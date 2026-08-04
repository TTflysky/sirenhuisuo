import fs from 'node:fs/promises';
import path from 'node:path';

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9333);
const endpoint = `http://127.0.0.1:${debugPort}`;
const outputDir = path.resolve('docs', 'screenshots');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForMainTarget(timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const targets = await (await fetch(`${endpoint}/json`)).json();
      const target = targets.find((item) => item.type === 'page'
        && /^https?:\/\//u.test(item.url || '')
        && !item.url.includes('#chat')
        && !item.url.includes('#settings')
        && !item.url.includes('#tool'));
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await delay(150);
  }
  throw new Error('没有找到可截图的太极主窗口');
}

async function connect(target) {
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
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 15000);
      pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
    });
  };
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本执行失败');
    return result.result.value;
  };
  await command('Runtime.enable');
  await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return { socket, command, evaluate };
}

async function capture(client, filename) {
  const shot = await client.command('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const output = path.join(outputDir, filename);
  await fs.writeFile(output, Buffer.from(shot.data, 'base64'));
  return output;
}

await fs.mkdir(outputDir, { recursive: true });
const client = await connect(await waitForMainTarget());
try {
  await delay(1200);
  const office = await capture(client, 'office-overview.png');
  const opened = await client.evaluate(`(() => {
    const target = [...document.querySelectorAll('.view-tabs .ant-segmented-item-label')]
      .find((item) => item.textContent?.includes('技能库'));
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    return Boolean(target);
  })()`);
  if (!opened) throw new Error('没有找到技能库入口');
  await delay(1000);
  const skills = await capture(client, 'skill-library.png');
  console.log(JSON.stringify({ passed: true, screenshots: [office, skills] }, null, 2));
} finally {
  client.socket.close();
}
