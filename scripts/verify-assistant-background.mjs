const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9333);
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
  return { socket, evaluate };
}

const targets = await listTargets();
const assistantTarget = targets.find((target) => target.url.includes('#chat?type=assistant-chat'));
const mainTarget = targets.find((target) => !target.url.includes('#chat') && !target.url.includes('#tool') && !target.url.includes('#settings'));
if (!assistantTarget || !mainTarget) throw new Error('需要同时打开主窗口和助理窗口');

const assistant = await connect(assistantTarget);
const main = await connect(mainTarget);

try {
  await assistant.evaluate(`(() => {
    clearInterval(window.__taijiBackgroundProbe);
    window.__taijiBackgroundProbeElapsed = 1;
    const publish = () => window.electronAPI.broadcast('assistant:activity-changed', {
      state: 'running',
      status: '正在验证后台执行…',
      completedActions: 2,
      elapsedSeconds: window.__taijiBackgroundProbeElapsed,
      updatedAt: Date.now(),
    });
    publish();
    window.__taijiBackgroundProbe = setInterval(() => { window.__taijiBackgroundProbeElapsed += 1; publish(); }, 1000);
    return true;
  })()`);
  await delay(250);

  const beforeClose = await main.evaluate(`(() => ({
    visible: Boolean(document.querySelector('.assistant-background-status')),
    text: document.querySelector('.assistant-background-status')?.textContent?.trim() || '',
    controls: [...document.querySelectorAll('.assistant-background-controls button')].map((button) => button.title),
  }))()`);

  await assistant.evaluate(`window.electronAPI.close()`);
  await delay(300);
  const afterCloseTargets = await listTargets();
  const rendererKeptAlive = afterCloseTargets.some((target) => target.id === assistantTarget.id);

  await delay(1250);
  const probeElapsed = await assistant.evaluate(`window.__taijiBackgroundProbeElapsed`);
  const afterClose = await main.evaluate(`(() => ({
    visible: Boolean(document.querySelector('.assistant-background-status')),
    text: document.querySelector('.assistant-background-status')?.textContent?.trim() || '',
  }))()`);

  const passed = beforeClose.visible
    && rendererKeptAlive
    && probeElapsed >= 2
    && afterClose.visible
    && beforeClose.controls.includes('完成当前动作后暂停')
    && beforeClose.controls.includes('完成当前动作后停止');

  console.log(JSON.stringify({ passed, beforeClose, rendererKeptAlive, probeElapsed, afterClose }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  try {
    await assistant.evaluate(`(() => {
      clearInterval(window.__taijiBackgroundProbe);
      delete window.__taijiBackgroundProbe;
      delete window.__taijiBackgroundProbeElapsed;
      window.electronAPI.broadcast('assistant:activity-changed', {
        state: 'idle', status: '', completedActions: 0, elapsedSeconds: 0, updatedAt: Date.now(),
      });
    })()`);
  } catch {}
  assistant.socket.close();
  main.socket.close();
}
