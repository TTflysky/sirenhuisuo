function text(value, limit = 1200) {
  return String(value ?? '').trim().slice(0, limit);
}

function markAdaptiveStepStarted(run, stepId) {
  const step = run.steps?.find((item) => item.id === stepId);
  if (!step) return;
  step.status = 'running';
  step.attempts = (Number(step.attempts) || 0) + 1;
  const node = run.adaptivePlanGraph?.nodes?.find((item) => item.id === stepId);
  if (node) {
    node.status = 'running';
    node.attempts = step.attempts;
  }
}

function applyAdaptiveStepFailure(run, input) {
  const { step, adaptivePlan } = input;
  const reason = text(input.reason);
  const liveStep = run.steps.find((item) => item.id === step.id) || step;
  const failure = adaptivePlan.classifyAdaptiveFailure(reason, input.errorClass);
  const routeFailures = Math.max(1, Number(liveStep.attempts) || 1);
  const node = run.adaptivePlanGraph?.nodes?.find((item) => item.id === step.id);
  if (node) {
    node.attempts = routeFailures;
    node.status = 'failed';
    node.lastFailure = { category: failure.category, summary: reason, at: Date.now() };
  }
  const canReplan = !failure.needsUser && routeFailures <= 2 && run.adaptivePlanGraph;
  const action = failure.needsUser ? 'await_user' : canReplan ? 'replan' : 'blocked';
  if (canReplan) {
    const priorFingerprint = node?.strategy?.fingerprint || step.id;
    run.adaptivePlanGraph = adaptivePlan.applyAdaptivePlanRevision(run.adaptivePlanGraph, {
      trigger: 'failure',
      reason: `步骤“${step.title}”失败，归因为 ${failure.category}。保留已完成证据，下一轮必须由模型选择不同工具、来源、参数或实现策略。`,
      operations: [{ type: 'switch_route', nodeId: step.id, category: failure.category, reason,
        strategy: { routeId: `adaptive-recovery-${failure.category}-${routeFailures}`,
          description: `Do not repeat ${priorFingerprint}. Select a materially different tool, source, parameter set, implementation method, or qualified owner based on the current evidence.`,
          fingerprint: `${priorFingerprint}:recovery:${failure.category}:${routeFailures}` } }],
    }, { run });
    run.steps = adaptivePlan.projectGraphToTaskSteps(run.adaptivePlanGraph, run.steps);
  }
  run.status = action === 'replan' ? 'queued' : action === 'await_user' ? 'awaiting_user' : 'failed';
  run.phase = action === 'replan' ? 'preflight' : action === 'await_user' ? 'awaiting_user' : 'blocked';
  run.lastError = action === 'replan' ? undefined : reason;
  run.handoff = { ts: Date.now(), completed: run.steps.filter((item) => item.status === 'completed').map((item) => item.title), blocked: reason,
    nextAction: action === 'replan' ? '系统已保留现有成果并修订计划，下一轮将使用本质不同的路线继续。'
      : action === 'await_user' ? '只需补充提示中的账号、授权或业务选择，完成后会从当前节点继续。'
        : '当前路线已经达到自主恢复边界，请查看明确阻塞点后决定是否调整目标或能力。' };
  if (run.recoveryContext) {
    run.recoveryContext.summary = action === 'replan'
      ? `${input.memberName || '当前员工'}的当前路线失败，计划已局部修订并准备换路线。`
      : `${input.memberName || '当前员工'}的步骤被阻塞，主进程已保留上下文。`;
    run.recoveryContext.unresolvedIssues = [...run.recoveryContext.unresolvedIssues, reason].slice(-20);
    run.recoveryContext.interruptedAt = Date.now();
    run.recoveryContext.interruptionReason = reason;
    run.recoveryContext.autoResume = action === 'replan';
    run.recoveryContext.waitingFor = action === 'await_user' ? reason : undefined;
  }
  return { action, failure, routeFailures, reason };
}

function buildStaffingPlanRevision(additions, input = {}) {
  const affectedNodeIds = Array.isArray(input.affectedNodeIds) ? input.affectedNodeIds.map((id) => text(id, 180)).filter(Boolean) : [];
  const acceptanceCriteria = Array.isArray(input.acceptanceCriteria) ? input.acceptanceCriteria.map((item) => text(item, 800)).filter(Boolean) : [];
  const reason = text(input.reason) || `运行中新增团队成员：${additions.map((member) => text(member.name || member.id, 120)).join('、')}`;
  return { trigger: 'staffing', reason, operations: additions.map((member) => ({ type: 'register_member', employeeId: member.id,
    employeeName: text(member.name, 200), reason, affectedNodeIds, acceptanceCriteria })) };
}

module.exports = { markAdaptiveStepStarted, applyAdaptiveStepFailure, buildStaffingPlanRevision };
