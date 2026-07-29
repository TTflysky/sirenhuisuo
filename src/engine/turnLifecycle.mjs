const TURN_LIFECYCLE_VERSION_VALUE = 1;

const TERMINAL_STATUSES = new Set([
  'completed',
  'waiting_user',
  'paused',
  'checkpointed',
  'stopped',
  'failed',
]);
const SECRET_KEYS = new Set(['apikey', 'authorization', 'cookie', 'credential', 'credentials', 'password', 'secret', 'token', 'accesstoken', 'refreshtoken']);

function text(value, limit = 4000) {
  return String(value ?? '').trim().slice(0, limit);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isSecretKey(key) {
  const normalized = String(key || '').replace(/[^a-z0-9]/giu, '').toLowerCase();
  return SECRET_KEYS.has(normalized) || normalized.endsWith('apikey');
}

function redactUrl(value) {
  const raw = text(value, 4000);
  try {
    const parsed = new URL(raw);
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSecretKey(key)) parsed.searchParams.set(key, '[REDACTED]');
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

function redactText(value, limit = 4000) {
  return text(value, limit)
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/giu, '$1[REDACTED]')
    .replace(/((?:api[-_]?key|authorization|cookie|credential|password|secret|token)\s*[:=]\s*)[^\s,;]+/giu, '$1[REDACTED]');
}

export function sanitizeLifecycleValue(value, key = '', depth = 0) {
  if (depth > 8) return '[TRUNCATED]';
  if (isSecretKey(key)) return '[REDACTED]';
  if (typeof value === 'string') return /^https?:\/\//iu.test(value) ? redactUrl(value) : redactText(value, 4000);
  if (Array.isArray(value)) return value.slice(-80).map((item) => sanitizeLifecycleValue(item, key, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).slice(0, 120).map(([childKey, childValue]) => [
    childKey,
    sanitizeLifecycleValue(childValue, childKey, depth + 1),
  ]));
}

function baseLifecycle(input = {}) {
  const now = Number(input.startedAt) || Date.now();
  return {
    protocolVersion: TURN_LIFECYCLE_VERSION_VALUE,
    lifecycleId: text(input.lifecycleId, 180) || `lifecycle-${now}-${Math.random().toString(36).slice(2, 8)}`,
    turnId: text(input.turnId, 180) || `turn-${now}-${Math.random().toString(36).slice(2, 8)}`,
    taskId: text(input.taskId, 180),
    conversationId: text(input.conversationId, 180),
    scope: text(input.scope, 180),
    goal: text(input.goal, 6000),
    deliverableType: text(input.deliverableType, 40) || 'answer',
    status: 'running',
    phase: text(input.phase, 80) || 'observe',
    sequence: 0,
    activity: text(input.activity, 500) || '正在理解目标并准备执行',
    progressAt: now,
    startedAt: now,
    updatedAt: now,
    budget: {
      modelRounds: 0,
      toolCalls: 0,
      maxModelRounds: Number(input.maxModelRounds) || undefined,
      maxToolCalls: Number(input.maxToolCalls) || undefined,
    },
    context: {
      stage: 1,
      compactions: 0,
      estimatedTokens: 0,
      contextWindowTokens: Number(input.contextWindowTokens) || undefined,
      summary: '',
      unresolvedIssues: [],
    },
    decisions: [],
    toolCalls: [],
    steering: [],
    events: [],
    recovery: {
      resumable: true,
      reason: '',
      nextAction: '',
    },
  };
}

function appendEvent(lifecycle, input = {}) {
  const next = clone(lifecycle);
  const now = Number(input.at) || Date.now();
  next.sequence = Math.max(0, Number(next.sequence) || 0) + 1;
  next.phase = text(input.phase, 80) || next.phase || 'observe';
  next.activity = text(input.activity, 500) || next.activity || '正在执行';
  next.updatedAt = now;
  if (input.progress !== false) next.progressAt = Math.max(Number(next.progressAt) || 0, now);
  next.events = Array.isArray(next.events) ? next.events : [];
  next.events.push({
    sequence: next.sequence,
    type: text(input.type, 100) || 'progress',
    phase: next.phase,
    activity: next.activity,
    at: now,
    detail: sanitizeLifecycleValue(input.detail || {}),
  });
  next.events = next.events.slice(-240);
  return next;
}

export function createTurnLifecycle(input = {}) {
  return appendEvent(baseLifecycle(input), {
    type: 'turn_started',
    phase: input.phase || 'observe',
    activity: input.activity || '正在理解目标并准备执行',
    at: input.startedAt,
  });
}

export function restoreTurnLifecycle(snapshot, input = {}) {
  if (!snapshot || typeof snapshot !== 'object') return createTurnLifecycle(input);
  const restored = {
    ...baseLifecycle({ ...input, ...snapshot }),
    ...sanitizeLifecycleValue(snapshot),
    protocolVersion: TURN_LIFECYCLE_VERSION_VALUE,
    taskId: text(input.taskId ?? snapshot.taskId, 180),
    conversationId: text(input.conversationId ?? snapshot.conversationId, 180),
    scope: text(input.scope ?? snapshot.scope, 180),
    goal: text(input.goal ?? snapshot.goal, 6000),
    deliverableType: text(input.deliverableType ?? snapshot.deliverableType, 40) || 'answer',
  };
  restored.sequence = Math.max(0, Number(restored.sequence) || 0);
  restored.decisions = Array.isArray(restored.decisions) ? restored.decisions.slice(-80) : [];
  restored.toolCalls = Array.isArray(restored.toolCalls) ? restored.toolCalls.slice(-240) : [];
  restored.steering = Array.isArray(restored.steering) ? restored.steering.slice(-40) : [];
  restored.events = Array.isArray(restored.events) ? restored.events.slice(-240) : [];
  return restored;
}

export function recordLifecycleProgress(lifecycle, input = {}) {
  const next = appendEvent(lifecycle, input);
  if (Number(input.modelRounds) > 0) next.budget.modelRounds += Number(input.modelRounds);
  if (Number(input.toolCalls) > 0) next.budget.toolCalls += Number(input.toolCalls);
  if (Number(input.estimatedTokens) >= 0) next.context.estimatedTokens = Number(input.estimatedTokens);
  if (Number(input.contextWindowTokens) > 0) next.context.contextWindowTokens = Number(input.contextWindowTokens);
  return next;
}

export function recordLifecycleDecision(lifecycle, decision = {}) {
  let next = restoreTurnLifecycle(lifecycle);
  const decisionId = text(decision.decisionId, 180) || `decision-${next.sequence + 1}`;
  if (!next.decisions.some((item) => item.decisionId === decisionId)) {
    next.decisions.push({
      decisionId,
      round: Number(decision.round) || next.budget.modelRounds || 1,
      action: text(decision.action, 80) || 'observe',
      reason: text(decision.reason, 800),
      toolCalls: (decision.toolCalls || []).map((call) => ({
        name: text(call.name, 160),
        args: sanitizeLifecycleValue(call.args || {}),
        fingerprint: text(call.fingerprint, 160),
        valid: call.valid !== false,
      })).slice(-24),
      evidenceGaps: (decision.evidenceGaps || []).map((item) => text(item, 500)).filter(Boolean).slice(-20),
      at: Date.now(),
    });
    next.decisions = next.decisions.slice(-80);
  }
  return appendEvent(next, {
    type: 'model_decision',
    phase: decision.action || 'observe',
    activity: decision.toolCalls?.length ? '模型已选择下一步工具' : '模型已返回结果，正在验收',
    detail: { decisionId, action: decision.action, toolNames: (decision.toolCalls || []).map((call) => call.name) },
  });
}

export function recordLifecycleToolStarted(lifecycle, input = {}) {
  let next = restoreTurnLifecycle(lifecycle);
  const callId = text(input.callId, 180) || `tool-call-${next.sequence + 1}`;
  const existing = next.toolCalls.find((item) => item.callId === callId);
  if (!existing) {
    next.toolCalls.push({
      callId,
      name: text(input.name, 160),
      args: sanitizeLifecycleValue(input.args || {}),
      status: 'running',
      startedAt: Number(input.at) || Date.now(),
    });
    next.toolCalls = next.toolCalls.slice(-240);
    next.budget.toolCalls += 1;
  }
  return appendEvent(next, {
    type: 'tool_started',
    phase: 'act',
    activity: text(input.activity, 500) || `正在调用 ${text(input.name, 160) || '工具'}`,
    detail: { callId, name: input.name },
    at: input.at,
  });
}

export function recordLifecycleToolFinished(lifecycle, input = {}) {
  let next = restoreTurnLifecycle(lifecycle);
  const callId = text(input.callId, 180);
  let call = next.toolCalls.find((item) => item.callId === callId);
  if (!call) {
    next = recordLifecycleToolStarted(next, { ...input, callId });
    call = next.toolCalls.find((item) => item.callId === callId);
  }
  const now = Number(input.at) || Date.now();
  if (call) {
    call.status = input.success === true ? 'succeeded' : 'failed';
    call.success = input.success === true;
    call.outputSummary = redactText(input.output ?? input.summary, 2400);
    call.errorType = text(input.errorType, 120) || undefined;
    call.resultRef = input.resultRef ? redactUrl(input.resultRef) : undefined;
    call.evidenceIds = (input.evidenceIds || []).map((item) => text(item, 180)).filter(Boolean).slice(-30);
    call.finishedAt = now;
  }
  return appendEvent(next, {
    type: input.success === true ? 'tool_succeeded' : 'tool_failed',
    phase: 'observe',
    activity: input.success === true
      ? `${text(input.name, 160) || '工具'} 已返回结果，正在判断是否满足目标`
      : `${text(input.name, 160) || '工具'} 未成功，正在判断恢复路线`,
    detail: { callId, name: input.name, success: input.success === true, errorType: input.errorType },
    at: now,
  });
}

export function recordLifecycleContext(lifecycle, input = {}) {
  let next = restoreTurnLifecycle(lifecycle);
  if (input.compacted === true) next.context.compactions = Math.max(0, Number(next.context.compactions) || 0) + 1;
  if (Number(input.stage) > 0) next.context.stage = Number(input.stage);
  if (Number(input.estimatedTokens) >= 0) next.context.estimatedTokens = Number(input.estimatedTokens);
  if (Number(input.contextWindowTokens) > 0) next.context.contextWindowTokens = Number(input.contextWindowTokens);
  if (input.summary !== undefined) next.context.summary = text(input.summary, 2400);
  if (Array.isArray(input.unresolvedIssues)) next.context.unresolvedIssues = input.unresolvedIssues.map((item) => text(item, 800)).filter(Boolean).slice(-30);
  return appendEvent(next, {
    type: input.compacted === true ? 'context_compacted' : 'context_updated',
    phase: 'observe',
    activity: input.compacted === true ? '已压缩上下文并保留目标、证据和未决问题' : '已更新可恢复上下文',
    detail: { stage: next.context.stage, compactions: next.context.compactions, estimatedTokens: next.context.estimatedTokens },
  });
}

export function recordLifecycleSteering(lifecycle, messages) {
  let next = restoreTurnLifecycle(lifecycle);
  const additions = (Array.isArray(messages) ? messages : [messages]).map((item) => text(item, 2000)).filter(Boolean);
  for (const message of additions) next.steering.push({ message, at: Date.now(), applied: true });
  next.steering = next.steering.slice(-40);
  return appendEvent(next, {
    type: 'user_steering',
    phase: 'observe',
    activity: '已收到新要求，正在合并原目标重新判断',
    detail: { count: additions.length },
  });
}

export function synchronizeTurnLifecycle(lifecycle, runtime, finalization, input = {}) {
  let next = restoreTurnLifecycle(lifecycle, {
    ...input,
    turnId: runtime?.turnId,
    taskId: runtime?.taskId || input.taskId,
    scope: runtime?.scope || input.scope,
    goal: runtime?.goal || input.goal,
    deliverableType: runtime?.deliverableType || input.deliverableType,
    startedAt: runtime?.startedAt,
  });
  for (const decision of runtime?.decisions || []) {
    if (!next.decisions.some((item) => item.decisionId === decision.decisionId)) next = recordLifecycleDecision(next, decision);
  }
  for (const evidence of runtime?.evidence || []) {
    const callId = text(evidence.toolCallId, 180) || text(evidence.evidenceId, 180);
    let existing = next.toolCalls.find((item) => item.callId === callId);
    if (!existing) {
      next = recordLifecycleToolStarted(next, { callId, name: evidence.toolName, args: evidence.arguments, at: evidence.createdAt });
      existing = next.toolCalls.find((item) => item.callId === callId);
    }
    if (existing && !['succeeded', 'failed'].includes(existing.status)) {
      next = recordLifecycleToolFinished(next, {
        callId,
        name: evidence.toolName,
        success: evidence.success === true,
        output: evidence.summary,
        errorType: evidence.errorType,
        resultRef: evidence.resultRef,
        evidenceIds: [evidence.evidenceId],
        at: evidence.createdAt,
      });
    }
  }
  next.budget.modelRounds = Math.max(Number(next.budget.modelRounds) || 0, Number(runtime?.round) || 0);
  next.context.unresolvedIssues = (runtime?.unresolvedIssues || []).map((item) => text(item, 800)).filter(Boolean).slice(-30);
  if (finalization) {
    next = finalizeTurnLifecycle(next, {
      status: finalization.status,
      summary: finalization.summary,
      waitingFor: finalization.waitingFor,
      unresolvedIssues: finalization.unresolvedIssues,
      reason: input.reason,
      nextAction: input.nextAction,
    });
  }
  return next;
}

export function createLifecycleRecoveryCapsule(lifecycle, input = {}) {
  const safe = restoreTurnLifecycle(lifecycle);
  return {
    protocolVersion: TURN_LIFECYCLE_VERSION_VALUE,
    lifecycleId: safe.lifecycleId,
    turnId: safe.turnId,
    taskId: safe.taskId,
    conversationId: safe.conversationId,
    goal: safe.goal,
    deliverableType: safe.deliverableType,
    status: safe.status,
    phase: safe.phase,
    activity: safe.activity,
    progressAt: safe.progressAt,
    budget: clone(safe.budget),
    context: clone(safe.context),
    latestDecision: clone(safe.decisions.at(-1)),
    completedToolCalls: safe.toolCalls.filter((call) => call.status === 'succeeded').slice(-30).map(clone),
    unresolvedToolCalls: safe.toolCalls.filter((call) => call.status !== 'succeeded').slice(-20).map(clone),
    steering: safe.steering.slice(-20).map(clone),
    reason: text(input.reason ?? safe.recovery?.reason, 1200),
    nextAction: text(input.nextAction ?? safe.recovery?.nextAction, 1200),
    resumable: input.resumable !== false && safe.recovery?.resumable !== false,
    createdAt: Date.now(),
  };
}

export function finalizeTurnLifecycle(lifecycle, input = {}) {
  let next = restoreTurnLifecycle(lifecycle);
  const requested = text(input.status, 40);
  const status = TERMINAL_STATUSES.has(requested) ? requested : 'checkpointed';
  const now = Date.now();
  next.status = status;
  next.phase = status;
  next.finishedAt = now;
  next.exit = {
    status,
    summary: text(input.summary, 4000),
    waitingFor: text(input.waitingFor, 1200),
    unresolvedIssues: (input.unresolvedIssues || next.context.unresolvedIssues || []).map((item) => text(item, 800)).filter(Boolean).slice(-30),
    reason: text(input.reason, 1200) || status,
    at: now,
  };
  next.recovery = {
    resumable: !['completed', 'stopped'].includes(status),
    reason: next.exit.reason,
    nextAction: text(input.nextAction, 1200) || (status === 'waiting_user'
      ? '补齐提示中的唯一条件后继续。'
      : status === 'checkpointed' || status === 'paused'
        ? '从已保存的目标、证据和未完成动作继续。'
        : ''),
  };
  return appendEvent(next, {
    type: 'turn_finalized',
    phase: status,
    activity: status === 'completed' ? '任务已完成并进入验收'
      : status === 'waiting_user' ? '任务正在等待用户补充条件'
        : status === 'paused' || status === 'checkpointed' ? '任务现场已保存，可继续执行'
          : status === 'stopped' ? '任务已停止' : '任务执行失败',
    detail: { status, reason: next.exit.reason },
    at: now,
  });
}

export const TURN_LIFECYCLE_VERSION = TURN_LIFECYCLE_VERSION_VALUE;
