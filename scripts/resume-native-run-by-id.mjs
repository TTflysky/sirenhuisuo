import assert from 'node:assert/strict';

const runId = process.argv[2];
if (!runId) throw new Error('Usage: node scripts/resume-native-run-by-id.mjs <runId>');

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9336);
const endpoint = `http://127.0.0.1:${debugPort}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function targets() {
  const response = await fetch(`${endpoint}/json`);
  if (!response.ok) throw new Error(`Cannot read Taiji debug port ${debugPort}`);
  return response.json();
}

async function waitFor(check, message, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await check().catch(() => undefined);
    if (value) return value;
    await delay(300);
  }
  throw new Error(message);
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
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Page evaluation failed');
    return result.result.value;
  };
  await command('Runtime.enable');
  return { socket, evaluate };
}

const allTargets = await targets();
const mainTarget = allTargets.find((target) => !target.url.includes('#chat') && !target.url.includes('#tool') && !target.url.includes('#settings'));
assert.ok(mainTarget, 'Main Taiji window is not open');
const main = await connect(mainTarget);
let team;

try {
  const run = await main.evaluate(`(() => {
    const runs = JSON.parse(localStorage.getItem('hermes_office_task_runs_v1') || '[]');
    const item = runs.find((candidate) => candidate.id === ${JSON.stringify(runId)});
    return item ? { id: item.id, teamId: item.teamId, status: item.status, title: item.title } : null;
  })()`);
  assert.ok(run?.teamId, `Run ${runId} was not found in renderer storage`);
  assert.ok(['failed', 'paused', 'awaiting_user'].includes(run.status), `Run ${runId} is not resumable (${run.status})`);

  const opened = await main.evaluate(`window.electronAPI.openChat(${JSON.stringify({ type: 'team-chat', refId: run.teamId })})`);
  assert.equal(opened?.ok, true, opened?.error || 'Team window did not open');
  const teamTarget = await waitFor(async () => (await targets()).find((target) => target.url.includes('#chat') && target.url.includes('type=team-chat') && target.url.includes(`id=${encodeURIComponent(run.teamId)}`)), 'Team window target did not appear');
  team = await connect(teamTarget);
  await waitFor(() => team.evaluate(`Boolean(document.querySelector('textarea'))`), 'Team window did not finish loading');

  const clickResult = await team.evaluate(`(async () => {
    const failedCards = [...document.querySelectorAll('section.task-run-failed, section.task-run-paused, section.task-run-awaiting_user')];
    for (const card of failedCards) {
      const title = card.querySelector('.task-run-summary strong')?.textContent?.trim();
      if (title !== ${JSON.stringify(run.title)}) continue;
      let button = [...card.querySelectorAll('button')].find((item) => item.textContent?.includes('继续执行'));
      if (!(button instanceof HTMLButtonElement)) {
        const summary = card.querySelector('.task-run-summary');
        if (summary instanceof HTMLButtonElement) summary.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        button = [...card.querySelectorAll('button')].find((item) => item.textContent?.includes('继续执行'));
      }
      if (button instanceof HTMLButtonElement && !button.disabled) {
        button.click();
        return { clicked: true };
      }
    }
    const resumeButtons = [...document.querySelectorAll('button.btn-primary')]
      .filter((item) => item.textContent?.includes('继续执行'));
    if (resumeButtons.length === 1 && resumeButtons[0] instanceof HTMLButtonElement && !resumeButtons[0].disabled) {
      resumeButtons[0].click();
      return { clicked: true, fallback: true };
    }
    return {
      clicked: false,
      cards: failedCards.map((card) => ({
        title: card.querySelector('.task-run-summary strong')?.textContent?.trim() || '',
        text: card.textContent?.trim().slice(0, 500) || '',
        buttons: [...card.querySelectorAll('button')].map((item) => item.textContent?.trim() || item.title || ''),
      })),
      pageButtons: [...document.querySelectorAll('button')].map((item) => item.textContent?.trim() || item.title || '').filter(Boolean).slice(-80),
      body: document.body.innerText.slice(-2000),
    };
  })()`);
  assert.equal(clickResult.clicked, true, `The resume control for the failed run was not available: ${JSON.stringify(clickResult)}`);

  const resumed = await waitFor(async () => main.evaluate(`(() => {
    const runs = JSON.parse(localStorage.getItem('hermes_office_task_runs_v1') || '[]');
    const item = runs.find((candidate) => candidate.id === ${JSON.stringify(runId)});
    return item && ['queued', 'running'].includes(item.status)
      ? { id: item.id, status: item.status, completed: item.steps.filter((step) => step.status === 'completed').map((step) => step.id) }
      : null;
  })()`), `Run ${runId} did not enter the execution queue`, 60_000);
  console.log(JSON.stringify({ passed: true, resumed }, null, 2));
} finally {
  team?.socket.close();
  main.socket.close();
}
