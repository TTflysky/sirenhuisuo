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
  const connectionState = { closing: false };
  let sequence = 0;
  socket.addEventListener('message', async (event) => {
    const raw = typeof event.data === 'string' ? event.data : await event.data.text();
    const message = JSON.parse(raw);
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error && connectionState.closing && /Target (?:crashed|closed)/iu.test(message.error.message || '')) request.resolve(undefined);
    else if (message.error) request.reject(new Error(message.error.message));
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
  return { socket, command, evaluate, connectionState };
}

async function capture(client, filename) {
  await fs.mkdir(outputDir, { recursive: true });
  let shot;
  try {
    shot = await client.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  } catch (error) {
    if (/Target crashed|GPU|screenshot/iu.test(error?.message || '')) return undefined;
    throw error;
  }
  const screenshot = path.join(outputDir, filename);
  await fs.writeFile(screenshot, Buffer.from(shot.data, 'base64'));
  return screenshot;
}

async function closeClient(client) {
  client.connectionState.closing = true;
  try { await client.evaluate('window.electronAPI.close()'); } catch (error) {
    if (!/Target (?:crashed|closed)|WebSocket|close/iu.test(error?.message || '')) throw error;
  }
  client.socket.close();
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

async function verifyChatControlPlane(client, label) {
  const result = await waitFor(async () => client.evaluate(`(() => {
    const state = {
      model: Boolean(document.querySelector('.model-selector')),
      policy: Boolean(document.querySelector('.execution-policy-control')),
      composer: Boolean(document.querySelector('.chat-composer')),
      newChat: Boolean(document.querySelector('.chat-new-session-btn'))
    };
    return Object.values(state).every(Boolean) ? state : null;
  })()`), `${label}控制面没有加载`);
  assert.equal(result.model, true, `${label}缺少模型切换控件`);
  assert.equal(result.policy, true, `${label}缺少审批/沙盒执行策略控件`);
  assert.equal(result.composer, true, `${label}缺少聊天输入区`);
  assert.equal(result.newChat, true, `${label}缺少新建聊天入口`);
  return result;
}

const targets = await listTargets();
const mainTarget = targets.find((target) => !target.url.includes('#chat') && !target.url.includes('#tool') && !target.url.includes('#settings'));
if (!mainTarget) throw new Error('没有找到太极主窗口');
const main = await connect(mainTarget);
const opened = [];
let testTaskId = '';

try {
  console.log('[e2e] main surface');
  const officeSurface = await waitFor(async () => main.evaluate(`(() => {
    const state = {
      office: Boolean(document.querySelector('.office-floor, .office-scene, .office-grid')),
      settings: Boolean(document.querySelector('[aria-label="打开设置"]')),
      update: Boolean(document.querySelector('.update-status')),
      text: document.body.innerText.slice(0, 2000)
    };
    return state.office && state.settings && state.update ? state : null;
  })()`), '办公室主窗口没有完成加载');
  assert.equal(officeSurface.settings, true, '办公室缺少设置入口');
  assert.equal(officeSurface.update, true, '办公室缺少更新状态入口');
  assert.equal(officeSurface.office, true, '办公室工位区域没有渲染');

  const assistant = await openChat(main, 'assistant-chat');
  console.log('[e2e] assistant opened');
  opened.push(assistant);
  const assistantControls = await verifyChatControlPlane(assistant, '助手窗口');
  const assistantResult = await verifyNewChat(assistant, 'assistant', '助手窗口', 'assistant-new-chat.png');
  console.log('[e2e] assistant verified');
  await closeClient(assistant);
  opened.splice(opened.indexOf(assistant), 1);

  const dm = await openChat(main, 'dm-chat', 'emp-pm');
  console.log('[e2e] dm opened');
  opened.push(dm);
  const dmControls = await verifyChatControlPlane(dm, '员工私聊窗口');
  const dmResult = await verifyNewChat(dm, 'dm:emp-pm', '员工私聊窗口', 'dm-new-chat.png');
  console.log('[e2e] dm verified');
  await closeClient(dm);
  opened.splice(opened.indexOf(dm), 1);

  const team = await openChat(main, 'team-chat', 'team-opc');
  console.log('[e2e] team opened');
  opened.push(team);
  const teamControls = await verifyChatControlPlane(team, '团队窗口');
  const teamResult = await verifyNewChat(team, 'team:team-opc', '团队窗口', 'team-new-chat.png');
  console.log('[e2e] team new chat verified');
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

  const settingsOpened = await main.evaluate('window.electronAPI.openSettings()');
  assert.equal(settingsOpened?.ok, true, settingsOpened?.error || '设置窗口没有打开');
  const settingsTarget = await waitFor(async () => (await listTargets()).find((item) => item.url.includes('#settings')), '没有找到设置窗口');
  const settings = await connect(settingsTarget);
  opened.push(settings);
  const settingsSurface = await waitFor(async () => settings.evaluate(`(() => {
    const state = {
      diagnostics: Boolean(document.querySelector('.diagnostics-page')),
      optimizer: [...document.querySelectorAll('button')].some((button) => button.textContent.includes('一键诊断并优化')),
      modelTab: [...document.querySelectorAll('button')].some((button) => button.textContent.includes('模型')),
      version: document.querySelector('.window-version-badge')?.textContent || ''
    };
    return state.diagnostics && state.optimizer && state.modelTab ? state : null;
  })()`), '设置与诊断中心没有完成加载');
  assert.equal(settingsSurface.diagnostics, true, '设置窗口没有默认打开诊断中心');
  assert.equal(settingsSurface.optimizer, true, '诊断中心缺少一键诊断并优化入口');
  assert.equal(settingsSurface.modelTab, true, '设置窗口缺少模型管理入口');
  const settingsScreenshot = await capture(settings, 'settings-diagnostics.png');
  await closeClient(settings);
  opened.splice(opened.indexOf(settings), 1);

  console.log(JSON.stringify({
    passed: true,
    surfaces: { office: officeSurface, assistant: assistantControls, dm: dmControls, team: teamControls, settings: settingsSurface, settingsScreenshot },
    newChat: { assistant: assistantResult, dm: dmResult, team: teamResult },
    stalledTask: { waiting: waiting.text, resumeFeedback, screenshot: beforeResumeScreenshot },
  }, null, 2));
} finally {
  if (testTaskId) {
    try { await main.evaluate(`window.electronAPI.taskWorkerCommand(${JSON.stringify({ taskId: testTaskId, type: 'close', requestedBy: 'chat-controls-e2e' })})`); } catch {}
  }
  for (const client of opened) {
    try { await closeClient(client); } catch {}
  }
  main.socket.close();
}
