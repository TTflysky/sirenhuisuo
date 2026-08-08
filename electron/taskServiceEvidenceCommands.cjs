const { appendEvent, appendDurableStepEvidence, appendNodeEvidenceIds, clone, id, list, text, updateStep } = require('./taskServiceEvidenceHelpers.cjs');

function createTaskServiceEvidenceCommands(update) {
  async function recordToolAttempt(taskId, input = {}) {
    const attempt = {
      id: text(input.id, 180) || id('attempt'),
      stepId: text(input.stepId, 160) || undefined,
      toolName: text(input.toolName, 240),
      status: ['started', 'succeeded', 'failed', 'skipped'].includes(input.status) ? input.status : 'started',
      errorClass: text(input.errorClass, 120) || undefined,
      inputSummary: text(input.inputSummary, 1200),
      outputSummary: text(input.outputSummary, 2000),
      evidenceIds: list(input.evidenceIds),
      startedAt: Number(input.startedAt) || Date.now(),
      finishedAt: Number(input.finishedAt) || undefined,
    };
    if (!attempt.toolName) throw new Error('TaskService: toolName is required');
    return update(taskId, (task) => {
      task.toolAttempts = Array.isArray(task.toolAttempts) ? task.toolAttempts : [];
      const index = task.toolAttempts.findIndex((item) => item.id === attempt.id);
      task.usage = { modelRounds: 0, promptTokens: 0, completionTokens: 0, estimatedTokens: 0, toolCalls: 0, ...(task.usage || {}) };
      task.usage.toolCalls += index >= 0 ? 0 : 1;
      if (index >= 0) task.toolAttempts[index] = { ...task.toolAttempts[index], ...attempt };
      else task.toolAttempts.push(attempt);
      if (attempt.stepId) updateStep(task, attempt.stepId, (step) => {
        step.attempts = Math.max(Number(step.attempts) || 0, task.toolAttempts.filter((item) => item.stepId === attempt.stepId).length);
        step.events = Array.isArray(step.events) ? step.events : [];
        step.events.push({ ts: Date.now(), type: 'tool_attempt', detail: `${attempt.toolName}: ${attempt.status}` });
      });
      if (attempt.stepId) appendNodeEvidenceIds(task, attempt.stepId, attempt.evidenceIds);
      appendEvent(task, 'tool_attempt', `${attempt.toolName} ${attempt.status}`, { attemptId: attempt.id, stepId: attempt.stepId });
    }, '记录工具尝试与结果');
  }

  async function addArtifact(taskId, input = {}) {
    const stepId = text(input.stepId, 160) || undefined;
    const artifact = {
      id: text(input.id, 180) || id('artifact'),
      name: text(input.name || input.path, 500),
      path: text(input.path, 1600),
      diskPath: text(input.diskPath, 1800) || undefined,
      workspaceId: text(input.workspaceId, 800) || undefined,
      bytes: Number.isFinite(Number(input.bytes)) ? Math.max(0, Number(input.bytes)) : undefined,
      contentType: text(input.contentType, 160) || undefined,
      verification: text(input.verification, 120) || undefined,
      category: ['final', 'working', 'reference'].includes(input.category) ? input.category : 'final',
      verified: input.verified === true,
      source: text(input.source, 120) || 'task-service',
      createdAt: Date.now(),
    };
    if (!artifact.name || !artifact.path) throw new Error('TaskService: artifact name and path are required');
    return update(taskId, (task) => {
      task.artifacts = Array.isArray(task.artifacts) ? task.artifacts : [];
      const index = task.artifacts.findIndex((item) => item.id === artifact.id || item.path === artifact.path);
      if (index >= 0) task.artifacts[index] = { ...task.artifacts[index], ...artifact };
      else task.artifacts.push(artifact);
      if (stepId) appendDurableStepEvidence(task, stepId, {
        id: artifact.id,
        ts: artifact.createdAt,
        source: 'system',
        kind: 'file',
        summary: artifact.path,
        verified: artifact.verified,
        artifactId: artifact.id,
      });
      appendEvent(task, 'artifact_registered', `登记交付物：${artifact.name}`, { artifactId: artifact.id, verified: artifact.verified });
    }, '登记任务交付物');
  }

  async function addReference(taskId, input = {}) {
    const reference = {
      kind: text(input.kind, 80) || 'answer',
      id: text(input.id, 500) || id('ref'),
      label: text(input.label, 500),
      sourceUrl: text(input.sourceUrl, 1600) || undefined,
      state: text(input.state, 80) || 'unknown',
      createdAt: Date.now(),
    };
    if (!reference.label) throw new Error('TaskService: reference label is required');
    return update(taskId, (task) => {
      task.references = Array.isArray(task.references) ? task.references : [];
      const index = task.references.findIndex((item) => item.id === reference.id);
      if (index >= 0) task.references[index] = { ...task.references[index], ...reference };
      else task.references.push(reference);
      appendEvent(task, 'reference_bound', `绑定引用：${reference.label}`, { referenceId: reference.id, kind: reference.kind });
    }, '绑定任务上下文引用');
  }

  async function recordUsage(taskId, input = {}) {
    return update(taskId, (task) => {
      task.usage = { modelRounds: 0, promptTokens: 0, completionTokens: 0, estimatedTokens: 0, toolCalls: 0, ...(task.usage || {}) };
      for (const key of ['modelRounds', 'promptTokens', 'completionTokens', 'estimatedTokens', 'toolCalls']) {
        const value = Number(input[key]);
        if (Number.isFinite(value) && value >= 0) task.usage[key] += value;
      }
      appendEvent(task, 'usage_recorded', '记录模型与工具用量', { usage: clone(input) });
    }, '记录任务用量');
  }

  async function recordCheckpoint(taskId, input = {}) {
    const checkpoint = {
      id: text(input.id, 180) || id('checkpoint'),
      kind: text(input.kind, 80) || 'workspace',
      label: text(input.label, 500) || '任务检查点',
      head: text(input.head, 240) || undefined,
      patchSha256: text(input.patchSha256, 160) || undefined,
      workspaceId: text(input.workspaceId, 800) || undefined,
      createdAt: Date.now(),
    };
    return update(taskId, (task) => {
      task.checkpoints = Array.isArray(task.checkpoints) ? task.checkpoints : [];
      task.checkpoints.push(checkpoint);
      if (task.workspace) task.workspace = { ...task.workspace, status: 'ready', workspaceId: checkpoint.workspaceId, lastCheckpointId: checkpoint.id };
      appendEvent(task, 'checkpoint_created', `保存检查点：${checkpoint.label}`, { checkpointId: checkpoint.id });
    }, '记录代码工作树检查点');
  }

  async function recordVerification(taskId, input = {}) {
    const stepId = text(input.stepId, 160) || undefined;
    const verification = {
      id: text(input.id, 180) || id('verification'),
      kind: text(input.kind, 100) || 'command',
      label: text(input.label, 500),
      status: input.status === 'passed' ? 'passed' : input.status === 'blocked' ? 'blocked' : 'failed',
      command: text(input.command, 1200) || undefined,
      detail: text(input.detail, 1600),
      exitCode: Number.isInteger(input.exitCode) ? input.exitCode : undefined,
      createdAt: Date.now(),
    };
    if (!verification.label) throw new Error('TaskService: verification label is required');
    return update(taskId, (task) => {
      task.verifications = Array.isArray(task.verifications) ? task.verifications : [];
      task.verifications.push(verification);
      if (stepId) appendDurableStepEvidence(task, stepId, {
        id: verification.id,
        ts: verification.createdAt,
        source: 'system',
        kind: verification.kind === 'review' ? 'review' : 'run',
        summary: [verification.label, verification.detail].filter(Boolean).join(': '),
        verified: verification.status === 'passed',
        verificationId: verification.id,
      });
      appendEvent(task, 'verification_recorded', `${verification.label}: ${verification.status}`, { verificationId: verification.id });
    }, '记录任务验证结果');
  }

  return { recordToolAttempt, addArtifact, addReference, recordUsage, recordCheckpoint, recordVerification };
}

module.exports = { createTaskServiceEvidenceCommands };
