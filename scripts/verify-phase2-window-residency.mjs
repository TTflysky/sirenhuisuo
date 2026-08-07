import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const minutesArg = process.argv.find((value) => value.startsWith('--minutes='));
const requestedMinutes = Math.max(0.05, Number(minutesArg?.split('=')[1]) || 0.1);
const durationMs = requestedMinutes * 60_000;
const port = Number(process.env.TAIJI_DEBUG_PORT || 9334);
const endpoint = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function targets() {
  const entries = await (await fetch(`${endpoint}/json`)).json();
  return entries.filter((target) => target.type === 'page' && /^https?:\/\//iu.test(target.url || ''));
}

async function waitForTargets(minimum, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let latest = [];
  while (Date.now() - startedAt < timeoutMs) {
    latest = await targets();
    if (latest.length >= minimum) return latest;
    await sleep(250);
  }
  throw new Error(`Expected ${minimum} Electron windows, found ${latest.length}`);
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let id = 0;
  socket.addEventListener('message', async (event) => {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : await event.data.text());
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const command = (method, params = {}, timeoutMs = 20_000) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => {
      if (!pending.delete(requestId)) return;
      reject(new Error(`${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async (expression) => (await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  await command('Runtime.enable');
  return { socket, evaluate };
}

const initialTargets = await targets();
const mainTarget = initialTargets.find((target) => !target.url.includes('#chat') && !target.url.includes('#tool') && !target.url.includes('#settings'));
assert(mainTarget, 'Electron main window was not found');
const main = await connect(mainTarget);

const bridgeStartedAt = Date.now();
while (Date.now() - bridgeStartedAt < 30_000) {
  const ready = await main.evaluate("Boolean(window.electronAPI?.openChat && window.electronAPI?.openTool && window.electronAPI?.openSettings && window.electronAPI?.autonomyEvaluationSummary)");
  if (ready) break;
  await sleep(200);
}
assert.equal(await main.evaluate("Boolean(window.electronAPI?.openChat && window.electronAPI?.openTool && window.electronAPI?.openSettings && window.electronAPI?.autonomyEvaluationSummary)"), true, 'Electron preload bridge did not become ready');
const autonomySummary = await main.evaluate('window.electronAPI.autonomyEvaluationSummary()');
assert.equal(autonomySummary?.ok, true, autonomySummary?.error || 'V5.8 autonomy evaluation IPC did not become ready');

const taskId = `window-residency-${Date.now()}`;
const taskInput = {
  id: taskId,
  taskType: 'team',
  teamId: 'window-residency-team',
  conversationId: 'window-residency-conversation',
  goal: 'Keep an auditable task checkpoint while desktop windows remain resident.',
  acceptanceCriteria: ['checkpoint sequence is durable', 'final task state is completed'],
  steps: [{ id: 'residency', title: 'Record durable window-residency checkpoint', employeeId: 'residency-worker', assignment: 'Record completion evidence.' }],
};
const created = await main.evaluate(`window.electronAPI.taskServiceCreate(${JSON.stringify(taskInput)})`);
assert.equal(created?.ok, true, created?.error || 'Residency task could not be created');
const claimed = await main.evaluate(`window.electronAPI.taskWorkerCommand(${JSON.stringify({
  commandId: `claim-${taskId}`, taskId, type: 'claim', payload: { adapter: 'main-native-execution-adapter', activity: 'Window residency verification started' },
})})`);
assert.equal(claimed?.ok, true, claimed?.error || 'Residency task could not be claimed');
const leaseId = claimed.run.worker.leaseId;
for (const checkpoint of [
  { sequence: 1, kind: 'step_started', stepId: 'residency', summary: 'Window residency verification started' },
  { sequence: 2, kind: 'step_completed', stepId: 'residency', summary: 'Window residency verification completed' },
  { sequence: 3, kind: 'run_finished', finalStatus: 'completed', summary: 'Window residency task completed' },
]) {
  const result = await main.evaluate(`window.electronAPI.taskWorkerCommand(${JSON.stringify({
    commandId: `checkpoint-${checkpoint.sequence}-${taskId}`, taskId, type: 'checkpoint', payload: { leaseId, checkpoint: { checkpointId: `checkpoint-${checkpoint.sequence}-${taskId}`, ...checkpoint } },
  })})`);
  assert.equal(result?.ok, true, result?.error || `Checkpoint ${checkpoint.sequence} failed`);
}
const taskSnapshot = await main.evaluate(`window.electronAPI.taskServiceRead(${JSON.stringify({ taskId })})`);
const taskRun = taskSnapshot?.runs?.[0];
assert.equal(taskRun?.status, 'completed');
assert.equal(taskRun?.worker?.checkpointSequence, 3);

const windows = [
  { kind: 'chat', type: 'assistant-chat' },
  ...['emp-pm', 'emp-planner', 'emp-coder', 'emp-checker'].map((refId) => ({ kind: 'chat', type: 'dm-chat', refId })),
  { kind: 'chat', type: 'team-chat', refId: 'team-opc' },
  { kind: 'settings' },
  { kind: 'tool', type: 'add-employee' },
  { kind: 'tool', type: 'create-team' },
  { kind: 'tool', type: 'assistant-settings' },
  { kind: 'tool', type: 'edit-employee', refId: 'emp-pm' },
];
const opened = [];
for (const item of windows) {
  let result;
  if (item.kind === 'chat') result = await main.evaluate(`window.electronAPI.openChat(${JSON.stringify({ type: item.type, refId: item.refId || '' })})`);
  else if (item.kind === 'settings') result = await main.evaluate('window.electronAPI.openSettings()');
  else result = await main.evaluate(`window.electronAPI.openTool(${JSON.stringify({ type: item.type, refId: item.refId || '' })})`);
  assert.equal(result?.ok, true, `${item.kind}:${item.type || 'settings'} failed: ${result?.error || 'unknown error'}`);
  opened.push({ ...item, reused: result.reused === true });
}

const expectedWindowCount = 12;
await waitForTargets(expectedWindowCount);
await sleep(3_000);
const startedAt = Date.now();
const samples = [];
const intervalMs = Math.max(1_000, Math.min(10_000, Math.floor(durationMs / 12)));
while (Date.now() - startedAt < durationMs) {
  const currentTargets = await targets();
  assert(currentTargets.length >= expectedWindowCount, `Window count dropped to ${currentTargets.length}`);
  samples.push({ ts: Date.now(), windows: currentTargets.length, routes: currentTargets.map((target) => target.url.replace(/^[^#]*#?/u, '#').slice(0, 180)).sort() });
  await sleep(Math.min(intervalMs, Math.max(0, durationMs - (Date.now() - startedAt))));
}
const finalTargets = await targets();
assert(finalTargets.length >= expectedWindowCount, `Window count dropped to ${finalTargets.length} before test completion`);

const report = {
  passed: true,
  requestedMinutes,
  actualMinutes: Number(((Date.now() - startedAt) / 60_000).toFixed(2)),
  formalEightHourRun: requestedMinutes >= 480,
  expectedWindowCount,
  windows: finalTargets.length,
  opened,
  samples,
  task: { taskId, status: taskRun.status, checkpointSequence: taskRun.worker.checkpointSequence },
  note: 'Task durability is verified before the residency interval; continuous task recovery is covered by the dedicated V5.8 long-task gate.',
};
await fs.mkdir(path.resolve('artifacts', 'performance'), { recursive: true });
await fs.writeFile(path.resolve('artifacts', 'performance', `phase2-window-residency-${Date.now()}.json`), JSON.stringify(report, null, 2));
main.socket.close();
console.log(JSON.stringify(report, null, 2));
