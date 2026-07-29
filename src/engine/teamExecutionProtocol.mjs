const PROTOCOL_VERSION = 1;
const MEMBER_STATUSES = new Set(['idle', 'queued', 'working', 'waiting', 'failed', 'completed', 'offline']);
const STEP_STATUSES = new Set(['queued', 'working', 'waiting', 'failed', 'completed', 'paused']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

function list(value, max = 32) {
  return Array.isArray(value) ? value.map((item) => text(item, 240)).filter(Boolean).slice(0, max) : [];
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMember(member = {}) {
  return {
    id: text(member.id, 160),
    name: text(member.name, 120) || text(member.id, 160),
    title: text(member.title, 160),
    role: text(member.role, 80),
    model: text(member.model ?? member.modelId ?? member.refModelId, 180),
    status: MEMBER_STATUSES.has(member.status) ? member.status : 'idle',
    stepIds: list(member.stepIds, 32),
  };
}

function normalizeStep(step = {}) {
  const status = STEP_STATUSES.has(step.status) ? step.status : 'queued';
  return {
    id: text(step.id ?? step.stepId, 160),
    employeeId: text(step.employeeId, 160),
    title: text(step.title, 240),
    kind: text(step.kind, 40) || 'work',
    dependsOnStepIds: list(step.dependsOnStepIds ?? step.dependsOn, 24),
    status,
    attempts: Number.isFinite(step.attempts) ? Math.max(0, Number(step.attempts)) : 0,
    lastError: text(step.lastError, 1200) || undefined,
    startedAt: Number.isFinite(step.startedAt) ? Number(step.startedAt) : undefined,
    completedAt: Number.isFinite(step.completedAt) ? Number(step.completedAt) : undefined,
  };
}

function buildKickoff(input, members, steps, createdAt) {
  const lines = [
    `需求复述：${text(input.goal, 1000)}`,
    '执行顺序：',
    ...steps.map((step, index) => {
      const member = members.find((item) => item.id === step.employeeId);
      const dependencies = step.dependsOnStepIds.length ? `（等待：${step.dependsOnStepIds.join('、')}）` : '';
      return `${index + 1}. @${member?.name ?? step.employeeId} 负责「${step.title || step.id}」${dependencies}`;
    }),
    '规则：每一步必须返回可验证结果，前一步未完成时不跳过；最后由审查步骤验收。',
  ];
  return {
    id: id('kickoff'),
    authorId: text(input.assistantId, 160) || 'assistant',
    content: lines.join('\n'),
    mentions: members.map((member) => member.id).filter(Boolean),
    createdAt,
  };
}

function initialEmployeeStates(members) {
  return Object.fromEntries(members.map((member) => [member.id, {
    employeeId: member.id,
    status: member.status,
    currentStepId: undefined,
    currentTool: undefined,
    startedAt: undefined,
    updatedAt: Date.now(),
  }]));
}

export function createTeamExecutionProtocol(input = {}) {
  const createdAt = Number.isFinite(input.createdAt) ? Number(input.createdAt) : Date.now();
  const members = (Array.isArray(input.members) ? input.members : []).map(normalizeMember).filter((member) => member.id);
  const steps = (Array.isArray(input.steps) ? input.steps : []).map(normalizeStep).filter((step) => step.id);
  const normalizedMembers = members.map((member) => ({
    ...member,
    stepIds: member.stepIds.length ? member.stepIds : steps.filter((step) => step.employeeId === member.id).map((step) => step.id),
  }));
  const protocol = {
    protocolVersion: PROTOCOL_VERSION,
    teamId: text(input.teamId, 160),
    teamName: text(input.teamName, 160),
    runId: text(input.runId, 160),
    goal: text(input.goal, 4000),
    assistantId: text(input.assistantId, 160) || 'assistant',
    members: normalizedMembers,
    steps,
    kickoff: buildKickoff(input, normalizedMembers, steps, createdAt),
    status: 'queued',
    currentStepId: undefined,
    currentEmployeeId: undefined,
    employeeStates: initialEmployeeStates(normalizedMembers),
    routeHistory: [],
    recovery: { available: false, reason: undefined, nextStepId: undefined },
    artifacts: [],
    review: { status: 'pending', lastDecision: undefined, responsibleStepId: undefined },
    sequence: 0,
    events: [{ sequence: 1, id: id('protocol-event'), type: 'created', ts: createdAt, detail: '团队执行协议已创建' }],
    createdAt,
    updatedAt: createdAt,
  };
  protocol.sequence = 1;
  return protocol;
}

export function restoreTeamExecutionProtocol(snapshot, input = {}) {
  if (!snapshot || snapshot.protocolVersion !== PROTOCOL_VERSION) {
    return createTeamExecutionProtocol({ ...input, createdAt: input.createdAt ?? Date.now() });
  }
  const restored = clone(snapshot);
  restored.members = (restored.members ?? []).map(normalizeMember).filter((member) => member.id);
  restored.steps = (restored.steps ?? []).map(normalizeStep).filter((step) => step.id);
  restored.employeeStates = restored.employeeStates ?? initialEmployeeStates(restored.members);
  restored.events = Array.isArray(restored.events) ? restored.events.slice(-400) : [];
  restored.routeHistory = Array.isArray(restored.routeHistory) ? restored.routeHistory.slice(-64) : [];
  restored.artifacts = Array.isArray(restored.artifacts) ? restored.artifacts.slice(-100) : [];
  restored.updatedAt = Date.now();
  return restored;
}

export function reconcileTeamExecutionProtocol(snapshot, input = {}) {
  const current = restoreTeamExecutionProtocol(snapshot, input);
  const incomingMembers = (Array.isArray(input.members) ? input.members : current.members).map(normalizeMember).filter((member) => member.id);
  const incomingSteps = (Array.isArray(input.steps) ? input.steps : current.steps).map(normalizeStep).filter((step) => step.id);
  const oldMembers = new Map(current.members.map((member) => [member.id, member]));
  const oldSteps = new Map(current.steps.map((step) => [step.id, step]));
  current.members = incomingMembers.map((member) => ({ ...member, status: oldMembers.get(member.id)?.status ?? member.status, stepIds: member.stepIds.length ? member.stepIds : incomingSteps.filter((step) => step.employeeId === member.id).map((step) => step.id) }));
  current.steps = incomingSteps.map((step) => ({ ...step, status: oldSteps.get(step.id)?.status ?? step.status, attempts: oldSteps.get(step.id)?.attempts ?? step.attempts, lastError: oldSteps.get(step.id)?.lastError ?? step.lastError, startedAt: oldSteps.get(step.id)?.startedAt ?? step.startedAt, completedAt: oldSteps.get(step.id)?.completedAt ?? step.completedAt }));
  current.employeeStates = { ...initialEmployeeStates(current.members), ...current.employeeStates };
  current.updatedAt = Date.now();
  return current;
}

export function projectTeamExecutionEvent(snapshot, input = {}) {
  const state = restoreTeamExecutionProtocol(snapshot);
  const eventType = text(input.type, 80) || 'status';
  const stepId = text(input.stepId, 160) || undefined;
  const step = stepId ? state.steps.find((item) => item.id === stepId) : undefined;
  const employeeId = text(input.employeeId, 160) || step?.employeeId;
  const now = Number.isFinite(input.ts) ? Number(input.ts) : Date.now();
  const next = clone(state);
  const event = { sequence: next.sequence + 1, id: text(input.eventId, 160) || id('protocol-event'), type: eventType, ts: now, detail: text(input.detail, 1200), stepId, employeeId, tool: text(input.tool, 160) || undefined };
  next.sequence = event.sequence;
  next.events = [...next.events, event].slice(-400);
  next.updatedAt = now;
  const projectedStep = stepId ? next.steps.find((item) => item.id === stepId) : undefined;
  if (projectedStep) {
    if (eventType === 'step_started') { projectedStep.status = 'working'; projectedStep.startedAt = projectedStep.startedAt || now; projectedStep.attempts += 1; }
    if (eventType === 'step_completed') { projectedStep.status = 'completed'; projectedStep.completedAt = now; }
    if (eventType === 'step_failed') { projectedStep.status = 'failed'; projectedStep.lastError = text(input.error ?? input.detail, 1200); }
    if (eventType === 'step_paused') projectedStep.status = 'paused';
    next.currentStepId = ['step_completed', 'step_failed'].includes(eventType) ? undefined : stepId;
  }
  if (employeeId) {
    const previous = next.employeeStates[employeeId] ?? { employeeId };
    const status = eventType === 'step_started' || eventType === 'tool_started' ? 'working'
      : eventType === 'step_completed' ? 'completed'
        : eventType === 'step_failed' ? 'failed'
          : eventType === 'paused' ? 'waiting' : previous.status ?? 'idle';
    next.employeeStates[employeeId] = { ...previous, employeeId, status, currentStepId: status === 'working' ? stepId : undefined, currentTool: event.tool, startedAt: status === 'working' ? previous.startedAt || now : undefined, updatedAt: now };
    next.currentEmployeeId = status === 'working' ? employeeId : undefined;
  }
  if (eventType === 'step_started' || eventType === 'tool_started') next.status = 'running';
  if (eventType === 'paused') next.status = 'paused';
  if (eventType === 'resumed') next.status = 'running';
  if (eventType === 'step_failed') next.status = 'blocked';
  if (eventType === 'run_completed') { next.status = 'completed'; next.currentStepId = undefined; next.currentEmployeeId = undefined; }
  if (eventType === 'run_failed') next.status = 'failed';
  if (eventType === 'retry_scheduled') next.recovery = { available: true, reason: text(input.reason ?? input.detail, 1200), nextStepId: stepId };
  if (eventType === 'recovery_started') { next.status = 'running'; next.recovery = { available: false, reason: undefined, nextStepId: stepId }; }
  if (eventType === 'review_rejected') next.review = { status: 'rejected', lastDecision: text(input.reason ?? input.detail, 1200), responsibleStepId: text(input.responsibleStepId, 160) || stepId };
  if (eventType === 'review_passed') next.review = { status: 'passed', lastDecision: text(input.reason ?? input.detail, 1200), responsibleStepId: undefined };
  return next;
}

export function classifyTeamRetry(input = {}) {
  const category = text(input.category ?? input.failureClass, 80) || 'unknown';
  const attempt = Number.isFinite(input.attempt) ? Number(input.attempt) : 1;
  const maxRetries = Number.isFinite(input.maxRetries) ? Number(input.maxRetries) : 3;
  const retryable = input.retryable === true || ['timeout', 'network', 'rate_limit', 'server'].includes(category);
  const sameRoute = retryable && attempt <= maxRetries && input.progress !== false;
  return {
    category,
    attempt,
    retryable,
    action: input.needsUser ? 'await_user' : sameRoute ? 'retry_same_route' : retryable ? 'switch_route' : 'block',
    reason: input.needsUser ? '需要用户补充授权或输入' : sameRoute ? '保留原任务上下文重试' : retryable ? '当前路线没有进展，切换路线后重新验证' : '确定性失败，停止跳步并等待处理',
  };
}

export function createRecoveryPlan(protocol, input = {}) {
  const state = restoreTeamExecutionProtocol(protocol);
  const stepId = text(input.stepId, 160) || state.steps.find((step) => ['failed', 'paused', 'queued'].includes(step.status))?.id;
  const step = state.steps.find((item) => item.id === stepId);
  if (!step) return { status: 'blocked', reason: '没有可恢复的责任步骤', stepId: undefined, dependsOnStepIds: [] };
  const unresolved = state.steps.filter((candidate) => step.dependsOnStepIds.includes(candidate.id) && candidate.status !== 'completed').map((candidate) => candidate.id);
  return unresolved.length
    ? { status: 'waiting_dependency', reason: '责任步骤依赖尚未完成，不能跳过前置步骤', stepId: step.id, dependsOnStepIds: unresolved }
    : { status: 'ready', reason: '从原责任步骤恢复，并复用已验证上下文', stepId: step.id, dependsOnStepIds: [] };
}

export function createArtifactIndex(artifacts = [], options = {}) {
  const scope = text(options.teamId, 160);
  const seen = new Set();
  return (Array.isArray(artifacts) ? artifacts : []).map((artifact) => ({
    id: text(artifact.id, 160) || id('artifact'),
    path: text(artifact.path ?? artifact.diskPath, 1000),
    filename: text(artifact.filename, 260),
    category: artifact.category === 'final' ? 'final' : artifact.category === 'reference' ? 'reference' : 'working',
    verified: artifact.verified === true && artifact.persistence === 'disk',
    workspaceId: text(artifact.workspaceId, 300),
    teamId: text(artifact.teamId, 160) || scope,
    sourceStepId: text(artifact.sourceStepId, 160) || undefined,
  })).filter((artifact) => artifact.path && (artifact.teamId === scope || !scope) && !seen.has(artifact.path) && seen.add(artifact.path));
}

export function summarizeTeamExecution(protocol, at = Date.now()) {
  const state = restoreTeamExecutionProtocol(protocol);
  const counts = Object.fromEntries(['queued', 'working', 'waiting', 'failed', 'completed', 'paused'].map((status) => [status, 0]));
  for (const step of state.steps) counts[step.status] = (counts[step.status] ?? 0) + 1;
  const active = state.currentStepId ? state.steps.find((step) => step.id === state.currentStepId) : undefined;
  const startedAt = active?.startedAt ?? state.createdAt;
  return {
    teamId: state.teamId,
    runId: state.runId,
    status: state.status,
    stepCounts: counts,
    completedSteps: counts.completed,
    totalSteps: state.steps.length,
    activeStepId: active?.id,
    activeEmployeeId: state.currentEmployeeId,
    activeDurationMs: active ? Math.max(0, at - startedAt) : 0,
    eventCount: state.events.length,
    sequence: state.sequence,
    recoveryAvailable: state.recovery.available,
    reviewStatus: state.review.status,
  };
}

export function decideCapabilityUse(input = {}) {
  const capability = text(input.capability ?? input.name, 120);
  const reason = text(input.reason, 800);
  const selected = input.selected === true;
  const used = input.used === true;
  return {
    capability,
    selected,
    used,
    decision: selected ? (used ? 'used' : 'selected_not_used') : 'not_needed',
    reason: reason || (selected ? (used ? '已调用并记录结果' : '已选择但尚未调用') : '当前任务不需要该能力'),
    evidence: Array.isArray(input.evidence) ? input.evidence.map((item) => text(item, 500)).filter(Boolean).slice(0, 12) : [],
    recordedAt: Number.isFinite(input.recordedAt) ? Number(input.recordedAt) : Date.now(),
  };
}

export function createReviewRevision(input = {}) {
  const responsibleStepId = text(input.responsibleStepId, 160);
  const responsibleEmployeeId = text(input.responsibleEmployeeId, 160);
  if (!responsibleStepId || !responsibleEmployeeId) return { ok: false, reason: '审查退回必须指出责任步骤和责任员工' };
  return {
    ok: true,
    revisionOfStepId: responsibleStepId,
    employeeId: responsibleEmployeeId,
    dependsOnStepIds: [text(input.reviewStepId, 160)].filter(Boolean),
    assignment: `只修订责任步骤「${responsibleStepId}」：${text(input.reason, 1200)}`,
    acceptanceCriteria: list(input.acceptanceCriteria, 8),
  };
}

export function createExecutionSyncEnvelope(input = {}) {
  return {
    envelopeVersion: 1,
    teamId: text(input.teamId, 160),
    runId: text(input.runId, 160),
    source: text(input.source, 80) || 'main-process',
    sequence: Number.isFinite(input.sequence) ? Number(input.sequence) : 0,
    emittedAt: Number.isFinite(input.emittedAt) ? Number(input.emittedAt) : Date.now(),
    payload: clone(input.payload ?? {}),
  };
}

export function shouldApplyExecutionSync(current, envelope) {
  return Boolean(envelope?.teamId && envelope.teamId === current?.teamId && envelope.sequence > (Number(current?.sequence) || 0));
}

export function validateTeamExecutionProtocol(protocol) {
  const errors = [];
  if (!protocol || protocol.protocolVersion !== PROTOCOL_VERSION) errors.push(`protocolVersion must be ${PROTOCOL_VERSION}`);
  if (!text(protocol?.teamId, 160)) errors.push('teamId is required');
  if (!text(protocol?.runId, 160)) errors.push('runId is required');
  if (!Array.isArray(protocol?.members)) errors.push('members must be an array');
  if (!Array.isArray(protocol?.steps) || protocol.steps.length === 0) errors.push('steps must contain at least one step');
  const memberIds = new Set((protocol?.members ?? []).map((member) => member.id));
  for (const step of protocol?.steps ?? []) {
    if (!memberIds.has(step.employeeId)) errors.push(`step ${step.id} references an unknown member`);
    for (const dependency of step.dependsOnStepIds ?? []) if (!(protocol.steps ?? []).some((item) => item.id === dependency)) errors.push(`step ${step.id} references an unknown dependency`);
  }
  return { valid: errors.length === 0, errors };
}

export const TEAM_EXECUTION_PROTOCOL_VERSION = PROTOCOL_VERSION;
