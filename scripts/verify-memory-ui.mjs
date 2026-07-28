import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9335);
const endpoint = `http://127.0.0.1:${debugPort}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, message, timeoutMs = 15_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { lastError = error; }
    await delay(120);
  }
  throw new Error(`${message}${lastError ? `：${lastError.message}` : ''}`);
}

async function targets() {
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
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools 调用超时：${method}`)); }, 12_000);
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
  return { socket, command, evaluate };
}

const mainTarget = await waitFor(async () => (await targets()).find((target) => target.url && !target.url.includes('#')), '没有找到太极主窗口');
const main = await connect(mainTarget);
let settings;
try {
  const seeded = await main.evaluate(`window.electronAPI.memoryUpsert({ scope: 'organization', category: 'workflow', content: '记忆界面自动验证记录', source: 'UI 自动验证', sourceType: 'manual', importance: 5, confidence: 1 })`);
  assert.equal(seeded?.ok, true, seeded?.error || '无法写入验证记忆');
  const opened = await main.evaluate('window.electronAPI.openSettings()');
  assert.equal(opened?.ok, true, opened?.error || '无法打开设置窗口');
  const settingsTarget = await waitFor(async () => (await targets()).find((target) => target.url.includes('#settings')), '没有找到设置窗口');
  settings = await connect(settingsTarget);
  await settings.evaluate(`(() => {
    const button = [...document.querySelectorAll('.settings-nav-section button')].find((item) => item.textContent?.includes('记忆'));
    button?.click();
    return Boolean(button);
  })()`);
  const metrics = await waitFor(async () => settings.evaluate(`(() => {
    const page = document.querySelector('.memory-settings-page');
    const content = document.querySelector('.settings-center-content');
    if (!page || !content || document.querySelectorAll('.memory-status-strip > div').length !== 4) return null;
    const rect = content.getBoundingClientRect();
    return {
      statusCells: document.querySelectorAll('.memory-status-strip > div').length,
      capacityBars: document.querySelectorAll('.memory-capacity i').length,
      sectionHeads: document.querySelectorAll('.settings-memory-section-head').length,
      memoryRows: document.querySelectorAll('.settings-memory-layered .ant-tag').length,
      horizontalOverflow: content.scrollWidth > content.clientWidth + 1,
      canScroll: content.scrollHeight >= content.clientHeight,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      text: page.textContent?.slice(0, 4000) || '',
    };
  })()`), '记忆设置页没有完成渲染');
  assert.equal(metrics.statusCells, 4);
  assert.equal(metrics.capacityBars, 1);
  assert.ok(metrics.sectionHeads >= 1);
  assert.equal(metrics.horizontalOverflow, false);
  assert.match(metrics.text, /记忆界面自动验证记录/u);
  assert.match(metrics.text, /当前层容量/u);
  const screenshot = await settings.command('Page.captureScreenshot', { format: 'png' });
  const outputDir = path.resolve('artifacts', 'ui-verification');
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'memory-settings-v029.png');
  await fs.writeFile(outputPath, Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({ passed: true, metrics, screenshot: outputPath }, null, 2));
} finally {
  try { await settings?.evaluate('window.electronAPI.close()'); } catch {}
  settings?.socket.close();
  main.socket.close();
}
