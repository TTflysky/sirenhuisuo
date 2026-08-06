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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || '页面脚本执行失败');
    return result.result.value;
  };
  await command('Runtime.enable');
  await command('Page.enable');
  return { socket, command, evaluate };
}

let main;
let assistant;
let previousHistory;
let previousAppearance;
let previousSessions;
try {
  const mainTarget = await waitFor(async () => (await listTargets()).find((target) => !target.url.includes('#chat') && !target.url.includes('#tool')), '没有找到主办公室窗口');
  main = await connect(mainTarget);
  await waitFor(async () => main.evaluate(`(() => {
    try {
      localStorage.getItem('hermes_office_assistant_chat');
      return document.readyState === 'complete' && Boolean(window.electronAPI);
    } catch { return false; }
  })()`), '主窗口尚未完成 preload 和本地存储初始化');
  const prepared = await main.evaluate(`(() => {
    const historyKey = 'hermes_office_assistant_chat';
    const appearanceKey = 'hermes_office_appearance';
    const sessionsKey = 'taiji_chat_sessions_v1';
    const previousHistory = localStorage.getItem(historyKey);
    const previousAppearance = localStorage.getItem(appearanceKey);
    const previousSessions = localStorage.getItem(sessionsKey);
    const now = Date.now();
    const longResult = [
      '# SkillHub 安装与完整配置',
      '',
      '## 结论',
      '已读取官方说明并核对依赖。下面保留完整来源、安装步骤、验证结果和发生错误时的替代路线。',
      '',
      ...Array.from({ length: 34 }, (_, index) => '- 检查项 ' + String(index + 1).padStart(2, '0') + '：确认配置字段、工作区路径和连接状态。'),
      '',
      '参考地址：https://www.skillhub.cn/',
    ].join('\\n');
    const codeResult = [
      'npm.cmd run verify:execution-detail-ui',
      'const configuration = { connector: "ima", workspace: "L:/AI办公室/太极/这是一个用于验证横向滚动的很长目录名称", enabled: true };',
      '验证完成：配置文件存在，连接测试通过，产出物已经登记。',
    ].join('\\n');
    localStorage.setItem(appearanceKey, JSON.stringify({ font: 'youyuan', fontSize: 'extra-large' }));
    localStorage.setItem(historyKey, JSON.stringify([{
      id: 'execution-detail-visual-test', authorId: 'assistant', roleId: 'custom', mentions: [], timestamp: now,
      conversationId: 'conversation-legacy-assistant',
      content: '执行记录已经整理好，详细参数和原始结果可以在下方查看。',
      thoughtChain: [
        { id: 'execution-goal', phase: 'understanding', title: '理解当前目标', summary: '已识别本轮目标：安装并验证指定 Skill。', toolName: 'task_understanding', args: '', result: '目标：安装并验证指定 Skill；本轮关系：独立任务。', success: true, state: 'completed', timestamp: now - 5000 },
        { id: 'execution-plan', phase: 'plan', title: '制定执行路线', summary: '先使用原生安装器，再回读规则与健康状态。', toolName: 'task_plan', args: '', result: '首选路线：使用原生安装器安装并回读 Skill；验收标准：安装目录和规则文档均可读取。', success: true, state: 'completed', timestamp: now - 4000 },
        { toolName: 'read_skill', args: JSON.stringify({ id: 'skillhub-installation-guide', includeReferences: true, workspace: 'L:/AI办公室/太极/技能安装验证工作区' }), result: longResult, success: true, timestamp: now - 3000 },
        { toolName: 'run_command', args: JSON.stringify({ cmd: 'npm.cmd run verify:execution-detail-ui -- --full-output --preserve-raw-log', cwd: 'L:/AI办公室/太极/这是一个用于验证横向滚动的很长目录名称' }), result: codeResult, success: true, timestamp: now - 2000 },
        { toolName: 'test_connector', args: JSON.stringify({ connectorId: 'ima-knowledge' }), result: '连接验证失败：当前电脑还没有完成 IMA 登录授权。请打开连接器设置完成授权后重试。', success: false, timestamp: now - 1000 },
      ],
    }]));
    localStorage.setItem(sessionsKey, JSON.stringify({
      version: 1,
      activeByScope: { assistant: 'conversation-legacy-assistant' },
      sessions: [{ id: 'conversation-legacy-assistant', scope: 'assistant', title: '执行详情验证', createdAt: now, updatedAt: now }],
    }));
    return { previousHistory, previousAppearance, previousSessions };
  })()`);
  previousHistory = prepared.previousHistory;
  previousAppearance = prepared.previousAppearance;
  previousSessions = prepared.previousSessions;

  // Let Chromium commit the fixture before reloading the pre-created
  // companion window below.
  await delay(180);

  const opened = await main.evaluate(`window.electronAPI.openChat({ type: 'assistant-chat', refId: '' })`);
  assert.equal(opened.ok, true, opened.error || '助手窗口打开失败');
  const assistantTarget = await waitFor(async () => (await listTargets()).find((target) => target.url.includes('#chat') && target.url.includes('assistant-chat')), '没有找到助手聊天窗口');
  assistant = await connect(assistantTarget);
  // The companion window is created with the main window. Reload it after the
  // fixture is written so the test covers its actual startup recovery path.
  await assistant.command('Page.reload', { ignoreCache: true });
  await waitFor(async () => assistant.evaluate(`document.readyState === 'complete' && Boolean(window.electronAPI)`), 'assistant window did not reload after fixture setup');
  await assistant.evaluate('window.resizeTo(1000, 850)');

  try {
    await waitFor(async () => assistant.evaluate(`Boolean(document.querySelector('.cot-toggle'))`), '执行过程没有显示');
  } catch (error) {
    const diagnostics = await assistant.evaluate(`(() => ({
      url: location.href,
      messages: document.querySelectorAll('.msg').length,
      toggles: document.querySelectorAll('.cot-toggle').length,
      history: localStorage.getItem('hermes_office_assistant_chat')?.slice(0, 800) || '',
      sessions: localStorage.getItem('taiji_chat_sessions_v1')?.slice(0, 800) || '',
      text: document.body.innerText.slice(0, 1200),
    }))()`);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${JSON.stringify(diagnostics)}`);
  }
  await assistant.evaluate(`document.querySelector('.cot-toggle')?.click()`);
  await delay(250);
  const expandedMetrics = await assistant.evaluate(`(() => {
    const steps = [...document.querySelectorAll('.cot-step')];
    const title = document.querySelector('.cot-step-title');
    const summary = document.querySelector('.cot-step-summary');
    const longStep = steps[2];
    longStep?.querySelector('.cot-step-head')?.click();
    longStep?.querySelector('.cot-step-details > summary')?.click();
    const result = longStep?.querySelector('.cot-step-result pre');
    const expand = document.querySelector('.cot-open-detail');
    return {
      steps: steps.length,
      firstTitle: title?.textContent?.trim(),
      firstState: document.querySelector('.cot-step-phase')?.textContent?.trim(),
      titleFont: parseFloat(getComputedStyle(title).fontSize),
      summaryFont: parseFloat(getComputedStyle(summary).fontSize),
      resultFont: parseFloat(getComputedStyle(result).fontSize),
      resultScrollable: result.scrollHeight > result.clientHeight,
      expandVisible: Boolean(expand && expand.getBoundingClientRect().width > 0),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  })()`);
  assert.equal(expandedMetrics.steps, 5, '执行步骤数量不正确');
  assert.equal(expandedMetrics.firstTitle, '理解当前目标', '公开的目标理解步骤没有展示');
  assert.equal(expandedMetrics.firstState, '已完成', '公开执行步骤没有展示状态');
  assert.ok(expandedMetrics.titleFont >= 15, `步骤标题没有跟随特大字号：${expandedMetrics.titleFont}px`);
  assert.ok(expandedMetrics.summaryFont >= 15, `通俗摘要没有跟随特大字号：${expandedMetrics.summaryFont}px`);
  assert.ok(expandedMetrics.resultFont >= 15, `技术详情没有跟随特大字号：${expandedMetrics.resultFont}px`);
  assert.equal(expandedMetrics.resultScrollable, true, '长结果没有形成独立滚动区域');
  assert.equal(expandedMetrics.expandVisible, true, '放大查看控件不可见');
  assert.equal(expandedMetrics.horizontalOverflow, false, '执行过程导致整个窗口横向溢出');

  const outputDir = path.resolve('artifacts', 'ui-verification');
  await fs.mkdir(outputDir, { recursive: true });
  const expandedShot = await assistant.command('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(outputDir, 'execution-detail-expanded.png'), Buffer.from(expandedShot.data, 'base64'));

  await assistant.evaluate(`document.querySelector('.cot-open-detail')?.click()`);
  const modalMetrics = await waitFor(async () => assistant.evaluate(`(() => {
    const modal = document.querySelector('.cot-detail-modal');
    const layout = document.querySelector('.cot-detail-layout');
    const result = document.querySelector('.cot-detail-section pre');
    if (!modal || !layout || !result) return null;
    const rect = modal.getBoundingClientRect();
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      navSteps: document.querySelectorAll('.cot-detail-nav > button').length,
      resultFont: parseFloat(getComputedStyle(result).fontSize),
      resultSelectable: getComputedStyle(document.querySelector('.cot-detail-content')).userSelect,
      fitsViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
    };
  })()`), '宽版执行详情没有打开');
  assert.ok(modalMetrics.width >= 850, `宽版详情宽度不足：${modalMetrics.width}px`);
  assert.equal(modalMetrics.navSteps, 5, '宽版详情没有列出全部步骤');
  assert.ok(modalMetrics.resultFont >= 15, `宽版原始结果没有跟随特大字号：${modalMetrics.resultFont}px`);
  assert.equal(modalMetrics.resultSelectable, 'text', '宽版详情文字不可选择');
  assert.equal(modalMetrics.fitsViewport, true, '宽版详情超出助手窗口');

  const modalShot = await assistant.command('Page.captureScreenshot', { format: 'png' });
  await fs.writeFile(path.join(outputDir, 'execution-detail-modal.png'), Buffer.from(modalShot.data, 'base64'));
  console.log(JSON.stringify({ passed: true, expandedMetrics, modalMetrics, screenshots: [path.join(outputDir, 'execution-detail-expanded.png'), path.join(outputDir, 'execution-detail-modal.png')] }, null, 2));
} finally {
  try { await assistant?.evaluate('window.electronAPI.close()'); } catch {}
  if (main) {
    const history = JSON.stringify(previousHistory ?? null);
    const appearance = JSON.stringify(previousAppearance ?? null);
    try {
      await main.evaluate(`(() => {
        const history = ${history};
        const appearance = ${appearance};
        const sessions = ${JSON.stringify(previousSessions ?? null)};
        if (history === null) localStorage.removeItem('hermes_office_assistant_chat'); else localStorage.setItem('hermes_office_assistant_chat', history);
        if (appearance === null) localStorage.removeItem('hermes_office_appearance'); else localStorage.setItem('hermes_office_appearance', appearance);
        if (sessions === null) localStorage.removeItem('taiji_chat_sessions_v1'); else localStorage.setItem('taiji_chat_sessions_v1', sessions);
      })()`);
    } catch {}
  }
  assistant?.socket.close();
  main?.socket.close();
}
