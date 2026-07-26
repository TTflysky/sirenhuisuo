import http from 'node:http';

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9334);
const modelPort = Number(process.env.TAIJI_FAKE_MODEL_PORT || 9445);
const endpoint = `http://127.0.0.1:${debugPort}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, message, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await check();
    if (value) return value;
    await delay(80);
  }
  throw new Error(message);
}

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
  return { socket, evaluate };
}

const requests = [];
const server = http.createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => { raw += chunk; });
  request.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    requests.push(body);
    const requestNumber = requests.length;
    const messageText = Array.isArray(body.messages) ? body.messages.map((message) => String(message?.content ?? '')).join('\n') : '';
    const isInitialTask = messageText.includes('配置 IMA 知识库');
    const isSteering = messageText.includes('没有任何意义');
    const content = isSteering
      ? '你说得对。我已停止重复路线，原任务保持暂停，不会自行恢复。'
      : '这是旧任务模型响应。';
    const send = () => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        id: `fake-${requestNumber}`,
        model: 'taiji-steering-test',
        choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      }));
    };
    if (isInitialTask && !isSteering) setTimeout(send, 5000);
    else send();
  });
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(modelPort, '127.0.0.1', resolve);
});

let page;
try {
  const target = (await listTargets()).find((item) => item.url.includes('#chat?type=assistant-chat'));
  if (!target) throw new Error('没有找到助手聊天窗口');
  page = await connect(target);
  await page.evaluate(`(() => {
    localStorage.setItem('hermes_office_settings', JSON.stringify({
      modelLibrary: [{
        id: 'steering-e2e', label: '插话回归模型', provider: 'custom',
        apiHost: 'http://127.0.0.1:${modelPort}/v1', apiKey: 'local-test-only',
        model: 'taiji-steering-test', contextWindowTokens: 32000
      }],
      activeModelId: 'steering-e2e', assistantModelId: 'steering-e2e',
      followUpMode: 'steer', showThoughtChain: true
    }));
    localStorage.removeItem('hermes_office_assistant_chat');
    location.reload();
    return true;
  })()`);

  await waitFor(() => page.evaluate(`Boolean(document.querySelector('textarea'))`), '助手输入框没有加载');
  const sendMessage = (text, buttonText) => page.evaluate(`(async () => {
    const input = document.querySelector('textarea');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(buttonText)});
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);

  if (!await sendMessage('请读取技能并配置 IMA 知识库。', '发送')) throw new Error('无法发送初始任务');
  try {
    await waitFor(
      () => requests.some((body) => (body.messages ?? []).some((message) => String(message?.content ?? '').includes('配置 IMA 知识库'))),
      '假模型没有收到初始任务',
    );
  } catch (error) {
    const diagnostics = await page.evaluate(`({
      body: document.body.innerText.slice(-3000),
      settings: localStorage.getItem('hermes_office_settings'),
      sendButtons: [...document.querySelectorAll('button')].map((item) => ({ text: item.textContent.trim(), disabled: item.disabled })).filter((item) => item.text === '发送' || item.text === '引导')
    })`);
    console.error(JSON.stringify({ diagnostics }, null, 2));
    throw error;
  }
  const paused = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === '暂停');
    button?.click();
    return Boolean(button);
  })()`);
  if (!paused) throw new Error('没有找到暂停按钮');
  await waitFor(() => page.evaluate(`document.body.innerText.includes('任务已暂停')`), '暂停后没有明确反馈');

  if (!await sendMessage('你这样的操作没有任何意义，一直重复读取技能。', '引导')) throw new Error('无法发送运行中反馈');
  await waitFor(
    () => requests.some((body) => (body.messages ?? []).some((message) => String(message?.content ?? '').includes('没有任何意义'))),
    '新反馈没有中断旧模型并触发优先回答',
  );
  await waitFor(
    () => page.evaluate(`document.body.innerText.includes('原任务保持暂停，不会自行恢复')`),
    '助手没有显示结合上下文的插话回复',
  );
  const taskRequestCount = () => requests.filter((body) => {
    const text = (body.messages ?? []).map((message) => String(message?.content ?? '')).join('\n');
    return text.includes('配置 IMA 知识库') || text.includes('没有任何意义');
  }).length;
  const countAfterReply = taskRequestCount();
  await delay(1800);
  const ui = await page.evaluate(`({
    paused: document.body.innerText.includes('任务已暂停'),
    replyVisible: document.body.innerText.includes('原任务保持暂停，不会自行恢复')
  })`);
  const steeringRequest = requests.find((body) => (body.messages ?? []).some((message) => String(message?.content ?? '').includes('没有任何意义')));
  const steeringMessages = steeringRequest?.messages ?? [];
  const steeringIncluded = steeringMessages.some((message) => String(message?.content ?? '').includes('没有任何意义'));
  const countStable = taskRequestCount() === countAfterReply;
  const passed = countStable && ui.paused && ui.replyVisible && steeringIncluded;
  console.log(JSON.stringify({ passed, requestCount: requests.length, taskRequestCount: taskRequestCount(), countStable, steeringIncluded, ui }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  page?.socket.close();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}
