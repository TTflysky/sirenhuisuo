const runId = process.argv[2];
const timeoutMs = Math.max(1_000, Number(process.argv[3]) || 900_000);
if (!runId) throw new Error('Usage: node scripts/monitor-live-native-run.mjs <runId> [timeoutMs]');

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9336);
const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
if (!response.ok) throw new Error(`Cannot read Taiji debug port ${debugPort}`);
const targets = await response.json();
const target = targets.find((item) => !item.url.includes('#chat') && !item.url.includes('#tool') && !item.url.includes('#settings'));
if (!target?.webSocketDebuggerUrl) throw new Error('Main Taiji window is not open');

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

async function snapshot() {
  const expression = `(() => {
    const runs = JSON.parse(localStorage.getItem('hermes_office_task_runs_v1') || '[]');
    const run = runs.find((item) => item.id === ${JSON.stringify(runId)});
    if (!run) return null;
    return {
      status: run.status,
      activity: run.worker?.activity || '',
      progressAt: run.worker?.progressAt || 0,
      artifacts: (run.artifacts || []).length,
      steps: (run.steps || []).map((step) => ({ id: step.id, status: step.status, attempts: step.attempts || 0 })),
    };
  })()`;
  const result = await command('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Page evaluation failed');
  return result.result.value;
}

await command('Runtime.enable');
const startedAt = Date.now();
let previous = '';
try {
  while (Date.now() - startedAt < timeoutMs) {
    const current = await snapshot();
    const serialized = JSON.stringify(current);
    if (serialized !== previous) {
      console.log(JSON.stringify({ at: new Date().toISOString(), ...current }));
      previous = serialized;
    }
    if (current && ['completed', 'failed', 'paused', 'awaiting_user', 'cancelled'].includes(current.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
} finally {
  socket.close();
}
