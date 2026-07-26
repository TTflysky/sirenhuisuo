import fs from 'node:fs/promises';
import path from 'node:path';

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9334);
const endpoint = `http://127.0.0.1:${debugPort}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listTargets() {
  const response = await fetch(`${endpoint}/json`);
  if (!response.ok) throw new Error(`无法读取 Electron 调试端口 ${debugPort}`);
  return response.json();
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', async (event) => {
    const raw = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(raw);
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
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
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
    return result.result.value;
  };
  await command('Runtime.enable');
  await command('Page.enable');
  return { socket, command, evaluate };
}

const targets = await listTargets();
const mainTarget = targets.find((target) => !target.url.includes('#chat') && !target.url.includes('#tool') && !target.url.includes('#settings'));
if (!mainTarget) throw new Error('没有找到太极主窗口');
const main = await connect(mainTarget);
let tool;
try {
  const openResult = await main.evaluate(`window.electronAPI.openTool({
    type: 'connector-config',
    refId: 'window-size-verification',
    payload: {
      id: 'window-size-verification', label: 'GitHub', icon: '', type: 'custom', kind: 'legacy',
      status: 'unknown', enabled: false, baseUrl: 'https://api.github.com', auth: { type: 'bearer' }, headers: {}
    }
  })`);
  if (!openResult?.ok) throw new Error(openResult?.error || '连接器窗口没有打开');
  await delay(900);
  const toolTarget = (await listTargets()).find((target) => target.url.includes('#tool?type=connector-config'));
  if (!toolTarget) throw new Error('没有找到连接器工具窗口');
  tool = await connect(toolTarget);
  const metrics = await tool.evaluate(`(() => {
    const actions = document.querySelector('.knowledge-config-actions');
    const rect = actions?.getBoundingClientRect();
    return {
      outerWidth, outerHeight, innerWidth, innerHeight,
      availableHeight: screen.availHeight,
      actionsFound: Boolean(actions),
      actionsTop: rect ? Math.round(rect.top) : -1,
      actionsBottom: rect ? Math.round(rect.bottom) : -1,
      bodyScrollHeight: document.body.scrollHeight,
    };
  })()`);
  const expectedHeight = Math.min(800, metrics.availableHeight - 16);
  const passed = metrics.outerHeight >= expectedHeight
    && metrics.actionsFound
    && metrics.actionsTop >= 40
    && metrics.actionsBottom <= metrics.innerHeight;
  const outputDir = path.resolve('artifacts', 'ui-verification');
  await fs.mkdir(outputDir, { recursive: true });
  const shot = await tool.command('Page.captureScreenshot', { format: 'png' });
  const screenshot = path.join(outputDir, 'connector-default-size.png');
  await fs.writeFile(screenshot, Buffer.from(shot.data, 'base64'));
  console.log(JSON.stringify({ passed, metrics, screenshot }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  try { await tool?.evaluate('window.electronAPI.close()'); } catch {}
  tool?.socket.close();
  main.socket.close();
}
