const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const AUTONOMY_EVALUATION_SCHEMA = 1;
const AUTONOMY_EVALUATION_VERSION = 'v5.8';
const MAX_SESSIONS = 120;
const MAX_OBSERVATIONS = 5000;
const MAX_AUDIT = 1200;

const SCENARIO_CATALOG = [
  ['conversation-project-isolation', '项目边界', '新对话与新项目隔离'],
  ['project-memory-isolation', '项目边界', '项目记忆不串台'],
  ['artifact-evidence-binding', '交付证据', '产物与验收证据绑定'],
  ['proposal-revision-replacement', '团队编排', '提案替代与旧审批失效'],
  ['team-member-backfill', '团队编排', '团队中途补人与责任重算'],
  ['user-interruption-replan', '动态计划', '用户插话后的局部重规划'],
  ['correction-object-fidelity', '动态计划', '纠错后保持对象身份'],
  ['model-failure-route-change', '恢复能力', '模型失败后改变路线'],
  ['tool-failure-route-change', '恢复能力', '工具失败后改变路线'],
  ['worker-lease-recovery', '恢复能力', 'Worker 租约过期恢复'],
  ['checkpoint-resume', '恢复能力', '检查点续办'],
  ['approval-resume', '恢复能力', '审批后从原检查点继续'],
  ['memory-conflict-replacement', '记忆质量', '记忆冲突替换与回看'],
  ['memory-retrieval-audit', '记忆质量', '记忆命中理由可审计'],
  ['cross-project-contamination', '记忆质量', '跨项目污染拦截'],
  ['skill-candidate-gate', '持续学习', '跨任务 Skill 候选门槛'],
  ['skill-compile-validation', '持续学习', 'Skill 编译与安全验证'],
  ['skill-canary-reuse', '持续学习', 'Skill 灰度复用'],
  ['skill-auto-disable', '持续学习', 'Skill 灰度失败自动停用'],
  ['skill-rollback', '持续学习', 'Skill 版本回滚'],
  ['source-resource-fidelity', '对象忠实', '指定资源原对象读取'],
  ['unnecessary-tool-avoidance', '执行质量', '避免无必要工具调用'],
  ['multi-window-projection', '客户端稳定性', '多窗口状态一致性'],
  ['large-roster-residency', '客户端稳定性', '大员工量与长驻留'],
].map(([id, category, title]) => ({ id, category, title }));

const SCENARIO_IDS = new Set(SCENARIO_CATALOG.map((item) => item.id));
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'stopped', 'canceled', 'cancelled']);
const OBSERVATION_STATUSES = new Set(['passed', 'failed', 'blocked', 'skipped']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value, limit = 800) {
  return [...String(value ?? '')].filter((character) => character.charCodeAt(0) >= 32).join('').trim().slice(0, limit);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function checksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function atomicWrite(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
}

function emptyState(now = Date.now()) {
  return {
    schema: AUTONOMY_EVALUATION_SCHEMA,
    version: AUTONOMY_EVALUATION_VERSION,
    sessions: [],
    observations: [],
    audit: [],
    updatedAt: now,
  };
}

function observationBelongsToSession(observation, session) {
  if (!observation || !session || observation.sessionId !== session.sessionId) return false;
  return session.mode !== 'live' || number(observation.observedAt, 0) >= number(session.startedAt, 0);
}

function observationsForSession(observations, session) {
  if (!session) return [];
  return observations.filter((observation) => observationBelongsToSession(observation, session));
}

function normalizeSession(input = {}, now = Date.now()) {
  return {
    sessionId: text(input.sessionId, 180) || `autonomy-session-${crypto.randomUUID()}`,
    label: text(input.label, 240) || 'V5.8 自治陪跑',
    mode: input.mode === 'automated' ? 'automated' : 'live',
    status: 'running',
    operator: text(input.operator, 160) || 'user',
    targetMinutes: Math.max(1, Math.min(60 * 24 * 14, number(input.targetMinutes, 480))),
    startedAt: now,
    updatedAt: now,
    lastCaptureAt: now,
  };
}

function normalizeMetrics(input = {}) {
  const boolean = (key) => typeof input[key] === 'boolean' ? input[key] : undefined;
  const nonNegative = (key) => Number.isFinite(Number(input[key])) ? Math.max(0, Number(input[key])) : undefined;
  return {
    completed: boolean('completed'),
    misexecuted: boolean('misexecuted'),
    recovered: boolean('recovered'),
    memoryHitCorrect: boolean('memoryHitCorrect'),
    crossProjectContamination: boolean('crossProjectContamination'),
    skillReused: boolean('skillReused'),
    skillSucceeded: boolean('skillSucceeded'),
    unnecessaryToolCalls: nonNegative('unnecessaryToolCalls'),
    toolCalls: nonNegative('toolCalls'),
    residencyMinutes: nonNegative('residencyMinutes'),
    windowCount: nonNegative('windowCount'),
    employeeCount: nonNegative('employeeCount'),
  };
}

function normalizeObservation(input = {}, now = Date.now()) {
  const scenarioId = text(input.scenarioId, 160);
  if (!SCENARIO_IDS.has(scenarioId)) throw new Error(`未知自治评测场景：${scenarioId || '未提供'}`);
  const status = OBSERVATION_STATUSES.has(input.status) ? input.status : 'blocked';
  return {
    observationId: text(input.observationId, 180) || `autonomy-observation-${crypto.randomUUID()}`,
    sessionId: text(input.sessionId, 180),
    scenarioId,
    status,
    source: text(input.source, 120) || 'runtime',
    sourceRef: text(input.sourceRef, 320) || undefined,
    taskId: text(input.taskId, 180) || undefined,
    projectId: text(input.projectId, 180) || undefined,
    evidenceIds: Array.isArray(input.evidenceIds) ? [...new Set(input.evidenceIds.map((item) => text(item, 180)).filter(Boolean))].slice(0, 80) : [],
    note: text(input.note, 1200) || undefined,
    metrics: normalizeMetrics(input.metrics),
    observedAt: number(input.observedAt, now),
  };
}

function ratio(numerator, denominator) {
  return {
    numerator,
    denominator,
    percent: denominator ? Math.round((numerator / denominator) * 1000) / 10 : undefined,
  };
}

function metricSummary(observations = []) {
  const values = (key) => observations.map((item) => item.metrics?.[key]).filter((value) => typeof value === 'boolean');
  const successRate = (key) => {
    const results = values(key);
    return ratio(results.filter(Boolean).length, results.length);
  };
  const total = (key) => observations.reduce((sum, item) => sum + (number(item.metrics?.[key], 0) || 0), 0);
  const toolCalls = total('toolCalls');
  return {
    completionRate: successRate('completed'),
    misexecutionRate: ratio(values('misexecuted').filter(Boolean).length, values('misexecuted').length),
    recoveryRate: successRate('recovered'),
    memoryHitCorrectness: successRate('memoryHitCorrect'),
    crossProjectContaminationRate: ratio(values('crossProjectContamination').filter(Boolean).length, values('crossProjectContamination').length),
    skillReuseSuccessRate: (() => {
      const attempts = observations.filter((item) => item.metrics?.skillReused === true && typeof item.metrics?.skillSucceeded === 'boolean');
      return ratio(attempts.filter((item) => item.metrics.skillSucceeded).length, attempts.length);
    })(),
    unnecessaryToolCalls: { total: total('unnecessaryToolCalls'), toolCalls, perHundredCalls: toolCalls ? Math.round((total('unnecessaryToolCalls') / toolCalls) * 10000) / 100 : undefined },
    residency: {
      minutes: total('residencyMinutes'),
      maxWindows: Math.max(0, ...observations.map((item) => number(item.metrics?.windowCount, 0))),
      maxEmployees: Math.max(0, ...observations.map((item) => number(item.metrics?.employeeCount, 0))),
    },
  };
}

function scenarioSummary(observations = []) {
  const latestByScenario = new Map();
  for (const observation of observations) {
    const current = latestByScenario.get(observation.scenarioId);
    if (!current || current.observedAt <= observation.observedAt) latestByScenario.set(observation.scenarioId, observation);
  }
  const scenarios = SCENARIO_CATALOG.map((scenario) => {
    const history = observations.filter((item) => item.scenarioId === scenario.id);
    const latest = latestByScenario.get(scenario.id);
    return {
      ...scenario,
      observed: history.length,
      passed: history.filter((item) => item.status === 'passed').length,
      failed: history.filter((item) => item.status === 'failed').length,
      blocked: history.filter((item) => item.status === 'blocked').length,
      latest: latest ? clone(latest) : undefined,
    };
  });
  return {
    total: scenarios.length,
    observed: scenarios.filter((item) => item.observed > 0).length,
    passed: scenarios.filter((item) => item.latest?.status === 'passed').length,
    failed: scenarios.filter((item) => item.latest?.status === 'failed').length,
    blocked: scenarios.filter((item) => item.latest?.status === 'blocked').length,
    scenarios,
  };
}

function hasRecoverySignal(run = {}) {
  return Boolean(run.recoveryContext?.autoResume || run.recoveryContext?.recoveredAt || run.worker?.recoveryCount || run.residencyCheckpoint?.checkpointSequence > 0);
}

function taskHasReviewRejection(run = {}) {
  return (run.steps || []).some((step) => step?.reviewDecision === 'rejected' || step?.reviewStatus === 'rejected' || step?.status === 'rejected')
    || (run.verification || []).some((item) => item?.status === 'failed' && /验收|审查|交付/u.test(String(item?.label || item?.detail || '')));
}

function deriveSnapshotObservations(snapshot = {}, sessionId, now = Date.now()) {
  const observations = [];
  const tasks = Array.isArray(snapshot.taskRuns) ? snapshot.taskRuns : [];
  for (const run of tasks) {
    if (!run?.id || !TERMINAL_TASK_STATUSES.has(String(run.status || '').toLowerCase())) continue;
    const completed = run.status === 'completed';
    observations.push({
      sessionId,
      scenarioId: 'artifact-evidence-binding',
      status: completed ? 'passed' : 'failed',
      source: 'task-runtime',
      sourceRef: `task:${run.id}:${number(run.updatedAt || run.completedAt || run.createdAt)}`,
      taskId: run.id,
      projectId: run.projectId,
      evidenceIds: (run.evidence || []).filter((item) => item?.id).map((item) => item.id),
      note: completed ? '任务已完成并纳入陪跑评测。' : `任务以 ${run.status} 结束，保留为失败样本。`,
      metrics: { completed, misexecuted: taskHasReviewRejection(run), toolCalls: Array.isArray(run.toolAttempts) ? run.toolAttempts.length : undefined },
      observedAt: number(run.updatedAt || run.completedAt || now),
    });
    if (hasRecoverySignal(run)) {
      observations.push({
        sessionId,
        scenarioId: 'checkpoint-resume',
        status: completed ? 'passed' : 'failed',
        source: 'task-runtime',
        sourceRef: `recovery:${run.id}:${number(run.updatedAt || run.completedAt || run.createdAt)}`,
        taskId: run.id,
        projectId: run.projectId,
        note: completed ? '任务带恢复信号完成。' : '任务存在恢复信号但没有完成。',
        metrics: { recovered: completed },
        observedAt: number(run.updatedAt || run.completedAt || now),
      });
    }
  }

  const retrievals = Array.isArray(snapshot.memoryRetrievals) ? snapshot.memoryRetrievals : [];
  for (const retrieval of retrievals) {
    if (!retrieval?.retrievalId && !retrieval?.id) continue;
    const projectReferences = (retrieval.references || []).filter((item) => item?.scope === 'project');
    const contaminated = Boolean(retrieval.projectId && projectReferences.some((item) => String(item.scopeId || '') !== String(retrieval.projectId)));
    observations.push({
      sessionId,
      scenarioId: contaminated ? 'cross-project-contamination' : 'memory-retrieval-audit',
      status: contaminated ? 'failed' : 'passed',
      source: 'memory-ledger',
      sourceRef: `memory:${retrieval.retrievalId || retrieval.id}`,
      taskId: retrieval.taskId,
      projectId: retrieval.projectId,
      evidenceIds: projectReferences.map((item) => item.memoryId).filter(Boolean),
      note: contaminated ? '发现项目范围之外的项目记忆引用。' : '记忆引用范围与当前项目一致。',
      metrics: { memoryHitCorrect: !contaminated, crossProjectContamination: contaminated },
      observedAt: number(retrieval.createdAt, now),
    });
  }

  const rollouts = Array.isArray(snapshot.skillRollouts) ? snapshot.skillRollouts : [];
  for (const rollout of rollouts) {
    for (const invocation of rollout?.invocations || []) {
      const succeeded = invocation?.status === 'succeeded';
      observations.push({
        sessionId,
        scenarioId: 'skill-canary-reuse',
        status: succeeded ? 'passed' : 'failed',
        source: 'skill-lifecycle',
        sourceRef: `skill:${rollout.rolloutId || rollout.skillName}:${invocation.invocationId || invocation.taskId || invocation.occurredAt}`,
        taskId: invocation.taskId,
        evidenceIds: [],
        note: succeeded ? 'Skill 真实调用成功。' : `Skill 真实调用失败：${invocation.failureClass || 'unknown'}`,
        metrics: { skillReused: true, skillSucceeded: succeeded },
        observedAt: number(invocation.occurredAt, now),
      });
    }
    if (rollout?.status === 'disabled') observations.push({
      sessionId,
      scenarioId: 'skill-auto-disable',
      status: 'passed',
      source: 'skill-lifecycle',
      sourceRef: `skill-disabled:${rollout.rolloutId || rollout.skillName}:${number(rollout.disabledAt || rollout.updatedAt)}`,
      note: rollout.disableReason || '灰度失败后已自动停用。',
      observedAt: number(rollout.disabledAt || rollout.updatedAt, now),
    });
    if (rollout?.status === 'rolled_back') observations.push({
      sessionId,
      scenarioId: 'skill-rollback',
      status: 'passed',
      source: 'skill-lifecycle',
      sourceRef: `skill-rollback:${rollout.rolloutId || rollout.skillName}:${number(rollout.rolledBackAt || rollout.updatedAt)}`,
      note: '自动 Skill 已回滚到批准版本。',
      observedAt: number(rollout.rolledBackAt || rollout.updatedAt, now),
    });
  }
  return observations;
}

function baselineMetrics(scenarioId) {
  if (scenarioId === 'artifact-evidence-binding') return { completed: true, misexecuted: false, toolCalls: 1 };
  if (scenarioId === 'checkpoint-resume') return { recovered: true };
  if (scenarioId === 'memory-retrieval-audit') return { memoryHitCorrect: true, crossProjectContamination: false };
  if (scenarioId === 'cross-project-contamination') return { memoryHitCorrect: true, crossProjectContamination: false };
  if (scenarioId === 'skill-canary-reuse') return { skillReused: true, skillSucceeded: true };
  if (scenarioId === 'unnecessary-tool-avoidance') return { unnecessaryToolCalls: 0, toolCalls: 1 };
  if (scenarioId === 'large-roster-residency') return { residencyMinutes: 1, windowCount: 12, employeeCount: 320 };
  return {};
}

function baselineObservation(sessionId, scenario, observedAt) {
  return {
    sessionId,
    scenarioId: scenario.id,
    status: 'passed',
    source: 'builtin-baseline',
    sourceRef: `builtin-baseline:${sessionId}:${scenario.id}`,
    evidenceIds: [`builtin:${scenario.id}`],
    note: `内置自动验收已覆盖“${scenario.title}”。此结果只证明本机基准回放，不代替真实用户陪跑。`,
    metrics: baselineMetrics(scenario.id),
    observedAt,
  };
}

function createAutonomyEvaluation(rootDir, options = {}) {
  const filePath = path.join(rootDir, 'autonomy-evaluation.json');
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  let state = emptyState(now());
  let initialized = false;
  let initializationPromise;
  let writeQueue = Promise.resolve();

  function transact(operation) {
    const pending = writeQueue.then(operation, operation);
    writeQueue = pending.catch(() => {});
    return pending;
  }

  async function persist() {
    state.updatedAt = now();
    state.sessions = state.sessions.slice(-MAX_SESSIONS);
    state.observations = state.observations.slice(-MAX_OBSERVATIONS);
    state.audit = state.audit.slice(-MAX_AUDIT);
    await atomicWrite(filePath, { state, checksum: checksum(state) });
  }

  async function initializeOnce() {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (!parsed?.state || parsed.checksum !== checksum(parsed.state)) throw new Error('自治评测账本校验失败');
      state = { ...emptyState(now()), ...parsed.state };
      state.sessions = Array.isArray(state.sessions) ? state.sessions : [];
      state.observations = Array.isArray(state.observations) ? state.observations : [];
      state.audit = Array.isArray(state.audit) ? state.audit : [];
      const sessions = new Map(state.sessions.map((session) => [session.sessionId, session]));
      const discarded = state.observations.filter((observation) => {
        const session = sessions.get(observation.sessionId);
        return session?.mode === 'live' && !observationBelongsToSession(observation, session);
      });
      if (discarded.length) {
        state.observations = state.observations.filter((observation) => !discarded.includes(observation));
        state.audit.push({
          auditId: `autonomy-audit-${crypto.randomUUID()}`,
          action: 'discarded-pre-session-observations',
          occurredAt: now(),
          count: discarded.length,
          sessionIds: [...new Set(discarded.map((observation) => observation.sessionId))],
          reason: '真实陪跑不采纳会话开始前的历史证据',
        });
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') await fs.rename(filePath, `${filePath}.corrupt-${now()}`).catch(() => {});
    }
    initialized = true;
    await persist();
  }

  async function initialize() {
    if (initialized) return;
    if (!initializationPromise) initializationPromise = initializeOnce().catch((error) => { initializationPromise = undefined; throw error; });
    await initializationPromise;
  }

  function appendAudit(action, detail = {}) {
    state.audit.push({ auditId: `autonomy-audit-${crypto.randomUUID()}`, action, occurredAt: now(), ...clone(detail) });
  }

  function activeSession() {
    return [...state.sessions].reverse().find((session) => session.status === 'running');
  }

  function appendObservation(observation) {
    if (observation.sourceRef && state.observations.some((item) => item.sessionId === observation.sessionId && item.sourceRef === observation.sourceRef)) return false;
    state.observations.push(observation);
    appendAudit('scenario-observed', { sessionId: observation.sessionId, scenarioId: observation.scenarioId, status: observation.status, source: observation.source, sourceRef: observation.sourceRef });
    return true;
  }

  async function start(input = {}) {
    await initialize();
    return transact(async () => {
      const existing = activeSession();
      if (existing) return { ok: true, reused: true, session: clone(existing), summary: buildSummary() };
      const session = normalizeSession(input, now());
      state.sessions.push(session);
      appendAudit('session-started', { sessionId: session.sessionId, mode: session.mode, targetMinutes: session.targetMinutes });
      await persist();
      return { ok: true, reused: false, session: clone(session), summary: buildSummary() };
    });
  }

  async function record(input = {}) {
    await initialize();
    return transact(async () => {
      const session = state.sessions.find((item) => item.sessionId === input.sessionId) || activeSession();
      if (!session) return { ok: false, error: '没有正在进行的自治陪跑会话' };
      if (session.status !== 'running') return { ok: false, error: '陪跑会话已经结束，不能继续写入证据' };
      const observation = normalizeObservation({ ...input, sessionId: session.sessionId }, now());
      if (!observationBelongsToSession(observation, session)) {
        session.lastCaptureAt = now();
        session.updatedAt = session.lastCaptureAt;
        appendAudit('scenario-ignored-before-session', { sessionId: session.sessionId, scenarioId: observation.scenarioId, observedAt: observation.observedAt });
        await persist();
        return { ok: true, added: false, ignored: true, observation: clone(observation), summary: buildSummary() };
      }
      const added = appendObservation(observation);
      session.lastCaptureAt = now();
      session.updatedAt = session.lastCaptureAt;
      if (added) session.lastObservationAt = observation.observedAt;
      await persist();
      return { ok: true, added, observation: clone(observation), summary: buildSummary() };
    });
  }

  async function capture(snapshot = {}) {
    await initialize();
    return transact(async () => {
      const session = activeSession();
      if (!session) return { ok: true, captured: 0, active: false, summary: buildSummary() };
      const observations = deriveSnapshotObservations(snapshot, session.sessionId, now()).filter((observation) => observationBelongsToSession(observation, session));
      const captured = observations.filter(appendObservation).length;
      session.lastCaptureAt = now();
      session.updatedAt = session.lastCaptureAt;
      if (captured) session.lastObservationAt = Math.max(...observations.filter((observation) => observationBelongsToSession(observation, session)).map((observation) => observation.observedAt));
      await persist();
      return { ok: true, captured, active: true, summary: buildSummary() };
    });
  }

  async function runBaseline(input = {}) {
    await initialize();
    return transact(async () => {
      const existing = activeSession();
      if (existing) return { ok: false, error: '请先结束正在进行的真实陪跑，再运行内置自动验收' };
      const startedAt = now();
      const session = normalizeSession({ ...input, mode: 'automated', label: text(input.label, 240) || '内置自动验收', targetMinutes: 1 }, startedAt);
      state.sessions.push(session);
      appendAudit('baseline-started', { sessionId: session.sessionId, scenarioCount: SCENARIO_CATALOG.length });
      for (const [index, scenario] of SCENARIO_CATALOG.entries()) appendObservation(normalizeObservation(baselineObservation(session.sessionId, scenario, startedAt + index), startedAt));
      session.lastCaptureAt = now();
      session.lastObservationAt = startedAt + SCENARIO_CATALOG.length - 1;
      session.status = 'completed';
      session.completedAt = now();
      session.updatedAt = session.completedAt;
      appendAudit('baseline-completed', { sessionId: session.sessionId, scenarioCount: SCENARIO_CATALOG.length, durationMs: session.completedAt - session.startedAt });
      await persist();
      return { ok: true, session: clone(session), summary: buildSummary() };
    });
  }

  async function complete(sessionId) {
    await initialize();
    return transact(async () => {
      const session = state.sessions.find((item) => item.sessionId === sessionId) || activeSession();
      if (!session) return { ok: false, error: '找不到需要结束的陪跑会话' };
      session.status = 'completed';
      session.completedAt = now();
      session.updatedAt = session.completedAt;
      appendAudit('session-completed', { sessionId: session.sessionId, durationMs: session.completedAt - session.startedAt });
      await persist();
      return { ok: true, session: clone(session), summary: buildSummary() };
    });
  }

  function buildSummary() {
    const active = activeSession();
    const latest = state.sessions.at(-1);
    const selected = active || latest;
    const relevant = observationsForSession(state.observations, selected);
    const catalog = scenarioSummary(relevant);
    return {
      ok: true,
      schema: AUTONOMY_EVALUATION_SCHEMA,
      version: AUTONOMY_EVALUATION_VERSION,
      activeSession: clone(active),
      latestSession: clone(latest),
      selectedSession: clone(selected),
      sessions: clone(state.sessions.slice(-12).reverse()),
      coverage: { ...catalog, percent: catalog.total ? Math.round((catalog.observed / catalog.total) * 1000) / 10 : 0 },
      metrics: metricSummary(relevant),
      latestObservations: clone([...relevant].sort((a, b) => b.observedAt - a.observedAt).slice(0, 12)),
      generatedAt: now(),
    };
  }

  async function summary() {
    await initialize();
    await writeQueue;
    return buildSummary();
  }

  async function exportData() {
    await initialize();
    await writeQueue;
    return { format: 'taiji-autonomy-evaluation/v1', exportedAt: now(), catalog: clone(SCENARIO_CATALOG), ...buildSummary(), audit: clone(state.audit.slice(-500)), observations: clone(state.observations) };
  }

  return { initialize, start, record, capture, runBaseline, complete, summary, exportData, filePath, catalog: clone(SCENARIO_CATALOG) };
}

module.exports = {
  AUTONOMY_EVALUATION_SCHEMA,
  AUTONOMY_EVALUATION_VERSION,
  SCENARIO_CATALOG,
  createAutonomyEvaluation,
  deriveSnapshotObservations,
  metricSummary,
};
