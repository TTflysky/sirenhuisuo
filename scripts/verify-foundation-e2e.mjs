import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9334);
const endpoint = `http://127.0.0.1:${debugPort}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, message, timeoutMs = 18000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { lastError = error; }
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
  return { socket, evaluate };
}

async function loadStandaloneTypeScript(relativePath) {
  let source = await fs.readFile(relativePath, 'utf8');
  const dataUrl = (value) => `data:text/javascript;base64,${Buffer.from(value).toString('base64')}`;
  const taskPlanSource = await fs.readFile('src/engine/taskPlan.mjs', 'utf8');
  const taskPlanUrl = dataUrl(taskPlanSource);
  const taskRunnerSource = (await fs.readFile('src/engine/taskRunner.mjs', 'utf8')).replaceAll('./taskPlan.mjs', taskPlanUrl);
  const taskContextUrl = dataUrl(await fs.readFile('src/engine/taskContext.mjs', 'utf8'));
  const taskContextRouterSource = (await fs.readFile('src/engine/taskContextRouter.mjs', 'utf8')).replaceAll('./taskContext.mjs', taskContextUrl);
  const moduleUrls = new Map([
    ['../engine/executionController.mjs', dataUrl(await fs.readFile('src/engine/executionController.mjs', 'utf8'))],
    ['../engine/taskPlan.mjs', taskPlanUrl],
    ['../engine/taskRunner.mjs', dataUrl(taskRunnerSource)],
    ['../engine/taskContext.mjs', taskContextUrl],
    ['../engine/taskContextRouter.mjs', dataUrl(taskContextRouterSource)],
  ]);
  for (const [specifier, url] of moduleUrls) source = source.replaceAll(specifier, url);
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
    fileName: relativePath,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`);
}

async function verifySecretRedaction() {
  const security = await loadStandaloneTypeScript('src/engine/securityBoundary.ts');
  const input = JSON.stringify({ apiKey: 'sk-real-secret-value', nested: { password: 'very-secret-password' }, note: 'Bearer abcdefghijklmnop' });
  const redacted = security.redactToolArguments(input);
  assert.equal(redacted.includes('sk-real-secret-value'), false);
  assert.equal(redacted.includes('very-secret-password'), false);
  assert.equal(redacted.includes('abcdefghijklmnop'), false);
  return { redacted };
}

async function verifyStaleTaskRecovery() {
  const savedWindow = globalThis.window;
  const savedStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  globalThis.window = { electronAPI: { getAppSessionId: () => 'new-test-session' } };
  try {
    const run = {
      id: 'stale-run', teamId: 'team-a', workspaceId: 'tasks/team/team-a/run-stale', executionSessionId: 'old-test-session',
      title: '恢复测试', request: '验证重启恢复', status: 'running', createdAt: Date.now() - 5000, updatedAt: Date.now() - 5000,
      memberSnapshot: [], steps: [{ id: 'step-a', employeeId: 'employee-a', title: '执行', order: 1, kind: 'work', assignment: '执行', dependsOnStepIds: [], status: 'running', attempts: 1, events: [] }],
    };
    values.set('hermes_office_task_runs_v1', JSON.stringify([run]));
    const taskRuns = await loadStandaloneTypeScript('src/data/taskRuns.ts');
    const [recovered] = taskRuns.loadTaskRuns();
    assert.equal(recovered.status, 'paused');
    assert.equal(recovered.steps[0].status, 'paused');
    assert.match(recovered.recoveryContext.summary, /待恢复/u);
    assert.match(recovered.recoveryContext.interruptionReason, /中断/u);
    return { status: recovered.status, summary: recovered.recoveryContext.summary };
  } finally {
    globalThis.window = savedWindow;
    globalThis.localStorage = savedStorage;
  }
}

let main;
let settings;
try {
  const targets = (await listTargets()).find((target) => !target.url.includes('#chat') && !target.url.includes('#settings') && !target.url.includes('#tool'));
  if (!targets) throw new Error('没有找到太极主窗口；请先按开发验证步骤启动带调试端口的客户端。');
  main = await connect(targets);

  const workspace = await main.evaluate(`(async () => {
    const api = window.electronAPI;
    const nonce = 'foundation-' + Date.now();
    const first = 'diagnostics/e2e/' + nonce + '/one';
    const second = 'diagnostics/e2e/' + nonce + '/two';
    const source = 'diagnostics/e2e/' + nonce + '/source';
    const initialized = await Promise.all([
      api.fsInitWorkspace(first, { kind: 'assistant', label: 'first' }),
      api.fsInitWorkspace(second, { kind: 'assistant', label: 'second' }),
      api.fsInitWorkspace(source, { kind: 'assistant', label: 'source' }),
    ]);
    const writes = await Promise.all([
      api.fsWrite(first + '/same.txt', 'first-content'),
      api.fsWrite(second + '/same.txt', 'second-content'),
      api.fsWrite(source + '/uploads/input.txt', 'attachment-content'),
    ]);
    const copied = await api.fsCopyIntoWorkspace(source, first, [{ sourcePath: 'uploads/input.txt', targetPath: 'inputs/input.txt' }]);
    const reads = await Promise.all([api.fsRead(first + '/same.txt'), api.fsRead(second + '/same.txt'), api.fsRead(first + '/inputs/input.txt')]);
    return { initialized, writes, copied, reads };
  })()`);
  assert.equal(workspace.initialized.every((item) => item.ok), true, '任务工作区无法初始化');
  assert.equal(workspace.writes.every((item) => item.ok), true, '任务工作区无法写入');
  assert.equal(workspace.copied.ok, true, '附件无法复制到任务工作区');
  assert.deepEqual(workspace.reads.map((item) => item.content), ['first-content', 'second-content', 'attachment-content']);

  const taskWorker = await main.evaluate(`(async () => {
    const api = window.electronAPI;
    const taskId = 'worker-ipc-' + Date.now();
    const current = await api.taskStoreRead();
    const run = {
      id: taskId, teamId: 'diagnostics', title: 'Worker IPC 验证', request: '验证主进程 Worker',
      status: 'queued', phase: 'preflight', createdAt: Date.now(), updatedAt: Date.now(), memberSnapshot: [],
      steps: [{ id: taskId + '-step', employeeId: 'diagnostic', title: '验证', order: 1, kind: 'work', assignment: '验证 Worker', dependsOnStepIds: [], status: 'queued', attempts: 0, events: [] }],
    };
    const created = await api.taskStoreWrite([...(current.runs || []), run], { source: 'foundation-e2e' });
    const claimed = await api.taskWorkerCommand({ taskId, type: 'claim', requestedBy: 'foundation-e2e', payload: { adapter: 'diagnostic' } });
    const heartbeat = claimed.run?.worker?.leaseId
      ? await api.taskWorkerCommand({ taskId, type: 'heartbeat', requestedBy: 'foundation-e2e', payload: { leaseId: claimed.run.worker.leaseId } })
      : { ok: false };
    const paused = await api.taskWorkerCommand({ taskId, type: 'pause', requestedBy: 'foundation-e2e' });
    const commands = await api.taskWorkerCommands({ taskId, limit: 20 });
    const nativeStatus = await api.taskExecutionStatus();
    const closed = await api.taskWorkerCommand({ taskId, type: 'close', requestedBy: 'foundation-e2e' });
    return { created, claimed, heartbeat, paused, commands, nativeStatus, closed };
  })()`);
  assert.equal(taskWorker.created.ok, true, 'Worker IPC 测试任务无法写入账本');
  assert.equal(taskWorker.claimed.ok, true, 'Worker 无法领取测试任务');
  assert.equal(taskWorker.heartbeat.ok, true, 'Worker 心跳未被主进程接受');
  assert.equal(taskWorker.paused.run?.worker?.state, 'paused', 'Worker 暂停命令未写入任务投影');
  assert.ok((taskWorker.commands.records || []).some((record) => record.commandType === 'claim' && record.type === 'command_completed'), 'Worker 命令日志缺少领取完成记录');
  assert.equal(taskWorker.nativeStatus.ok, true, '原生 Execution Adapter 状态 IPC 不可用');
  assert.equal(taskWorker.closed.ok, true, 'Worker 无法关闭测试任务');

  const openSettings = await main.evaluate('window.electronAPI.openSettings()');
  assert.equal(openSettings.ok, true, `无法打开诊断中心${openSettings.error ? `：${openSettings.error}` : ''}`);
  const settingsTarget = await waitFor(async () => (await listTargets()).find((target) => target.url.includes('#settings')), '设置窗口没有启动');
  settings = await connect(settingsTarget);
  const diagnostics = await waitFor(async () => {
    const result = await settings.evaluate(`(() => ({
      count: document.querySelectorAll('.diagnostic-item').length,
      titles: [...document.querySelectorAll('.diagnostic-item strong')].map((item) => item.textContent.trim())
    }))()`);
    return result.count === 7 ? result : null;
  }, '诊断中心没有完成七项检查');
  assert.deepEqual(diagnostics.titles, ['AI 模型', '连接器与知识库', 'Skill 健康', '工具注册中心', '任务内核与恢复', '任务工作区', '安全与审批']);

  const cognitiveMemory = await settings.evaluate(`(() => {
    const button = [...document.querySelectorAll('.settings-nav-section button')].find((item) => item.textContent.includes('记忆'));
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(cognitiveMemory, true, '设置中没有记忆入口');
  const memoryPage = await waitFor(async () => {
    const result = await settings.evaluate(`(() => {
      const page = document.querySelector('.settings-page-memory');
      return page ? {
        text: page.innerText,
        horizontalOverflow: page.scrollWidth > page.clientWidth + 2
      } : null;
    })()`);
    return result?.text.includes('任务经验') ? result : null;
  }, '记忆页没有显示任务经验');
  assert.match(memoryPage.text, /长期记忆/u);
  assert.match(memoryPage.text, /相似任务会先读取这里的经验/u);
  assert.equal(memoryPage.horizontalOverflow, false, '记忆页出现横向溢出');

  await settings.evaluate(`(() => {
    const button = [...document.querySelectorAll('.settings-nav-section button')].find((item) => item.textContent.includes('备份迁移'));
    button?.click();
  })()`);
  const backupPage = await waitFor(async () => settings.evaluate(`document.body.innerText.includes('导出同步配置')`), '备份页没有完整配置导出入口');
  assert.equal(backupPage, true);

  const secret = await verifySecretRedaction();
  const recovery = await verifyStaleTaskRecovery();
  console.log(JSON.stringify({ passed: true, workspace: workspace.reads.map((item) => item.content), taskWorker: { commands: taskWorker.commands.records.length, state: taskWorker.paused.run.worker.state }, diagnostics, memoryPage, secret, recovery }, null, 2));
} finally {
  try { await settings?.evaluate('window.electronAPI.close()'); } catch {}
  settings?.socket.close();
  main?.socket.close();
}
