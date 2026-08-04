const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, message, timeoutMs = 90_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { lastError = error; }
    await delay(150);
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

function modelResponse(message) {
  return JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 800, completion_tokens: 120, total_tokens: 920 }, model: 'taiji-v311-acceptance' });
}

function toolCall(name, args, id) {
  return { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
}

function riskBoardHtml() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>离线项目风险看板</title><style>
*{box-sizing:border-box}body{margin:0;background:#eef1ed;color:#17201c;font-family:Segoe UI,"Microsoft YaHei",sans-serif}.shell{width:min(1160px,calc(100% - 32px));margin:24px auto}.top{display:flex;justify-content:space-between;gap:16px;align-items:end;border-bottom:2px solid #17201c;padding-bottom:16px}.top h1{font-size:clamp(28px,5vw,50px);margin:0}.top p{margin:6px 0 0;color:#526059}.badge{background:#f4cf4d;border:1px solid #17201c;padding:8px 10px}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:16px 0}.metric{background:#17201c;color:#fff;padding:14px}.metric strong{display:block;font-size:28px}.board{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.column{background:#fff;border:1px solid #17201c;padding:14px;min-width:0}.column h2{margin:0 0 12px;font-size:19px}.risk{border-top:1px solid #d7ddd9;padding:12px 0}.risk:first-of-type{border-top:0}.risk-head{display:flex;justify-content:space-between;gap:8px}.risk h3{margin:0;font-size:16px;overflow-wrap:anywhere}.level{padding:3px 6px;border:1px solid currentColor;font-size:12px;white-space:nowrap}.high{color:#a52b20}.medium{color:#765b00}.low{color:#24633c}.meta,.action{margin:7px 0 0;color:#526059;font-size:14px;overflow-wrap:anywhere}.action{color:#17201c}.footer{margin-top:14px;padding:12px;border:1px dashed #526059}@media(max-width:760px){.shell{width:min(100% - 20px,560px);margin:12px auto}.top{align-items:start;flex-direction:column}.summary,.board{grid-template-columns:1fr}.badge{max-width:100%}.risk-head{align-items:start}}
</style></head><body><main class="shell"><header class="top"><div><h1>离线项目风险看板</h1><p>无需服务器，打开文件即可查看当前风险与缓解动作。</p></div><div class="badge">本地保存 · 2026-08-04</div></header><section class="summary"><div class="metric"><strong>5</strong>风险总数</div><div class="metric"><strong>2</strong>高风险</div><div class="metric"><strong>1</strong>等待确认</div></section><section class="board">
<article class="column"><h2>待处理</h2><div class="risk"><div class="risk-head"><h3>模型接口限流</h3><span class="level high">高</span></div><p class="meta">负责人：后端架构师</p><p class="action">缓解：增加退避、备用模型提示与预算告警。</p></div><div class="risk"><div class="risk-head"><h3>需求范围继续扩大</h3><span class="level medium">中</span></div><p class="meta">负责人：产品经理</p><p class="action">缓解：冻结本迭代验收标准。</p></div></article>
<article class="column"><h2>处理中</h2><div class="risk"><div class="risk-head"><h3>窄屏内容裁切</h3><span class="level high">高</span></div><p class="meta">负责人：响应式专家</p><p class="action">缓解：按真实 clientWidth 验证 375px。</p></div><div class="risk"><div class="risk-head"><h3>任务恢复重复执行</h3><span class="level medium">中</span></div><p class="meta">负责人：执行内核工程师</p><p class="action">缓解：以 Worker 租约和递增检查点恢复。</p></div></article>
<article class="column"><h2>已缓解</h2><div class="risk"><div class="risk-head"><h3>验收结果过于笼统</h3><span class="level low">低</span></div><p class="meta">负责人：质量审查员</p><p class="action">结果：按交付类型显示缺失证据和责任步骤。</p></div></article>
</section><footer class="footer">说明：此页面为本地离线验收产物，不连接账号、不上传数据。</footer></main></body></html>`;
}

async function startMockModel() {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url.endsWith('/chat/completions')) {
      response.writeHead(404).end(); return;
    }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || '{}');
    const messages = body.messages || [];
    const system = String(messages[0]?.content || '');
    const usedTool = (name) => messages.some((item) => item?.name === name
      || item?.tool_calls?.some((call) => call?.function?.name === name));
    const review = system.includes('当前步骤：Review responsive risk board');
    calls.push({ review, tools: (body.tools || []).map((item) => item.function?.name), messageCount: messages.length });
    let message;
    if (review) {
      message = toolCall('submit_review', { decision: 'PASS', reason: 'The risk board exists and the installed verifier confirmed desktop and 375px layouts.', checkedArtifacts: ['risk-board.html'] }, `review-${calls.length}`);
    } else if (!usedTool('write_file')) {
      message = toolCall('write_file', { path: 'risk-board.html', content: riskBoardHtml(), category: 'final' }, `write-${calls.length}`);
    } else if (!usedTool('verify_web_artifact')) {
      message = toolCall('verify_web_artifact', { path: 'risk-board.html', viewports: [{ width: 1440, height: 900, label: 'desktop' }, { width: 375, height: 844, label: 'narrow' }] }, `verify-${calls.length}`);
    } else {
      message = { role: 'assistant', content: 'The responsive offline project risk board is complete and verified at desktop and 375px.' };
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(modelResponse(message));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port, calls };
}

async function connect(debugPort) {
  const target = await waitFor(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    return targets.find((item) => item.type === 'page' && /^(?:file|https?):/iu.test(item.url || '') && !item.url.includes('#tool'));
  }, 'Installed Taiji renderer target was not ready');
  if (!target) throw new Error('Installed Taiji renderer target was not found');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', async (event) => {
    const raw = typeof event.data === 'string' ? event.data
      : typeof event.data?.text === 'function' ? await event.data.text()
        : Buffer.from(event.data).toString('utf8');
    const message = JSON.parse(raw);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP command timed out: ${method}`)); }, 20_000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await command('Runtime.enable');
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Renderer evaluation failed');
    return result.result.value;
  };
  return { socket, command, evaluate };
}

async function main() {
  const installedExe = process.env.TAIJI_INSTALLED_EXE || `${process.env.LOCALAPPDATA}\\Programs\\taiji-office\\太极 AI 办公会所.exe`;
  await fs.access(installedExe);
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-v311-installed-'));
  const debugPort = 9800 + Math.floor(Math.random() * 100);
  const mock = await startMockModel();
  const gpuArgs = ['--disable-gpu', '--disable-gpu-compositing', '--in-process-gpu', '--disable-direct-composition',
    '--disable-gpu-sandbox', '--use-gl=swiftshader', '--disable-features=CalculateNativeWinOcclusion,Vulkan'];
  const child = spawn(installedExe, ['--remote-allow-origins=*', ...gpuArgs], {
    env: { ...process.env, TAIJI_TEST_USER_DATA: userData, TAIJI_TEST_DEBUG_PORT: String(debugPort), TAIJI_DISABLE_HARDWARE_ACCELERATION: '1' },
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8000); });
  let client;
  try {
    console.log('[installed-v311] waiting for installed client');
    await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${debugPort}/json`)).ok; } catch { return false; } }, 'Installed Taiji did not open its debug endpoint');
    client = await connect(debugPort);
    await waitFor(() => client.evaluate('document.readyState === "complete" && Boolean(window.electronAPI)'), 'Installed renderer did not expose Electron API');
    console.log('[installed-v311] renderer ready');
    const taskId = `installed-v311-${Date.now()}`;
    const created = await client.evaluate(`window.electronAPI.taskServiceCreate(${JSON.stringify({
      id: taskId, taskType: 'team', teamId: 'team-v311-installed', projectId: 'risk-board-project', conversationId: 'risk-board-acceptance',
      workspaceId: `tasks/team/team-v311-installed/${taskId}`,
      goal: 'Build an offline responsive project risk board and verify desktop plus 375px layouts.',
      acceptanceCriteria: ['risk-board.html exists', 'desktop verification passes', '375px verification passes', 'review passes'],
      memberSnapshot: [
        { id: 'product', name: '产品规划师', title: '产品', role: 'pm' },
        { id: 'frontend', name: '前端实现工程师', title: '前端', role: 'coder' },
        { id: 'reviewer', name: '质量审查员', title: '审查', role: 'checker' },
      ],
      steps: [
        { id: 'brief', title: 'Confirm risk board scope', employeeId: 'product', status: 'completed', output: { summary: 'Offline risk fields and acceptance scope confirmed.' } },
        { id: 'build', title: 'Build responsive risk board', assignment: 'Create risk-board.html and verify desktop and 375px layouts.', deliverableType: 'file', employeeId: 'frontend', dependsOnStepIds: ['brief'] },
        { id: 'review', title: 'Review responsive risk board', assignment: 'Review the verified risk board and submit PASS or REJECT.', kind: 'review', employeeId: 'reviewer', dependsOnStepIds: ['build'] },
      ],
    })})`);
    assert.equal(created.ok, true, created.error);
    console.log('[installed-v311] task created');
    const failed = await client.evaluate(`window.electronAPI.taskServiceFailStep(${JSON.stringify({
      taskId, stepId: 'build', error: 'Initial layout review did not cover the real 375px viewport.', errorClass: 'verification',
      alternativeStrategy: { routeId: 'installed-risk-board-verification', toolName: 'verify_web_artifact', description: 'Use the installed Electron verifier at desktop and 375px.', fingerprint: 'installed-risk-board-verification-v1' },
    })})`);
    assert.equal(failed.ok, true, failed.error);
    console.log('[installed-v311] initial verification failure recorded');
    const modelConfig = { provider: 'custom', apiHost: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'local-acceptance', model: 'taiji-v311-acceptance', contextWindowTokens: 64000 };
    const synced = await client.evaluate(`window.electronAPI.taskExecutionSyncMembers(${JSON.stringify({
      taskId,
      members: [
        { id: 'product', name: '产品规划师', title: '产品', role: 'pm', modelConfig },
        { id: 'frontend', name: '前端实现工程师', title: '前端', role: 'coder', modelConfig },
        { id: 'reviewer', name: '质量审查员', title: '审查', role: 'checker', modelConfig },
        { id: 'responsive', name: '响应式专家', title: '响应式 UI', role: 'coder', modelConfig },
      ],
      reason: 'The owner added a responsive specialist after the first 375px verification gap.',
      affectedNodeIds: ['build', 'review'], acceptanceCriteria: ['Verify the real 375px viewport before review.'],
    })})`);
    assert.equal(synced.ok, true, synced.error);
    console.log('[installed-v311] responsive specialist synchronized');
    const snapshot = await client.evaluate(`window.electronAPI.taskServiceRead({taskId:${JSON.stringify(taskId)}})`);
    const run = snapshot.runs[0];
    const started = await client.evaluate(`window.electronAPI.taskExecutionStart(${JSON.stringify({
      taskId, run,
      members: run.memberSnapshot.map((member) => ({ ...member, modelConfig })),
      executionPolicy: { sandboxEnabled: true, approvalMode: 'full', connectorApprovalMode: 'full' },
    })})`);
    assert.equal(started.ok, true, started.error);
    console.log('[installed-v311] native execution started');
    const completed = await waitFor(async () => client.evaluate(`(async()=>{const r=await window.electronAPI.taskServiceRead({taskId:${JSON.stringify(taskId)}});const run=r.runs?.[0];return run?.status==='completed'?run:null})()`), 'Installed project did not complete', 180_000);
    assert.equal(completed.adaptivePlanGraph.revision, 3);
    const preservedCompletedNodeIds = [...new Set(completed.adaptivePlanGraph.revisionHistory.flatMap((item) => item.preservedCompletedNodeIds || []))];
    assert.ok(preservedCompletedNodeIds.includes('brief'), JSON.stringify(completed.adaptivePlanGraph.revisionHistory));
    assert.equal(completed.adaptivePlanGraph.routeHistory.at(-1).fingerprint, 'installed-risk-board-verification-v1');
    assert.equal(completed.adaptivePlanGraph.rosterChanges.at(-1).employeeId, 'responsive');
    assert.ok(completed.evidence.some((item) => item.kind === 'file' && item.verified));
    const artifact = completed.evidence.find((item) => item.kind === 'file' && (item.path === 'risk-board.html' || item.fileName === 'risk-board.html'));
    const verification = completed.evidence.find((item) => item.kind === 'web_verification' || item.webArtifactVerification);
    const evidenceDir = path.resolve('docs', 'evidence', 'v3.11.0');
    const userDataEntries = await fs.readdir(userData, { recursive: true });
    const riskBoardRelativePath = userDataEntries.find((entry) => String(entry).replace(/\\/gu, '/').endsWith('/risk-board.html'));
    assert.ok(riskBoardRelativePath, 'Installed project artifact was not found in the task workspace');
    const preservedArtifactPath = path.join(evidenceDir, 'risk-board.html');
    await fs.mkdir(evidenceDir, { recursive: true });
    await fs.copyFile(path.join(userData, riskBoardRelativePath), preservedArtifactPath);
    const screenshotRelativePaths = userDataEntries.filter((entry) => /risk-board-(?:desktop|narrow)-\d+x\d+\.png$/u.test(String(entry).replace(/\\/gu, '/')));
    const preservedScreenshots = [];
    for (const screenshotRelativePath of screenshotRelativePaths) {
      const preservedScreenshot = path.join(evidenceDir, path.basename(screenshotRelativePath));
      await fs.copyFile(path.join(userData, screenshotRelativePath), preservedScreenshot);
      preservedScreenshots.push(preservedScreenshot);
    }
    await fs.writeFile(path.join(evidenceDir, 'task-run.json'), `${JSON.stringify(completed, null, 2)}\n`, 'utf8');
    const report = {
      passed: true, installedExe, taskId, status: completed.status, planRevision: completed.adaptivePlanGraph.revision,
      preservedCompletedNodeIds,
      revisionHistory: completed.adaptivePlanGraph.revisionHistory,
      activeRoute: completed.adaptivePlanGraph.routeHistory.at(-1).fingerprint,
      rosterChange: completed.adaptivePlanGraph.rosterChanges.at(-1),
      attempts: completed.steps.map((step) => ({ id: step.id, status: step.status, attempts: step.attempts })),
      artifact, verification, evidence: completed.evidence, modelCalls: mock.calls.length, userData,
      preservedArtifactPath, preservedScreenshots,
    };
    const output = path.join(evidenceDir, 'installed-project.json');
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ...report, output }, null, 2));
  } finally {
    try { await client?.evaluate('window.electronAPI.close()'); } catch {}
    client?.socket.close();
    mock.server.closeAllConnections?.();
    await new Promise((resolve) => mock.server.close(resolve));
    child.kill();
    await delay(500);
    await fs.rm(userData, { recursive: true, force: true }).catch(() => {});
    if (stderr) console.error(stderr);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
