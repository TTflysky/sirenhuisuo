import assert from 'node:assert/strict';

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9336);
const workspaceId = process.argv[2];
const artifactPath = process.argv[3];
assert.ok(workspaceId && artifactPath, 'Usage: node scripts/verify-live-web-artifact-tool.mjs <workspaceId> <html-path>');

const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
const target = targets.find((item) => item.type === 'page' && item.url.includes('index.html')) || targets.find((item) => item.type === 'page');
assert.ok(target, '没有找到正在运行的太极页面');

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
const command = (method, params = {}) => {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
try {
  const expression = `window.electronAPI.verifyWebArtifact(${JSON.stringify({ workspaceId, path: artifactPath })})`;
  const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || '网页验收调用失败');
  const result = response.result.value;
  assert.ok(result && Array.isArray(result.viewports), '客户端没有返回结构化网页验收结果');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 2;
} finally {
  socket.close();
}
