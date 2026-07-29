import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9334);
const endpoint = `http://127.0.0.1:${debugPort}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const outputDir = path.resolve('artifacts', 'ui-verification');

async function waitFor(check, message, timeoutMs = 18_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(120);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
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
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`DevTools 调用超时：${method}`));
      }, 15_000);
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

async function capture(client, filename) {
  await fs.mkdir(outputDir, { recursive: true });
  const shot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshot = path.join(outputDir, filename);
  await fs.writeFile(screenshot, Buffer.from(shot.data, 'base64'));
  return screenshot;
}

async function openChat(main, type, refId = '') {
  const result = await main.evaluate(`window.electronAPI.openChat(${JSON.stringify({ type, refId })})`);
  assert.equal(result?.ok, true, result?.error || `${type} 窗口没有打开`);
  const marker = `type=${encodeURIComponent(type)}`;
  const idMarker = refId ? `id=${encodeURIComponent(refId)}` : '';
  const target = await waitFor(async () => (await listTargets()).find((item) => (
    item.url.includes('#chat') && item.url.includes(marker) && (!idMarker || item.url.includes(idMarker))
  )), `没有找到 ${type} 窗口`);
  return connect(target);
}

async function verifyNewChat(client, scope, label, screenshotName) {
  const before = await waitFor(async () => client.evaluate(`(() => {
    const button = document.querySelector('.chat-new-session-btn');
    const index = JSON.parse(localStorage.getItem('taiji_chat_sessions_v1') || '{}');
    return button ? { active: index.activeByScope?.[${JSON.stringify(scope)}] || '', text: button.textContent?.trim() || '' } : null;
  })()`), `${label}没有显示新建聊天控件`);
  assert.match(before.text, /新建聊天/u);
  const clicked = await client.evaluate(`(() => {
    const button = document.querySelector('.chat-new-session-btn');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert.equal(clicked, true, `${label}的新建聊天控件不可点击`);
  const after = await waitFor(async () => client.evaluate(`(() => {
    const index = JSON.parse(localStorage.getItem('taiji_chat_sessions_v1') || '{}');
    const active = index.activeByScope?.[${JSON.stringify(scope)}] || '';
    return active && active !== ${JSON.stringify(before.active)} ? { active, sessions: index.sessions?.length || 0 } : null;
  })()`), `${label}点击后没有建立独立聊天`);
  const screenshot = await capture(client, screenshotName);
  return { before: before.active, after: after.active, screenshot };
}

const targets = await listTargets();
const mainTarget = targets.find((target) => !target.url.includes('#chat') && !target.url.includes('#tool') && !target.url.includes('#settings'));
if (!mainTarget) throw new Error('没有找到太极主窗口');
const main = await connect(mainTarget);
const opened = [];
let testTaskId = '';

try {
  const assistant = await openChat(main, 'assistant-chat');
  opened.push(assistant);
  const assistantResult = await verifyNewChat(assistant, 'assistant', '助手窗口', 'assistant-new-chat.png');
  await assistant.evaluate('window.electronAPI.close()');
  assistant.socket.close();
  opened.splice(opened.indexOf(assistant), 1);

  const dm = await openChat(main, 'dm-chat', 'emp-pm');
  opened.push(dm);
  const dmResult = await verifyNewChat(dm, 'dm:emp-pm', '员工私聊窗口', 'dm-new-chat.png');
  await dm.evaluate('window.electronAPI.close()');
  dm.socket.close();
  opened.splice(opened.indexOf(dm), 1);

  const team = await openChat(main, 'team-chat', 'team-opc');
  opened.push(team);
  const teamResult = await verifyNewChat(team, 'team:team-opc', '团队窗口', 'team-new-chat.png');
  testTaskId = `ui-stall-${Date.now()}`;
  const inserted = await main.evaluate(`(async () => {
    const api = window.electronAPI;
    const current = await api.taskStoreRead();
    const now = Date.now();
    const run = {
      id: ${JSON.stringify(testTaskId)}, teamId: 'team-opc', conversationId: ${JSON.stringify(teamResult.after)},
      workspaceId: 'diagnostics/chat-controls/${testTaskId}', executionSessionId: api.getAppSessionId(),
      title: '停滞恢复控件验证', request: '验证暂停后的任务可以继续', goal: '验证暂停后的任务可以继续',
      status: 'paused', phase: 'blocked', createdAt: now - 90_000, updatedAt: now,
      memberSnapshot: [{ id: 'emp-pm', name: '铁柱', title: '协调者', role: 'pm' }],
      steps: [{ id: '${testTaskId}-step', employeeId: 'emp-pm', title: '等待恢复', order: 1, kind: 'work', assignment: '恢复测试', dependsOnStepIds: [], status: 'paused', attempts: 1, events: [{ ts: now, type: 'error', detail: '模型长时间没有产生新结果，已安全暂停' }] }],
      worker: { state: 'paused', adapter: 'diagnostic', activity: '已检测到停滞并暂停', progressAt: now - 90_000, heartbeatAt: now - 1_000 },
      recoveryContext: { summary: '任务长时间没有真实进展，已安全暂停。', completedEvidence: [], unresolvedIssues: ['模型或工具没有返回结果'], steeringMessages: [] },
      handoff: { handoffVersion: 1, taskId: ${JSON.stringify(testTaskId)}, completed: [], completedEvidence: [], blockers: [{ category: 'environment', summary: '模型或工具没有返回结果', retryable: true }], blocked: '模型或工具没有返回结果', nextAction: '确认环境后点击继续执行', resumeCondition: '模型和工具恢复可用', attemptedRoutes: [], risks: [], updatedAt: now }
    };
    return api.taskStoreWrite([...(current.runs || []).filter((item) => item.id !== run.id), run], { source: 'chat-controls-e2e' });
  })()`);
  assert.equal(inserted?.ok, true, '无法写入停滞任务测试数据');
  await team.command('Page.reload', { ignoreCache: true });
  const waiting = await waitFor(async () => team.evaluate(`(() => {
    const banner = document.querySelector('.team-waiting-banner');
    const resume = [...document.querySelectorAll('.team-waiting-banner button')].find((item) => item.textContent.includes('继续执行'));
    return banner && resume ? { text: banner.textContent.trim(), disabled: resume.disabled } : null;
  })()`), '团队窗口没有显示停滞后的暂停状态和继续控件');
  assert.match(waiting.text, /暂停|恢复/u);
  assert.equal(waiting.disabled, false, '继续执行控件处于不可点击状态');
  const beforeResumeScreenshot = await capture(team, 'team-stalled-task.png');
  const resumed = await team.evaluate(`(() => {
    const resume = [...document.querySelectorAll('.team-waiting-banner button')].find((item) => item.textContent.includes('继续执行'));
    if (!(resume instanceof HTMLButtonElement) || resume.disabled) return false;
    resume.click();
    return true;
  })()`);
  assert.equal(resumed, true, '继续执行控件没有响应点击');
  const resumeFeedback = await waitFor(async () => team.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('正在继续'));
    return button ? { text: button.textContent.trim(), disabled: button.disabled } : null;
  })()`), '点击继续执行后没有即时反馈', 3_000);
  assert.equal(resumeFeedback.disabled, true);

  console.log(JSON.stringify({
    passed: true,
    newChat: { assistant: assistantResult, dm: dmResult, team: teamResult },
    stalledTask: { waiting: waiting.text, resumeFeedback, screenshot: beforeResumeScreenshot },
  }, null, 2));
} finally {
  if (testTaskId) {
    try { await main.evaluate(`window.electronAPI.taskWorkerCommand(${JSON.stringify({ taskId: testTaskId, type: 'close', requestedBy: 'chat-controls-e2e' })})`); } catch {}
  }
  for (const client of opened) {
    try { await client.evaluate('window.electronAPI.close()'); } catch {}
    client.socket.close();
  }
  main.socket.close();
}
