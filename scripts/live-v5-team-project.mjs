import fs from 'node:fs/promises';

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9336);
const endpoint = `http://127.0.0.1:${debugPort}`;
const request = 'Autonomously build a small but complete collaboration team for this project: create an offline project risk dashboard web app with adding risks, status filters, priority labels, JSON and Markdown export, and both desktop and mobile layouts. First understand the goal, choose suitable employees, create an isolated project workspace and phased plan, then execute until file writing, runtime verification, and a final progress report all have evidence. Do not inherit old chats, old projects, or old approvals.';
const resultRoot = 'test-results/v5-live-team';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listTargets() {
  const response = await fetch(`${endpoint}/json`);
  if (!response.ok) throw new Error(`Cannot read debug endpoint ${debugPort}`);
  return response.json();
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', async (event) => {
    const raw = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(raw);
    const requestState = pending.get(message.id);
    if (!requestState) return;
    pending.delete(message.id);
    if (message.error) requestState.reject(new Error(message.error.message));
    else requestState.resolve(message.result);
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
    return result.result.value;
  };
  await command('Runtime.enable');
  return { socket, evaluate };
}

async function waitFor(check, message, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

async function snapshot(page, conversationId) {
  return page.evaluate(`(() => {
    const projectStore = JSON.parse(localStorage.getItem('taiji_conversation_projects_v1') || '[]');
    const runStore = JSON.parse(localStorage.getItem('hermes_office_task_runs_v1') || '[]');
    const projects = Array.isArray(projectStore) ? projectStore : Object.values(projectStore || {}).flatMap((value) => Array.isArray(value) ? value : [value]);
    const runs = Array.isArray(runStore) ? runStore : Object.values(runStore || {}).flatMap((value) => Array.isArray(value) ? value : [value]);
    const sessions = JSON.parse(localStorage.getItem('taiji_chat_sessions_v1') || '{}');
    return {
      activeConversationId: sessions.activeByScope?.assistant || '',
      bodyText: document.body.innerText.slice(-12000),
      projects: projects.filter((item) => item.conversationId === ${JSON.stringify(conversationId)}),
      runs: runs.filter((item) => item.conversationId === ${JSON.stringify(conversationId)}),
      approvalCards: document.querySelectorAll('.project-approval-card').length,
      activity: JSON.parse(localStorage.getItem('hermes_office_assistant_activity') || '{}'),
    };
  })()`);
}

const target = (await listTargets()).find((item) => item.url.includes('#chat?type=assistant-chat'));
if (!target) throw new Error('Assistant window is not open');
const page = await connect(target);
try {
  const previousConversationId = await page.evaluate("JSON.parse(localStorage.getItem('taiji_chat_sessions_v1') || '{}').activeByScope?.assistant || ''");
  const opened = await page.evaluate("(() => { const button = document.querySelector('.chat-new-session-btn'); if (!(button instanceof HTMLButtonElement) || button.disabled) return false; button.click(); return true; })()");
  if (!opened) throw new Error('New chat control is unavailable');
  const conversationId = await waitFor(async () => {
    const active = await page.evaluate("JSON.parse(localStorage.getItem('taiji_chat_sessions_v1') || '{}').activeByScope?.assistant || ''");
    return active && active !== previousConversationId ? active : '';
  }, 'New conversation was not created');
  await delay(1_000);
  const sent = await page.evaluate(`(async () => {
    const input = document.querySelector('textarea');
    if (!(input instanceof HTMLTextAreaElement)) return { ok: false, reason: 'no-textarea' };
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(request)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const button = document.querySelector('button.btn-primary');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return { ok: false, reason: 'send-disabled' };
    button.click();
    return { ok: true };
  })()`);
  if (!sent.ok) throw new Error(`Request send failed: ${sent.reason}`);

  let state = {};
  let previousSignature = '';
  const startedAt = Date.now();
  while (Date.now() - startedAt < 180_000) {
    state = await snapshot(page, conversationId);
    const signature = JSON.stringify({ projects: state.projects.length, runs: state.runs.length, approvalCards: state.approvalCards, activity: state.activity.state, body: state.bodyText.slice(-600) });
    if (signature !== previousSignature) {
      console.log(JSON.stringify({ at: new Date().toISOString(), conversationId, ...state }, null, 2));
      previousSignature = signature;
    }
    if (state.projects.length || state.runs.length || state.approvalCards) break;
    await delay(1_000);
  }
  await fs.mkdir(resultRoot, { recursive: true });
  await fs.writeFile(`${resultRoot}/initial.json`, `${JSON.stringify({ request, conversationId, state }, null, 2)}\n`, 'utf8');
} finally {
  page.socket.close();
}
