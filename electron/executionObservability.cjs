const TERMINAL_STATES = new Set(['completed', 'failed', 'stopped']);
const ACTIVE_STATES = new Set(['queued', 'running', 'paused', 'awaiting_user']);

function text(value, limit = 1200) {
  return String(value ?? '').trim().slice(0, limit);
}

function increment(target, key) {
  const name = text(key, 80) || 'unknown';
  target[name] = (Number(target[name]) || 0) + 1;
}

function classifyFailure(value) {
  const message = text(value, 4000).toLowerCase();
  if (!message) return 'unknown';
  if (/timeout|timed out|超时|没有返回/u.test(message)) return 'timeout';
  if (/permission|forbidden|unauthori[sz]ed|credential|api key|授权|权限|密钥/u.test(message)) return 'authorization';
  if (/network|connect|dns|socket|econn|网络|连接/u.test(message)) return 'network';
  if (/invalid|schema|parameter|input|参数|格式/u.test(message)) return 'invalid_input';
  if (/missing|not found|configuration|配置|不存在/u.test(message)) return 'configuration';
  return 'unknown';
}

function projectExecutionState(job = {}) {
  const rawState = text(job.state, 80) || 'queued';
  const rawMap = {
    waiting_children: { status: 'running', phase: 'waiting_for_children' },
    compensating_queue: { status: 'running', phase: 'compensating' },
  };
  const mapped = rawMap[rawState] || { status: rawState, phase: rawState === 'queued' ? 'queue' : rawState === 'awaiting_user' ? 'waiting_for_user' : rawState };
  return {
    status: mapped.status,
    phase: mapped.phase,
    rawState,
    active: ACTIVE_STATES.has(mapped.status),
    terminal: TERMINAL_STATES.has(mapped.status),
    waiting: mapped.status === 'awaiting_user' || mapped.phase === 'waiting_for_children',
  };
}

function createEmptySummary(taskId, now) {
  return {
    taskId,
    startedAt: now,
    updatedAt: now,
    eventCount: 0,
    retries: 0,
    failures: {},
    tools: { total: 0, succeeded: 0, failed: 0 },
    evidence: { total: 0, verified: 0 },
    steps: { started: 0, completed: 0, failed: 0 },
    lastActivity: undefined,
    semanticState: projectExecutionState(),
  };
}

function snapshot(summary, now) {
  if (!summary) return undefined;
  return {
    ...summary,
    durationMs: Math.max(0, (summary.finishedAt || now) - summary.startedAt),
    failures: { ...summary.failures },
    tools: { ...summary.tools },
    evidence: { ...summary.evidence },
    steps: { ...summary.steps },
    semanticState: { ...summary.semanticState },
  };
}

function createExecutionObservability(options = {}) {
  const now = options.now || (() => Date.now());
  const entries = new Map();

  function record(event = {}) {
    const taskId = text(event.taskId, 180);
    if (!taskId) return undefined;
    const occurredAt = Number(event.occurredAt) || now();
    const entry = entries.get(taskId) || createEmptySummary(taskId, occurredAt);
    entry.updatedAt = occurredAt;
    entry.eventCount += 1;
    entry.semanticState = projectExecutionState(event.job || {});
    entry.lastActivity = text(event.activity || event.job?.currentActivity, 500) || entry.lastActivity;
    if (entry.semanticState.terminal) entry.finishedAt = occurredAt;

    if (event.type === 'model_retry') entry.retries += 1;
    if (event.type === 'tool_result') {
      entry.tools.total += 1;
      if (event.success === true) entry.tools.succeeded += 1;
      else {
        entry.tools.failed += 1;
        increment(entry.failures, event.failureClass || event.errorClass || classifyFailure(event.error || event.output));
      }
      for (const artifact of Array.isArray(event.artifacts) ? event.artifacts : []) {
        entry.evidence.total += 1;
        if (artifact?.verified === true) entry.evidence.verified += 1;
      }
    }
    if (event.type === 'step_started') entry.steps.started += 1;
    if (event.type === 'step_completed') entry.steps.completed += 1;
    if (/step_failed|job_failed|execution_stalled|compensation_step_failed/u.test(text(event.type))) {
      entry.steps.failed += event.type === 'step_failed' ? 1 : 0;
      increment(entry.failures, event.failureClass || event.errorClass || classifyFailure(event.error || event.reason));
    }
    entries.set(taskId, entry);
    return snapshot(entry, occurredAt);
  }

  function get(taskId) {
    return snapshot(entries.get(text(taskId, 180)), now());
  }

  function list() {
    return [...entries.values()].map((entry) => snapshot(entry, now())).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  return { record, get, list };
}

function taskEvidenceCompleteness(task = {}) {
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const completed = steps.filter((step) => step.status === 'completed' && step.compensationOnly !== true);
  const evidenceSteps = completed.filter((step) => step.kind !== 'review' && ['file', 'connection', 'operation'].includes(step.deliverableType || task.deliverableType));
  const verifiedArtifacts = (task.artifacts || []).filter((artifact) => artifact?.verified === true);
  const passedVerifications = (task.verifications || []).filter((item) => item?.status === 'passed');
  const missing = [];
  if (evidenceSteps.length > 0 && verifiedArtifacts.length + passedVerifications.length === 0) missing.push('verified_execution_evidence');
  if (task.status === 'completed' && (task.contract?.deliverableType || task.deliverableType) === 'file' && !verifiedArtifacts.some((artifact) => artifact.category === 'final')) missing.push('verified_final_artifact');
  return {
    required: evidenceSteps.length,
    verifiedArtifacts: verifiedArtifacts.length,
    passedVerifications: passedVerifications.length,
    complete: missing.length === 0,
    missing,
  };
}

function buildTaskObservability(task = {}, runtime = {}) {
  const failures = {};
  for (const attempt of task.toolAttempts || []) {
    if (attempt?.status === 'failed') increment(failures, attempt.errorClass || classifyFailure(attempt.outputSummary));
  }
  const startedAt = Number(task.startedAt || task.createdAt) || Date.now();
  const endedAt = Number(task.completedAt || task.updatedAt) || startedAt;
  return {
    taskId: task.id,
    status: task.status,
    phase: task.phase,
    durationMs: Math.max(0, endedAt - startedAt),
    queuePosition: runtime.queuePosition ?? task.queuePosition,
    retries: (task.steps || []).reduce((total, step) => total + Math.max(0, (Number(step.attempts) || 0) - 1), 0),
    failureClasses: failures,
    budget: { ...(task.usage || {}), ...(task.recoveryContext?.budget || {}) },
    evidence: taskEvidenceCompleteness(task),
  };
}

module.exports = { classifyFailure, projectExecutionState, createExecutionObservability, taskEvidenceCompleteness, buildTaskObservability };
