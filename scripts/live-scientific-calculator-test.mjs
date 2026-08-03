import fs from 'node:fs/promises';
import path from 'node:path';

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9336);
const endpoint = `http://127.0.0.1:${debugPort}`;
const action = process.argv[2] || 'snapshot';
const request = '让他制作一个可以使用的科学计算器，UI界面风格是波普漫画风，黑白点状主体';
const resultRoot = path.resolve('test-results', 'scientific-calculator-live');
const currentPath = path.join(resultRoot, 'current.json');
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
    await delay(500);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

async function listTargets() {
  const response = await fetch(`${endpoint}/json`);
  if (!response.ok) throw new Error(`无法读取太极调试端口 ${debugPort}`);
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
  await command('Page.enable');
  return { socket, command, evaluate };
}

async function assistantTarget() {
  return waitFor(async () => (await listTargets()).find((target) => target.url.includes('#chat?type=assistant-chat')), '没有找到助理窗口', 30_000);
}

async function sendMessage(page, text) {
  return page.evaluate(`(async () => {
    const input = document.querySelector('textarea');
    if (!(input instanceof HTMLTextAreaElement)) return { ok: false, reason: 'no-textarea' };
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === '发送');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return { ok: false, reason: 'send-disabled' };
    button.click();
    return { ok: true };
  })()`);
}

async function readCurrent() {
  try {
    return JSON.parse(await fs.readFile(currentPath, 'utf8'));
  } catch {
    return {};
  }
}

async function snapshot(page, conversationId) {
  return page.evaluate(`(async () => {
    const conversationId = ${JSON.stringify(conversationId || '')};
    const projects = JSON.parse(localStorage.getItem('hermes_office_projects_v1') || '[]');
    const employees = JSON.parse(localStorage.getItem('hermes_office_employees') || '[]');
    const sessions = JSON.parse(localStorage.getItem('taiji_chat_sessions_v1') || '{}');
    const directory = new Map(employees.map((employee) => [employee.id, employee]));
    const project = [...projects].reverse().find((item) => item.conversationId === conversationId) || null;
    const approvalCard = document.querySelector('.project-approval-card');
    const taskResult = await window.electronAPI.taskServiceRead({ teamId: 'scope:assistant', limit: 120 });
    const tasks = (taskResult.runs || [])
      .filter((task) => task.conversationId === conversationId)
      .map((task) => ({
        id: task.id,
        parentTaskId: task.parentTaskId || '',
        title: task.title,
        request: task.request,
        goal: task.goal,
        status: task.status,
        workspaceId: task.workspaceId || task.workspace?.workspaceId || '',
        updatedAt: task.updatedAt,
        toolAttempts: (task.toolAttempts || []).map((attempt) => ({
          toolName: attempt.toolName,
          status: attempt.status,
          inputSummary: attempt.inputSummary || '',
          outputSummary: attempt.outputSummary || '',
          errorClass: attempt.errorClass || '',
        })),
      }));
    return {
      capturedAt: Date.now(),
      activeConversationId: sessions.activeByScope?.assistant || '',
      bodyText: document.body.innerText.slice(-12000),
      activity: JSON.parse(localStorage.getItem('hermes_office_assistant_activity') || '{}'),
      tasks,
      approvalCard: approvalCard ? approvalCard.textContent?.trim() || '' : '',
      project: project ? {
        id: project.id,
        title: project.title,
        request: project.request,
        conversationId: project.conversationId || '',
        status: project.status,
        decisionReason: project.decisionReason || '',
        requiredCapabilities: project.requiredCapabilities || [],
        steps: project.steps || [],
        expectedOutputs: project.expectedOutputs || [],
        teamId: project.teamId || '',
        brief: project.brief || null,
        members: (project.members || []).map((member) => {
          const employee = directory.get(member.employeeId);
          return {
            id: member.employeeId,
            name: employee?.name || member.employeeId,
            title: employee?.title || '',
            department: employee?.department || '',
            capabilities: employee?.capabilities || [],
            reason: member.reason || '',
          };
        }),
      } : null,
    };
  })()`);
}

async function saveEvidence(page, state, label) {
  await fs.mkdir(resultRoot, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const base = `${timestamp}-${label}`;
  await fs.writeFile(path.join(resultRoot, `${base}.json`), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  const screenshot = await page.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await fs.writeFile(path.join(resultRoot, `${base}.png`), Buffer.from(screenshot.data, 'base64'));
  return base;
}

const page = await connect(await assistantTarget());
try {
  if (action === 'start') {
    const previousConversationId = await page.evaluate(`JSON.parse(localStorage.getItem('taiji_chat_sessions_v1') || '{}').activeByScope?.assistant || ''`);
    const clicked = await page.evaluate(`(() => {
      const button = document.querySelector('.chat-new-session-btn');
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error('新建聊天控件不可用');
    const conversationId = await waitFor(async () => {
      const active = await page.evaluate(`JSON.parse(localStorage.getItem('taiji_chat_sessions_v1') || '{}').activeByScope?.assistant || ''`);
      return active && active !== previousConversationId ? active : '';
    }, '没有建立独立的新聊天', 30_000);
    await fs.mkdir(resultRoot, { recursive: true });
    await fs.writeFile(currentPath, `${JSON.stringify({ conversationId, request, startedAt: Date.now() }, null, 2)}\n`, 'utf8');
    const sent = await sendMessage(page, request);
    if (!sent.ok) throw new Error(`需求发送失败：${sent.reason}`);
    const state = await waitFor(async () => {
      const value = await snapshot(page, conversationId);
      return value.project || value.activity?.state === 'idle' ? value : null;
    }, '助理没有形成项目方案，也没有结束本轮回答');
    const evidence = await saveEvidence(page, state, 'draft');
    console.log(JSON.stringify({ action, request, conversationId, evidence, state }, null, 2));
  } else {
    const current = await readCurrent();
    if (!current.conversationId) throw new Error('没有正在验收的科学计算器聊天，请先运行 start');
    if (action === 'stop') {
      const stopped = await page.evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === '停止');
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
      })()`);
      if (!stopped) throw new Error('当前任务没有可用的停止控件');
      await delay(500);
    }
    if (action === 'approve') {
      const approved = await page.evaluate(`(() => {
        const card = document.querySelector('.project-approval-card');
        const button = card && [...card.querySelectorAll('button')].find((item) => item.textContent?.includes('批准并建立团队'));
        if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
        button.click();
        return true;
      })()`);
      if (!approved) throw new Error('当前项目审批卡不可用');
      await waitFor(async () => (await snapshot(page, current.conversationId)).project?.status === 'clarifying', '批准后没有建立团队');
    }
    if (action === 'resume' || action === 'correct') {
      const instruction = action === 'correct'
        ? '继续原任务。窄屏下主要容器的边框和外阴影仍有遮挡，请根据真实桌面与 375px 验收证据修复原文件，并完成复验。'
        : '继续完成刚才的任务';
      const sent = await sendMessage(page, instruction);
      if (!sent.ok) throw new Error(`继续消息发送失败：${sent.reason}`);
      await waitFor(async () => (await snapshot(page, current.conversationId)).activity?.state === 'running', '任务没有恢复执行', 30_000);
    }
    const state = await snapshot(page, current.conversationId);
    const evidence = await saveEvidence(page, state, action);
    console.log(JSON.stringify({ action, evidence, state }, null, 2));
  }
} finally {
  page.socket.close();
}
