import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createLifecycleRecoveryCapsule,
  createTurnLifecycle,
  recordLifecycleContext,
  recordLifecycleSteering,
} from '../src/engine/turnLifecycle.mjs';

const minutesArg = process.argv.find((value) => value.startsWith('--minutes='));
const requestedMinutes = Math.max(0.05, Number(minutesArg?.split('=')[1]) || 0.1);
const durationMs = requestedMinutes * 60_000;
const port = Number(process.env.TAIJI_DEBUG_PORT || 9334);
const endpoint = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function targets() { return (await fetch(`${endpoint}/json`)).json(); }
async function waitForTargets(minimum, timeoutMs = 20_000) {
  const startedAt = Date.now();
  let latest = [];
  while (Date.now() - startedAt < timeoutMs) {
    latest = await targets();
    if (latest.length >= minimum) return latest;
    await sleep(200);
  }
  throw new Error(`Expected at least ${minimum} Electron windows, found ${latest.length}`);
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
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
    setTimeout(() => { if (pending.delete(requestId)) reject(new Error(`${method} timed out`)); }, 15000);
  });
  const evaluate = async (expression) => (await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  await command('Runtime.enable');
  await command('Performance.enable');
  return { socket, command, evaluate };
}

const initialTargets = await targets();
const mainTarget = initialTargets.find((target) => !target.url.includes('#chat') && !target.url.includes('#tool') && !target.url.includes('#settings'));
assert(mainTarget, 'Electron main window was not found');
const main = await connect(mainTarget);
const bridgeStartedAt = Date.now();
while (Date.now() - bridgeStartedAt < 30_000) {
  const ready = await main.evaluate("Boolean(window.electronAPI?.openChat && window.electronAPI?.openTool && window.electronAPI?.openSettings)");
  if (ready) break;
  await sleep(200);
}
assert.equal(await main.evaluate("Boolean(window.electronAPI?.openChat && window.electronAPI?.openTool && window.electronAPI?.openSettings)"), true, 'Electron preload bridge did not become ready');
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
  console.log('[phase2-soak] opening', `${item.kind}:${item.type || 'settings'}:${item.refId || ''}`);
  let result;
  if (item.kind === 'chat') result = await main.evaluate(`window.electronAPI.openChat(${JSON.stringify({ type: item.type, refId: item.refId || '' })})`);
  else if (item.kind === 'settings') result = await main.evaluate('window.electronAPI.openSettings()');
  else result = await main.evaluate(`window.electronAPI.openTool(${JSON.stringify({ type: item.type, refId: item.refId || '' })})`);
  assert.equal(result?.ok, true, `${item.kind}:${item.type || 'settings'}:${item.refId || ''} failed: ${result?.error || 'unknown error'}`);
  console.log('[phase2-soak] opened', `${item.kind}:${item.type || 'settings'}:${item.refId || ''}`, result);
  opened.push({ ...item, reused: result.reused === true });
}
const openedTargets = await waitForTargets(10);
const clients = [];
for (const target of openedTargets) clients.push(await connect(target));
assert(clients.length >= 10, `Expected at least 10 Electron windows, found ${clients.length}`);

const taskId = `phase2-soak-${Date.now()}`;
const taskInput = {
  id: taskId,
  taskType: 'team',
  teamId: 'phase2-soak-team',
  conversationId: 'phase2-soak-conversation',
  goal: '持续整理一份可恢复的项目检查清单，并在长时间运行期间保留用户插话和压缩摘要。',
  acceptanceCriteria: ['检查点连续', '上下文压缩后目标不丢失', '用户插话可恢复'],
  steps: [{ id: 'sustain', title: '持续整理项目检查清单', employeeId: 'phase2-worker', assignment: '保持任务运行并周期性保存进度。' }],
};
const created = await main.evaluate(`window.electronAPI.taskServiceCreate(${JSON.stringify(taskInput)})`);
assert.equal(created?.ok, true, created?.error || 'Soak task could not be created');
const claimed = await main.evaluate(`window.electronAPI.taskWorkerCommand(${JSON.stringify({
  commandId: `claim-${taskId}`, taskId, type: 'claim', payload: { adapter: 'main-native-execution-adapter', activity: '耐久任务已开始' },
})})`);
assert.equal(claimed?.ok, true, claimed?.error || 'Soak task could not be claimed');
const leaseId = claimed.run.worker.leaseId;
let lifecycle = createTurnLifecycle({ taskId, conversationId: taskInput.conversationId, goal: taskInput.goal, deliverableType: 'answer' });
lifecycle = recordLifecycleContext(lifecycle, {
  compacted: true, stage: 2, estimatedTokens: 32000, contextWindowTokens: 128000,
  summary: '目标是持续整理项目检查清单；已建立后台租约，尚未完成最终验收。',
  unresolvedIssues: ['仍需完成持续运行观察'],
});
lifecycle = recordLifecycleSteering(lifecycle, '用户插话：完成前保留所有检查点，不要重开任务。');
let lifecycleSaved = await main.evaluate(`window.electronAPI.taskServiceLifecycle(${JSON.stringify({
  taskId, lifecycle, recovery: createLifecycleRecoveryCapsule(lifecycle, { reason: '耐久测试首个恢复胶囊', nextAction: '继续当前步骤' }),
})})`);
assert.equal(lifecycleSaved?.ok, true, lifecycleSaved?.error || 'Initial lifecycle could not be recorded');
const startedCheckpoint = await main.evaluate(`window.electronAPI.taskWorkerCommand(${JSON.stringify({
  commandId: `checkpoint-start-${taskId}`, taskId, type: 'checkpoint', payload: { leaseId, checkpoint: { checkpointId: `cp-${taskId}-1`, sequence: 1, kind: 'step_started', stepId: 'sustain', summary: '开始持续整理' } },
})})`);
assert.equal(startedCheckpoint?.ok, true, startedCheckpoint?.error || 'Initial checkpoint could not be recorded');

const startedAt = Date.now();
const samples = [];
const intervalMs = Math.max(1000, Math.min(10_000, Math.floor(durationMs / 12)));
let steeringUpdated = false;
while (Date.now() - startedAt < durationMs) {
  const currentTargets = await targets();
  assert(currentTargets.length >= 10, `Window count dropped to ${currentTargets.length}`);
  const metrics = [];
  for (const client of clients) {
    const response = await client.command('Performance.getMetrics');
    const values = Object.fromEntries(response.metrics.map((metric) => [metric.name, metric.value]));
    metrics.push({ jsHeapUsed: values.JSHeapUsedSize || 0, nodes: values.Nodes || 0, documents: values.Documents || 0 });
  }
  samples.push({ ts: Date.now(), windows: currentTargets.length, heapBytes: metrics.reduce((total, item) => total + item.jsHeapUsed, 0), nodes: metrics.reduce((total, item) => total + item.nodes, 0), documents: metrics.reduce((total, item) => total + item.documents, 0) });
  const heartbeat = await main.evaluate(`window.electronAPI.taskWorkerCommand(${JSON.stringify({
    taskId, type: 'heartbeat', payload: { leaseId, progressAt: Date.now(), activity: '持续任务正在整理检查清单' },
  })})`);
  assert.equal(heartbeat?.ok, true, heartbeat?.error || 'Long-running task heartbeat failed');
  if (!steeringUpdated && Date.now() - startedAt >= durationMs / 2) {
    lifecycle = recordLifecycleContext(lifecycle, {
      compacted: true, stage: 3, estimatedTokens: 18000, contextWindowTokens: 128000,
      summary: '目标保持不变；耐久观察仍在进行；首条用户插话已经并入当前任务。',
      unresolvedIssues: ['等待耐久窗口结束并写入最终检查点'],
    });
    lifecycle = recordLifecycleSteering(lifecycle, '用户插话：最终报告必须明确检查点序号和恢复状态。');
    lifecycleSaved = await main.evaluate(`window.electronAPI.taskServiceLifecycle(${JSON.stringify({
      taskId, lifecycle, recovery: createLifecycleRecoveryCapsule(lifecycle, { reason: '耐久测试中段恢复胶囊', nextAction: '从 sustain 步骤继续' }),
    })})`);
    assert.equal(lifecycleSaved?.ok, true, lifecycleSaved?.error || 'Updated lifecycle could not be recorded');
    steeringUpdated = true;
  }
  await sleep(Math.min(intervalMs, Math.max(0, durationMs - (Date.now() - startedAt))));
}
const first = samples[0];
const last = samples.at(-1);
const heapGrowthMb = Math.max(0, (last.heapBytes - first.heapBytes) / 1024 / 1024);
assert(heapGrowthMb < 128, `Renderer heap grew by ${heapGrowthMb.toFixed(1)}MB during the run`);
const completedCheckpoint = await main.evaluate(`window.electronAPI.taskWorkerCommand(${JSON.stringify({
  commandId: `checkpoint-complete-${taskId}`, taskId, type: 'checkpoint', payload: { leaseId, checkpoint: { checkpointId: `cp-${taskId}-2`, sequence: 2, kind: 'step_completed', stepId: 'sustain', summary: '耐久观察完成' } },
})})`);
assert.equal(completedCheckpoint?.ok, true, completedCheckpoint?.error || 'Completion checkpoint could not be recorded');
const finished = await main.evaluate(`window.electronAPI.taskWorkerCommand(${JSON.stringify({
  commandId: `checkpoint-finish-${taskId}`, taskId, type: 'checkpoint', payload: { leaseId, checkpoint: { checkpointId: `cp-${taskId}-3`, sequence: 3, kind: 'run_finished', finalStatus: 'completed', summary: '耐久任务验收完成' } },
})})`);
assert.equal(finished?.ok, true, finished?.error || 'Final checkpoint could not be recorded');
const finalSnapshot = await main.evaluate(`window.electronAPI.taskServiceRead(${JSON.stringify({ taskId })})`);
const finalRun = finalSnapshot?.runs?.[0];
assert.equal(finalRun?.status, 'completed');
assert.equal(finalRun?.worker?.checkpointSequence, 3);
assert.equal(finalRun?.residencyCheckpoint?.checkpointSequence, 3);
assert.equal(finalRun?.turnLifecycle?.context?.compactions, 2);
assert.ok(finalRun?.turnLifecycle?.steering?.some((item) => String(item.message).includes('检查点序号')), 'Latest user steering was not retained');
assert.match(String(finalRun?.turnLifecycle?.context?.summary), /目标保持不变/u);
const workerJournal = await main.evaluate(`window.electronAPI.taskWorkerCommands(${JSON.stringify({ taskId, limit: 200 })})`);
assert.equal(workerJournal?.integrity?.ok, true);
assert.ok(workerJournal.records.filter((item) => item.taskId === taskId && item.type === 'command_completed').length >= 3);
const report = {
  passed: true, requestedMinutes, actualMinutes: Number(((Date.now() - startedAt) / 60000).toFixed(2)), formalEightHourRun: requestedMinutes >= 480,
  windows: last.windows, opened, samples: samples.length, heapGrowthMb: Number(heapGrowthMb.toFixed(2)), first, last,
  task: { taskId, status: finalRun.status, checkpointSequence: finalRun.worker.checkpointSequence, residencySequence: finalRun.residencyCheckpoint.checkpointSequence, contextCompactions: finalRun.turnLifecycle.context.compactions, retainedSteering: finalRun.turnLifecycle.steering.map((item) => item.message) },
};
await fs.mkdir(path.resolve('artifacts', 'performance'), { recursive: true });
await fs.writeFile(path.resolve('artifacts', 'performance', `phase2-soak-${Date.now()}.json`), JSON.stringify(report, null, 2));
clients.forEach((client) => client.socket.close());
main.socket.close();
console.log(JSON.stringify(report, null, 2));
