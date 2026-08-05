import fs from 'node:fs/promises';

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9336);
const endpoint = `http://127.0.0.1:${debugPort}`;
const resultRoot = 'test-results/v5-live-team';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', async (event) => {
    const raw = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(raw);
    const state = pending.get(message.id);
    if (!state) return;
    pending.delete(message.id);
    if (message.error) state.reject(new Error(message.error.message));
    else state.resolve(message.result);
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

const targets = await (await fetch(`${endpoint}/json`)).json();
const target = targets.find((item) => item.url.includes('#chat?type=assistant-chat'));
if (!target) throw new Error('Assistant window is not open');
const page = await connect(target);
try {
  const conversationId = await page.evaluate("JSON.parse(localStorage.getItem('taiji_chat_sessions_v1') || '{}').activeByScope?.assistant || ''");
  let previous = '';
  let state = {};
  const startedAt = Date.now();
  while (Date.now() - startedAt < 600_000) {
    state = await page.evaluate(`(async () => {
      const projectStore = JSON.parse(localStorage.getItem('taiji_conversation_projects_v1') || '[]');
      const runStore = JSON.parse(localStorage.getItem('hermes_office_task_runs_v1') || '[]');
      const projects = (Array.isArray(projectStore) ? projectStore : Object.values(projectStore || {}).flatMap((value) => Array.isArray(value) ? value : [value])).filter((item) => item?.conversationId === ${JSON.stringify(conversationId)});
      const runs = (Array.isArray(runStore) ? runStore : Object.values(runStore || {}).flatMap((value) => Array.isArray(value) ? value : [value])).filter((item) => item?.conversationId === ${JSON.stringify(conversationId)});
      return {
        conversationId: ${JSON.stringify(conversationId)},
        bodyText: document.body.innerText.slice(-14000),
        projects,
        runs,
        approvalCards: document.querySelectorAll('.project-approval-card').length,
        activity: JSON.parse(localStorage.getItem('hermes_office_assistant_activity') || '{}'),
      };
    })()`);
    const signature = JSON.stringify({ projects: state.projects.length, runs: state.runs.length, approvalCards: state.approvalCards, activity: state.activity.state, body: state.bodyText.slice(-800) });
    if (signature !== previous) {
      console.log(JSON.stringify({ at: new Date().toISOString(), ...state }, null, 2));
      previous = signature;
    }
    const statuses = state.runs.map((item) => item.status);
    if (statuses.some((status) => ['completed', 'failed', 'paused', 'awaiting_user', 'cancelled'].includes(status))) break;
    await delay(2_000);
  }
  await fs.mkdir(resultRoot, { recursive: true });
  await fs.writeFile(`${resultRoot}/final.json`, `${JSON.stringify({ capturedAt: new Date().toISOString(), ...state }, null, 2)}\n`, 'utf8');
} finally {
  page.socket.close();
}
