const ADAPTER_PROTOCOL_VERSION = 1;
const CHECKPOINT_KINDS = new Set(['step_started', 'step_completed', 'step_failed', 'run_failed', 'run_finished']);

function normalizeCheckpoint(input, currentSequence = 0, now = Date.now()) {
  const protocolVersion = Number(input?.protocolVersion) || ADAPTER_PROTOCOL_VERSION;
  if (protocolVersion !== ADAPTER_PROTOCOL_VERSION) throw new Error(`不支持的执行适配器协议版本：${protocolVersion}`);
  const kind = String(input?.kind || '');
  if (!CHECKPOINT_KINDS.has(kind)) throw new Error(`未知执行检查点：${kind || '空'}`);
  const sequence = Number(input?.sequence);
  if (!Number.isInteger(sequence) || sequence !== currentSequence + 1) throw new Error(`执行检查点序号必须连续递增，期望 ${currentSequence + 1}`);
  const stepId = input?.stepId ? String(input.stepId) : undefined;
  if (kind.startsWith('step_') && !stepId) throw new Error('步骤检查点缺少 stepId');
  return {
    protocolVersion: ADAPTER_PROTOCOL_VERSION,
    checkpointId: String(input?.checkpointId || `checkpoint-${now}-${sequence}`),
    sequence,
    kind,
    stepId,
    occurredAt: Number(input?.occurredAt) || now,
    summary: String(input?.summary || '').slice(0, 800),
    finalStatus: input?.finalStatus ? String(input.finalStatus) : undefined,
  };
}

function applyCheckpoint(run, checkpoint) {
  const step = checkpoint.stepId ? run.steps.find((item) => item.id === checkpoint.stepId) : undefined;
  if (checkpoint.stepId && !step) throw new Error(`找不到执行步骤：${checkpoint.stepId}`);
  if (step && !Array.isArray(step.events)) step.events = [];
  if (checkpoint.kind === 'step_started') {
    step.status = 'running';
    step.startedAt = step.startedAt || checkpoint.occurredAt;
    step.attempts = Math.max(1, Number(step.attempts) || 0);
    step.events.push({ ts: checkpoint.occurredAt, type: 'status', detail: checkpoint.summary || '执行适配器已开始步骤' });
  } else if (checkpoint.kind === 'step_completed') {
    step.status = 'completed';
    step.completedAt = checkpoint.occurredAt;
    step.lastError = undefined;
    step.events.push({ ts: checkpoint.occurredAt, type: 'result', detail: checkpoint.summary || '执行适配器已完成步骤' });
  } else if (checkpoint.kind === 'step_failed') {
    step.status = 'failed';
    step.lastError = checkpoint.summary || '执行适配器步骤失败';
    step.events.push({ ts: checkpoint.occurredAt, type: 'error', detail: step.lastError });
  } else if (checkpoint.kind === 'run_failed') {
    run.status = 'failed';
    run.phase = 'blocked';
    run.lastError = checkpoint.summary || '执行适配器任务失败';
  } else if (checkpoint.kind === 'run_finished') {
    const finalStatus = ['completed', 'failed', 'paused', 'stopped'].includes(checkpoint.finalStatus)
      ? checkpoint.finalStatus
      : 'completed';
    run.status = finalStatus;
    run.phase = finalStatus === 'completed' ? 'completed' : 'blocked';
    if (finalStatus === 'completed') run.lastError = undefined;
  }
  return run;
}

module.exports = { ADAPTER_PROTOCOL_VERSION, CHECKPOINT_KINDS, normalizeCheckpoint, applyCheckpoint };
