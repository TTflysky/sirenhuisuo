import { assertValidPlan } from './taskPlan.mjs';

const RUNNER_VERSION = 1;
const TERMINAL_STEP_STATES = new Set(['succeeded', 'failed', 'cancelled']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function now() {
  return Date.now();
}

function eventId(prefix = 'event') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function stepRecord(step, timestamp) {
  return {
    stepId: step.stepId,
    status: 'pending',
    attempts: 0,
    idempotencyKey: step.idempotencyKey || undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function appendEvent(state, type, stepId, detail, data = {}) {
  state.events.push({ id: eventId(type), ts: now(), type, stepId, detail: String(detail || '').slice(0, 800), ...data });
  state.events = state.events.slice(-240);
}

function planStep(state, stepId) {
  return state.plan.steps.find((step) => step.stepId === stepId);
}

function recordFor(state, stepId) {
  return state.steps.find((step) => step.stepId === stepId);
}

function dependenciesSatisfied(state, step) {
  return step.dependsOn.every((dependency) => recordFor(state, dependency)?.status === 'succeeded');
}

export function createTaskRunner(plan, options = {}) {
  const validPlan = assertValidPlan(plan, { allowInlineApproval: true });
  const timestamp = Number.isFinite(options.createdAt) ? options.createdAt : now();
  const state = {
    runnerVersion: RUNNER_VERSION,
    traceId: String(options.traceId || validPlan.planId),
    planId: validPlan.planId,
    status: 'ready',
    currentStepId: undefined,
    steps: validPlan.steps.map((step) => stepRecord(step, timestamp)),
    approvals: [],
    reviews: [],
    idempotency: {},
    events: [],
    lastError: undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
    plan: validPlan,
  };
  appendEvent(state, 'created', undefined, `任务计划已就绪，共 ${validPlan.steps.length} 步`);
  return state;
}

export function restoreTaskRunner(snapshot, options = {}) {
  if (!snapshot || snapshot.runnerVersion !== RUNNER_VERSION || !snapshot.plan) {
    return options.plan ? createTaskRunner(options.plan, options) : null;
  }
  const restored = clone(snapshot);
  assertValidPlan(restored.plan, { allowInlineApproval: true });
  restored.steps = restored.plan.steps.map((step) => {
    const existing = restored.steps.find((item) => item.stepId === step.stepId);
    const merged = existing ? { ...stepRecord(step, restored.createdAt || now()), ...existing } : stepRecord(step, restored.createdAt || now());
    return merged.status === 'running' ? { ...merged, status: 'pending', updatedAt: now() } : merged;
  });
  restored.reviews = Array.isArray(restored.reviews) ? restored.reviews : [];
  restored.status = restored.status === 'running' ? 'paused' : restored.status;
  restored.currentStepId = undefined;
  restored.updatedAt = now();
  appendEvent(restored, 'restored', undefined, '从已保存的任务运行状态恢复');
  return restored;
}

export function getRunnableTaskSteps(snapshot) {
  if (!snapshot || (snapshot.status !== 'ready' && snapshot.status !== 'running')) return [];
  return snapshot.plan.steps.filter((step) => {
    const record = recordFor(snapshot, step.stepId);
    return record?.status === 'pending' && dependenciesSatisfied(snapshot, step)
      && !(step.approvalRequired && !snapshot.approvals.some((item) => item.stepId === step.stepId && item.decision === 'approved'));
  });
}

export function beginTaskStep(snapshot, stepId) {
  const state = clone(snapshot);
  const step = planStep(state, stepId);
  const record = recordFor(state, stepId);
  if (!step || !record) throw new Error(`Unknown task step: ${stepId}`);
  if (record.status === 'succeeded') return state;
  if (record.status === 'running') return state;
  if (record.status === 'failed' || record.status === 'cancelled') return state;
  if (state.status === 'cancelled' || state.status === 'failed') return state;
  if (!dependenciesSatisfied(state, step)) throw new Error(`Task step ${stepId} is waiting for dependencies`);
  if (step.approvalRequired && !state.approvals.some((item) => item.stepId === stepId && item.decision === 'approved')) {
    record.status = 'waiting_approval';
    state.status = 'waiting_approval';
    appendEvent(state, 'approval_required', stepId, '步骤需要人工审批后才能执行');
    state.updatedAt = now();
    return state;
  }
  record.status = 'running';
  record.attempts += 1;
  record.startedAt = record.startedAt || now();
  record.updatedAt = now();
  state.status = 'running';
  state.currentStepId = stepId;
  appendEvent(state, 'step_started', stepId, `开始执行第 ${record.attempts} 次尝试`, { attempt: record.attempts });
  state.updatedAt = now();
  return state;
}

export function recordTaskStepResult(snapshot, input = {}) {
  const state = clone(snapshot);
  const stepId = String(input.stepId || state.currentStepId || '');
  const step = planStep(state, stepId);
  const record = recordFor(state, stepId);
  if (!step || !record) throw new Error(`Unknown task step: ${stepId}`);
  if (record.status === 'succeeded' && state.idempotency[record.idempotencyKey || stepId]) return state;
  const success = input.success === true;
  record.updatedAt = now();
  if (success) {
    record.status = 'succeeded';
    record.output = clone(input.output ?? { summary: 'step completed' });
    record.completedAt = now();
    if (record.idempotencyKey) state.idempotency[record.idempotencyKey] = { stepId, status: 'succeeded', completedAt: record.completedAt };
    state.currentStepId = undefined;
    state.status = state.steps.every((item) => item.status === 'succeeded') ? 'completed' : 'ready';
    state.lastError = undefined;
    appendEvent(state, 'step_succeeded', stepId, String(input.detail || '步骤已完成'), { attempt: record.attempts });
  } else {
    const retryable = input.retryable === true;
    const maxRetries = Number.isInteger(step.retryPolicy?.maxRetries) ? step.retryPolicy.maxRetries : 0;
    const retriesUsed = Math.max(0, record.attempts - 1);
    record.error = String(input.error || input.detail || '步骤执行失败').slice(0, 1200);
    state.lastError = record.error;
    state.currentStepId = undefined;
    if (retryable && retriesUsed < maxRetries) {
      record.status = 'pending';
      record.retryAt = now() + Math.min(step.retryPolicy.maxBackoffMs, step.retryPolicy.backoffMs * (2 ** retriesUsed));
      state.status = 'ready';
      appendEvent(state, 'step_retry_scheduled', stepId, `${record.error}；将保留上下文重试`, { attempt: record.attempts, retryAt: record.retryAt });
    } else {
      record.status = 'failed';
      state.status = 'failed';
      appendEvent(state, 'step_failed', stepId, record.error, { attempt: record.attempts, retryable });
    }
  }
  state.updatedAt = now();
  return state;
}

export function appendTaskRunnerSteps(snapshot, steps = [], detail = '任务计划已追加修订步骤') {
  const state = clone(snapshot);
  const existingIds = new Set(state.plan.steps.map((step) => step.stepId));
  const additions = Array.isArray(steps) ? steps.filter((step) => !existingIds.has(step?.stepId)) : [];
  if (additions.length === 0) return state;
  const plan = assertValidPlan({
    ...state.plan,
    steps: [...state.plan.steps, ...clone(additions)],
  }, { allowInlineApproval: true });
  const timestamp = now();
  state.plan = plan;
  state.steps.push(...additions.map((step) => stepRecord(step, timestamp)));
  if (state.status !== 'cancelled') state.status = 'ready';
  state.currentStepId = undefined;
  appendEvent(state, 'plan_extended', undefined, detail, { addedStepIds: additions.map((step) => step.stepId) });
  state.updatedAt = timestamp;
  return state;
}

export function recordTaskReviewDecision(snapshot, input = {}) {
  const state = clone(snapshot);
  const stepId = String(input.stepId || state.currentStepId || '');
  const step = planStep(state, stepId);
  const record = recordFor(state, stepId);
  if (!step || !record) throw new Error(`Unknown task step: ${stepId}`);
  if (step.type !== 'review') throw new Error(`Task step ${stepId} is not a review step`);
  const decision = input.approved === true ? 'pass' : 'reject';
  const timestamp = now();
  const review = {
    stepId,
    decision,
    reason: String(input.reason || (decision === 'pass' ? '验收通过' : '验收退回')).slice(0, 1200),
    responsibleStepId: String(input.responsibleStepId || '').slice(0, 160) || undefined,
    responsibleEmployeeId: String(input.responsibleEmployeeId || '').slice(0, 160) || undefined,
    checkedArtifacts: Array.isArray(input.checkedArtifacts) ? input.checkedArtifacts.map(String).slice(0, 20) : [],
    ts: timestamp,
  };
  state.reviews = [...(state.reviews || []), review].slice(-60);
  record.status = 'succeeded';
  record.output = { review };
  record.completedAt = timestamp;
  record.updatedAt = timestamp;
  state.currentStepId = undefined;
  state.status = decision === 'pass' && state.steps.every((item) => item.status === 'succeeded') ? 'completed' : 'ready';
  state.lastError = decision === 'reject' ? review.reason : undefined;
  appendEvent(state, decision === 'pass' ? 'review_passed' : 'review_rejected', stepId, review.reason, {
    decision,
    responsibleStepId: review.responsibleStepId,
    responsibleEmployeeId: review.responsibleEmployeeId,
    checkedArtifacts: review.checkedArtifacts,
  });
  state.updatedAt = timestamp;
  return state;
}

export function approveTaskStep(snapshot, stepId, decision, reason = '') {
  const state = clone(snapshot);
  const step = planStep(state, stepId);
  if (!step) throw new Error(`Unknown task step: ${stepId}`);
  const normalized = decision === 'approved' ? 'approved' : 'rejected';
  state.approvals.push({ stepId, decision: normalized, reason: String(reason).slice(0, 800), ts: now() });
  const record = recordFor(state, stepId);
  if (record?.status === 'waiting_approval') record.status = normalized === 'approved' ? 'pending' : 'failed';
  state.status = normalized === 'approved' ? 'ready' : 'failed';
  appendEvent(state, normalized === 'approved' ? 'approval_granted' : 'approval_rejected', stepId, reason || (normalized === 'approved' ? '审批通过' : '审批拒绝'));
  state.updatedAt = now();
  return state;
}

export function cancelTaskRunner(snapshot, reason = '用户取消任务') {
  const state = clone(snapshot);
  state.status = 'cancelled';
  state.currentStepId = undefined;
  state.steps.forEach((step) => { if (!TERMINAL_STEP_STATES.has(step.status)) step.status = 'cancelled'; });
  appendEvent(state, 'cancelled', undefined, reason);
  state.updatedAt = now();
  return state;
}

export function taskRunnerStatus(snapshot) {
  if (!snapshot) return '未初始化';
  const labels = { ready: '等待下一步', running: '正在执行', waiting_approval: '等待审批', completed: '已完成', failed: '执行失败', cancelled: '已取消', paused: '已暂停' };
  return labels[snapshot.status] || '未知状态';
}

export const TASK_RUNNER_VERSION = RUNNER_VERSION;
