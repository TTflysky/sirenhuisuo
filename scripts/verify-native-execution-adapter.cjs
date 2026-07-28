const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createTaskRuntimeStore } = require('../electron/taskRuntimeStore.cjs');
const { createTaskWorker } = require('../electron/taskWorker.cjs');
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
        return { name, success: true, output: 'report.md 已写入并读回校验', structuredEvidence: { artifacts: [{ path: 'report.md', filename: 'report.md', bytes: 128, verified: true }] } };
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
  assert(!JSON.stringify(await store.read()).includes('NATIVE_TEST_SECRET'), '模型凭据泄漏到任务持久化');
  const completedEvent = await waitFor(() => adapter.events(run.id).events.find((event) => event.type === 'job_completed'));
  assert.equal(completedEvent.type, 'job_completed', '没有完成事件');
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

  adapter.stopAll();
  pauseAdapter.stopAll();
  queueAdapter.stopAll();
  waitingAdapter.stopAll();
  steeringAdapter.stopAll();
  budgetAdapter.stopAll();
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
