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
  const completed = await waitFor(async () => {
    const snapshot = await store.read();
    const current = snapshot.runs.find((item) => item.id === run.id);
    return current?.status === 'completed' ? current : null;
  });
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

  adapter.stopAll();
  pauseAdapter.stopAll();
  worker.stop();
  await fs.rm(root, { recursive: true, force: true });
  console.log('native execution adapter verification passed');
  console.log(JSON.stringify({ completed: completed.status, writeExecutions, messages: completed.executionMessages.length, paused: pausedJob.state, credentialsPersisted: false }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
