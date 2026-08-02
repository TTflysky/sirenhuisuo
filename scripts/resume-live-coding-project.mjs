import assert from 'node:assert/strict';

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9336);
const endpoint = `http://127.0.0.1:${debugPort}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, message, timeoutMs = 120_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { lastError = error; }
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
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时`)); }, 20_000);
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
    if (!(input instanceof HTMLTextAreaElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === '发送');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`);
}

const targets = await listTargets();
const mainTarget = targets.find((target) => !target.url.includes('#chat') && !target.url.includes('#tool') && !target.url.includes('#settings'));
if (!mainTarget) throw new Error('没有找到主窗口');
const main = await connect(mainTarget);
let team;
try {
  const project = await main.evaluate(`(() => {
    const projects = JSON.parse(localStorage.getItem('hermes_office_projects_v1') || '[]');
    const employees = JSON.parse(localStorage.getItem('hermes_office_employees') || '[]');
    const directory = new Map(employees.map((employee) => [employee.id, employee]));
    const item = [...projects].reverse().find((candidate) => candidate.status === 'clarifying' && candidate.teamId);
    if (!item) return null;
    return {
      id: item.id,
      teamId: item.teamId,
      members: (item.members || []).map((member) => ({
        id: member.employeeId,
        name: directory.get(member.employeeId)?.name || member.employeeId,
        title: directory.get(member.employeeId)?.title || '',
      })),
    };
  })()`);
  assert.ok(project?.teamId, '没有找到等待确认方向的测试项目');
  const rosterText = project.members.map((member) => `${member.name} ${member.title}`).join('\n');
  assert.match(rosterText, /QA|审查者|质量保证/iu, '当前测试项目没有正式 QA');
  assert.doesNotMatch(rosterText, /嵌入式测试|Drupal|WordPress|购物车|幼师/iu, '当前测试项目存在不匹配岗位');

  const opened = await main.evaluate(`window.electronAPI.openChat(${JSON.stringify({ type: 'team-chat', refId: project.teamId })})`);
  assert.equal(opened?.ok, true, opened?.error || '团队聊天窗口没有打开');
  const target = await waitFor(async () => (await listTargets()).find((item) => item.url.includes('#chat') && item.url.includes('type=team-chat') && item.url.includes(`id=${encodeURIComponent(project.teamId)}`)), '没有找到团队聊天窗口');
  team = await connect(target);
  await waitFor(() => team.evaluate(`Boolean(document.querySelector('textarea'))`), '团队聊天输入框没有完成加载', 30_000);

  const clarification = '第一版只做可离线运行的移动端原型：文生图、图生图、图片上传预览、1:1/4:3/16:9、2K/2.7K/4K、API 地址和密钥的本地配置界面、Mock 生成状态与结果历史。不得把密钥写进前端源码。交付 HTML/CSS/JavaScript 源文件、README 和验证记录；先架构与 UI，再前后端实现，最后由 QA 审查。';
  assert.equal(await sendMessage(team, clarification), true, '方向说明没有发送成功');
  const started = await waitFor(async () => team.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('确认方向并开始执行'));
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`), '确认方向控件没有出现或不可点击', 30_000);
  assert.equal(started, true);

  const run = await waitFor(async () => team.evaluate(`(() => {
    const runs = JSON.parse(localStorage.getItem('hermes_office_task_runs_v1') || '[]');
    const item = [...runs].reverse().find((candidate) => candidate.teamId === ${JSON.stringify(project.teamId)});
    return item ? {
      id: item.id,
      taskId: item.taskId,
      teamId: item.teamId,
      status: item.status,
      workspace: item.workspace,
      codingProjectVersion: item.codingProject?.codingProjectVersion,
      steps: (item.steps || []).map((step) => ({ id: step.id, title: step.title, kind: step.kind, status: step.status, employeeId: step.employeeId, dependsOnStepIds: step.dependsOnStepIds || [] })),
    } : null;
  })()`), '没有生成任务运行记录');
  assert.equal(run.codingProjectVersion, 2, '没有使用固定 Coding DAG');
  assert.equal(run.steps.length, 8, `固定计划应为 8 步，实际为 ${run.steps.length}`);
  assert.ok(run.workspace, '任务没有独立工作区');
  console.log(JSON.stringify({ passed: true, project, run }, null, 2));
} finally {
  team?.socket.close();
  main.socket.close();
}
