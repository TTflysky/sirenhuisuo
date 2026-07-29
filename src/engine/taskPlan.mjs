const CONTRACT_VERSION = 2;
const PLAN_VERSION = 1;

const MODES = new Set(['conversation', 'answer', 'execute']);
const ROUTES = new Set([
  'direct_answer', 'web_search', 'inspect_connectors', 'read_file', 'list_files',
  'search_skills', 'install_skill', 'write_file', 'run_command', 'connector', 'team_dispatch', 'general_tools',
]);
const STEP_TYPES = new Set(['tool', 'connector', 'review', 'approval', 'human', 'composite']);
const RISK_LEVELS = new Set(['low', 'normal', 'high']);

function text(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function list(value, max = 12) {
  return Array.isArray(value) ? value.map((item) => text(item, 500)).filter(Boolean).slice(0, max) : [];
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function deliverableFormat(value) {
  const textValue = text(value, 80).toLowerCase();
  if (/markdown|\.md\b/u.test(textValue)) return 'markdown';
  if (/word|\.docx\b/u.test(textValue)) return 'docx';
  if (/excel|xlsx|\.csv\b/u.test(textValue)) return 'spreadsheet';
  if (/ppt|powerpoint|\.pptx\b/u.test(textValue)) return 'presentation';
  if (/pdf/u.test(textValue)) return 'pdf';
  if (/code|源码|代码|脚本|程序/u.test(textValue)) return 'source';
  return 'text';
}

function normalizeDeliverables(value, goal) {
  const source = Array.isArray(value) ? value : [];
  const normalized = source.map((item) => {
    const label = typeof item === 'string' ? text(item, 500) : text(item?.label ?? item?.name ?? item?.title, 500);
    if (!label) return undefined;
    return {
      label,
      format: deliverableFormat(typeof item === 'string' ? item : item?.format ?? label),
      type: ['answer', 'file', 'connection', 'operation', 'decision', 'mixed'].includes(item?.type) ? item.type : undefined,
      category: ['final', 'working', 'reference'].includes(item?.category) ? item.category : 'final',
      required: item?.required !== false,
    };
  }).filter(Boolean).slice(0, 12);
  if (normalized.length) return normalized;
  const inferredFormat = deliverableFormat(goal);
  return [{
    label: inferredFormat === 'source' ? '可运行代码或明确的修改文件' : '可交接且可验证的任务结果',
    format: inferredFormat,
    type: inferredFormat === 'text' ? 'answer' : 'file',
    category: 'final',
    required: true,
  }];
}

function inferCapabilities(goal, route, provided) {
  const capabilities = list(provided, 12);
  const routeCapability = {
    direct_answer: 'reasoning', web_search: 'web_research', connector: 'connector_access', inspect_connectors: 'connector_access',
    read_file: 'workspace_read', list_files: 'workspace_read', search_skills: 'skill_selection',
    install_skill: 'skill_installation', write_file: 'file_output', run_command: 'command_execution',
    team_dispatch: 'team_coordination', general_tools: 'general_tool_use',
  }[route];
  if (routeCapability) capabilities.push(routeCapability);
  if (/代码|编程|开发|修复|构建|测试|脚本/u.test(goal)) capabilities.push('coding');
  if (/调度|团队|员工|分工|协作/u.test(goal)) capabilities.push('team_coordination');
  if (/skill|技能/u.test(goal)) capabilities.push('skill_selection');
  return [...new Set(capabilities)].slice(0, 12);
}

function inferRisk(goal, provided) {
  if (RISK_LEVELS.has(provided)) return provided;
  return /删除|发送|发布|部署|安装|支付|提交|执行命令|外部服务|权限|密钥/u.test(goal) ? 'high' : 'normal';
}

function issue(path, message) {
  return `${path}: ${message}`;
}

function makeId(prefix, provided) {
  const value = text(provided, 120).replace(/[^a-zA-Z0-9._:-]/g, '-');
  return value || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createTaskContract(input = {}) {
  const decision = input.decision ?? input;
  const mode = MODES.has(decision.mode) ? decision.mode : 'execute';
  const goal = text(decision.goal ?? input.goal);
  const sourceRequest = text(input.sourceRequest ?? input.request ?? decision.sourceRequest ?? goal, 4000);
  const acceptanceCriteria = list(decision.acceptanceCriteria ?? input.acceptanceCriteria, 8);
  const requiredConstraints = list(decision.requiredConstraints ?? input.requiredConstraints, 8);
  const requiresEvidence = decision.requiresEvidence !== false;
  const needsUser = decision.needsUser === true;
  const primaryRoute = ROUTES.has(decision.primaryRoute) ? decision.primaryRoute : 'general_tools';
  const teamPolicyInput = object(input.teamPolicy ?? decision.teamPolicy);

  return {
    contractVersion: CONTRACT_VERSION,
    contractId: makeId('contract', input.contractId),
    mode,
    sourceRequest: sourceRequest || goal,
    goal,
    primaryRoute,
    deliverableType: ['answer', 'file', 'connection', 'operation', 'decision', 'mixed'].includes(decision.deliverableType)
      ? decision.deliverableType
      : undefined,
    deliverables: normalizeDeliverables(
      decision.deliverables ?? input.deliverables ?? input.expectedOutputs,
      `${goal} ${acceptanceCriteria.join(' ')} ${requiredConstraints.join(' ')}`,
    ),
    requiredCapabilities: inferCapabilities(goal, primaryRoute, decision.requiredCapabilities ?? input.requiredCapabilities),
    riskLevel: inferRisk(goal, decision.riskLevel ?? input.riskLevel),
    teamPolicy: {
      requiresTeam: teamPolicyInput.requiresTeam === true || primaryRoute === 'team_dispatch',
      explicitMemberIds: list(teamPolicyInput.explicitMemberIds, 24),
      allowDynamicDelegation: teamPolicyInput.allowDynamicDelegation !== false,
    },
    constraints: {
      required: requiredConstraints,
      acceptanceCriteria,
      requiresEvidence,
      needsUser,
      missingUserCondition: needsUser ? text(decision.missingUserCondition, 500) : '',
    },
    decision: {
      source: decision.source === 'model' ? 'model' : 'rules',
      reason: text(decision.decisionReason, 500),
      confidence: Number.isFinite(decision.confidence) ? Math.max(0, Math.min(1, decision.confidence)) : 0,
    },
    context: {
      scope: text(input.scope, 120),
      parentTaskId: text(input.parentTaskId, 120),
      experienceRefs: list(input.experienceRefs, 12),
    },
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
  };
}

export function validateTaskContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== 'object') return { valid: false, errors: ['contract: must be an object'] };
  if (contract.contractVersion !== CONTRACT_VERSION) errors.push(issue('contractVersion', `must be ${CONTRACT_VERSION}`));
  if (!text(contract.contractId, 120)) errors.push(issue('contractId', 'is required'));
  if (!MODES.has(contract.mode)) errors.push(issue('mode', 'is invalid'));
  if (!text(contract.sourceRequest, 4000)) errors.push(issue('sourceRequest', 'is required'));
  if (!text(contract.goal)) errors.push(issue('goal', 'is required'));
  if (!ROUTES.has(contract.primaryRoute)) errors.push(issue('primaryRoute', 'is invalid'));
  if (!Array.isArray(contract.deliverables) || contract.deliverables.length === 0) errors.push(issue('deliverables', 'must contain at least one item'));
  if (!Array.isArray(contract.requiredCapabilities)) errors.push(issue('requiredCapabilities', 'must be an array'));
  if (!RISK_LEVELS.has(contract.riskLevel)) errors.push(issue('riskLevel', 'is invalid'));
  if (!contract.teamPolicy || typeof contract.teamPolicy !== 'object' || !Array.isArray(contract.teamPolicy.explicitMemberIds)) {
    errors.push(issue('teamPolicy', 'must contain explicitMemberIds'));
  }
  const constraints = object(contract.constraints);
  if (!Array.isArray(constraints.acceptanceCriteria) || constraints.acceptanceCriteria.length === 0) {
    errors.push(issue('constraints.acceptanceCriteria', 'must contain at least one criterion'));
  }
  if (constraints.needsUser === true && !text(constraints.missingUserCondition)) {
    errors.push(issue('constraints.missingUserCondition', 'is required when needsUser is true'));
  }
  if (!Number.isFinite(contract.createdAt)) errors.push(issue('createdAt', 'must be a timestamp'));
  return { valid: errors.length === 0, errors, value: errors.length === 0 ? structuredClone(contract) : undefined };
}

export function assertValidTaskContract(contract) {
  const result = validateTaskContract(contract);
  if (!result.valid) throw new Error(`Invalid task contract: ${result.errors.join('; ')}`);
  return result.value;
}

function normalizeRetryPolicy(policy = {}) {
  return {
    maxRetries: Number.isInteger(policy.maxRetries) ? Math.max(0, Math.min(10, policy.maxRetries)) : 3,
    backoffMs: Number.isInteger(policy.backoffMs) ? Math.max(100, Math.min(300000, policy.backoffMs)) : 1000,
    maxBackoffMs: Number.isInteger(policy.maxBackoffMs) ? Math.max(1000, Math.min(900000, policy.maxBackoffMs)) : 30000,
  };
}

export function createPlan(input = {}) {
  const contract = input.contract;
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  return {
    planVersion: PLAN_VERSION,
    planId: makeId('plan', input.planId),
    contractId: text(contract?.contractId ?? input.contractId, 120),
    goal: text(contract?.goal ?? input.goal),
    steps: rawSteps.map((step, index) => ({
      stepId: makeId(`step-${index + 1}`, step.stepId ?? step.id),
      type: STEP_TYPES.has(step.type) ? step.type : 'tool',
      connector: text(step.connector, 120),
      input: object(step.input),
      expectedOutputSchema: object(step.expectedOutputSchema),
      dependsOn: list(step.dependsOn ?? step.dependsOnStepIds, 20),
      retryPolicy: normalizeRetryPolicy(step.retryPolicy ?? step),
      idempotencyKey: text(step.idempotencyKey, 240),
      sideEffect: step.sideEffect === true,
      compensateStepId: text(step.compensateStepId ?? step.compensate_step, 120),
      approvalRequired: step.approvalRequired === true,
      metadata: object(step.metadata),
    })),
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
  };
}

function hasCycle(steps) {
  const byId = new Map(steps.map((step) => [step.stepId, step]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const step = byId.get(id);
    if (step?.dependsOn.some(visit)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return steps.some((step) => visit(step.stepId));
}

export function validatePlan(plan, options = {}) {
  const errors = [];
  if (!plan || typeof plan !== 'object') return { valid: false, errors: ['plan: must be an object'] };
  if (plan.planVersion !== PLAN_VERSION) errors.push(issue('planVersion', `must be ${PLAN_VERSION}`));
  if (!text(plan.planId, 120)) errors.push(issue('planId', 'is required'));
  if (!text(plan.contractId, 120)) errors.push(issue('contractId', 'is required'));
  if (!text(plan.goal)) errors.push(issue('goal', 'is required'));
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) errors.push(issue('steps', 'must contain at least one step'));
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const ids = new Set();
  for (const [index, step] of steps.entries()) {
    const path = `steps[${index}]`;
    if (!text(step?.stepId, 120)) errors.push(issue(`${path}.stepId`, 'is required'));
    if (ids.has(step?.stepId)) errors.push(issue(`${path}.stepId`, 'must be unique'));
    ids.add(step?.stepId);
    if (!STEP_TYPES.has(step?.type)) errors.push(issue(`${path}.type`, 'is invalid'));
    if (['tool', 'connector', 'composite'].includes(step?.type) && !text(step?.connector)) {
      errors.push(issue(`${path}.connector`, 'is required for executable steps'));
    }
    if (!step?.expectedOutputSchema || typeof step.expectedOutputSchema !== 'object' || Array.isArray(step.expectedOutputSchema)) {
      errors.push(issue(`${path}.expectedOutputSchema`, 'must be an object'));
    }
    if (!step?.retryPolicy || !Number.isInteger(step.retryPolicy.maxRetries) || step.retryPolicy.maxRetries < 0) {
      errors.push(issue(`${path}.retryPolicy`, 'must define maxRetries'));
    }
    if (step?.sideEffect && !text(step.idempotencyKey)) {
      errors.push(issue(`${path}.idempotencyKey`, 'is required for side-effect steps'));
    }
    for (const dependency of Array.isArray(step?.dependsOn) ? step.dependsOn : []) {
      if (!ids.has(dependency) && !steps.some((candidate) => candidate?.stepId === dependency)) {
        errors.push(issue(`${path}.dependsOn`, `references missing step ${dependency}`));
      }
    }
    if (step?.compensateStepId && !steps.some((candidate) => candidate?.stepId === step.compensateStepId)) {
      errors.push(issue(`${path}.compensateStepId`, `references missing step ${step.compensateStepId}`));
    }
    if (step?.compensateStepId === step?.stepId) errors.push(issue(`${path}.compensateStepId`, 'cannot reference itself'));
    if (step?.approvalRequired && step.type !== 'approval' && !options.allowInlineApproval) {
      errors.push(issue(`${path}.approvalRequired`, 'must use an explicit approval step'));
    }
  }
  if (hasCycle(steps)) errors.push(issue('steps', 'dependencies contain a cycle'));
  return { valid: errors.length === 0, errors, value: errors.length === 0 ? structuredClone(plan) : undefined };
}

export function assertValidPlan(plan, options = {}) {
  const result = validatePlan(plan, options);
  if (!result.valid) throw new Error(`Invalid task plan: ${result.errors.join('; ')}`);
  return result.value;
}

export function serializePlan(plan) {
  return JSON.stringify(assertValidPlan(plan));
}

export function parsePlan(serialized, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`Invalid serialized task plan: ${error instanceof Error ? error.message : String(error)}`);
  }
  return assertValidPlan(parsed, options);
}

export const TASK_CONTRACT_VERSION = CONTRACT_VERSION;
export const TASK_PLAN_VERSION = PLAN_VERSION;
