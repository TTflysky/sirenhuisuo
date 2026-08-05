/**
 * The single host contract for every Taiji execution surface.
 *
 * Renderer chats, employee DMs, team runs and the native worker may have
 * different presentation layers, but they must publish the same request,
 * capability readiness and action identity before work is allowed to proceed.
 */

export const UNIFIED_HOST_VERSION = 1;
export const UNIFIED_HOST_ENTRYPOINTS = Object.freeze([
  'assistant',
  'employee',
  'team',
  'worker',
  'background',
]);

const AVAILABLE = 'available';

function text(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

function list(value, max = 24) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => text(item, 240))
    .filter(Boolean))].slice(0, max);
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value ?? '')) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalized(value) {
  return text(value, 300).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function entriesFrom(matrix) {
  return Object.values(matrix?.entries ?? {}).filter((entry) => entry && typeof entry === 'object');
}

function matchesRequirement(entry, requirement) {
  const wanted = normalized(requirement);
  if (!wanted) return false;
  return [entry.id, entry.kind, entry.label, entry.source]
    .map(normalized)
    .some((candidate) => candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate));
}

export function capabilityKindForTool(toolName) {
  const name = normalized(toolName);
  if (/websearch|readweb|fetchurl|browser|网页|联网/.test(name)) return 'web_page';
  if (/image|draw|generate|生图|图片/.test(name)) return 'image_generation';
  if (/skill|技能/.test(name)) return 'skillhub';
  if (/github|git|发布|仓库/.test(name)) return 'github';
  if (/connector|mcp|ima|knowledge|知识库|连接器/.test(name)) return 'knowledge_base';
  return undefined;
}

export function normalizeUnifiedHostRequest(input = {}) {
  const requestedEntrypoint = text(input.entrypoint || input.surface || input.taskType, 40);
  const entrypoint = UNIFIED_HOST_ENTRYPOINTS.includes(requestedEntrypoint)
    ? requestedEntrypoint
    : requestedEntrypoint === 'dm' ? 'employee' : 'assistant';
  const taskId = text(input.taskId || input.id || input.run?.taskId || input.run?.id, 180);
  const goalId = text(input.goalId || input.run?.goalState?.goalId, 180);
  const goal = text(input.goal || input.request || input.run?.goal || input.run?.request, 2400);
  const requiredCapabilities = list(input.requiredCapabilities
    || input.run?.requiredCapabilities
    || input.run?.contract?.requiredCapabilities
    || input.run?.taskDecision?.requiredCapabilities);
  const operation = ['plan', 'execute', 'observe', 'resolve_conflict', 'resume'].includes(input.operation)
    ? input.operation
    : 'execute';
  const createdAt = Number(input.createdAt) || Date.now();
  const requestId = text(input.requestId, 220)
    || `host-request-${hash(`${taskId}|${goalId}|${entrypoint}|${goal}`)}`;
  return {
    requestId,
    taskId: taskId || undefined,
    goalId: goalId || undefined,
    goal,
    entrypoint,
    operation,
    requiredCapabilities,
    createdAt,
  };
}

export function evaluateCapabilityReadiness(matrix, requiredCapabilities = []) {
  const required = list(requiredCapabilities);
  const entries = entriesFrom(matrix);
  // An empty inventory means the capability subsystem has not been synced yet.
  // It is observable, but it must not brick legacy tasks that never declared a
  // matrix. Once an inventory exists, every declared capability is enforced.
  const enforced = entries.length > 0 && required.length > 0;
  const matched = [];
  const missing = [];
  const blocked = [];
  for (const requirement of required) {
    const entry = entries.find((candidate) => matchesRequirement(candidate, requirement));
    if (!entry) {
      missing.push(requirement);
      continue;
    }
    matched.push({ requirement, id: entry.id, kind: entry.kind, state: entry.state });
    if (entry.state !== AVAILABLE) blocked.push({ requirement, id: entry.id, state: entry.state, detail: entry.lastDetail });
  }
  const ready = !enforced || (missing.length === 0 && blocked.length === 0);
  return { enforced, ready, required, matched, missing, blocked, checkedAt: Date.now() };
}

export function buildUnifiedHostState(input = {}) {
  const run = input.run || {};
  const request = normalizeUnifiedHostRequest({ ...run, ...input, run });
  const matrix = input.capabilityMatrix || run.capabilityMatrix || run.externalCapabilityMatrix;
  const capabilityReadiness = evaluateCapabilityReadiness(matrix, request.requiredCapabilities);
  return {
    hostVersion: UNIFIED_HOST_VERSION,
    mode: 'adaptive',
    singleHost: true,
    entrypoint: request.entrypoint,
    request,
    capabilityReadiness,
    legacyEntrypoint: text(input.legacyEntrypoint || run.legacyEntrypoint, 120),
    updatedAt: Number(input.now) || Date.now(),
  };
}

export function validateUnifiedHostRequest(input = {}) {
  const request = normalizeUnifiedHostRequest(input);
  const errors = [];
  if (!request.taskId) errors.push('Unified host request has no task id');
  if (!request.goal) errors.push('Unified host request has no goal');
  if (!request.goalId && input.operation !== 'plan') errors.push('Unified host request has no goal id');
  return { valid: errors.length === 0, errors, request };
}

export function validateUnifiedHostAction(input = {}) {
  const requestResult = validateUnifiedHostRequest({ ...input, operation: 'execute' });
  const readiness = evaluateCapabilityReadiness(
    input.capabilityMatrix || input.run?.capabilityMatrix || input.run?.externalCapabilityMatrix,
    input.requiredCapabilities || input.run?.requiredCapabilities || input.run?.contract?.requiredCapabilities,
  );
  const action = input.action || {};
  const errors = [...requestResult.errors];
  const inferredCapability = capabilityKindForTool(action.toolName);
  if (readiness.enforced && inferredCapability && !readiness.required.includes(inferredCapability)) {
    const inferred = evaluateCapabilityReadiness(input.capabilityMatrix || input.run?.capabilityMatrix, [inferredCapability]);
    if (!inferred.ready) errors.push(`Tool ${text(action.toolName, 120)} requires unavailable capability ${inferredCapability}`);
  } else if (readiness.enforced && !readiness.ready) {
    errors.push(`Required external capability is not ready: ${[...readiness.missing, ...readiness.blocked.map((item) => item.requirement)].join(', ')}`);
  }
  return {
    allowed: errors.length === 0,
    errors,
    reason: errors.join('; '),
    request: requestResult.request,
    readiness,
    action: clone(action),
  };
}
