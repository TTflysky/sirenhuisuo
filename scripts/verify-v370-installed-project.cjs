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
  return JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 800, completion_tokens: 120, total_tokens: 920 }, model: 'taiji-v370-acceptance' });
}

function toolCall(name, args, id) {
  return { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
}

function travelBoardHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline Travel Board</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f7f4;color:#17201c;font-family:Segoe UI,Arial,sans-serif}.shell{width:min(1120px,calc(100% - 32px));margin:24px auto}.top{display:flex;justify-content:space-between;gap:16px;align-items:end;border-bottom:2px solid #17201c;padding-bottom:16px}.top h1{font-size:clamp(28px,5vw,52px);margin:0}.top p{margin:6px 0 0;color:#526059}.badge{background:#ffd85d;border:1px solid #17201c;padding:8px 10px}.days{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:18px}.day{background:#fff;border:1px solid #17201c;padding:16px;min-width:0}.day h2{margin:0 0 12px;font-size:20px}.item{display:grid;grid-template-columns:58px minmax(0,1fr);gap:10px;padding:10px 0;border-top:1px solid #d7ddd9}.time{font-weight:700}.item span:last-child{overflow-wrap:anywhere}.footer{display:flex;justify-content:space-between;gap:12px;margin-top:16px;padding:14px;background:#17201c;color:#fff}@media(max-width:760px){.shell{width:min(100% - 20px,560px);margin:12px auto}.top{align-items:start;flex-direction:column}.days{grid-template-columns:1fr}.footer{flex-direction:column}.badge{max-width:100%}}
</style></head><body><main class="shell"><header class="top"><div><h1>Offline Travel Board</h1><p>Three-day city walk with local-only notes.</p></div><div class="badge">Saved on this device</div></header><section class="days">
<article class="day"><h2>Day 1 · Old Town</h2><div class="item"><span class="time">09:00</span><span>Market breakfast and riverside walk</span></div><div class="item"><span class="time">14:00</span><span>Museum reservation · code A17</span></div></article>
<article class="day"><h2>Day 2 · Hills</h2><div class="item"><span class="time">08:30</span><span>Trail entrance, water and offline map</span></div><div class="item"><span class="time">18:00</span><span>Sunset platform and return bus</span></div></article>
<article class="day"><h2>Day 3 · Design District</h2><div class="item"><span class="time">10:00</span><span>Independent studios and bookshop</span></div><div class="item"><span class="time">16:30</span><span>Pack photos and expense notes</span></div></article>
</section><footer class="footer"><span>Budget: 1,800 CNY</span><span>Emergency note available offline</span></footer></main></body></html>`;
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
    const review = system.includes('当前步骤：Review responsive travel board');
    calls.push({ review, tools: (body.tools || []).map((item) => item.function?.name), messageCount: messages.length });
    let message;
    if (review) {
      message = toolCall('submit_review', { decision: 'PASS', reason: 'The HTML exists and the installed verifier confirmed desktop and 375px layouts.', checkedArtifacts: ['travel-board.html'] }, `review-${calls.length}`);
    } else if (!usedTool('write_file')) {
      message = toolCall('write_file', { path: 'travel-board.html', content: travelBoardHtml(), category: 'final' }, `write-${calls.length}`);
    } else if (!usedTool('verify_web_artifact')) {
      message = toolCall('verify_web_artifact', { path: 'travel-board.html', viewports: [{ width: 1440, height: 900, label: 'desktop' }, { width: 375, height: 844, label: 'narrow' }] }, `verify-${calls.length}`);
    } else {
      message = { role: 'assistant', content: 'The responsive offline travel board is complete and verified at desktop and 375px.' };
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
  const installedExe = process.env.TAIJI_INSTALLED_EXE || 'C:\\Program Files\\taiji-office\\太极 AI 办公会所.exe';
  await fs.access(installedExe);
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-v370-installed-'));
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
    console.log('[installed-v370] waiting for installed client');
    await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${debugPort}/json`)).ok; } catch { return false; } }, 'Installed Taiji did not open its debug endpoint');
    client = await connect(debugPort);
    await waitFor(() => client.evaluate('document.readyState === "complete" && Boolean(window.electronAPI)'), 'Installed renderer did not expose Electron API');
    console.log('[installed-v370] renderer ready');
    const taskId = `installed-v370-${Date.now()}`;
    const created = await client.evaluate(`window.electronAPI.taskServiceCreate(${JSON.stringify({
      id: taskId, taskType: 'team', teamId: 'team-v370-installed', projectId: 'travel-board-project', conversationId: 'travel-board-acceptance',
      workspaceId: `tasks/team/team-v370-installed/${taskId}`,
      goal: 'Build an offline responsive travel itinerary board and verify desktop plus 375px layouts.',
      acceptanceCriteria: ['travel-board.html exists', 'desktop verification passes', '375px verification passes', 'review passes'],
      memberSnapshot: [
        { id: 'product', name: 'Product Planner', title: 'Product', role: 'pm' },
        { id: 'frontend', name: 'Frontend Builder', title: 'Frontend', role: 'coder' },
        { id: 'reviewer', name: 'Quality Reviewer', title: 'Review', role: 'checker' },
      ],
      steps: [
        { id: 'brief', title: 'Confirm travel board scope', employeeId: 'product', status: 'completed', output: { summary: 'Offline three-day itinerary scope confirmed.' } },
        { id: 'build', title: 'Build responsive travel board', assignment: 'Create travel-board.html and verify desktop and 375px layouts.', deliverableType: 'file', employeeId: 'frontend', dependsOnStepIds: ['brief'] },
        { id: 'review', title: 'Review responsive travel board', assignment: 'Review the verified travel board and submit PASS or REJECT.', kind: 'review', employeeId: 'reviewer', dependsOnStepIds: ['build'] },
      ],
    })})`);
    assert.equal(created.ok, true, created.error);
    console.log('[installed-v370] task created');
    const failed = await client.evaluate(`window.electronAPI.taskServiceFailStep(${JSON.stringify({
      taskId, stepId: 'build', error: 'Initial static verification did not cover the real 375px viewport.', errorClass: 'verification',
      alternativeStrategy: { routeId: 'installed-browser-verification', toolName: 'verify_web_artifact', description: 'Use the installed Electron verifier at desktop and 375px.', fingerprint: 'installed-browser-verification-v1' },
    })})`);
    assert.equal(failed.ok, true, failed.error);
    console.log('[installed-v370] initial verification failure recorded');
    const modelConfig = { provider: 'custom', apiHost: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'local-acceptance', model: 'taiji-v370-acceptance', contextWindowTokens: 64000 };
    const synced = await client.evaluate(`window.electronAPI.taskExecutionSyncMembers(${JSON.stringify({
      taskId,
      members: [
        { id: 'product', name: 'Product Planner', title: 'Product', role: 'pm', modelConfig },
        { id: 'frontend', name: 'Frontend Builder', title: 'Frontend', role: 'coder', modelConfig },
        { id: 'reviewer', name: 'Quality Reviewer', title: 'Review', role: 'checker', modelConfig },
        { id: 'responsive', name: 'Responsive Specialist', title: 'Responsive UI', role: 'coder', modelConfig },
      ],
      reason: 'The owner added a responsive specialist after the first 375px verification gap.',
      affectedNodeIds: ['build', 'review'], acceptanceCriteria: ['Verify the real 375px viewport before review.'],
    })})`);
    assert.equal(synced.ok, true, synced.error);
    console.log('[installed-v370] responsive specialist synchronized');
    const snapshot = await client.evaluate(`window.electronAPI.taskServiceRead({taskId:${JSON.stringify(taskId)}})`);
    const run = snapshot.runs[0];
    const started = await client.evaluate(`window.electronAPI.taskExecutionStart(${JSON.stringify({
      taskId, run,
      members: run.memberSnapshot.map((member) => ({ ...member, modelConfig })),
      executionPolicy: { sandboxEnabled: true, approvalMode: 'full', connectorApprovalMode: 'full' },
    })})`);
    assert.equal(started.ok, true, started.error);
    console.log('[installed-v370] native execution started');
    const completed = await waitFor(async () => client.evaluate(`(async()=>{const r=await window.electronAPI.taskServiceRead({taskId:${JSON.stringify(taskId)}});const run=r.runs?.[0];return run?.status==='completed'?run:null})()`), 'Installed project did not complete', 180_000);
    assert.equal(completed.adaptivePlanGraph.revision, 3);
    const preservedCompletedNodeIds = [...new Set(completed.adaptivePlanGraph.revisionHistory.flatMap((item) => item.preservedCompletedNodeIds || []))];
    assert.ok(preservedCompletedNodeIds.includes('brief'), JSON.stringify(completed.adaptivePlanGraph.revisionHistory));
    assert.equal(completed.adaptivePlanGraph.routeHistory.at(-1).fingerprint, 'installed-browser-verification-v1');
    assert.equal(completed.adaptivePlanGraph.rosterChanges.at(-1).employeeId, 'responsive');
    assert.ok(completed.evidence.some((item) => item.kind === 'file' && item.verified));
    const artifact = completed.evidence.find((item) => item.kind === 'file' && item.path === 'travel-board.html');
    const verification = completed.evidence.find((item) => item.kind === 'web_verification' || item.webArtifactVerification);
    const report = {
      passed: true, installedExe, taskId, status: completed.status, planRevision: completed.adaptivePlanGraph.revision,
      preservedCompletedNodeIds,
      revisionHistory: completed.adaptivePlanGraph.revisionHistory,
      activeRoute: completed.adaptivePlanGraph.routeHistory.at(-1).fingerprint,
      rosterChange: completed.adaptivePlanGraph.rosterChanges.at(-1),
      attempts: completed.steps.map((step) => ({ id: step.id, status: step.status, attempts: step.attempts })),
      artifact, verification, modelCalls: mock.calls.length, userData,
    };
    const output = path.resolve('artifacts', 'v3.7.0-installed-project.json');
    await fs.mkdir(path.dirname(output), { recursive: true });
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
