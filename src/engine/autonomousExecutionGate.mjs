function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function completedNodeIds(run) {
  return new Set((run?.adaptivePlanGraph?.nodes || [])
    .filter((node) => node.status === 'completed')
    .map((node) => node.id));
}

// Models choose the action. This gate only verifies its identity and scope.
export function validateAutonomousToolExecution(run = {}, input = {}) {
  const errors = [];
  const goalId = text(input.goalId || run.goalState?.goalId, 180);
  const planRevision = Number(input.planRevision || run.adaptivePlanGraph?.revision) || 1;
  const stepId = text(input.stepId, 180);
  const employeeId = text(input.employeeId, 180);
  const toolName = text(input.toolName, 180);
  const authority = run.autonomousControl?.decisionAuthority;
  const proposal = run.autonomousDecisionProposal;

  if (!goalId || goalId !== run.goalState?.goalId) errors.push('Tool action is not bound to the current goal');
  if (planRevision !== Number(run.adaptivePlanGraph?.revision || 1)) errors.push('Tool action uses a stale plan revision');
  if (!stepId) errors.push('Tool action has no responsibility step');
  if (!toolName) errors.push('Tool action has no tool name');
  const node = run.adaptivePlanGraph?.nodes?.find((item) => item.id === stepId);
  if (!node) errors.push(`Responsibility step does not exist: ${stepId || '(empty)'}`);
  else {
    if (node.status === 'superseded') errors.push(`Responsibility step is superseded: ${stepId}`);
    if (!['running', 'queued'].includes(node.status)) errors.push(`Responsibility step is not executable: ${node.status}`);
    const completed = completedNodeIds(run);
    const unresolved = (node.dependsOn || []).filter((id) => !completed.has(id));
    if (unresolved.length) errors.push(`Responsibility step has unresolved dependencies: ${unresolved.join(', ')}`);
    if (employeeId && node.ownerEmployeeId && employeeId !== node.ownerEmployeeId) errors.push(`Wrong responsibility employee; expected ${node.ownerEmployeeId}`);
  }
  if (proposal) {
    if (input.proposalId && proposal.proposalId !== input.proposalId) errors.push('Tool action does not use the current proposal');
    if (proposal.goalId !== goalId || proposal.planRevision !== planRevision) errors.push('Proposal is not bound to the current goal or plan');
    if (proposal.selectedAction?.kind !== 'use_tool') errors.push('Current proposal is not a tool action');
    if (proposal.selectedAction?.toolName !== toolName) errors.push('Proposal tool name does not match');
    if (proposal.selectedAction?.stepId !== stepId) errors.push('Proposal responsibility step does not match');
    if (employeeId && proposal.selectedAction?.employeeId && proposal.selectedAction.employeeId !== employeeId) errors.push('Proposal responsibility employee does not match');
  }
  if (!authority?.accepted) errors.push(authority?.reason || 'Autonomous host has not authorized this tool action');
  if (input.proposalId && authority?.proposalId !== input.proposalId) errors.push('Autonomous host did not accept the current proposal');
  return { allowed: errors.length === 0, errors, reason: errors.join('; ') };
}

export function createAutonomousToolAction(input = {}) {
  return {
    kind: 'use_tool',
    stepId: text(input.stepId, 180) || undefined,
    employeeId: text(input.employeeId, 180) || undefined,
    toolName: text(input.toolName, 180) || undefined,
    toolCallId: text(input.toolCallId, 180) || undefined,
    summary: text(input.summary, 1000) || `Call ${text(input.toolName, 180) || 'tool'} to produce verifiable evidence.`,
  };
}
