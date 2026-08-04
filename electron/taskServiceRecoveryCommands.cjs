function createTaskServiceRecoveryCommands(update, options = {}) {
  const {
    text,
    clone,
    updateStep,
    appendServiceEvent,
    loadAdaptivePlan,
    synchronizeTaskFromAdaptiveGraph,
    classifyFailure,
  } = options;
  if (typeof update !== 'function') throw new Error('TaskService recovery commands require update');
  if (![text, clone, updateStep, appendServiceEvent, loadAdaptivePlan, synchronizeTaskFromAdaptiveGraph, classifyFailure].every((item) => typeof item === 'function')) {
    throw new Error('TaskService recovery commands require service helpers');
  }

  async function recordReviewDecision(taskId, input = {}) {
    const reviewStepId = text(input.reviewStepId || input.stepId, 160);
    const responsibleStepId = text(input.responsibleStepId, 160);
    const approved = input.approved === true;
    const reason = text(input.reason, 1200) || (approved ? 'Review passed' : 'Review rejected');
    if (!reviewStepId) throw new Error('TaskService: reviewStepId is required');
    const adaptive = await loadAdaptivePlan();
    return update(taskId, (task) => {
      const review = updateStep(task, reviewStepId, (step) => {
        if (step.kind !== 'review') throw new Error(`TaskService: ${reviewStepId} is not a review step`);
        step.status = approved ? 'completed' : 'queued';
        step.output = { review: { decision: approved ? 'pass' : 'reject', reason, responsibleStepId: responsibleStepId || undefined } };
        step.lastError = approved ? undefined : reason;
        step.events = [...(step.events || []), { ts: Date.now(), type: approved ? 'review_passed' : 'review_rejected', detail: reason, responsibleStepId: responsibleStepId || undefined }].slice(-100);
      });
      if (!approved) {
        if (!responsibleStepId) throw new Error('TaskService: responsibleStepId is required for a rejected review');
        const responsible = updateStep(task, responsibleStepId, (step) => {
          if (step.kind === 'review') throw new Error('TaskService: a review cannot reject another review as the responsible work step');
          step.status = 'queued';
          step.lastError = reason;
          step.retryAt = undefined;
          step.events = [...(step.events || []), { ts: Date.now(), type: 'review_rework_requested', detail: reason, reviewStepId }].slice(-100);
        });
        task.status = 'queued';
        task.phase = 'execution';
        task.lastError = reason;
        if (task.adaptivePlanGraph) {
          task.adaptivePlanGraph = adaptive.applyAdaptivePlanRevision(task.adaptivePlanGraph, {
            trigger: 'review',
            reason,
            operations: [{ type: 'reopen_node', nodeId: responsibleStepId, reason, category: 'verification' }],
          }, { run: task });
          synchronizeTaskFromAdaptiveGraph(task, adaptive);
        }
        appendServiceEvent(task, 'review_rejected', `Review returned only responsible step: ${responsible.title}`, { reviewStepId, responsibleStepId, reason });
      } else {
        appendServiceEvent(task, 'review_passed', `Review passed: ${review.title}`, { reviewStepId });
      }
    }, approved ? 'Record coding review pass' : 'Return only the responsible coding step');
  }

  async function failStep(taskId, input = {}) {
    const stepId = text(input.stepId, 160);
    if (!stepId) throw new Error('TaskService: stepId is required');
    const reason = text(input.error || input.reason, 1200) || '步骤执行失败';
    const adaptive = await loadAdaptivePlan();
    const classification = input.errorClass ? { category: text(input.errorClass, 120), retryable: input.retryable === true } : classifyFailure(reason);
    return update(taskId, (task) => {
      let retryable = false;
      const step = updateStep(task, stepId, (current) => {
        current.attempts = (Number(current.attempts) || 0) + 1;
        const maxRetries = Number.isInteger(current.maxRetries) ? current.maxRetries : 3;
        const recovery = task.adaptivePlanGraph
          ? adaptive.selectAdaptiveRecovery(task.adaptivePlanGraph, { nodeId: stepId, error: reason, category: classification.category, sameRouteFailures: current.attempts, alternativeStrategy: input.alternativeStrategy, evidenceIds: input.evidenceIds })
          : { action: classification.retryable === true && current.attempts <= maxRetries ? 'retry' : 'discover_alternative' };
        retryable = recovery.action === 'retry' && current.attempts <= maxRetries;
        current.status = retryable ? 'queued' : 'failed';
        current.lastError = reason;
        current.errorClass = classification.category;
        current.retryAt = retryable ? Date.now() + Math.min(300000, Number(recovery.delayMs) || 1000 * (2 ** Math.max(0, current.attempts - 1))) : undefined;
        current.events = Array.isArray(current.events) ? current.events : [];
        current.events.push({ ts: Date.now(), type: retryable ? 'retry_scheduled' : 'failed', detail: reason, errorClass: classification.category, retryable });
        if (task.adaptivePlanGraph) {
          const node = task.adaptivePlanGraph.nodes.find((item) => item.id === stepId);
          if (node) {
            node.attempts = current.attempts;
            node.status = current.status;
            node.lastFailure = { category: classification.category, summary: reason, at: Date.now() };
          }
          if (recovery.action === 'revise') {
            task.adaptivePlanGraph = adaptive.applyAdaptivePlanRevision(task.adaptivePlanGraph, recovery.proposal, { run: task });
            synchronizeTaskFromAdaptiveGraph(task, adaptive);
            retryable = true;
          } else if (recovery.action === 'await_user') {
            current.status = 'paused';
            task.waitingFor = reason;
          }
        }
      });
      task.status = task.waitingFor ? 'awaiting_user' : retryable ? 'queued' : 'failed';
      task.phase = task.waitingFor ? 'awaiting_user' : retryable ? 'preflight' : 'blocked';
      task.lastError = reason;
      appendServiceEvent(task, retryable ? 'step_retry_scheduled' : 'step_failed', `步骤失败：${step.title}`, { stepId, retryable, errorClass: classification.category, adaptivePlanRevision: task.adaptivePlanGraph?.revision });
    }, `记录步骤失败：${stepId}`);
  }

  async function reviseAdaptivePlan(taskId, input = {}) {
    const adaptive = await loadAdaptivePlan();
    return update(taskId, (task) => {
      task.adaptivePlanGraph = adaptive.applyAdaptivePlanRevision(task.adaptivePlanGraph, input, { run: task });
      synchronizeTaskFromAdaptiveGraph(task, adaptive);
      task.status = ['failed', 'paused', 'stopped'].includes(task.status) ? 'queued' : task.status;
      task.phase = task.status === 'queued' ? 'preflight' : task.phase;
      task.lastError = undefined;
      appendServiceEvent(task, 'adaptive_plan_revised', `计划已修订到第 ${task.adaptivePlanGraph.revision} 版`, {
        revision: task.adaptivePlanGraph.revision,
        reason: text(input.reason, 1200),
        affectedNodeIds: task.adaptivePlanGraph.revisionHistory.at(-1)?.affectedNodeIds || [],
      });
    }, '修订自适应计划图');
  }

  async function reassignAdaptiveNode(taskId, input = {}) {
    if (!text(input.nodeId, 180) || !text(input.employeeId, 180) || !text(input.reason, 1200)) throw new Error('TaskService: nodeId, employeeId and reason are required');
    return reviseAdaptivePlan(taskId, {
      trigger: 'staffing',
      reason: input.reason,
      operations: [{ type: 'reassign_node', nodeId: input.nodeId, employeeId: input.employeeId, employeeName: input.employeeName, reason: input.reason }],
    });
  }

  return { recordReviewDecision, failStep, reviseAdaptivePlan, reassignAdaptiveNode };
}

module.exports = { createTaskServiceRecoveryCommands };
