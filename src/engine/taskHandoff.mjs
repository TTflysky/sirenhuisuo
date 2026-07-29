const HANDOFF_VERSION = 1;
const BLOCKER_CATEGORIES = new Set(['environment', 'dependency', 'permission', 'network', 'authentication', 'input', 'plan', 'validation', 'unknown']);

function text(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

function list(value, max = 20) {
  return Array.isArray(value) ? value.map((item) => text(item, 500)).filter(Boolean).slice(-max) : [];
}

function blocker(value) {
  if (typeof value === 'string') return { category: 'unknown', summary: text(value, 700), retryable: false };
  const category = BLOCKER_CATEGORIES.has(value?.category) ? value.category : 'unknown';
  const summary = text(value?.summary ?? value?.detail ?? value?.message, 700);
  if (!summary) return undefined;
  return {
    category,
    summary,
    retryable: value?.retryable === true,
    ownerId: text(value?.ownerId, 160) || undefined,
    stepId: text(value?.stepId, 160) || undefined,
  };
}

export function createTaskHandoff(input = {}) {
  const blockers = (Array.isArray(input.blockers) ? input.blockers : input.blocked ? [input.blocked] : [])
    .map(blocker).filter(Boolean).slice(-12);
  return {
    handoffVersion: HANDOFF_VERSION,
    taskId: text(input.taskId, 160),
    completed: list(input.completed),
    completedEvidence: list(input.completedEvidence),
    blockers,
    blocked: text(input.blocked ?? blockers.at(-1)?.summary, 1200),
    nextAction: text(input.nextAction, 900) || (blockers.length ? '先处理阻塞原因，再从未完成步骤继续。' : '继续执行未完成步骤。'),
    resumeCondition: text(input.resumeCondition, 700) || (blockers.length ? `阻塞条件已处理：${blockers.at(-1).summary}` : '任务上下文和工作区仍然可用'),
    attemptedRoutes: list(input.attemptedRoutes, 12),
    risks: list(input.risks, 12),
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now(),
  };
}

export function normalizeTaskHandoff(input, fallback = {}) {
  if (!input && !fallback) return undefined;
  return createTaskHandoff({ ...fallback, ...(input || {}) });
}

export function validateTaskHandoff(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return { valid: false, errors: ['handoff must be an object'] };
  if (input.handoffVersion !== HANDOFF_VERSION) errors.push(`handoffVersion must be ${HANDOFF_VERSION}`);
  if (!Array.isArray(input.completed)) errors.push('completed must be an array');
  if (!Array.isArray(input.completedEvidence)) errors.push('completedEvidence must be an array');
  if (!Array.isArray(input.blockers)) errors.push('blockers must be an array');
  if (!String(input.nextAction ?? '').trim()) errors.push('nextAction is required');
  for (const item of input.blockers ?? []) {
    if (!BLOCKER_CATEGORIES.has(item.category)) errors.push(`invalid blocker category: ${item.category}`);
    if (!String(item.summary ?? '').trim()) errors.push('blocker summary is required');
  }
  return { valid: errors.length === 0, errors };
}

export function mergeTaskHandoff(previous, update = {}) {
  const base = normalizeTaskHandoff(previous, update);
  return createTaskHandoff({
    ...base,
    ...update,
    completed: [...new Set([...(base.completed ?? []), ...list(update.completed)])],
    completedEvidence: [...new Set([...(base.completedEvidence ?? []), ...list(update.completedEvidence)])],
    blockers: update.clearBlockers === true ? (update.blockers ?? []) : [...(base.blockers ?? []), ...(update.blockers ?? [])],
    attemptedRoutes: [...new Set([...(base.attemptedRoutes ?? []), ...list(update.attemptedRoutes)])],
    risks: [...new Set([...(base.risks ?? []), ...list(update.risks)])],
    updatedAt: Date.now(),
  });
}

export const TASK_HANDOFF_VERSION = HANDOFF_VERSION;
