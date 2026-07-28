import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9335);
const endpoint = `http://127.0.0.1:${debugPort}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listTargets() {
  const response = await fetch(`${endpoint}/json`);
  if (!response.ok) throw new Error(`无法连接 Electron 调试端口 ${debugPort}`);
  return response.json();
}

async function waitFor(check, message, timeoutMs = 12_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await check();
    if (result) return result;
    await delay(100);
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
  return { socket, command, evaluate };
}

let main;
let team;
try {
  const mainTarget = await waitFor(async () => (await listTargets()).find((target) => !target.url.includes('#chat') && !target.url.includes('#tool')), '没有找到主办公室窗口');
  main = await connect(mainTarget);
  const opened = await main.evaluate(`window.electronAPI.openChat({ type: 'team-chat', refId: 'team-opc' })`);
  assert.equal(opened.ok, true, opened.error || '团队窗口打开失败');

  const teamTarget = await waitFor(async () => (await listTargets()).find((target) => target.url.includes('#chat') && target.url.includes('team-opc')), '没有找到团队聊天窗口');
  team = await connect(teamTarget);
  const metrics = await waitFor(async () => {
    const value = await team.evaluate(`(() => {
      const sidebar = document.querySelector('.team-member-sidebar');
      const frames = [...document.querySelectorAll('.team-member-sidebar .agent-avatar-frame')];
      const supervisor = document.querySelector('.team-member-sidebar .supervisor-avatar');
      if (!sidebar || frames.length < 4) return null;
      const sidebarRect = sidebar.getBoundingClientRect();
      return {
        innerWidth: window.innerWidth,
        sidebarWidth: Math.round(sidebarRect.width),
        frameWidths: frames.map((frame) => Math.round(frame.getBoundingClientRect().width)),
        supervisorWidth: supervisor ? Math.round(supervisor.getBoundingClientRect().width) : 0,
        clippedFrames: frames.filter((frame) => {
          const rect = frame.getBoundingClientRect();
          return rect.left < sidebarRect.left || rect.right > sidebarRect.right;
        }).length,
        actionButtons: document.querySelectorAll('.team-member-sidebar-actions button').length,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      };
    })()`);
    return value?.innerWidth <= 599 ? value : null;
  }, '团队窗口没有进入窄窗口布局');

  assert.ok(metrics.sidebarWidth >= 76, `成员栏宽度不足：${metrics.sidebarWidth}px`);
  assert.equal(metrics.clippedFrames, 0, '团队成员头像框仍被侧栏裁切');
  assert.ok(metrics.frameWidths.every((width) => width >= 44), `员工头像被压缩：${metrics.frameWidths.join(', ')}px`);
  assert.ok(metrics.supervisorWidth >= 34, `助手头像被压缩：${metrics.supervisorWidth}px`);
  assert.equal(metrics.actionButtons, 2, '窄窗口应保留添加成员和重命名入口');
  assert.equal(metrics.horizontalOverflow, false, '团队窗口出现横向溢出');

  const overflowSetup = await team.evaluate(`(() => {
    const sidebar = document.querySelector('.team-member-sidebar');
    const source = sidebar?.querySelector('.team-member-item:not(.team-supervisor-item)');
    if (!sidebar || !source) return null;
    for (let index = 0; index < 20; index += 1) {
      const clone = source.cloneNode(true);
      clone.classList.add('layout-test-member');
      clone.removeAttribute('title');
      sidebar.appendChild(clone);
    }
    const rect = sidebar.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + Math.min(rect.height / 2, 180)),
      clientHeight: sidebar.clientHeight,
      scrollHeight: sidebar.scrollHeight,
    };
  })()`);
  assert.ok(overflowSetup && overflowSetup.scrollHeight > overflowSetup.clientHeight, '成员增多后成员栏没有形成纵向滚动区域');
  await team.command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: overflowSetup.x, y: overflowSetup.y, deltaX: 0, deltaY: 420 });
  await delay(180);
  const memberScrollTop = await team.evaluate(`document.querySelector('.team-member-sidebar')?.scrollTop ?? 0`);
  assert.ok(memberScrollTop > 0, '鼠标滚轮无法滚动团队成员头像栏');
  await team.evaluate(`document.querySelectorAll('.layout-test-member').forEach((node) => node.remove())`);

  const screenshot = await team.command('Page.captureScreenshot', { format: 'png' });
  const outputDir = path.resolve('artifacts', 'ui-verification');
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'team-window-narrow.png'), Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify({ passed: true, metrics, screenshot: path.join(outputDir, 'team-window-narrow.png') }, null, 2));
} finally {
  try { await team?.evaluate('window.electronAPI.close()'); } catch {}
  team?.socket.close();
  main?.socket.close();
}
