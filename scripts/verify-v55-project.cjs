const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const debugPort = Number(process.env.TAIJI_DEBUG_PORT || 9336);
const endpoint = `http://127.0.0.1:${debugPort}`;
const resultRoot = path.resolve('test-results/v5.5-project');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function modelResponse(message) {
  return JSON.stringify({
    choices: [{ message }],
    usage: { prompt_tokens: 900, completion_tokens: 180, total_tokens: 1080 },
    model: 'taiji-v55-local-acceptance',
  });
}

function toolCall(name, args, id) {
  return { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
}

function riskBoardHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline Risk Dashboard</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f7f4;color:#17201c;font-family:Segoe UI,Arial,sans-serif}.shell{width:min(1120px,calc(100% - 32px));margin:24px auto}.top{display:flex;justify-content:space-between;gap:16px;align-items:end;border-bottom:2px solid #17201c;padding-bottom:16px}.top h1{font-size:clamp(28px,5vw,52px);margin:0}.top p{margin:6px 0 0;color:#526059}.badge{background:#ffd85d;border:1px solid #17201c;padding:8px 10px}.board{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:18px}.column{background:#fff;border:1px solid #17201c;padding:16px;min-width:0}.column h2{margin:0 0 12px;font-size:20px}.risk{border-top:1px solid #d7ddd9;padding:12px 0}.risk:first-of-type{border-top:0}.risk h3{margin:0;font-size:16px;overflow-wrap:anywhere}.risk p{margin:7px 0 0;color:#526059;overflow-wrap:anywhere}.footer{display:flex;justify-content:space-between;gap:12px;margin-top:16px;padding:14px;background:#17201c;color:#fff}@media(max-width:760px){.shell{width:min(100% - 20px,560px);margin:12px auto}.top{align-items:start;flex-direction:column}.board{grid-template-columns:1fr}.footer{flex-direction:column}.badge{max-width:100%}}
</style></head><body><main class="shell"><header class="top"><div><h1>Offline Risk Dashboard</h1><p>Track project risks without a server.</p></div><div class="badge">Local only</div></header><section class="board"><article class="column"><h2>Open</h2><div class="risk"><h3>Model rate limit</h3><p>Owner: backend · Add retry and budget alerts.</p></div><div class="risk"><h3>Scope drift</h3><p>Owner: product · Freeze this iteration's acceptance.</p></div></article><article class="column"><h2>In progress</h2><div class="risk"><h3>Mobile layout</h3><p>Owner: frontend · Verify a real 375px viewport.</p></div></article><article class="column"><h2>Mitigated</h2><div class="risk"><h3>Unclear review result</h3><p>Owner: QA · Record evidence and the responsible step.</p></div></article></section><footer class="footer"><span>5 risks</span><span>JSON and Markdown export ready</span></footer></main></body></html>`;
}

async function startMockModel() {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url.endsWith('/chat/completions')) {
      response.writeHead(404).end();
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || '{}');
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = String(messages[0]?.content || '');
    const currentStep = String(system.match(/(?:当前步骤|Current step)\s*[:：]\s*([^\n]+)/iu)?.[1] || '').trim();
    const hasPath = (filePath) => messages.some((item) => {
      const toolCalls = Array.isArray(item?.tool_calls) ? item.tool_calls : [];
      if (toolCalls.some((call) => {
        if (call?.function?.name !== 'write_file') return false;
        try { return JSON.parse(call.function.arguments || '{}')?.path === filePath; } catch { return false; }
      })) return true;
      if (item?.name !== 'write_file') return false;
      try { return JSON.parse(item.content || '{}')?.path === filePath; } catch { return false; }
    });
    const hasTool = (name) => messages.some((item) => item?.name === name || item?.tool_calls?.some((call) => call?.function?.name === name));
    const review = /Review responsive risk dashboard/iu.test(currentStep);
    const build = /Build responsive risk dashboard/iu.test(currentStep);
    const ui = !review && !build && /UI design|responsive visual structure/iu.test(currentStep);
    const architecture = !review && !build && !ui && /Architecture/iu.test(currentStep);
    calls.push({ at: Date.now(), currentStep, review, architecture, ui, build, system: system.slice(-600), messageCount: messages.length, tools: (body.tools || []).map((item) => item.function?.name) });
    let message;
    if (review) {
      message = toolCall('submit_review', {
        decision: 'PASS',
        reason: 'The risk dashboard exists and the real desktop and 375px checks passed.',
        checkedArtifacts: ['risk-board.html', 'architecture.md', 'ui-spec.md'],
      }, `review-${calls.length}`);
    } else if (architecture && !hasPath('architecture.md')) {
      message = toolCall('write_file', { path: 'architecture.md', content: '# Architecture\nOffline static dashboard with a file-first delivery and deterministic viewport verification.\n', category: 'final' }, `architecture-${calls.length}`);
    } else if (ui && !hasPath('ui-spec.md')) {
      message = toolCall('write_file', { path: 'ui-spec.md', content: '# UI specification\nThree columns on desktop, one column below 760px, high-contrast status labels.\n', category: 'final' }, `ui-${calls.length}`);
    } else if (build && !hasPath('risk-board.html')) {
      message = toolCall('write_file', { path: 'risk-board.html', content: riskBoardHtml(), category: 'final' }, `build-${calls.length}`);
    } else if (build && !hasTool('verify_web_artifact')) {
      message = toolCall('verify_web_artifact', { path: 'risk-board.html', viewports: [{ width: 1440, height: 900, label: 'desktop' }, { width: 375, height: 844, label: 'narrow' }] }, `verify-${calls.length}`);
    } else {
      message = { role: 'assistant', content: 'The assigned stage is complete with its requested evidence.' };
    }
    console.log(JSON.stringify({ currentStep, stage: review ? 'review' : architecture ? 'architecture' : ui ? 'ui' : build ? 'build' : 'unknown', action: message.tool_calls?.[0]?.function?.name || 'final', path: (() => { try { return JSON.parse(message.tool_calls?.[0]?.function?.arguments || '{}').path; } catch { return undefined; } })() }));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(modelResponse(message));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port, calls };
}

async function waitFor(check, message, timeoutMs = 180_000) {
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

async function connect() {
  const targets = await (await fetch(`${endpoint}/json`)).json();
  const target = targets.find((item) => item.type === 'page' && /^(?:file|https?):/iu.test(item.url || '') && !item.url.includes('#tool'));
  if (!target) throw new Error('Taiji renderer target was not found');
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
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20_000);
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
  return { socket, evaluate };
}

async function main() {
  console.log(JSON.stringify({ phase: 'mock_model_start' }));
  const mock = await startMockModel();
  console.log(JSON.stringify({ phase: 'mock_model_ready', port: mock.port }));
  const client = await connect();
  console.log(JSON.stringify({ phase: 'renderer_connected', debugPort }));
  const taskId = `v55-project-${Date.now()}`;
  const modelConfig = { provider: 'custom', apiHost: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'local-acceptance', model: 'taiji-v55-local-acceptance', contextWindowTokens: 64000 };
  try {
    console.log(JSON.stringify({ phase: 'wait_electron_api' }));
    await waitFor(() => client.evaluate('Boolean(window.electronAPI)'), 'Electron API was not ready', 30_000);
    console.log(JSON.stringify({ phase: 'electron_api_ready' }));
    const created = await client.evaluate(`window.electronAPI.taskServiceCreate(${JSON.stringify({
      id: taskId,
      taskType: 'team',
      teamId: 'team-v55-project',
      projectId: 'project-v55-risk-dashboard',
      conversationId: 'conversation-v55-project',
      workspaceId: `projects/project-v55-risk-dashboard/tasks/team/${taskId}`,
      goal: 'Build an offline project risk dashboard with real files, desktop and 375px verification, and a final QA review.',
      acceptanceCriteria: ['architecture.md exists', 'ui-spec.md exists', 'risk-board.html exists', 'desktop verification passes', '375px verification passes', 'QA review passes'],
      memberSnapshot: [
        { id: 'product', name: 'Product Planner', title: 'Product', role: 'pm' },
        { id: 'architect', name: 'System Architect', title: 'Architecture', role: 'planner' },
        { id: 'ui', name: 'UI Designer', title: 'UI', role: 'custom' },
        { id: 'frontend', name: 'Frontend Builder', title: 'Frontend', role: 'coder' },
        { id: 'qa', name: 'Quality Reviewer', title: 'QA', role: 'checker' },
      ],
      steps: [
        { id: 'brief', title: 'Confirm risk dashboard scope', employeeId: 'product', status: 'completed', output: { summary: 'Scope and acceptance criteria confirmed.' } },
        { id: 'architecture', title: 'Architecture', assignment: 'Define the offline file-first architecture and delivery boundaries.', employeeId: 'architect', dependsOnStepIds: ['brief'] },
        { id: 'ui', title: 'UI design', assignment: 'Define the responsive visual structure and readable risk states.', employeeId: 'ui', dependsOnStepIds: ['architecture'] },
        { id: 'build', title: 'Build responsive risk dashboard', assignment: 'Create risk-board.html and verify desktop and 375px layouts.', deliverableType: 'file', employeeId: 'frontend', dependsOnStepIds: ['ui'] },
        { id: 'review', title: 'Review responsive risk dashboard', assignment: 'Review all verified files and submit PASS or REJECT with evidence.', kind: 'review', employeeId: 'qa', dependsOnStepIds: ['build'] },
      ],
    })})`);
    console.log(JSON.stringify({ phase: 'task_created', ok: created?.ok, taskId }));
    assert.equal(created.ok, true, created.error);
    const initial = await client.evaluate(`window.electronAPI.taskServiceRead({taskId:${JSON.stringify(taskId)}})`);
    console.log(JSON.stringify({ phase: 'task_read', ok: initial?.ok, runCount: initial?.runs?.length || 0 }));
    const run = initial.runs?.[0];
    assert.ok(run, 'created project run is missing');
    const started = await client.evaluate(`window.electronAPI.taskExecutionStart(${JSON.stringify({
      taskId,
      run,
      members: run.memberSnapshot.map((member) => ({ ...member, modelConfig })),
      executionPolicy: { sandboxEnabled: true, approvalMode: 'full', connectorApprovalMode: 'full' },
    })})`);
    console.log(JSON.stringify({ phase: 'execution_started', ok: started?.ok, state: started?.job?.state, error: started?.error }));
    assert.equal(started.ok, true, started.error);

    let lastStatus = '';
    const completed = await waitFor(async () => {
      const result = await client.evaluate(`window.electronAPI.taskServiceRead({taskId:${JSON.stringify(taskId)}})`);
      const current = result.runs?.[0];
      if (current && `${current.status}:${current.steps?.map((step) => step.status).join(',')}` !== lastStatus) {
        lastStatus = `${current.status}:${current.steps?.map((step) => step.status).join(',')}`;
        console.log(JSON.stringify({ at: new Date().toISOString(), status: current.status, steps: current.steps?.map((step) => ({ id: step.id, status: step.status, attempts: step.attempts })) }));
      }
      return current && (current.status === 'completed' || current.status === 'paused' || current.status === 'failed') ? current : null;
    }, 'V5.5 project did not complete');

    if (completed.status !== 'completed') {
      throw new Error(`V5.5 project stopped before completion: ${JSON.stringify({ status: completed.status, lastError: completed.lastError, handoff: completed.handoff, steps: completed.steps })}`);
    }
    assert.equal(completed.status, 'completed');
    assert.ok(completed.steps.filter((step) => step.id !== 'brief').every((step) => step.status === 'completed'), 'all project stages must complete');
    assert.ok(completed.steps.every((step) => step.id === 'brief' || step.responsibilityTaskId), 'every executed member stage must have a responsibility task');
    assert.ok(completed.evidence?.some((item) => item.verified), 'completed project must retain verified evidence');
    assert.ok(completed.evidence?.some((item) => item.kind === 'file' || item.artifact), 'project must retain file evidence');
    assert.ok(completed.evidence?.some((item) => item.kind === 'web_verification' || item.webArtifactVerification || /375px|viewport/iu.test(item.summary || '')), 'project must retain viewport verification evidence');
    const tree = await client.evaluate(`window.electronAPI.taskServiceTree(${JSON.stringify(taskId)})`);
    assert.equal(tree.ok, true, tree.error);
    assert.ok((tree.tree?.nodes || []).length >= 6, 'task tree must include the root and member responsibility records');
    const scoped = await client.evaluate(`window.electronAPI.taskStoreQuery(${JSON.stringify({ projectId: 'project-v55-risk-dashboard', conversationId: 'conversation-v55-project', limit: 50 })})`);
    assert.equal(scoped.ok, true, scoped.error);
    assert.ok(scoped.runs?.some((item) => item.id === taskId), 'project-scoped task query must return the current project');
    assert.ok(scoped.runs?.every((item) => item.projectId === 'project-v55-risk-dashboard' && item.conversationId === 'conversation-v55-project'), 'project-scoped query must not leak another context');

    const report = {
      passed: true,
      version: '5.5.0',
      taskId,
      projectId: completed.projectId,
      conversationId: completed.conversationId,
      status: completed.status,
      stages: completed.steps.map((step) => ({ id: step.id, status: step.status, responsibilityTaskId: step.responsibilityTaskId, attempts: step.attempts })),
      evidence: (completed.evidence || []).map((item) => ({ kind: item.kind, summary: item.summary, verified: item.verified, artifact: item.artifact })),
      treeNodeCount: tree.tree?.nodes?.length || 0,
      modelCalls: mock.calls.length,
      checkedAt: new Date().toISOString(),
    };
    await fs.mkdir(resultRoot, { recursive: true });
    await fs.writeFile(path.join(resultRoot, 'project-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    try { await client.evaluate('window.electronAPI.close()'); } catch {}
    client.socket.close();
    mock.server.closeAllConnections?.();
    await new Promise((resolve) => mock.server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
