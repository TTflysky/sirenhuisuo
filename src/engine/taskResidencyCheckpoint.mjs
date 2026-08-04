const RESIDENCY_VERSION = 1;

function text(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stable(value[key])]));
}

function checksum(value) {
  const source = JSON.stringify(stable(value));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
}

function unique(values) {
  return [...new Set(values.map((value) => text(value, 220)).filter(Boolean))].sort();
}

function completedStepIds(run) {
  return unique((run?.steps || []).filter((step) => step.status === 'completed').map((step) => step.id));
}

function verifiedEvidenceIds(run) {
  const runEvidence = (run?.evidence || []).filter((item) => item.verified).map((item) => item.id || item.summary);
  const stepEvidence = (run?.steps || []).flatMap((step) => (step.evidence || []).filter((item) => item.verified).map((item) => item.id || item.summary));
  return unique([...runEvidence, ...stepEvidence]);
}

function nextExecutableStepId(run) {
  const steps = run?.steps || [];
  const completed = new Set(completedStepIds(run));
  const running = steps.find((step) => step.status === 'running');
  if (running) return text(running.id, 220) || undefined;
  return text(steps.find((step) => ['queued', 'paused', 'failed'].includes(step.status)
    && (step.dependsOnStepIds || []).every((id) => completed.has(String(id))))?.id, 220) || undefined;
}

function goalIdentity(run) {
  const goalId = text(run?.goalState?.goalId || run?.id, 220);
  return {
    goalId,
    goalHash: checksum({
      goalId,
      goalVersion: Number(run?.goalState?.goalVersion) || 1,
      goal: text(run?.goalState?.goal || run?.goal || run?.request, 8000),
      acceptanceCriteria: (run?.acceptanceCriteria || run?.goalState?.successCriteria || []).map((item) => text(item, 1000)),
    }),
  };
}

function planIdentity(run) {
  const graph = run?.adaptivePlanGraph;
  const plan = run?.plan;
  const steps = graph?.nodes || plan?.steps || run?.steps || [];
  const planId = text(graph?.graphId || plan?.planId || run?.contract?.contractId || `plan-${run?.id || 'unknown'}`, 220);
  const planRevision = Math.max(1, Number(graph?.revision || plan?.revision || plan?.planVersion) || 1);
  const structure = steps.map((step) => ({
    id: text(step.id || step.stepId, 220),
    dependsOn: unique(step.dependsOnStepIds || step.dependsOn || []),
    employeeId: text(step.employeeId || step.responsibleEmployeeId || step.metadata?.employeeId, 220),
    kind: text(step.kind || step.type, 80),
  }));
  return { planId, planRevision, planHash: checksum({ planId, planRevision, structure }) };
}

function contextSummaryHash(run) {
  return checksum({
    recoveryCapsuleChecksum: text(run?.recoveryCapsule?.checksum, 500),
    summary: text(run?.recoveryContext?.summary, 4000),
    unresolvedIssues: (run?.recoveryContext?.unresolvedIssues || []).map((item) => text(item, 1000)),
    steeringMessages: (run?.recoveryContext?.steeringMessages || []).map((item) => text(item, 1000)),
    lifecycleContext: {
      stage: Number(run?.turnLifecycle?.context?.stage) || 0,
      compactions: Number(run?.turnLifecycle?.context?.compactions) || 0,
      estimatedTokens: Number(run?.turnLifecycle?.context?.estimatedTokens) || 0,
      summary: text(run?.turnLifecycle?.context?.summary, 4000),
      unresolvedIssues: (run?.turnLifecycle?.context?.unresolvedIssues || []).map((item) => text(item, 1000)),
    },
    lifecycleSteering: (run?.turnLifecycle?.steering || []).map((item) => ({
      message: text(item?.message ?? item, 1000),
      applied: item?.applied !== false,
    })),
    verifiedFacts: run?.context?.summary?.verifiedFacts || [],
    artifacts: run?.context?.summary?.artifactPaths || [],
  });
}

function checkpointPayload(run, input = {}) {
  return {
    residencyVersion: RESIDENCY_VERSION,
    taskId: text(run?.id, 220),
    ...goalIdentity(run),
    ...planIdentity(run),
    completedStepIds: completedStepIds(run),
    verifiedEvidenceIds: verifiedEvidenceIds(run),
    nextExecutableStepId: nextExecutableStepId(run),
    contextSummaryHash: contextSummaryHash(run),
    checkpointSequence: Math.max(0, Number(input.checkpointSequence ?? run?.worker?.checkpointSequence) || 0),
    updatedAt: Number(input.updatedAt) || Date.now(),
    reason: text(input.reason || '长任务驻留检查点', 500),
  };
}

export function createTaskResidencyCheckpoint(run, input = {}) {
  const payload = checkpointPayload(run, input);
  return { ...payload, checksum: checksum(payload) };
}

export function verifyTaskResidencyCheckpoint(run, checkpoint) {
  const errors = [];
  if (!checkpoint || checkpoint.residencyVersion !== RESIDENCY_VERSION || typeof checkpoint.checksum !== 'string') {
    return { valid: false, errors: ['缺少可校验的长任务恢复检查点'], current: createTaskResidencyCheckpoint(run) };
  }
  const storedPayload = { ...checkpoint };
  delete storedPayload.checksum;
  if (checksum(storedPayload) !== checkpoint.checksum) errors.push('恢复检查点自身校验失败');
  const current = createTaskResidencyCheckpoint(run, { checkpointSequence: checkpoint.checkpointSequence, updatedAt: checkpoint.updatedAt, reason: checkpoint.reason });
  if (checkpoint.taskId !== current.taskId) errors.push('任务身份与检查点不一致');
  if (checkpoint.goalId !== current.goalId || checkpoint.goalHash !== current.goalHash) errors.push('任务目标在检查点后发生变化');
  if (checkpoint.planId !== current.planId || checkpoint.planRevision !== current.planRevision || checkpoint.planHash !== current.planHash) errors.push('任务计划或计划版本在检查点后发生变化');
  if (JSON.stringify(checkpoint.completedStepIds) !== JSON.stringify(current.completedStepIds)) errors.push('已完成步骤记录与当前任务不一致');
  if (JSON.stringify(checkpoint.verifiedEvidenceIds) !== JSON.stringify(current.verifiedEvidenceIds)) errors.push('已验证证据记录与当前任务不一致');
  if (checkpoint.nextExecutableStepId !== current.nextExecutableStepId) errors.push('下一个可执行步骤与检查点不一致');
  if (checkpoint.contextSummaryHash !== current.contextSummaryHash) errors.push('任务上下文摘要在检查点后发生变化');
  if (Number(checkpoint.checkpointSequence) !== Number(run?.worker?.checkpointSequence || 0)) errors.push('Worker 检查点序号与任务记录不一致');
  return { valid: errors.length === 0, errors, current };
}

export function explainResidencyConflict(errors) {
  const items = unique(Array.isArray(errors) ? errors : []);
  return items.length ? `恢复前核对未通过：${items.join('；')}` : '恢复前核对未通过，请检查任务目标、计划和已完成证据。';
}

export const TASK_RESIDENCY_CHECKPOINT_VERSION = RESIDENCY_VERSION;
