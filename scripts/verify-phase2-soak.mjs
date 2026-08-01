import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

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

const startedAt = Date.now();
const samples = [];
const intervalMs = Math.max(1000, Math.min(10_000, Math.floor(durationMs / 12)));
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
  await sleep(Math.min(intervalMs, Math.max(0, durationMs - (Date.now() - startedAt))));
}
const first = samples[0];
const last = samples.at(-1);
const heapGrowthMb = Math.max(0, (last.heapBytes - first.heapBytes) / 1024 / 1024);
assert(heapGrowthMb < 128, `Renderer heap grew by ${heapGrowthMb.toFixed(1)}MB during the run`);
const report = { passed: true, requestedMinutes, actualMinutes: Number(((Date.now() - startedAt) / 60000).toFixed(2)), formalEightHourRun: requestedMinutes >= 480, windows: last.windows, opened, samples: samples.length, heapGrowthMb: Number(heapGrowthMb.toFixed(2)), first, last };
await fs.mkdir(path.resolve('artifacts', 'performance'), { recursive: true });
await fs.writeFile(path.resolve('artifacts', 'performance', `phase2-soak-${Date.now()}.json`), JSON.stringify(report, null, 2));
clients.forEach((client) => client.socket.close());
main.socket.close();
console.log(JSON.stringify(report, null, 2));
