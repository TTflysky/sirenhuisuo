const PROPOSAL_VERSION = 1;

const ACTION_KINDS = new Set([
  'observe',
  'propose_plan',
  'start_step',
  'continue_step',
  'use_tool',
  'verify_completion',
  'resolve_blocker',
  'switch_route',
  'replan',
  'reflect',
  'await_user',
  'hold',
  'checkpoint',
  'compact_context',
  'stop_safely',
]);

function text(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

function list(value, max = 16, itemMax = 800) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => text(item, itemMax)).filter(Boolean))].slice(-max)
    : [];
}

function stableId(prefix, ...parts) {
  const source = parts.map((part) => text(part, 300)).filter(Boolean).join('|') || 'unknown';
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function normalizeAction(input = {}) {
  return {
    kind: text(input.kind, 80),
    summary: text(input.summary, 1200),
    stepId: text(input.stepId, 180) || undefined,
    routeId: text(input.routeId, 240) || undefined,
    toolName: text(input.toolName, 180) || undefined,
    toolCallId: text(input.toolCallId, 180) || undefined,
    requiredUserInput: text(input.requiredUserInput, 600) || undefined,
  };
}

export function createAutonomousDecisionProposal(input = {}, run = {}) {
  const selectedAction = normalizeAction(input.selectedAction || input.action);
  const createdAt = Number(input.createdAt) || Date.now();
  const goalId = text(input.goalId || run.goalState?.goalId, 180);
  const planRevision = Math.max(1, Number(input.planRevision || run.adaptivePlanGraph?.revision) || 1);
  return {
    proposalVersion: PROPOSAL_VERSION,
    proposalId: text(input.proposalId, 180) || stableId('proposal', goalId, planRevision, selectedAction.kind, selectedAction.stepId, selectedAction.toolCallId, createdAt),
    source: ['model', 'runtime', 'user', 'system'].includes(input.source) ? input.source : 'runtime',
    goalId,
    planRevision,
    selectedAction,
    observedFactIds: list(input.observedFactIds, 20, 180),
    publicRationale: text(input.publicRationale, 1200),
    expectedEvidence: list(input.expectedEvidence, 16, 600),
    riskLevel: ['low', 'medium', 'high'].includes(input.riskLevel) ? input.riskLevel : 'low',
    approvalRequired: input.approvalRequired === true,
    createdAt,
  };
}

function stepValidation(run, action) {
  if (!action.stepId) return ['该动作必须绑定具体步骤'];
  const graph = run.adaptivePlanGraph;
  const node = graph?.nodes?.find((item) => item.id === action.stepId);
  if (!node) return [`计划中不存在步骤 ${action.stepId}`];
  if (node.status === 'superseded') return [`步骤 ${action.stepId} 已废弃`];
  const completed = new Set((graph?.nodes || []).filter((item) => item.status === 'completed').map((item) => item.id));
  const unresolved = (node.dependsOn || []).filter((dependencyId) => !completed.has(dependencyId));
  if (action.kind === 'start_step' && node.status !== 'queued') return [`步骤 ${action.stepId} 当前不是待执行状态`];
  if (action.kind === 'continue_step' && node.status !== 'running') return [`步骤 ${action.stepId} 当前不是执行中状态`];
  if (unresolved.length) return [`步骤 ${action.stepId} 仍等待依赖：${unresolved.join('、')}`];
  return [];
}

export function validateAutonomousDecisionProposal(run = {}, input = {}) {
  const proposal = createAutonomousDecisionProposal(input, run);
  const errors = [];
  if (!proposal.goalId || proposal.goalId !== run.goalState?.goalId) errors.push('决策提案没有绑定当前目标');
  if (proposal.planRevision !== Number(run.adaptivePlanGraph?.revision || 1)) errors.push('决策提案使用了过期计划版本');
  if (!ACTION_KINDS.has(proposal.selectedAction.kind)) errors.push(`不支持的自主动作：${proposal.selectedAction.kind || '空'}`);
  if (!proposal.selectedAction.summary) errors.push('决策提案缺少公开行动摘要');
  if (['start_step', 'continue_step'].includes(proposal.selectedAction.kind)) errors.push(...stepValidation(run, proposal.selectedAction));
  if (proposal.selectedAction.kind === 'use_tool') {
    if (!proposal.selectedAction.toolName) errors.push('工具动作必须声明 toolName');
    if (proposal.selectedAction.stepId) {
      const node = run.adaptivePlanGraph?.nodes?.find((item) => item.id === proposal.selectedAction.stepId);
      if (!node || node.status === 'superseded') errors.push(`工具动作绑定了无效步骤 ${proposal.selectedAction.stepId}`);
    }
  }
  if (proposal.selectedAction.kind === 'await_user'
    && !proposal.selectedAction.requiredUserInput
    && !run.waitingFor
    && !run.pendingApproval
    && !(run.situationModel?.blockedBy || []).length) errors.push('等待用户必须指出无法自行取得的具体条件');
  if (proposal.selectedAction.kind === 'verify_completion') {
    const active = (run.adaptivePlanGraph?.nodes || []).filter((node) => node.status !== 'superseded' && node.compensationOnly !== true);
    if (active.some((node) => node.status !== 'completed')) errors.push('仍有未完成步骤，不能进入最终验收');
  }
  if (proposal.riskLevel === 'high' && !proposal.approvalRequired) errors.push('高风险动作必须声明需要授权');
  const approvalPending = Boolean(run.pendingApproval?.status === 'pending');
  const requiresApproval = proposal.approvalRequired || proposal.riskLevel === 'high' || approvalPending;
  return { valid: errors.length === 0, errors, proposal, requiresApproval };
}

export function selectAutonomousDecision(run = {}, fallbackAction = {}, input, options = {}) {
  if (!input || typeof input !== 'object' || (!input.selectedAction && !input.action)) {
    return { action: fallbackAction, authority: { source: 'deterministic-fallback', accepted: false, reason: '没有新的模型或运行时决策提案' } };
  }
  const validation = validateAutonomousDecisionProposal(run, input);
  if (validation.proposal.proposalId === options.consumedProposalId) {
    return { action: fallbackAction, authority: { source: 'deterministic-fallback', accepted: false, proposalId: validation.proposal.proposalId, reason: '该决策提案已经执行或处理' } };
  }
  if (!validation.valid) {
    return { action: fallbackAction, authority: { source: 'deterministic-fallback', accepted: false, proposalId: validation.proposal.proposalId, reason: validation.errors.join('；') } };
  }
  if (validation.requiresApproval && run.pendingApproval?.status !== 'approved') {
    return {
      action: {
        kind: 'await_user',
        summary: validation.proposal.selectedAction.requiredUserInput || '该动作需要用户授权后才能执行。',
      },
      authority: { source: validation.proposal.source, accepted: true, proposalId: validation.proposal.proposalId, approvalRequired: true, reason: validation.proposal.publicRationale },
    };
  }
  return {
    action: validation.proposal.selectedAction,
    authority: { source: validation.proposal.source, accepted: true, proposalId: validation.proposal.proposalId, approvalRequired: false, reason: validation.proposal.publicRationale },
    proposal: validation.proposal,
  };
}

export const AUTONOMOUS_DECISION_PROPOSAL_VERSION = PROPOSAL_VERSION;
