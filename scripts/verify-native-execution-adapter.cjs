const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createTaskRuntimeStore } = require('../electron/taskRuntimeStore.cjs');
const { createTaskWorker } = require('../electron/taskWorker.cjs');
const { createTaskService } = require('../electron/taskService.cjs');
const { createNativeExecutionAdapter } = require('../electron/nativeExecutionAdapter.cjs');
const { redact, containsSensitiveLiteral } = require('../electron/nativeToolRuntime.cjs');

function runFixture(id, goal = '生成一份真实报告') {
  const now = Date.now();
  return {
    id,
    teamId: 'team-native-test',
    workspaceId: `tasks/team/team-native-test/${id}`,
    title: goal,
    request: goal,
    goal,
    status: 'queued',
    phase: 'preflight',
    createdAt: now,
    updatedAt: now,
    memberSnapshot: [
      { id: 'writer', name: '写作员工', title: '内容执行', role: 'coder' },
      { id: 'reviewer', name: '审查员工', title: '质量审查', role: 'checker' },
    ],
    steps: [
      { id: 'work-1', employeeId: 'writer', title: '完成真实报告', order: 1, kind: 'work', assignment: '生成并写入 report.md', dependsOnStepIds: [], status: 'queued', attempts: 0, evidence: [], events: [] },
      { id: 'review-1', employeeId: 'reviewer', title: '审查真实报告', order: 2, kind: 'review', assignment: '读取证据并提交审查', dependsOnStepIds: ['work-1'], status: 'queued', attempts: 0, evidence: [], events: [] },
    ],
    evidence: [],
    acceptanceCriteria: ['真实文件', '审查通过'],
    revisionCount: 0,
    maxRevisions: 2,
    recoveryContext: { summary: '等待执行', completedEvidence: [], unresolvedIssues: [], steeringMessages: [], budget: { toolAttempts: 0, updatedAt: now } },
  };
}

function singleStepRun(id, goal = '生成一份真实报告') {
  const run = runFixture(id, goal);
  run.memberSnapshot = [run.memberSnapshot[0]];
  run.steps = [run.steps[0]];
  return run;
}

function modelResponse(message, usage = {}) {
  return new Response(JSON.stringify({ choices: [{ message }], usage, model: 'mock-model' }), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function waitFor(check, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('等待原生执行器状态超时');
}

async function main() {
  assert.equal(containsSensitiveLiteral('curl -H "Authorization: Bearer abcdefghijklmnop"'), true);
  assert.equal(redact('Authorization: Bearer abcdefghijklmnop').includes('abcdefghijklmnop'), false);
  assert.equal(redact({ apiKey: 'NATIVE_TEST_SECRET' }).apiKey, '[已隐藏]');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-native-adapter-'));
  const store = createTaskRuntimeStore(path.join(root, 'runtime'));
  const worker = createTaskWorker({ rootDir: path.join(root, 'runtime'), store, sessionId: 'native-test-session', leaseMs: 5000, sweepMs: 1000 });
  await worker.start();
  let writeExecutions = 0;
  const toolRuntime = {
    definitions: [
      { type: 'function', function: { name: 'write_file', description: '写文件', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, category: { type: 'string' } }, required: ['path', 'content', 'category'] } } },
      { type: 'function', function: { name: 'submit_review', description: '提交审查', parameters: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' } }, required: ['decision', 'reason'] } } },
    ],
    redact: (value) => value,
    async execute(name) {
      if (name === 'write_file') {
        writeExecutions += 1;
        return { name, success: true, output: 'report.md 已写入并读回校验', structuredEvidence: { artifacts: [{ path: 'report.md', filename: 'report.md', bytes: 128, persistence: 'disk', diskPath: path.join(root, 'report.md'), verified: true }] } };
      }
      if (name === 'submit_review') {
        return { name, success: true, output: '审查通过', structuredEvidence: { review: { decision: 'pass', reason: '真实文件存在且内容完整', checkedArtifacts: ['report.md'], submittedAt: Date.now() } } };
      }
      return { name, success: false, output: '未知工具' };
    },
  };
  const rounds = new Map();
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    const system = String(body.messages?.[0]?.content || '');
    const step = system.includes('审查真实报告') ? 'review' : 'work';
    const count = (rounds.get(step) || 0) + 1;
    rounds.set(step, count);
    if (step === 'work' && count <= 2) {
      return modelResponse({ role: 'assistant', content: null, tool_calls: [{ id: `write-${count}`, type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'report.md', content: '真实内容', category: 'final' }) } }] }, { prompt_tokens: 30 });
    }
    if (step === 'review' && count === 1) {
      return modelResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'review-call', type: 'function', function: { name: 'submit_review', arguments: JSON.stringify({ decision: 'PASS', reason: '真实文件存在且内容完整', checkedArtifacts: ['report.md'] }) } }] }, { prompt_tokens: 20 });
    }
    return modelResponse({ role: 'assistant', content: step === 'review' ? '已根据真实文件完成审查并通过。' : '真实报告已写入并校验完成。' }, { prompt_tokens: 10 });
  };
  const adapter = createNativeExecutionAdapter({
    projectRoot: path.resolve(__dirname, '..'), store, worker, toolRuntime, sessionId: 'native-test-session', fetchImpl,
  });
  const run = runFixture('native-complete');
  const started = await adapter.start({
    taskId: run.id,
    run,
    members: run.memberSnapshot.map((member) => ({ ...member, modelConfig: { apiHost: 'https://mock.invalid/v1', apiKey: 'NATIVE_TEST_SECRET', model: 'mock-model', contextWindowTokens: 64000 } })),
  });
  assert.equal(started.ok, true, started.error);
  let completed;
  try {
    completed = await waitFor(async () => {
      const snapshot = await store.read();
      const current = snapshot.runs.find((item) => item.id === run.id);
      return current?.status === 'completed' ? current : null;
    });
  } catch (error) {
    const snapshot = await store.read();
    console.error(JSON.stringify({ status: adapter.status(run.id), run: snapshot.runs.find((item) => item.id === run.id), events: adapter.events(run.id).events }, null, 2));
    throw error;
  }
  assert.equal(writeExecutions, 1, '完全相同的 write_file 不应真实执行两次');
  assert(completed.evidence.some((item) => item.kind === 'file' && item.verified), '缺少文件证据');
  assert(completed.evidence.some((item) => item.kind === 'review' && item.verified), '缺少审查证据');
  assert(completed.executionMessages.some((item) => item.kind === 'execution'), '后台工具消息没有写入任务投影');
  assert(completed.stageSummaries?.some((item) => item.stepId === 'work-1' && item.status === 'completed'), '缺少章北海阶段交接记录');
  assert(completed.executionMessages.some((item) => item.kind === 'stage_summary' && item.stageSummary?.stepId === 'work-1'), '阶段交接没有投影到团队聊天');
  assert(!JSON.stringify(await store.read()).includes('NATIVE_TEST_SECRET'), '模型凭据泄漏到任务持久化');
  const completedEvent = await waitFor(() => adapter.events(run.id).events.find((event) => event.type === 'job_completed'));
  assert.equal(completedEvent.type, 'job_completed', '没有完成事件');
  const decisionRun = singleStepRun('native-decision-deliverable', 'Provide a UX design decision with clear rationale.');
  decisionRun.steps[0] = {
    ...decisionRun.steps[0], title: 'Provide UX design decision', assignment: 'Provide a UX design decision with clear rationale.', deliverableType: 'decision',
  };
  const decisionAdapter = createNativeExecutionAdapter({
    projectRoot: path.resolve(__dirname, '..'), store, worker, toolRuntime, sessionId: 'native-test-session',
    fetchImpl: async () => modelResponse({ role: 'assistant', content: 'Use a focused workspace layout, preserve direct navigation, and validate the visual hierarchy with the team.' }),
  });
  const decisionStarted = await decisionAdapter.start({
    taskId: decisionRun.id,
    run: decisionRun,
    members: decisionRun.memberSnapshot.map((member) => ({ ...member, modelConfig: { apiHost: 'https://mock.invalid/v1', model: 'mock-model' } })),
  });
  assert.equal(decisionStarted.ok, true, decisionStarted.error);
  const completedDecision = await waitFor(async () => {
    const snapshot = await store.read();
    const current = snapshot.runs.find((item) => item.id === decisionRun.id);
    return current?.status === 'completed' ? current : null;
  });
  assert.equal(completedDecision.verification.some((item) => item.kind === 'decision' && item.status === 'passed'), true, 'decision deliverable must not require a file artifact');

  const explicitUrl = 'https://mp.weixin.qq.com/s/6d_2gn2jK3lVTJaeookHkA';
  const resourceGoal = `${explicitUrl} 总结链接内容。`;
  const resourceRun = singleStepRun('native-explicit-resource', resourceGoal);
  resourceRun.steps[0] = {
    ...resourceRun.steps[0], title: '总结指定网页', assignment: resourceGoal, deliverableType: 'answer',
  };
  let resourceRound = 0;
  let searchExecutions = 0;
  let pageReadExecutions = 0;
  const resourceToolRuntime = {
    definitions: [
      { type: 'function', function: { name: 'web_search', description: '搜索网页', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
      { type: 'function', function: { name: 'read_web_page', description: '读取网页', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
    ],
    redact: (value) => value,
    async execute(name, args) {
      if (name === 'web_search') {
        searchExecutions += 1;
        return { name, success: true, output: '无关的搜索结果' };
      }
      if (name === 'read_web_page') {
        pageReadExecutions += 1;
        assert.equal(args.url, explicitUrl);
        return { name, success: true, output: `来源：${explicitUrl}\n正文：这是一篇用于精确链接回归的文章。` };
      }
      return { name, success: false, output: '未知工具' };
    },
  };
  const resourceAdapter = createNativeExecutionAdapter({
    projectRoot: path.resolve(__dirname, '..'), store, worker, toolRuntime: resourceToolRuntime, sessionId: 'native-test-session',
    fetchImpl: async () => {
      resourceRound += 1;
      if (resourceRound === 1) return modelResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'drift-search', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: '微信公众号文章' }) } }] });
      if (resourceRound === 2) return modelResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'exact-read', type: 'function', function: { name: 'read_web_page', arguments: JSON.stringify({ url: explicitUrl }) } }] });
      return modelResponse({ role: 'assistant', content: '该文章的核心内容是验证指定链接必须按原地址读取，不能由搜索结果替代。' });
    },
  });
  const resourceStarted = await resourceAdapter.start({
    taskId: resourceRun.id,
    run: resourceRun,
    members: resourceRun.memberSnapshot.map((member) => ({ ...member, modelConfig: { apiHost: 'https://mock.invalid/v1', model: 'mock-model' } })),
  });
  assert.equal(resourceStarted.ok, true, resourceStarted.error);
  await waitFor(async () => {
    const snapshot = await store.read();
    return snapshot.runs.find((item) => item.id === resourceRun.id)?.status === 'completed';
  });
  assert.equal(searchExecutions, 0, 'Explicit URL contract must block the model from executing web_search');
  assert.equal(pageReadExecutions, 1, 'The exact supplied webpage must be read once');

  const staleRendererRun = { ...completed, status: 'running', evidence: [], executionMessages: [] };
  const staleWrite = await store.write([staleRendererRun], { source: 'renderer', sessionId: 'stale-window' });
  assert.equal(staleWrite.ok, true);
  const protectedRun = (await store.read()).runs.find((item) => item.id === run.id);
  assert.equal(protectedRun.status, 'completed', '旧渲染快照回退了原生任务状态');
  assert(protectedRun.executionMessages.length > 0, '旧渲染快照擦除了后台执行消息');
  assert(protectedRun.evidence.length > 0, '旧渲染快照擦除了后台证据');

  let slowStarted;
  const slowFetch = async (_url, options) => new Promise((resolve, reject) => {
    slowStarted = true;
    const timer = setTimeout(() => resolve(modelResponse({ role: 'assistant', content: '不应到达' })), 2000);
    options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
  });
  const pauseAdapter = createNativeExecutionAdapter({ projectRoot: path.resolve(__dirname, '..'), store, worker, toolRuntime, sessionId: 'native-test-session', fetchImpl: slowFetch });
  const pausedRun = runFixture('native-paused');
  await pauseAdapter.start({ taskId: pausedRun.id, run: pausedRun, members: pausedRun.memberSnapshot.map((member) => ({ ...member, modelConfig: { apiHost: 'https://mock.invalid/v1', model: 'mock-model' } })) });
  await waitFor(() => slowStarted);
  const pauseResult = await worker.dispatch({ taskId: pausedRun.id, type: 'pause', requestedBy: 'test' });
  pauseAdapter.handleControl({ taskId: pausedRun.id, type: 'pause' }, pauseResult);
  const pausedJob = await waitFor(() => pauseAdapter.status(pausedRun.id).job?.state === 'paused' ? pauseAdapter.status(pausedRun.id).job : null);
  assert.equal(pausedJob.state, 'paused');
  const pausedSnapshot = await store.read();
  assert.equal(pausedSnapshot.runs.find((item) => item.id === pausedRun.id).status, 'paused');
  const delegatedWhilePaused = await pauseAdapter.delegate(pausedRun.id, {
    parentStepId: 'work-1', employeeId: 'reviewer', title: '暂停后新增校验子任务', assignment: '读取主步骤产出并检查完整性', acceptanceCriteria: ['列出检查结果'],
  });
  assert.equal(delegatedWhilePaused.ok, true, delegatedWhilePaused.error);
  const delegatedStatus = await pauseAdapter.delegationStatus(pausedRun.id);
  assert.equal(delegatedStatus.total, 1);
  assert.equal(delegatedStatus.active[0].employeeId, 'reviewer');
  assert.equal((await store.read()).runs.find((item) => item.id === pausedRun.id).steps.some((step) => step.delegationId === delegatedWhilePaused.delegation.id), true);

  const stalledToolRuntime = {
    ...toolRuntime,
    definitions: [...toolRuntime.definitions, {
      type: 'function',
      function: { name: 'hang_tool', description: '模拟永不返回的外部工具', parameters: { type: 'object', properties: {} } },
    }],
    async execute(name, args, context) {
      if (name === 'hang_tool') return new Promise(() => {});
      return toolRuntime.execute(name, args, context);
    },
  };
  const stalledAdapter = createNativeExecutionAdapter({
    projectRoot: path.resolve(__dirname, '..'), store, worker, toolRuntime: stalledToolRuntime,
    sessionId: 'native-test-session', toolCallTimeoutMs: 100, modelRequestTimeoutMs: 1000,
    fetchImpl: async () => modelResponse({ role: 'assistant', content: null, tool_calls: [{
      id: 'hang-call', type: 'function', function: { name: 'hang_tool', arguments: '{}' },
    }] }),
  });
  const stalledRun = singleStepRun('native-stalled-tool', '调用外部工具并等待真实结果');
  await stalledAdapter.start({
    taskId: stalledRun.id,
    run: stalledRun,
    members: stalledRun.memberSnapshot.map((member) => ({ ...member, modelConfig: { apiHost: 'https://mock.invalid/v1', model: 'mock-model' } })),
  });
  const stalledSnapshot = await waitFor(async () => {
    const current = (await store.read()).runs.find((item) => item.id === stalledRun.id);
    return current?.status === 'paused' ? current : null;
  });
  assert.equal(stalledSnapshot.worker.state, 'paused', '停滞保护必须同步暂停 Worker');
  assert.match(stalledSnapshot.handoff.blocked, /没有返回|安全暂停/u);
  assert.match(stalledSnapshot.handoff.nextAction, /继续执行/u);
  assert(stalledAdapter.events(stalledRun.id).events.some((event) => event.type === 'tool_started'), '缺少真实工具开始事件');
  assert(stalledAdapter.events(stalledRun.id).events.some((event) => event.type === 'execution_paused_after_stall'), '停滞后没有明确暂停事件');

  const uncooperativeAdapter = createNativeExecutionAdapter({
    projectRoot: path.resolve(__dirname, '..'), store, worker, toolRuntime,
    sessionId: 'native-test-session', modelRequestTimeoutMs: 100, retryDelays: [0],
    fetchImpl: async () => new Promise(() => {}),
  });
  const uncooperativeRun = singleStepRun('native-uncooperative-model', '验证模型请求不会无限挂起');
  await uncooperativeAdapter.start({
    taskId: uncooperativeRun.id,
    run: uncooperativeRun,
    members: uncooperativeRun.memberSnapshot.map((member) => ({ ...member, modelConfig: { apiHost: 'https://mock.invalid/v1', model: 'mock-model' } })),
  });
  const boundedModelRun = await waitFor(async () => {
    const current = (await store.read()).runs.find((item) => item.id === uncooperativeRun.id);
    return current?.status === 'failed' ? current : null;
  });
  assert.match(boundedModelRun.lastError, /没有返回|超时/u, '不响应的模型必须在边界内返回明确错误');
  const resumeFailedJob = await worker.dispatch({ commandId: 'resume-failed-native-job', taskId: uncooperativeRun.id, type: 'resume' });
  assert.equal(resumeFailedJob.ok, true, resumeFailedJob.error);
  await uncooperativeAdapter.handleControl({ taskId: uncooperativeRun.id, type: 'resume' }, resumeFailedJob);
  await waitFor(() => {
    const state = uncooperativeAdapter.status(uncooperativeRun.id).job?.state;
    return state === 'queued' || state === 'running';
  });
  assert(uncooperativeAdapter.events(uncooperativeRun.id).events.some((event) => event.type === 'control_received' && event.control === 'resume'), 'a failed native job must accept and requeue a resume control');

  const stalledBodyAdapter = createNativeExecutionAdapter({
    projectRoot: path.resolve(__dirname, '..'), store, worker, toolRuntime,
    sessionId: 'native-test-session', modelRequestTimeoutMs: 100, retryDelays: [0],
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => new Promise(() => {}) }),
  });
  const stalledBodyRun = singleStepRun('native-stalled-model-body', '验证模型响应正文不会无限挂起');
  await stalledBodyAdapter.start({
    taskId: stalledBodyRun.id,
    run: stalledBodyRun,
    members: stalledBodyRun.memberSnapshot.map((member) => ({ ...member, modelConfig: { apiHost: 'https://mock.invalid/v1', model: 'mock-model' } })),
  });
  const boundedBodyRun = await waitFor(async () => {
    const current = (await store.read()).runs.find((item) => item.id === stalledBodyRun.id);
    return current?.status === 'failed' ? current : null;
  });
  assert.match(boundedBodyRun.lastError, /没有返回|超时/u, '模型响应正文必须受同一个硬截止保护');

  let queueFirstStarted = false;
  let queueSecondStarted = false;
  const queuedFetch = async (_url, options) => {
    const system = String(JSON.parse(options.body).messages?.[0]?.content || '');
    if (system.includes('队列任务一')) {
      queueFirstStarted = true;
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    }
    queueSecondStarted = true;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  };
  const queueAdapter = createNativeExecutionAdapter({ projectRoot: path.resolve(__dirname, '..'), store, worker, toolRuntime, sessionId: 'native-test-session', fetchImpl: queuedFetch });
  const queueFirst = singleStepRun('native-queue-first', '队列任务一');
  const queueSecond = singleStepRun('native-queue-second', '队列任务二');
  const queueMembers = (run) => run.memberSnapshot.map((member) => ({ ...member, modelConfig: { apiHost: 'https://mock.invalid/v1', model: 'mock-model' } }));
  await queueAdapter.start({ taskId: queueFirst.id, run: queueFirst, members: queueMembers(queueFirst) });
  await waitFor(() => queueFirstStarted);
  await queueAdapter.start({ taskId: queueSecond.id, run: queueSecond, members: queueMembers(queueSecond) });
  const queuedStatus = queueAdapter.status(queueSecond.id);
  assert.equal(queuedStatus.job.state, 'queued');
  assert.equal(queuedStatus.job.queuePosition, 1);
  assert.equal(queuedStatus.queue.total, 1);
  const pauseQueued = await worker.dispatch({ taskId: queueFirst.id, type: 'pause', requestedBy: 'test' });
  queueAdapter.handleControl({ taskId: queueFirst.id, type: 'pause' }, pauseQueued);
  await waitFor(() => queueSecondStarted);
  const stopQueued = await worker.dispatch({ taskId: queueSecond.id, type: 'stop', requestedBy: 'test' });
  queueAdapter.handleControl({ taskId: queueSecond.id, type: 'stop' }, stopQueued);

  const waitingToolRuntime = {
    ...toolRuntime,
    async execute(name, args, context) {
      if (name === 'write_file') return { name, success: false, awaitingUser: true, output: '需要先在设置中完成外部服务授权。' };
      return toolRuntime.execute(name, args, context);
    },
  };
  const waitingFetch = async () => modelResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'wait-write', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'report.md', content: '真实内容', category: 'final' }) } }] });
  const waitingAdapter = createNativeExecutionAdapter({ projectRoot: path.resolve(__dirname, '..'), store, worker, toolRuntime: waitingToolRuntime, sessionId: 'native-test-session', fetchImpl: waitingFetch });
  const waitingRun = singleStepRun('native-awaiting-user', '等待用户授权');
  await waitingAdapter.start({ taskId: waitingRun.id, run: waitingRun, members: queueMembers(waitingRun) });
  const waitingJob = await waitFor(() => waitingAdapter.status(waitingRun.id).job?.state === 'awaiting_user' ? waitingAdapter.status(waitingRun.id).job : null);
  assert.equal(waitingJob.state, 'awaiting_user');
  const waitingSnapshot = (await store.read()).runs.find((item) => item.id === waitingRun.id);
  assert.equal(waitingSnapshot.status, 'awaiting_user');
  assert.match(waitingSnapshot.recoveryContext.waitingFor, /授权/u);

  let steeringFirstRequest = false;
  let steeringAbortCount = 0;
  let steeringCalls = 0;
  const steeringFetch = async (_url, options) => {
    steeringCalls += 1;
    if (steeringCalls === 1) {
      steeringFirstRequest = true;
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { steeringAbortCount += 1; reject(new Error('aborted')); }, { once: true }));
    }
    if (steeringCalls === 2) return modelResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'steer-write', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'report.md', content: '按新要求生成', category: 'final' }) } }] });
    return modelResponse({ role: 'assistant', content: '已按最新要求生成并验证真实报告。' });
  };
  const steeringAdapter = createNativeExecutionAdapter({ projectRoot: path.resolve(__dirname, '..'), store, worker, toolRuntime, sessionId: 'native-test-session', fetchImpl: steeringFetch });
  const steeringRun = singleStepRun('native-steering', '生成可验证报告');
  await steeringAdapter.start({ taskId: steeringRun.id, run: steeringRun, members: queueMembers(steeringRun) });
  await waitFor(() => steeringFirstRequest);
  const steeringResult = await steeringAdapter.steer(steeringRun.id, '改为面向新手的说明，并保留报告文件。');
  assert.equal(steeringResult.ok, true);
  const steeredCompleted = await waitFor(async () => {
    const snapshot = await store.read();
    const current = snapshot.runs.find((item) => item.id === steeringRun.id);
    return current && !['queued', 'running'].includes(current.status) ? current : null;
  });
  assert.equal(steeringAbortCount, 1, '插话必须取消正在进行的模型请求');
  assert(steeringAdapter.events(steeringRun.id).events.some((event) => event.type === 'steering_preempted'), '缺少插话抢占事件');
  assert.equal(steeredCompleted.status, 'completed', JSON.stringify({ status: steeredCompleted.status, lastError: steeredCompleted.lastError, handoff: steeredCompleted.handoff, events: steeringAdapter.events(steeringRun.id).events.map((event) => event.type) }));
  assert.equal(steeredCompleted.recoveryCapsule?.recoveryVersion, 1, '插话没有写入长期恢复胶囊');
  assert(steeredCompleted.context?.events?.some((event) => event.source === 'user' && /新手/u.test(event.summary)), '插话没有进入结构化任务上下文');

  const budgetFetch = async () => modelResponse({ role: 'assistant', content: '仍在准备，没有真实交付文件。' }, { prompt_tokens: 20, completion_tokens: 8 });
  const budgetAdapter = createNativeExecutionAdapter({ projectRoot: path.resolve(__dirname, '..'), store, worker, toolRuntime, sessionId: 'native-test-session', fetchImpl: budgetFetch });
  const budgetRun = singleStepRun('native-budget-checkpoint', '生成并写入真实报告文件');
  await budgetAdapter.start({ taskId: budgetRun.id, run: budgetRun, members: queueMembers(budgetRun) });
  const budgetJob = await waitFor(() => budgetAdapter.status(budgetRun.id).job?.state === 'paused' ? budgetAdapter.status(budgetRun.id).job : null, 15000);
  const budgetSnapshot = (await store.read()).runs.find((item) => item.id === budgetRun.id);
  assert.equal(budgetSnapshot.status, 'paused', '达到轮次预算后应安全暂停而不是标记失败');
  assert.match(budgetSnapshot.handoff.nextAction, /继续/u);
  assert.equal(budgetSnapshot.recoveryCapsule?.recoveryVersion, 1);
  assert(budgetAdapter.events(budgetRun.id).events.some((event) => event.type === 'context_compacted'), '长任务没有执行阶段压缩');
  assert.equal((await store.listRecoveryPoints({ taskId: budgetRun.id })).recoveryPoints.length > 0, true, '长任务没有创建恢复点');

  const childService = createTaskService(store);
  const childToolRuntime = {
    ...toolRuntime,
    definitions: [...toolRuntime.definitions, {
      type: 'function', function: {
        name: 'delegate_subtask', description: 'delegate a child task',
        parameters: { type: 'object', properties: { assignment: { type: 'string' }, employeeId: { type: 'string' }, title: { type: 'string' }, acceptanceCriteria: { type: 'array', items: { type: 'string' } } }, required: ['assignment'] },
      },
    }],
  };
  const childRounds = new Map();
  const childFetch = async (_url, options) => {
    const system = String(JSON.parse(options.body).messages?.[0]?.content || '');
    const isChild = system.includes('Parent task native-child-dispatch');
    const key = isChild ? 'child' : 'parent';
    const round = (childRounds.get(key) || 0) + 1;
    childRounds.set(key, round);
    if (!isChild && round === 1) {
      return modelResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'delegate-child', type: 'function', function: { name: 'delegate_subtask', arguments: JSON.stringify({ employeeId: 'writer', title: 'child report', assignment: 'write child-report.md', acceptanceCriteria: ['child file exists'] }) } }] });
    }
    if ((isChild && round === 1) || (!isChild && round === 2)) {
      const filename = isChild ? 'child-report.md' : 'parent-report.md';
      return modelResponse({ role: 'assistant', content: null, tool_calls: [{ id: `${key}-write-${round}`, type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: filename, content: `${key} verified output`, category: 'final' }) } }] });
    }
    return modelResponse({ role: 'assistant', content: `${key} completed verified work.` });
  };
  const childAdapter = createNativeExecutionAdapter({
    projectRoot: path.resolve(__dirname, '..'), store, worker, taskService: childService, toolRuntime: childToolRuntime,
    sessionId: 'native-test-session', fetchImpl: childFetch,
  });
  const childParent = singleStepRun('native-child-dispatch', 'parent task delegates and writes verified output');
  await childAdapter.start({ taskId: childParent.id, run: childParent, members: queueMembers(childParent) });
  let childCompleted;
  try {
    childCompleted = await waitFor(async () => {
      const snapshot = await store.read();
      const parent = snapshot.runs.find((item) => item.id === childParent.id);
      const child = snapshot.runs.find((item) => item.parentTaskId === childParent.id);
      return parent?.status === 'completed' && child?.status === 'completed' ? { parent, child } : null;
    }, 15000);
  } catch (error) {
    const snapshot = await store.read();
    const child = snapshot.runs.find((item) => item.parentTaskId === childParent.id);
    console.error(JSON.stringify({ parent: snapshot.runs.find((item) => item.id === childParent.id), child, parentEvents: childAdapter.events(childParent.id).events, childEvents: child ? childAdapter.events(child.id).events : [] }, null, 2));
    throw error;
  }
  const delegatedStep = childCompleted.parent.steps.find((step) => step.childTaskId === childCompleted.child.id);
  assert(delegatedStep, 'delegated parent step must retain childTaskId');
  assert.equal(delegatedStep.status, 'completed', 'child completion must synchronize parent step status');
  assert.match(delegatedStep.output?.childTask?.summary || '', /child completed verified work/i, 'parent step must retain the child delivery summary');
  assert.equal(delegatedStep.output?.childTask?.artifacts?.some((artifact) => artifact.path === 'report.md'), true, 'parent step must retain verified child artifacts');
  assert.match(childCompleted.parent.childTaskResults?.[childCompleted.child.id]?.summary || '', /child completed verified work/i, 'parent must preserve child results for downstream steps');
  assert.equal(childCompleted.parent.delegations.find((item) => item.childTaskId === childCompleted.child.id)?.status, 'completed');
  assert(childAdapter.events(childParent.id).events.some((event) => event.type === 'child_task_waiting'), 'parent must yield while its child task executes');
  assert.equal(childAdapter.events(childParent.id).events.some((event) => event.type === 'step_started' && event.stepId === delegatedStep.id), false, 'parent must never execute a delegated child step itself');
  assert(childAdapter.events(childCompleted.child.id).events.some((event) => event.type === 'job_completed'), 'child task did not execute in the native queue');

  const manualParent = singleStepRun('native-manual-child-dispatch', 'manual delegation creates a durable child');
  await store.write([...(await store.read()).runs, manualParent], { source: 'test-manual-child-dispatch' });
  const manualAdapter = createNativeExecutionAdapter({
    projectRoot: path.resolve(__dirname, '..'), store, worker, taskService: childService, toolRuntime: childToolRuntime,
    sessionId: 'native-test-session', fetchImpl: childFetch,
  });
  const manualDelegation = await manualAdapter.delegate(manualParent.id, {
    parentStepId: 'work-1', employeeId: 'writer', title: 'manual child', assignment: 'write manual-child.md', acceptanceCriteria: ['manual file exists'],
  });
  assert.equal(manualDelegation.ok, true, manualDelegation.error);
  assert(manualDelegation.childTask?.id, 'manual delegation must create a child task');
  const manualSnapshot = (await store.read()).runs.find((run) => run.id === manualParent.id);
  assert.equal(manualSnapshot.delegations[0].childTaskId, manualDelegation.childTask.id);
  assert.equal(manualSnapshot.steps.find((step) => step.id === manualDelegation.step.id)?.externalChild, true);

  const lifecycleParent = singleStepRun('native-child-lifecycle', 'parent controls its child lifecycle');
  await store.write([...(await store.read()).runs, lifecycleParent], { source: 'test-child-lifecycle' });
  const lifecycleChild = await childService.createChild(lifecycleParent.id, {
    employeeId: 'writer', title: 'controlled child', assignment: 'write a controlled report', goal: 'write a controlled report',
  });
  const blockedFetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('model request aborted for lifecycle control')), { once: true });
  });
  const lifecycleAdapter = createNativeExecutionAdapter({
    projectRoot: path.resolve(__dirname, '..'), store, worker, taskService: childService, toolRuntime: childToolRuntime,
    sessionId: 'native-test-session', fetchImpl: blockedFetch,
  });
  await lifecycleAdapter.start({ taskId: lifecycleChild.task.id, run: lifecycleChild.task, members: queueMembers(lifecycleChild.task) });
  await waitFor(() => lifecycleAdapter.status(lifecycleChild.task.id).job?.state === 'running');
  const pauseParent = await worker.dispatch({ commandId: 'pause-child-lifecycle-parent', taskId: lifecycleParent.id, type: 'pause' });
  lifecycleAdapter.handleControl({ taskId: lifecycleParent.id, type: 'pause' }, pauseParent);
  await waitFor(async () => (await store.read()).runs.find((run) => run.id === lifecycleChild.task.id)?.status === 'paused');
  await waitFor(() => lifecycleAdapter.events(lifecycleChild.task.id).events.some((event) => event.type === 'control_received' && event.control === 'pause'));
  assert(lifecycleAdapter.events(lifecycleChild.task.id).events.some((event) => event.type === 'control_received' && event.control === 'pause'), 'parent pause must cascade to child tasks');
  const resumeLiveParent = await worker.dispatch({ commandId: 'resume-live-child-lifecycle-parent', taskId: lifecycleParent.id, type: 'resume' });
  assert.equal(resumeLiveParent.ok, true, resumeLiveParent.error);
  await lifecycleAdapter.handleControl({ taskId: lifecycleParent.id, type: 'resume' }, resumeLiveParent);
  await waitFor(async () => (await store.read()).runs.find((run) => run.id === lifecycleChild.task.id)?.status === 'running');
  assert.equal(lifecycleAdapter.events(lifecycleChild.task.id).events.some((event) => event.type === 'job_failed' && /不能领取执行租约/u.test(event.error || '')), false, 'resumed child must enter queued durable state before its adapter job is enqueued');

  const resumeCascadeParent = singleStepRun('native-child-resume-cascade', 'parent resumes a paused child before continuing');
  resumeCascadeParent.steps[0].status = 'completed';
  await store.write([...(await store.read()).runs, resumeCascadeParent], { source: 'test-child-resume-cascade' });
  const resumeCascadeChild = await childService.createChild(resumeCascadeParent.id, {
    employeeId: 'writer', title: 'resume cascade child', assignment: 'resume child work', goal: 'resume child work',
  });
  await store.updateTask(resumeCascadeParent.id, (run) => {
    run.status = 'awaiting_user';
    run.phase = 'awaiting_user';
    run.steps.push({ id: 'resume-cascade-child-step', employeeId: 'writer', title: 'resume cascade child', assignment: 'wait for child resume', dependsOnStepIds: [], status: 'paused', attempts: 0, evidence: [], events: [], childTaskId: resumeCascadeChild.task.id, externalChild: true });
  }, { source: 'test-child-resume-cascade' });
  await store.updateTask(resumeCascadeChild.task.id, (run) => {
    run.status = 'failed';
    run.phase = 'blocked';
  }, { source: 'test-child-resume-cascade' });
  const resumeCascade = await worker.dispatch({ commandId: 'resume-child-lifecycle-parent', taskId: resumeCascadeParent.id, type: 'resume' });
  assert.equal(resumeCascade.ok, true, resumeCascade.error);
  await lifecycleAdapter.handleControl({ taskId: resumeCascadeParent.id, type: 'resume' }, resumeCascade);
  await waitFor(async () => {
    const snapshot = await store.read();
    const parent = snapshot.runs.find((run) => run.id === resumeCascadeParent.id);
    const child = snapshot.runs.find((run) => run.id === resumeCascadeChild.task.id);
    return parent?.status === 'queued' && child?.status === 'queued' ? { parent, child } : null;
  });

  const waitingParent = singleStepRun('native-child-wait-without-spin', 'parent waits without repeatedly reclaiming the queue');
  waitingParent.steps[0].status = 'completed';
  await store.write([...(await store.read()).runs, waitingParent], { source: 'test-child-wait-without-spin' });
  const waitingChild = await childService.createChild(waitingParent.id, {
    employeeId: 'writer', title: 'slow child', assignment: 'wait for a model response', goal: 'wait for a model response',
  });
  await store.updateTask(waitingParent.id, (run) => {
    run.steps.push({ id: 'waiting-child-step', employeeId: 'writer', title: 'slow child', assignment: 'wait for child', dependsOnStepIds: [], status: 'queued', attempts: 0, evidence: [], events: [], childTaskId: waitingChild.task.id, externalChild: true });
  }, { source: 'test-child-wait-without-spin' });
  const childWaitAdapter = createNativeExecutionAdapter({
    projectRoot: path.resolve(__dirname, '..'), store, worker, taskService: childService, toolRuntime: childToolRuntime,
    sessionId: 'native-test-session', fetchImpl: blockedFetch,
  });
  await childWaitAdapter.start({ taskId: waitingParent.id, run: waitingParent, members: queueMembers(waitingParent) });
  await waitFor(() => childWaitAdapter.status(waitingParent.id).job?.state === 'waiting_children');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(childWaitAdapter.events(waitingParent.id).events.filter((event) => event.type === 'child_task_waiting').length, 1, 'a parent waiting on a child must not spin in the queue');
  const stopWaitingParent = await worker.dispatch({ commandId: 'stop-waiting-parent', taskId: waitingParent.id, type: 'stop' });
  assert.equal(stopWaitingParent.ok, true, stopWaitingParent.error);
  await childWaitAdapter.handleControl({ taskId: waitingParent.id, type: 'stop' }, stopWaitingParent);
  await waitFor(async () => (await store.read()).runs.find((run) => run.id === waitingChild.task.id)?.status === 'stopped');

  const stopParent = await worker.dispatch({ commandId: 'stop-child-lifecycle-parent', taskId: lifecycleParent.id, type: 'stop' });
  lifecycleAdapter.handleControl({ taskId: lifecycleParent.id, type: 'stop' }, stopParent);
  await waitFor(async () => (await store.read()).runs.find((run) => run.id === lifecycleChild.task.id)?.status === 'stopped');
  assert.equal(lifecycleAdapter.status(lifecycleChild.task.id).job?.state, 'stopped', 'stopping the parent must stop an active child adapter job');

  const recoveryParent = singleStepRun('native-child-recovery', 'parent resumes a durable queued child');
  recoveryParent.steps[0].status = 'completed';
  await store.write([...(await store.read()).runs, recoveryParent], { source: 'test-child-recovery' });
  const recoveryChild = await childService.createChild(recoveryParent.id, {
    employeeId: 'writer', title: 'recovered child', assignment: 'write recovered-child.md', goal: 'write recovered-child.md',
  });
  await store.updateTask(recoveryParent.id, (run) => {
    const delegationId = 'recovery-delegation';
    run.delegations = [{ id: delegationId, childTaskId: recoveryChild.task.id, employeeId: 'writer', employeeName: '写作员工', title: 'recovered child', status: 'queued', acceptanceCriteria: ['recovered file exists'] }];
    run.steps.push({ id: 'recovery-child-step', employeeId: 'writer', title: 'recovered child', assignment: 'wait for recovered child', dependsOnStepIds: [], status: 'queued', attempts: 0, evidence: [], events: [], delegationId, childTaskId: recoveryChild.task.id, externalChild: true });
  }, { source: 'test-child-recovery' });
  let recoveryRound = 0;
  const recoveryFetch = async () => {
    recoveryRound += 1;
    if (recoveryRound === 1) return modelResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'recovered-write', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'recovered-child.md', content: 'recovered child output', category: 'final' }) } }] });
    return modelResponse({ role: 'assistant', content: 'recovered child completed verified work.' });
  };
  const recoveryAdapter = createNativeExecutionAdapter({
    projectRoot: path.resolve(__dirname, '..'), store, worker, taskService: childService, toolRuntime: childToolRuntime,
    sessionId: 'native-test-session', fetchImpl: recoveryFetch,
  });
  await recoveryAdapter.start({ taskId: recoveryParent.id, run: recoveryParent, members: queueMembers(recoveryParent) });
  await waitFor(async () => (await store.read()).runs.find((run) => run.id === recoveryChild.task.id)?.status === 'completed');
  assert(recoveryAdapter.events(recoveryParent.id).events.some((event) => event.type === 'child_task_resumed' && event.childTaskId === recoveryChild.task.id), 'parent recovery must restart a queued child without an active native job');

  const failedChildParent = singleStepRun('native-child-failure', 'parent records a child failure');
  failedChildParent.steps[0].status = 'completed';
  await store.write([...(await store.read()).runs, failedChildParent], { source: 'test-child-failure' });
  const failedChild = await childService.createChild(failedChildParent.id, {
    employeeId: 'writer', title: 'failed child', assignment: 'write an unavailable report', goal: 'write an unavailable report',
  });
  await store.updateTask(failedChild.task.id, (run) => { run.status = 'failed'; run.phase = 'blocked'; run.lastError = 'child connector authentication failed'; }, { source: 'test-child-failure' });
  await store.updateTask(failedChildParent.id, (run) => {
    const delegationId = 'failed-child-delegation';
    run.delegations = [{ id: delegationId, childTaskId: failedChild.task.id, employeeId: 'writer', employeeName: '写作员工', title: 'failed child', status: 'queued', acceptanceCriteria: ['report exists'] }];
    run.steps.push({ id: 'failed-child-step', employeeId: 'writer', title: 'failed child', assignment: 'wait for failed child', dependsOnStepIds: [], status: 'queued', attempts: 0, evidence: [], events: [], delegationId, childTaskId: failedChild.task.id, externalChild: true });
  }, { source: 'test-child-failure' });
  const failedChildAdapter = createNativeExecutionAdapter({
    projectRoot: path.resolve(__dirname, '..'), store, worker, taskService: childService, toolRuntime: childToolRuntime,
    sessionId: 'native-test-session', fetchImpl: recoveryFetch,
  });
  await failedChildAdapter.start({ taskId: failedChildParent.id, run: failedChildParent, members: queueMembers(failedChildParent) });
  const failedParentSnapshot = await waitFor(async () => {
    const parent = (await store.read()).runs.find((run) => run.id === failedChildParent.id);
    return parent?.status === 'failed' ? parent : null;
  });
  assert.equal(failedParentSnapshot.delegations[0].status, 'failed', 'failed child must synchronize its delegation status before parent failure');
  assert.equal(failedParentSnapshot.steps.find((step) => step.id === 'failed-child-step')?.status, 'failed', 'failed child must synchronize the parent child step');
  assert.match(failedParentSnapshot.delegations[0].error, /authentication failed/i);

  const compensationRun = singleStepRun('native-compensation', 'stop a task and execute its declared compensation');
  compensationRun.steps[0].status = 'completed';
  compensationRun.steps[0].sideEffect = true;
  compensationRun.steps[0].compensateStepId = 'rollback-side-effect';
  compensationRun.steps.push(
    { id: 'await-stop', employeeId: 'writer', title: 'wait for stop', assignment: 'wait until stopped', dependsOnStepIds: [], status: 'queued', attempts: 0, evidence: [], events: [] },
    { id: 'rollback-side-effect', employeeId: 'writer', title: 'rollback side effect', assignment: 'write rollback-evidence.md to document the executed rollback', dependsOnStepIds: [], status: 'queued', attempts: 0, evidence: [], events: [], compensationOnly: true },
  );
  await store.write([...(await store.read()).runs, compensationRun], { source: 'test-compensation' });
  let compensationFirstCall = true;
  let compensationNormalStarted = false;
  const compensationFetch = async (_url, options) => {
    if (compensationFirstCall) {
      compensationFirstCall = false;
      compensationNormalStarted = true;
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('stopped before normal work completed')), { once: true }));
    }
    const payload = JSON.parse(options.body);
    const hasToolResult = payload.messages.some((message) => message.role === 'tool');
    if (!hasToolResult) return modelResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'rollback-write', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'rollback-evidence.md', content: 'rollback executed', category: 'working' }) } }] });
    return modelResponse({ role: 'assistant', content: 'Rollback completed with verified evidence.' });
  };
  const compensationAdapter = createNativeExecutionAdapter({
    projectRoot: path.resolve(__dirname, '..'), store, worker, taskService: childService, toolRuntime: childToolRuntime,
    sessionId: 'native-test-session', fetchImpl: compensationFetch,
  });
  await compensationAdapter.start({ taskId: compensationRun.id, run: compensationRun, members: queueMembers(compensationRun) });
  await waitFor(() => compensationNormalStarted);
  const stopCompensation = await worker.dispatch({ commandId: 'stop-native-compensation', taskId: compensationRun.id, type: 'stop' });
  compensationAdapter.handleControl({ taskId: compensationRun.id, type: 'stop' }, stopCompensation);
  const compensatedSnapshot = await waitFor(async () => {
    const run = (await store.read()).runs.find((item) => item.id === compensationRun.id);
    return run?.compensation?.some((item) => item.compensateStepId === 'rollback-side-effect' && item.status === 'completed') ? run : null;
  });
  assert.equal(compensatedSnapshot.steps.find((step) => step.id === 'rollback-side-effect')?.status, 'completed', 'declared compensation step must execute after stop');
  assert(compensationAdapter.events(compensationRun.id).events.some((event) => event.type === 'compensation_step_completed'), 'missing compensation completion event');

  const missingCompensationRun = singleStepRun('native-missing-compensation', 'stop a task with a declared but missing compensation step');
  missingCompensationRun.steps[0].status = 'completed';
  missingCompensationRun.steps[0].sideEffect = true;
  missingCompensationRun.steps[0].compensateStepId = 'missing-rollback-step';
  missingCompensationRun.steps.push({ id: 'wait-for-missing-stop', employeeId: 'writer', title: 'wait for stop', assignment: 'wait until stopped', dependsOnStepIds: [], status: 'queued', attempts: 0, evidence: [], events: [] });
  await store.write([...(await store.read()).runs, missingCompensationRun], { source: 'test-missing-compensation' });
  let missingCompensationStarted = false;
  const missingCompensationAdapter = createNativeExecutionAdapter({
    projectRoot: path.resolve(__dirname, '..'), store, worker, taskService: childService, toolRuntime: childToolRuntime,
    sessionId: 'native-test-session', fetchImpl: async (_url, options) => {
      missingCompensationStarted = true;
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('stopped before missing compensation')), { once: true }));
    },
  });
  await missingCompensationAdapter.start({ taskId: missingCompensationRun.id, run: missingCompensationRun, members: queueMembers(missingCompensationRun) });
  await waitFor(() => missingCompensationStarted);
  const stopMissingCompensation = await worker.dispatch({ commandId: 'stop-native-missing-compensation', taskId: missingCompensationRun.id, type: 'stop' });
  missingCompensationAdapter.handleControl({ taskId: missingCompensationRun.id, type: 'stop' }, stopMissingCompensation);
  const missingCompensationSnapshot = await waitFor(async () => {
    const run = (await store.read()).runs.find((item) => item.id === missingCompensationRun.id);
    return run?.compensation?.some((item) => item.status === 'missing') ? run : null;
  });
  assert.equal(missingCompensationSnapshot.compensation.at(-1).compensateStepId, 'missing-rollback-step', 'missing compensation target must be persisted');
  assert.match(missingCompensationSnapshot.handoff?.blocked || '', /补偿未完成/u, 'missing compensation must create a clear handoff');

  const approvalCompensationRun = singleStepRun('native-approved-compensation', 'stop a task and require approval before deleting remote state');
  approvalCompensationRun.steps[0].status = 'completed';
  approvalCompensationRun.steps[0].sideEffect = true;
  approvalCompensationRun.steps[0].compensateStepId = 'delete-remote-state';
  approvalCompensationRun.steps.push(
    { id: 'await-approval-stop', employeeId: 'writer', title: 'wait for stop', assignment: 'wait until stopped', dependsOnStepIds: [], status: 'queued', attempts: 0, evidence: [], events: [] },
    { id: 'delete-remote-state', employeeId: 'writer', title: 'delete remote state', assignment: 'delete external system state and write approved-rollback.md as evidence', dependsOnStepIds: [], status: 'queued', attempts: 0, evidence: [], events: [], compensationOnly: true },
  );
  await store.write([...(await store.read()).runs, approvalCompensationRun], { source: 'test-approved-compensation' });
  let approvalNormalStarted = false;
  let approvalToolExecuted = false;
  const approvalCompensationAdapter = createNativeExecutionAdapter({
    projectRoot: path.resolve(__dirname, '..'), store, worker, taskService: childService, toolRuntime: childToolRuntime,
    sessionId: 'native-test-session', fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const isCompensation = String(body.messages?.[0]?.content || '').includes('当前步骤：delete remote state');
      if (!isCompensation) {
        approvalNormalStarted = true;
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('stopped before approved compensation')), { once: true }));
      }
      const hasToolResult = body.messages.some((message) => message.role === 'tool');
      if (!hasToolResult) return modelResponse({ role: 'assistant', content: null, tool_calls: [{ id: 'approved-rollback-write', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'approved-rollback.md', content: 'approved rollback executed', category: 'working' }) } }] });
      approvalToolExecuted = true;
      return modelResponse({ role: 'assistant', content: 'Approved rollback completed.' });
    },
  });
  await approvalCompensationAdapter.start({ taskId: approvalCompensationRun.id, run: approvalCompensationRun, members: queueMembers(approvalCompensationRun) });
  await waitFor(() => approvalNormalStarted);
  const stopApprovalCompensation = await worker.dispatch({ commandId: 'stop-native-approved-compensation', taskId: approvalCompensationRun.id, type: 'stop' });
  approvalCompensationAdapter.handleControl({ taskId: approvalCompensationRun.id, type: 'stop' }, stopApprovalCompensation);
  const pendingApprovalSnapshot = await waitFor(async () => {
    const run = (await store.read()).runs.find((item) => item.id === approvalCompensationRun.id);
    return run?.approvals?.find((approval) => approval.scope === 'compensation' && approval.status === 'pending') ? run : null;
  });
  assert.equal(approvalToolExecuted, false, 'high-risk compensation must not execute before approval');
  const approvalId = pendingApprovalSnapshot.approvals.find((approval) => approval.scope === 'compensation').id;
  await childService.decideApproval(approvalCompensationRun.id, { approvalId, decision: 'approved', decidedBy: 'test' });
  const resumeApprovalCompensation = await worker.dispatch({ commandId: 'resume-native-approved-compensation', taskId: approvalCompensationRun.id, type: 'resume' });
  assert.equal(resumeApprovalCompensation.ok, true, resumeApprovalCompensation.error);
  approvalCompensationAdapter.handleControl({ taskId: approvalCompensationRun.id, type: 'resume' }, resumeApprovalCompensation);
  await waitFor(() => approvalCompensationAdapter.events(approvalCompensationRun.id).events.some((event) => event.type === 'compensation_queued'));
  const approvedCompensationSnapshot = await waitFor(async () => {
    const run = (await store.read()).runs.find((item) => item.id === approvalCompensationRun.id);
    return run?.compensation?.some((item) => item.compensateStepId === 'delete-remote-state' && item.status === 'completed') ? run : null;
  });
  assert.equal(approvalToolExecuted, true, 'approved compensation must execute its real tool action');
  assert.equal(approvedCompensationSnapshot.steps.find((step) => step.id === 'delete-remote-state')?.status, 'completed');

  adapter.stopAll();
  decisionAdapter.stopAll();
  pauseAdapter.stopAll();
  stalledAdapter.stopAll();
  uncooperativeAdapter.stopAll();
  stalledBodyAdapter.stopAll();
  queueAdapter.stopAll();
  waitingAdapter.stopAll();
  steeringAdapter.stopAll();
  budgetAdapter.stopAll();
  childAdapter.stopAll();
  manualAdapter.stopAll();
  lifecycleAdapter.stopAll();
  recoveryAdapter.stopAll();
  childWaitAdapter.stopAll();
  failedChildAdapter.stopAll();
  compensationAdapter.stopAll();
  missingCompensationAdapter.stopAll();
  approvalCompensationAdapter.stopAll();
  worker.stop();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await fs.rm(root, { recursive: true, force: true });
  console.log('native execution adapter verification passed');
  console.log(JSON.stringify({ completed: completed.status, writeExecutions, messages: completed.executionMessages.length, paused: pausedJob.state, queued: queuedStatus.job.queuePosition, awaitingUser: waitingJob.state, budgetCheckpoint: budgetJob.state, steeringAbortCount, credentialsPersisted: false }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
