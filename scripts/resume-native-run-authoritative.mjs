import assert from 'node:assert/strict';

const runId = process.argv[2];
if (!runId) throw new Error('Usage: node scripts/resume-native-run-authoritative.mjs <runId>');

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9336);
const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
if (!response.ok) throw new Error(`Cannot read Taiji debug port ${debugPort}`);
const targets = await response.json();
const target = targets.find((item) => !item.url.includes('#chat') && !item.url.includes('#tool') && !item.url.includes('#settings'));
assert.ok(target?.webSocketDebuggerUrl, 'Main Taiji window is not open');

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;
socket.addEventListener('message', async (event) => {
  const raw = typeof event.data === 'string' ? event.data : await event.data.text();
  const message = JSON.parse(raw);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Page evaluation failed');
  return result.result.value;
}

await command('Runtime.enable');
try {
  const result = await evaluate(`(async () => {
    const taskId = ${JSON.stringify(runId)};
    const beforeResult = await window.electronAPI.taskStoreQuery({ taskId, limit: 1 });
    const before = beforeResult?.runs?.find((item) => item.id === taskId);
    if (!before) return { ok: false, error: 'run-not-found' };
    if (['queued', 'running'].includes(before.status)) return { ok: true, unchanged: true, status: before.status };
    if (!['failed', 'paused', 'awaiting_user'].includes(before.status)) return { ok: false, error: 'not-resumable', status: before.status };
    const resumed = await window.electronAPI.taskWorkerCommand({
      commandId: 'authoritative-resume-' + taskId + '-' + Date.now(),
      taskId,
      type: 'resume',
      requestedBy: 'authoritative-diagnostic',
    });
    return { ok: resumed?.ok === true, error: resumed?.error, status: resumed?.run?.status, run: resumed?.run };
  })()`);
  assert.equal(result?.ok, true, result?.error || `Run ${runId} could not resume`);
  console.log(JSON.stringify({ passed: true, runId, status: result.status, unchanged: result.unchanged === true }, null, 2));
} finally {
  socket.close();
}
