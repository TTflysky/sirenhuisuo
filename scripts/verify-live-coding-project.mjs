import assert from 'node:assert/strict';

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9336);
const endpoint = `http://127.0.0.1:${debugPort}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, message, timeoutMs = 180_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

async function listTargets() {
  const response = await fetch(`${endpoint}/json`);
  if (!response.ok) throw new Error(`无法读取客户端调试端口 ${debugPort}`);
  return response.json();
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
        reject(new Error(`${method} 超时`));
      }, 20_000);
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
  return { socket, evaluate };
}

async function sendMessage(page, text) {
  return page.evaluate(`(async () => {
    const input = document.querySelector('textarea');
    if (!(input instanceof HTMLTextAreaElement)) return { ok: false, reason: 'no-textarea' };
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === '发送');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return { ok: false, reason: 'send-disabled' };
    button.click();
    return { ok: true };
  })()`);
}

function projectSnapshotExpression(conversationId) {
  return `(() => {
    const projects = JSON.parse(localStorage.getItem('hermes_office_projects_v1') || '[]');
    const employees = JSON.parse(localStorage.getItem('hermes_office_employees') || '[]');
    const project = [...projects].reverse().find((item) => item.conversationId === ${JSON.stringify(conversationId)});
    if (!project) return null;
    const directory = new Map(employees.map((employee) => [employee.id, employee]));
    return {
      id: project.id,
      title: project.title,
      request: project.request,
      status: project.status,
      teamId: project.teamId || '',
      members: (project.members || []).map((member) => ({
        id: member.employeeId,
        name: directory.get(member.employeeId)?.name || member.employeeId,
        title: directory.get(member.employeeId)?.title || '',
      })),
    };
  })()`;
}

const targets = await listTargets();
const mainTarget = targets.find((target) => !target.url.includes('#chat') && !target.url.includes('#tool') && !target.url.includes('#settings'));
const assistantTarget = targets.find((target) => target.url.includes('#chat?type=assistant-chat'));
if (!mainTarget || !assistantTarget) throw new Error('需要同时打开主窗口和助手窗口');

const main = await connect(mainTarget);
const assistant = await connect(assistantTarget);
let team;
try {
  const previousConversationId = await assistant.evaluate(`JSON.parse(localStorage.getItem('taiji_chat_sessions_v1') || '{}').activeByScope?.assistant || ''`);
  const newChat = await assistant.evaluate(`(() => {
    const button = document.querySelector('.chat-new-session-btn');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert.equal(newChat, true, '新建聊天控件不可用');
  const conversationId = await waitFor(async () => {
    const active = await assistant.evaluate(`JSON.parse(localStorage.getItem('taiji_chat_sessions_v1') || '{}').activeByScope?.assistant || ''`);
    return active && active !== previousConversationId ? active : '';
  }, '没有建立独立的新聊天');

  const request = '请建立一个全新的手机生图 APP 测试项目。需要支持上传照片、文生图、图生图、1:1/4:3/16:9 尺寸和 2K/2.7K/4K 像素档位，可配置中转 API 调用 GPT-image-2。界面采用美式复古波普漫画风，基础实现使用 HTML、CSS 和 JavaScript。请组建职责完整的六人团队，必须包含项目管理、系统架构、UI 设计、前端、后端和 QA；建立独立工作区，按依赖顺序完成真实文件、运行验证、正式审查和最终交付。缺少真实生图密钥时，用 Mock 链路完成可离线验收，不得虚构外部 API 已成功。';
  assert.deepEqual(await sendMessage(assistant, request), { ok: true }, '测试需求没有发送成功');

  const draft = await waitFor(async () => {
    const project = await assistant.evaluate(projectSnapshotExpression(conversationId));
    return project?.status === 'awaiting_approval' ? project : null;
  }, '模型没有建立待批准的项目方案');

  const rosterText = draft.members.map((member) => `${member.name} ${member.title}`).join('\n');
  for (const expected of ['项目管理', '系统架构', 'UI 设计', '前端', '后端', 'QA']) {
    assert.match(rosterText, new RegExp(expected.replace(' ', '\\s*'), 'iu'), `团队缺少 ${expected}`);
  }
  assert.doesNotMatch(rosterText, /Drupal|WordPress|购物车|幼师/iu, '团队出现无关岗位');
  assert.equal(draft.members.length, 6, `团队人数应为 6，实际为 ${draft.members.length}`);

  const approved = await assistant.evaluate(`(() => {
    const card = document.querySelector('.project-approval-card');
    const button = card && [...card.querySelectorAll('button')].find((item) => item.textContent?.includes('批准并建立团队'));
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
  assert.equal(approved, true, '项目批准按钮不可用');
  const clarifying = await waitFor(async () => {
    const project = await assistant.evaluate(projectSnapshotExpression(conversationId));
    return project?.status === 'clarifying' && project.teamId ? project : null;
  }, '批准后没有建立团队');

  const opened = await main.evaluate(`window.electronAPI.openChat(${JSON.stringify({ type: 'team-chat', refId: clarifying.teamId })})`);
  assert.equal(opened?.ok, true, opened?.error || '团队聊天窗口没有打开');
  const teamTarget = await waitFor(async () => (await listTargets()).find((target) => target.url.includes('#chat') && target.url.includes('type=team-chat') && target.url.includes(`id=${encodeURIComponent(clarifying.teamId)}`)), '没有找到团队聊天窗口');
  team = await connect(teamTarget);
  await waitFor(() => team.evaluate(`Boolean(document.querySelector('textarea'))`), '团队聊天输入框没有完成加载', 30_000);

  const clarification = '第一版只做可离线运行的移动端原型：文生图、图生图、图片上传预览、1:1/4:3/16:9、2K/2.7K/4K、API 地址和密钥的本地配置界面、Mock 生成状态与结果历史。不得把密钥写进前端源码。交付 HTML/CSS/JavaScript 源文件、README 和验证记录；先架构与 UI，再前后端实现，最后由 QA 审查。';
  assert.deepEqual(await sendMessage(team, clarification), { ok: true }, '方向说明没有发送成功');
  const started = await waitFor(async () => team.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('确认方向并开始执行'));
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`), '确认方向控件没有出现或不可点击', 30_000);
  assert.equal(started, true);

  const run = await waitFor(async () => team.evaluate(`(() => {
    const runs = JSON.parse(localStorage.getItem('hermes_office_task_runs_v1') || '[]');
    const item = [...runs].reverse().find((candidate) => candidate.teamId === ${JSON.stringify(clarifying.teamId)});
    return item ? {
      id: item.id,
      teamId: item.teamId,
      taskId: item.taskId,
      status: item.status,
      workspace: item.workspace,
      codingProjectVersion: item.codingProject?.codingProjectVersion,
      steps: (item.steps || []).map((step) => ({ id: step.id, title: step.title, kind: step.kind, status: step.status, employeeId: step.employeeId, dependsOnStepIds: step.dependsOnStepIds || [] })),
    } : null;
  })()`), '没有生成任务运行记录');
  assert.equal(run.codingProjectVersion, 2, '没有使用固定 Coding DAG');
  assert.equal(run.steps.length, 8, `固定计划应为 8 步，实际为 ${run.steps.length}`);
  assert.ok(run.workspace, '任务没有独立工作区');

  console.log(JSON.stringify({ passed: true, conversationId, project: clarifying, run }, null, 2));
} finally {
  team?.socket.close();
  assistant.socket.close();
  main.socket.close();
}
