const STATE_MACHINE_VERSION = 1;
const TERMINAL = new Set(['completed', 'stopped']);
const TRANSITIONS = {
  queued: new Set(['queued', 'running', 'paused', 'awaiting_user', 'failed', 'stopped']),
  running: new Set(['running', 'queued', 'paused', 'awaiting_user', 'failed', 'completed', 'stopped']),
  awaiting_user: new Set(['awaiting_user', 'queued', 'running', 'paused', 'failed', 'stopped']),
  paused: new Set(['paused', 'queued', 'running', 'failed', 'stopped']),
  failed: new Set(['failed', 'queued', 'paused', 'stopped']),
  stopped: new Set(['stopped']),
  completed: new Set(['completed']),
};

function normalize(value) {
  return String(value ?? '').trim();
}

export function isTerminalTaskRunStatus(status) {
  return TERMINAL.has(normalize(status));
}

export function allowedTaskRunTransitions(status) {
  return [...(TRANSITIONS[normalize(status)] ?? [])];
}

export function canTransitionTaskRun(from, to) {
  const source = normalize(from);
  const target = normalize(to);
  return Boolean(TRANSITIONS[source]?.has(target));
}

export function assertTaskRunTransition(from, to, context = {}) {
  if (canTransitionTaskRun(from, to)) return { valid: true, from: normalize(from), to: normalize(to) };
  const reason = context.reason ? `：${String(context.reason).slice(0, 180)}` : '';
  throw new Error(`非法任务状态迁移 ${normalize(from)} -> ${normalize(to)}${reason}`);
}

export function transitionTaskRunStatus(run, nextStatus, context = {}) {
  const next = structuredClone(run);
  assertTaskRunTransition(next.status, nextStatus, context);
  next.status = nextStatus;
  if (context.phase !== undefined) next.phase = context.phase;
  if (context.error !== undefined) next.lastError = context.error || undefined;
  next.updatedAt = Number.isFinite(context.updatedAt) ? context.updatedAt : Date.now();
  return next;
}

export function validateTaskRunState(run) {
  const errors = [];
  if (!run || typeof run !== 'object') return { valid: false, errors: ['run must be an object'] };
  if (!TRANSITIONS[run.status]) errors.push(`未知任务状态：${run.status}`);
  if (run.status === 'completed' && run.lastError) errors.push('completed 任务不能保留 lastError');
  if (run.status === 'running' && !run.executionSessionId && !run.worker) errors.push('running 任务缺少执行会话或 Worker 租约');
  if (['paused', 'awaiting_user', 'failed'].includes(run.status) && !run.handoff && !run.lastError) errors.push(`${run.status} 任务必须有交接或错误说明`);
  return { valid: errors.length === 0, errors };
}

export const TASK_STATE_MACHINE_VERSION = STATE_MACHINE_VERSION;
