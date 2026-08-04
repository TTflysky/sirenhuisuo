const GRAPH_VERSION = 1;
const MAX_REVISIONS = 120;
const MAX_ROUTES = 80;

const NODE_STATUSES = new Set(['queued', 'running', 'paused', 'awaiting_user', 'failed', 'completed', 'stopped', 'superseded']);
const OPERATION_TYPES = new Set(['add_node', 'update_node', 'replace_dependencies', 'reassign_node', 'register_member', 'reopen_node', 'supersede_node', 'switch_route']);
const FAILURE_CATEGORIES = new Set(['authentication', 'permission', 'billing', 'rate_limit', 'network', 'timeout', 'validation', 'configuration', 'dependency', 'result_mismatch', 'verification', 'unknown']);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function text(value, max = 2000) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

function list(value, max = 24, itemMax = 600) {
  return Array.isArray(value) ? [...new Set(value.map((item) => text(item, itemMax)).filter(Boolean))].slice(0, max) : [];
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
}

function stableId(prefix, ...parts) {
  const source = parts.map((part) => text(part, 180)).filter(Boolean).join('-').replace(/[^a-zA-Z0-9._:-]/gu, '-');
  return source ? `${prefix}-${source}`.slice(0, 220) : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStatus(value) {
  return NODE_STATUSES.has(value) ? value : 'queued';
}

function normalizeStrategy(value = {}, fallback = {}) {
  const source = typeof value === 'string' ? { description: value } : object(value);
  const routeId = text(source.routeId || fallback.routeId, 180);
  const toolName = text(source.toolName || fallback.toolName, 160);
  const description = text(source.description || source.strategy || fallback.description, 800);
  const fingerprint = text(source.fingerprint || [routeId, toolName, description].filter(Boolean).join(':'), 500);
  return { routeId, toolName, description, fingerprint };
}

function normalizeNode(input = {}, index = 0, revision = 1) {
  const id = text(input.id || input.nodeId || input.stepId, 180) || `node-${index + 1}`;
  const metadata = object(input.metadata);
  return {
    id,
    title: text(input.title || input.assignment || input.objective || id, 300),
    objective: text(input.objective || input.assignment || input.title || id, 3000),
    kind: text(input.kind || input.type, 80) || 'work',
    ownerEmployeeId: text(input.ownerEmployeeId || input.employeeId || input.input?.employeeId, 180),
    ownerName: text(input.ownerName, 200),
    requiredCapabilities: list(input.requiredCapabilities || [input.requiredCapability || metadata.requiredCapability], 24, 180),
    dependsOn: list(input.dependsOn || input.dependsOnStepIds, 40, 180),
    acceptanceCriteria: list(input.acceptanceCriteria || metadata.acceptanceCriteria, 24, 800),
    expectedEvidence: list(input.expectedEvidence || input.acceptanceCriteria || metadata.acceptanceCriteria, 24, 800),
    deliverableType: text(input.deliverableType || metadata.deliverableType, 80),
    approvalRequired: input.approvalRequired === true,
    riskLevel: ['low', 'normal', 'high'].includes(input.riskLevel) ? input.riskLevel : input.approvalRequired ? 'high' : 'normal',
    retryPolicy: {
      maxRetries: Number.isInteger(input.retryPolicy?.maxRetries ?? input.maxRetries) ? Math.max(0, Math.min(10, input.retryPolicy?.maxRetries ?? input.maxRetries)) : 2,
      backoffMs: Number.isInteger(input.retryPolicy?.backoffMs) ? Math.max(100, input.retryPolicy.backoffMs) : 1000,
      maxBackoffMs: Number.isInteger(input.retryPolicy?.maxBackoffMs) ? Math.max(1000, input.retryPolicy.maxBackoffMs) : 30000,
    },
    strategy: normalizeStrategy(input.strategy, {
      routeId: metadata.primaryRoute || input.connector,
      toolName: input.connector,
      description: metadata.strategy || input.assignment,
    }),
    status: normalizeStatus(input.status),
    attempts: Math.max(0, Number(input.attempts) || 0),
    evidenceIds: list(input.evidenceIds || input.evidence?.map((item) => item.id || item.summary), 40, 240),
    lastFailure: input.lastFailure ? object(input.lastFailure) : input.lastError ? { category: text(input.errorClass, 80) || 'unknown', summary: text(input.lastError, 1200), at: Number(input.updatedAt) || 0 } : undefined,
    revisionCreated: Math.max(1, Number(input.revisionCreated) || revision),
    revisionUpdated: Math.max(1, Number(input.revisionUpdated) || revision),
    supersededBy: list(input.supersededBy, 20, 180),
    metadata,
  };
}

function dependencyCycle(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if ((byId.get(id)?.dependsOn || []).some(visit)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return nodes.some((node) => visit(node.id));
}

export function validateAdaptivePlanGraph(graph) {
  const errors = [];
  if (!graph || typeof graph !== 'object') return { valid: false, errors: ['graph must be an object'] };
  if (graph.graphVersion !== GRAPH_VERSION) errors.push(`graphVersion must be ${GRAPH_VERSION}`);
  if (!text(graph.graphId, 220)) errors.push('graphId is required');
  if (!text(graph.goalId, 220)) errors.push('goalId is required');
  if (!Number.isInteger(graph.revision) || graph.revision < 1) errors.push('revision must be a positive integer');
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) errors.push('nodes must contain at least one node');
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const ids = new Set();
  for (const node of nodes) {
    if (!text(node?.id, 180)) errors.push('every node requires an id');
    if (ids.has(node?.id)) errors.push(`duplicate node id: ${node.id}`);
    ids.add(node?.id);
  }
  for (const node of nodes) {
    if (!NODE_STATUSES.has(node?.status)) errors.push(`node ${node?.id} has invalid status`);
    for (const dependency of node?.dependsOn || []) if (!ids.has(dependency)) errors.push(`node ${node.id} references missing dependency ${dependency}`);
    if ((node?.dependsOn || []).includes(node?.id)) errors.push(`node ${node.id} cannot depend on itself`);
  }
  if (dependencyCycle(nodes)) errors.push('node dependencies contain a cycle');
  return { valid: errors.length === 0, errors, value: errors.length ? undefined : clone(graph) };
}

function sourceNodes(input = {}) {
  if (Array.isArray(input.nodes) && input.nodes.length) return input.nodes;
  if (Array.isArray(input.run?.steps) && input.run.steps.length) return input.run.steps;
  if (Array.isArray(input.plan?.steps) && input.plan.steps.length) return input.plan.steps;
  if (Array.isArray(input.codingProject?.stages) && input.codingProject.stages.length) return input.codingProject.stages;
  return [{ id: 'primary-goal', title: input.goal || 'Complete goal', objective: input.goal || 'Complete goal' }];
}

export function createAdaptivePlanGraph(input = {}) {
  const now = Number(input.now) || Date.now();
  const run = input.run || {};
  const goalId = text(input.goalId || run.goalState?.goalId || run.id, 220) || stableId('goal', run.id, input.goal);
  const revision = 1;
  const nodes = sourceNodes(input).map((node, index) => normalizeNode(node, index, revision));
  const graph = {
    graphVersion: GRAPH_VERSION,
    graphId: text(input.graphId, 220) || stableId('adaptive-plan', goalId),
    goalId,
    projectId: text(input.projectId || run.projectId || run.goalState?.projectId, 220),
    sourcePlanId: text(input.sourcePlanId || run.plan?.planId, 220),
    revision,
    nodes,
    revisionHistory: [{
      revision,
      revisionId: stableId('revision', goalId, revision),
      trigger: input.trigger || 'migration',
      reason: text(input.reason, 1200) || 'Initial adaptive plan created from the existing task plan.',
      operations: [{ type: 'initialize', nodeIds: nodes.map((node) => node.id) }],
      affectedNodeIds: nodes.map((node) => node.id),
      preservedCompletedNodeIds: nodes.filter((node) => node.status === 'completed').map((node) => node.id),
      evidenceIds: [],
      at: now,
    }],
    rosterChanges: [],
    routeHistory: [],
    createdAt: now,
    updatedAt: now,
  };
  const validation = validateAdaptivePlanGraph(graph);
  if (!validation.valid) throw new Error(`Invalid adaptive plan graph: ${validation.errors.join('; ')}`);
  return graph;
}

export function downstreamNodeIds(graph, nodeIds) {
  const affected = new Set(list(nodeIds, 100, 180));
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph?.nodes || []) {
      if (affected.has(node.id)) continue;
      if ((node.dependsOn || []).some((id) => affected.has(id))) {
        affected.add(node.id);
        changed = true;
      }
    }
  }
  return [...affected];
}

export function readyAdaptiveNodes(graph) {
  const completed = new Set((graph?.nodes || []).filter((node) => node.status === 'completed').map((node) => node.id));
  return (graph?.nodes || []).filter((node) => ['queued', 'paused'].includes(node.status)
    && (node.dependsOn || []).every((dependency) => completed.has(dependency))
    && node.status !== 'superseded');
}

export function restoreAdaptivePlanGraph(snapshot, input = {}) {
  if (!snapshot?.graphVersion) return createAdaptivePlanGraph(input);
  const now = Number(input.now) || Date.now();
  const next = clone(snapshot);
  next.graphVersion = GRAPH_VERSION;
  next.revision = Math.max(1, Number(next.revision) || 1);
  next.nodes = (next.nodes || []).map((node, index) => normalizeNode(node, index, next.revision));
  next.revisionHistory = Array.isArray(next.revisionHistory) ? next.revisionHistory.slice(-MAX_REVISIONS) : [];
  next.rosterChanges = Array.isArray(next.rosterChanges) ? next.rosterChanges.slice(-MAX_REVISIONS) : [];
  next.routeHistory = Array.isArray(next.routeHistory) ? next.routeHistory.slice(-MAX_ROUTES) : [];
  const liveSteps = input.run?.steps || input.steps;
  if (Array.isArray(liveSteps) && liveSteps.length) {
    const liveById = new Map(liveSteps.map((step) => [text(step.id || step.stepId, 180), step]));
    for (const node of next.nodes) {
      const live = liveById.get(node.id);
      if (!live) continue;
      node.status = normalizeStatus(live.status || node.status);
      node.attempts = Math.max(node.attempts, Number(live.attempts) || 0);
      node.evidenceIds = list([...(node.evidenceIds || []), ...(live.evidence || []).map((item) => item.id || item.summary)], 40, 240);
      if (live.lastError) node.lastFailure = { category: text(live.errorClass, 80) || 'unknown', summary: text(live.lastError, 1200), at: Number(live.updatedAt || input.run?.updatedAt) || now };
      if (live.employeeId) node.ownerEmployeeId = text(live.employeeId, 180);
    }
    for (const [id, live] of liveById) {
      if (!id || next.nodes.some((node) => node.id === id)) continue;
      next.nodes.push(normalizeNode(live, next.nodes.length, next.revision));
    }
  }
  next.updatedAt = now;
  const validation = validateAdaptivePlanGraph(next);
  return validation.valid ? next : createAdaptivePlanGraph(input);
}

function operationSummary(operation) {
  const target = text(operation.nodeId || operation.node?.id, 180);
  if (operation.type === 'add_node') return `Add ${target}`;
  if (operation.type === 'reassign_node') return `Reassign ${target} to ${text(operation.employeeId, 180)}`;
  if (operation.type === 'register_member') return `Register team member ${text(operation.employeeName || operation.employeeId, 200)}`;
  if (operation.type === 'replace_dependencies') return `Change dependencies for ${target}`;
  if (operation.type === 'reopen_node') return `Reopen ${target} and affected downstream work`;
  if (operation.type === 'supersede_node') return `Supersede ${target}`;
  if (operation.type === 'switch_route') return `Switch route for ${target}`;
  return `Update ${target}`;
}

function applyOperation(graph, operation, revision, affected) {
  if (!OPERATION_TYPES.has(operation.type)) throw new Error(`Unsupported adaptive plan operation: ${operation.type}`);
  const nodeId = text(operation.nodeId || operation.node?.id, 180);
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (operation.type === 'register_member') {
    const employeeId = text(operation.employeeId, 180);
    if (!employeeId) throw new Error('register_member requires employeeId');
    const affectedNodeIds = list(operation.affectedNodeIds, 40, 180).filter((id) => graph.nodes.some((item) => item.id === id));
    graph.rosterChanges = Array.isArray(graph.rosterChanges) ? graph.rosterChanges : [];
    graph.rosterChanges.push({
      employeeId,
      employeeName: text(operation.employeeName, 200),
      reason: text(operation.reason, 1200),
      affectedNodeIds,
      acceptanceCriteria: list(operation.acceptanceCriteria, 24, 800),
      revision,
      at: Date.now(),
    });
    graph.rosterChanges = graph.rosterChanges.slice(-MAX_REVISIONS);
    for (const id of affectedNodeIds) affected.add(id);
    return;
  }
  if (operation.type !== 'add_node' && !node) throw new Error(`Adaptive plan node not found: ${nodeId}`);
  if (operation.type === 'add_node') {
    const added = normalizeNode(operation.node, graph.nodes.length, revision);
    if (graph.nodes.some((item) => item.id === added.id)) throw new Error(`Adaptive plan node already exists: ${added.id}`);
    added.revisionCreated = revision;
    added.revisionUpdated = revision;
    graph.nodes.push(added);
    affected.add(added.id);
    return;
  }
  if (operation.type === 'update_node') {
    const changes = object(operation.changes);
    for (const key of ['title', 'objective', 'deliverableType', 'riskLevel']) if (changes[key] !== undefined) node[key] = text(changes[key], key === 'objective' ? 3000 : 300);
    if (changes.acceptanceCriteria) node.acceptanceCriteria = list(changes.acceptanceCriteria, 24, 800);
    if (changes.expectedEvidence) node.expectedEvidence = list(changes.expectedEvidence, 24, 800);
    if (changes.requiredCapabilities) node.requiredCapabilities = list(changes.requiredCapabilities, 24, 180);
    node.revisionUpdated = revision;
    affected.add(node.id);
    return;
  }
  if (operation.type === 'replace_dependencies') {
    node.dependsOn = list(operation.dependsOn, 40, 180);
    node.revisionUpdated = revision;
    affected.add(node.id);
    return;
  }
  if (operation.type === 'reassign_node') {
    const previousOwnerEmployeeId = node.ownerEmployeeId;
    node.ownerEmployeeId = text(operation.employeeId, 180);
    node.ownerName = text(operation.employeeName, 200);
    if (!node.ownerEmployeeId) throw new Error('reassign_node requires employeeId');
    if (node.status !== 'queued') node.status = 'queued';
    node.lastFailure = operation.reason ? { category: 'assignment', summary: text(operation.reason, 1200), at: Date.now(), previousOwnerEmployeeId } : node.lastFailure;
    node.revisionUpdated = revision;
    affected.add(node.id);
    return;
  }
  if (operation.type === 'reopen_node') {
    const reopenIds = downstreamNodeIds(graph, [node.id]);
    for (const id of reopenIds) {
      const target = graph.nodes.find((item) => item.id === id);
      if (!target || target.status === 'superseded') continue;
      target.status = 'queued';
      target.revisionUpdated = revision;
      if (id === node.id) target.lastFailure = { category: text(operation.category, 80) || 'verification', summary: text(operation.reason, 1200), at: Date.now() };
      affected.add(id);
    }
    return;
  }
  if (operation.type === 'supersede_node') {
    if (node.status === 'completed' && operation.preserveCompleted !== false) throw new Error('Completed nodes can only be superseded with preserveCompleted=false');
    node.status = 'superseded';
    node.supersededBy = list(operation.replacementNodeIds, 20, 180);
    node.revisionUpdated = revision;
    affected.add(node.id);
    return;
  }
  if (operation.type === 'switch_route') {
    const strategy = normalizeStrategy(operation.strategy);
    if (!strategy.fingerprint) throw new Error('switch_route requires a strategy fingerprint');
    if (strategy.fingerprint === node.strategy?.fingerprint) throw new Error('switch_route must use a materially different strategy');
    const prior = clone(node.strategy);
    node.strategy = strategy;
    node.status = 'queued';
    node.lastFailure = operation.reason ? { category: text(operation.category, 80) || 'unknown', summary: text(operation.reason, 1200), at: Date.now() } : node.lastFailure;
    node.revisionUpdated = revision;
    graph.routeHistory.push({
      routeId: strategy.routeId || stableId('route', node.id, revision),
      nodeId: node.id,
      previousFingerprint: prior?.fingerprint || '',
      fingerprint: strategy.fingerprint,
      reason: text(operation.reason, 1200),
      revision,
      at: Date.now(),
    });
    graph.routeHistory = graph.routeHistory.slice(-MAX_ROUTES);
    affected.add(node.id);
  }
}

export function applyAdaptivePlanRevision(snapshot, proposal = {}, options = {}) {
  const graph = restoreAdaptivePlanGraph(snapshot, options);
  const reason = text(proposal.reason, 1600);
  const operations = Array.isArray(proposal.operations) ? proposal.operations : [];
  if (!reason) throw new Error('Adaptive plan revision requires a reason');
  if (!operations.length) throw new Error('Adaptive plan revision requires at least one operation');
  const next = clone(graph);
  const revision = next.revision + 1;
  const affected = new Set();
  for (const operation of operations) applyOperation(next, operation, revision, affected);
  const validation = validateAdaptivePlanGraph(next);
  if (!validation.valid) throw new Error(`Adaptive plan revision rejected: ${validation.errors.join('; ')}`);
  const preservedCompletedNodeIds = graph.nodes.filter((node) => node.status === 'completed' && !affected.has(node.id)).map((node) => node.id);
  next.revision = revision;
  next.updatedAt = Number(options.now) || Date.now();
  next.revisionHistory = [...(next.revisionHistory || []), {
    revision,
    revisionId: text(proposal.revisionId, 220) || stableId('revision', next.goalId, revision),
    trigger: text(proposal.trigger, 80) || 'model',
    reason,
    operations: operations.map((operation) => ({ type: operation.type, nodeId: text(operation.nodeId || operation.node?.id, 180), summary: operationSummary(operation) })),
    affectedNodeIds: [...affected],
    preservedCompletedNodeIds,
    evidenceIds: list(proposal.evidenceIds, 40, 240),
    at: next.updatedAt,
  }].slice(-MAX_REVISIONS);
  return next;
}

export function classifyAdaptiveFailure(error, hint) {
  if (FAILURE_CATEGORIES.has(hint)) return { category: hint, retryable: ['rate_limit', 'network', 'timeout'].includes(hint), needsUser: ['authentication', 'permission', 'billing'].includes(hint) };
  const message = text(error?.message || error, 2000);
  const rules = [
    ['authentication', /401|unauthorized|api.?key|token|credential|凭据|密钥/iu, false, true],
    ['permission', /403|forbidden|permission|denied|权限|拒绝/iu, false, true],
    ['billing', /billing|payment|required quota|余额|付费|账单/iu, false, true],
    ['rate_limit', /429|rate.?limit|too many requests|限流/iu, true, false],
    ['timeout', /timeout|timed out|aborted|超时/iu, true, false],
    ['network', /ECONN|ENOTFOUND|fetch failed|network|socket|网络|连接失败/iu, true, false],
    ['validation', /schema|required|invalid argument|参数|格式|校验/iu, false, false],
    ['dependency', /module not found|dependency|package|依赖/iu, false, false],
    ['configuration', /not configured|missing config|未配置|配置缺失/iu, false, true],
    ['result_mismatch', /mismatch|unexpected result|结果不符|答非所问/iu, false, false],
    ['verification', /verification|acceptance|test failed|验收|测试失败/iu, false, false],
  ];
  const matched = rules.find(([, pattern]) => pattern.test(message));
  return matched ? { category: matched[0], retryable: matched[2], needsUser: matched[3] } : { category: 'unknown', retryable: false, needsUser: false };
}

export function selectAdaptiveRecovery(graph, input = {}) {
  const nodeId = text(input.nodeId || input.stepId, 180);
  const node = graph?.nodes?.find((item) => item.id === nodeId);
  if (!node) throw new Error(`Adaptive recovery node not found: ${nodeId}`);
  const failure = classifyAdaptiveFailure(input.error || input.reason, input.category);
  const sameRouteFailures = Math.max(0, Number(input.sameRouteFailures) || Number(node.attempts) || 0);
  if (failure.needsUser) return { action: 'await_user', failure, reason: text(input.error || input.reason, 1200), nodeId };
  if (failure.retryable && sameRouteFailures < 2) return { action: 'retry', failure, delayMs: Math.min(30000, 1000 * (2 ** sameRouteFailures)), nodeId };
  if (input.alternativeStrategy) {
    return {
      action: 'revise',
      failure,
      nodeId,
      proposal: {
        trigger: 'failure',
        reason: text(input.reason || input.error, 1200) || `Route failed for ${node.title}; use a materially different strategy.`,
        evidenceIds: input.evidenceIds,
        operations: [{ type: 'switch_route', nodeId, strategy: input.alternativeStrategy, reason: input.error || input.reason, category: failure.category }],
      },
    };
  }
  return { action: 'discover_alternative', failure, reason: `Route ${node.strategy?.fingerprint || node.id} cannot be repeated without a new strategy, tool, parameter set, or owner.`, nodeId };
}

export function assessAdaptiveBudget(input = {}) {
  const usage = object(input.usage);
  const hard = { modelRounds: 36, toolCalls: 72, estimatedTokens: 400000, elapsedMs: 45 * 60 * 1000, ...object(input.hardLimits) };
  const elapsedMs = Math.max(0, Number(input.elapsedMs) || 0);
  for (const key of ['modelRounds', 'toolCalls', 'estimatedTokens']) {
    if ((Number(usage[key]) || 0) >= hard[key]) return { action: 'stop', reason: `${key} reached the hard safety limit`, dimension: key };
  }
  if (elapsedMs >= hard.elapsedMs) return { action: 'stop', reason: 'elapsed time reached the hard safety limit', dimension: 'elapsedMs' };
  if (input.needsApproval === true) return { action: 'await_user', reason: 'the next action crosses an approval boundary' };
  if (input.repeatedRouteDetected === true || Number(input.noProgressRounds) >= 3) return { action: 'replan', reason: 'no verified progress was produced by the current route' };
  const contextRatio = Number(input.contextRatio) || 0;
  if (contextRatio >= 0.86) return { action: 'checkpoint', reason: 'context is near its safe capacity' };
  if (contextRatio >= 0.68) return { action: 'compact', reason: 'compress verified progress before continuing' };
  return { action: 'continue', reason: 'risk, progress, context, and hard limits allow another action' };
}

export function projectGraphToTaskSteps(graph, existingSteps = []) {
  const existing = new Map((existingSteps || []).map((step) => [step.id, step]));
  return (graph?.nodes || []).filter((node) => node.status !== 'superseded').map((node, index) => {
    const prior = existing.get(node.id) || {};
    return {
      ...prior,
      id: node.id,
      title: node.title,
      assignment: node.objective,
      employeeId: node.ownerEmployeeId || prior.employeeId,
      dependsOnStepIds: [...node.dependsOn],
      kind: ['review', 'revision'].includes(node.kind) ? node.kind : 'work',
      deliverableType: node.deliverableType || prior.deliverableType,
      acceptanceCriteria: [...node.acceptanceCriteria],
      maxRetries: node.retryPolicy.maxRetries,
      order: index + 1,
      status: node.status === 'awaiting_user' ? 'paused' : node.status,
      attempts: Math.max(Number(prior.attempts) || 0, node.attempts),
      lastError: node.lastFailure?.summary || prior.lastError,
      errorClass: node.lastFailure?.category || prior.errorClass,
      evidence: prior.evidence || [],
      events: prior.events || [],
      adaptivePlanRevision: graph.revision,
      adaptiveStrategy: clone(node.strategy),
    };
  });
}

export const ADAPTIVE_PLAN_GRAPH_VERSION = GRAPH_VERSION;
