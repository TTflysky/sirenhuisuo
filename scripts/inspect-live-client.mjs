const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9336);
const endpoint = `http://127.0.0.1:${debugPort}`;

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
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面检查失败');
    return result.result.value;
  };
  await command('Runtime.enable');
  return { socket, evaluate };
}

const response = await fetch(`${endpoint}/json`);
const targets = await response.json();
const assistantTarget = targets.find((target) => target.url.includes('#chat?type=assistant-chat'));
if (!assistantTarget) throw new Error('没有找到已打开的助手窗口');
const page = await connect(assistantTarget);

try {
  const snapshot = await page.evaluate(`(() => {
    const settings = JSON.parse(localStorage.getItem('hermes_office_settings') || '{}');
    const sessions = JSON.parse(localStorage.getItem('taiji_chat_sessions_v1') || '{}');
    const activeModel = (settings.modelLibrary || []).find((item) => item.id === settings.assistantModelId)
      || (settings.modelLibrary || []).find((item) => item.id === settings.activeModelId);
    const runs = JSON.parse(localStorage.getItem('hermes_office_task_runs_v1') || '[]');
    const runTime = (run) => Number(run.createdAt || run.startedAt || run.updatedAt || String(run.id || '').match(/[0-9]{10,}/)?.[0] || 0);
    const latestRun = [...runs].sort((left, right) => runTime(right) - runTime(left))[0];
    return {
      title: document.title,
      body: document.body.innerText.slice(-6000),
      buttons: [...document.querySelectorAll('button')].map((button) => ({
        text: button.textContent?.trim() || '',
        title: button.title || button.getAttribute('aria-label') || '',
        disabled: button.disabled,
        className: String(button.className || ''),
      })).filter((button) => button.text || button.title),
      textarea: Boolean(document.querySelector('textarea')),
      approvalCards: document.querySelectorAll('.project-approval-card').length,
      storageKeys: Object.keys(localStorage).filter((key) => !/key|token|secret|password/iu.test(key)).sort(),
      activeConversationId: sessions.activeByScope?.assistant || '',
      sessionCount: sessions.sessions?.length || 0,
      activeModel: activeModel ? {
        id: activeModel.id,
        label: activeModel.label,
        provider: activeModel.provider,
        model: activeModel.model,
        configured: Boolean(activeModel.apiKey && activeModel.apiHost),
      } : null,
      latestRun: latestRun ? {
        id: latestRun.id,
        taskId: latestRun.taskId,
        teamId: latestRun.teamId,
        status: latestRun.status,
        workspace: latestRun.workspace,
        codingProjectVersion: latestRun.codingProject?.codingProjectVersion,
        steps: (latestRun.steps || []).map((step) => ({ id: step.id, status: step.status, kind: step.kind, attempts: step.attempts })),
      } : null,
    };
  })()`);
  console.log(JSON.stringify(snapshot, null, 2));
} finally {
  page.socket.close();
}
