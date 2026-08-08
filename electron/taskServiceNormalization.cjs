const { createStepTaskContract, normalizeTaskContract } = require('./taskServiceContracts.cjs');

const DELIVERABLE_TYPES = new Set(['answer', 'file', 'connection', 'operation', 'decision', 'mixed']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value, limit = 4000) {
  return String(value ?? '').trim().slice(0, limit);
}

function list(value, fallback = []) {
  return Array.isArray(value) ? value.map((item) => text(item, 500)).filter(Boolean) : fallback;
}

function normalizeDeliverableType(value) {
  const normalized = text(value, 40).toLowerCase();
  return DELIVERABLE_TYPES.has(normalized) ? normalized : undefined;
}

function normalizeStep(input, index, defaults = {}) {
  const stepId = text(input?.stepId || input?.id, 160) || `step-${index + 1}`;
  const status = ['queued', 'running', 'paused', 'stopped', 'failed', 'completed'].includes(input?.status) ? input.status : 'queued';
  const dependsOnStepIds = list(input?.dependsOnStepIds || input?.dependsOn, []);
  const deliverableType = normalizeDeliverableType(input?.deliverableType || defaults.deliverableType) || 'answer';
  const acceptanceCriteria = list(input?.acceptanceCriteria, list(defaults.acceptanceCriteria, []));
  const expectedEvidence = list(input?.expectedEvidence, list(defaults.expectedEvidence, []));
  const outputPath = text(input?.outputPath || defaults.outputPath, 500) || undefined;
  const title = text(input?.title || input?.assignment || stepId, 240);
  const assignment = text(input?.assignment || input?.title || stepId, 2000);
  const taskContract = normalizeTaskContract(input?.taskContract) || createStepTaskContract({
    title,
    assignment,
    deliverableType,
    inputRefs: dependsOnStepIds.map((dependency) => `verified:${dependency}`),
    acceptanceCriteria,
    expectedEvidence,
    outputPath,
    budget: {
      maxModelRounds: 8,
      maxToolCalls: 24,
      maxReworkAttempts: Number.isInteger(input?.maxRetries) ? Math.max(0, Math.min(10, input.maxRetries)) : 2,
    },
  });
  return {
    id: stepId,
    title,
    assignment,
    employeeId: text(input?.employeeId, 160) || undefined,
    dependsOnStepIds,
    sideEffect: input?.sideEffect !== false,
    compensateStepId: text(input?.compensateStepId || input?.compensate_step, 160) || undefined,
    compensationOnly: input?.compensationOnly === true,
    approvalRequired: input?.approvalRequired === true,
    kind: text(input?.kind, 40) || undefined,
    codingRole: text(input?.codingRole, 80) || undefined,
    reviewPoint: input?.reviewPoint === true,
    acceptanceCriteria,
    requiredCapabilities: list(input?.requiredCapabilities, []),
    expectedEvidence,
    outputPath,
    taskContract,
    maxRetries: Number.isInteger(input?.maxRetries) ? Math.max(0, Math.min(10, input.maxRetries)) : undefined,
    deliverableType,
    responsibilityTaskId: text(input?.responsibilityTaskId, 180) || undefined,
    executionBinding: input?.executionBinding && typeof input.executionBinding === 'object' ? clone(input.executionBinding) : undefined,
    status,
    attempts: Math.max(0, Number(input?.attempts) || 0),
    startedAt: Number(input?.startedAt) || undefined,
    completedAt: Number(input?.completedAt) || (status === 'completed' ? Date.now() : undefined),
    lastError: text(input?.lastError, 1200) || undefined,
    output: input?.output === undefined ? undefined : clone(input.output),
    evidence: Array.isArray(input?.evidence) ? clone(input.evidence) : [],
    events: Array.isArray(input?.events) && input.events.length
      ? clone(input.events)
      : [{ ts: Date.now(), type: 'status', detail: status === 'completed' ? '任务步骤作为已有成果导入' : '任务步骤已创建，等待执行' }],
  };
}

module.exports = { normalizeDeliverableType, normalizeStep };
