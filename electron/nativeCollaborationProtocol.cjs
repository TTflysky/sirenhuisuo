const crypto = require('crypto');
const { isVerifiedArtifact, publicMember, toolKey } = require('./nativeExecutionPolicy.cjs');

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function text(value, limit = 12000) { return String(value ?? '').trim().slice(0, limit); }

function safeArgsForApproval(args) {
  if (!args || typeof args !== 'object') return args;
  const safe = clone(args);
  for (const key of Object.keys(safe)) {
    if (/key|token|password|secret|credential/iu.test(key)) safe[key] = '[REDACTED]';
  }
  return safe;
}

function taskApprovalContract(job, run, step, member, name, args, request = {}) {
  const approvalKey = toolKey(name, args);
  return {
    approvalVersion: 1,
    id: `approval-${job.taskId}-${crypto.randomUUID()}`,
    taskId: job.taskId,
    stepId: step.id,
    requestedById: member.id,
    requestedByName: member.name,
    title: text(request.title || `允许 ${member.name} 执行下一步`, 160),
    purpose: text(request.purpose || step.assignment || run.goal || run.request, 700),
    action: text(request.action || `${name} ${JSON.stringify(safeArgsForApproval(args))}`, 700),
    toolName: name,
    approvalKey,
    reads: Array.isArray(request.reads) ? request.reads.map((item) => text(item, 500)).filter(Boolean).slice(0, 12) : [],
    writes: Array.isArray(request.writes) ? request.writes.map((item) => text(item, 500)).filter(Boolean).slice(0, 12) : [],
    risks: Array.isArray(request.risks) ? request.risks.map((item) => text(item, 500)).filter(Boolean).slice(0, 12) : [],
    approveEffect: text(request.approveEffect || '只放行本次完全相同的动作。', 700),
    rejectEffect: text(request.rejectEffect || '不执行该动作，保留当前成果并重新规划。', 700),
    status: 'pending',
    requestedAt: Date.now(),
  };
}

function createNativeCollaborationProtocol(options) {
  const { updateRun, readRun, emit, loadEngineModules, toolRuntime, taskService, jobs, enqueueJob, safeJob } = options;

  async function appendExecutionMessage(job, run, member, content, kind = 'text', tool, extra = {}) {
    const id = `native-message-${job.taskId}-${++job.messageSequence}`;
    const message = {
      id, authorId: member.id, authorName: member.name, roleId: member.role || 'custom', content: text(content, 20000), mentions: [],
      timestamp: Date.now(), kind, discussionId: job.taskId, triggeredBy: 'task', ...(tool ? { tool } : {}),
      ...(run?.conversationId ? { conversationId: run.conversationId } : {}),
      ...clone(extra),
    };
    await updateRun(job.taskId, (next) => {
      if (!Array.isArray(next.executionMessages)) next.executionMessages = [];
      if (!next.executionMessages.some((item) => item.id === id)) next.executionMessages.push(message);
      if (next.executionMessages.length > 300) next.executionMessages = next.executionMessages.slice(-300);
    }, `${member.name}写入原生执行消息`);
    emit(job, 'message', { stepId: job.currentStepId, member: publicMember(member), message });
    return message;
  }

  function evidenceFromTool(result, member, name) {
    const now = Date.now();
    const evidence = [];
    for (const artifact of result.structuredEvidence?.artifacts || []) {
      const verified = isVerifiedArtifact(artifact);
      evidence.push({ ts: now, source: 'tool', kind: 'file', summary: `${artifact.filename || artifact.path} · ${artifact.bytes || 0} 字节 · ${verified ? '已验证' : '未验证'}`, verified, artifact });
    }
    if (result.structuredEvidence?.command) evidence.push({ ts: now, source: 'tool', kind: 'run', summary: `${name}：退出码 ${result.structuredEvidence.command.exitCode}`, verified: result.success === true });
    if (result.structuredEvidence?.connection) evidence.push({ ts: now, source: 'connector', kind: 'connection', summary: `${result.structuredEvidence.connection.connectorLabel}：${result.output.slice(0, 240)}`, verified: result.structuredEvidence.connection.verified === true });
    if (result.structuredEvidence?.review) evidence.push({ ts: now, source: 'review', kind: 'review', summary: `${result.structuredEvidence.review.decision === 'pass' ? '审查通过' : '审查退回'}：${result.structuredEvidence.review.reason}`, verified: result.structuredEvidence.review.decision === 'pass', review: result.structuredEvidence.review });
    if (!evidence.length) evidence.push({ ts: now, source: 'tool', kind: 'progress', summary: `${member.name} 调用 ${name}：${result.output.slice(0, 240)}`, verified: result.success === true });
    if (result.structuredEvidence?.skill) evidence.push({ ts: now, source: 'tool', kind: 'operation', summary: `${name}: ${result.structuredEvidence.skill.name || result.structuredEvidence.skill.id || 'skill'}`, verified: result.structuredEvidence.skill.verified === true });
    return evidence;
  }

  async function recordTool(job, run, step, member, name, args, result) {
    const { contextRouter } = await loadEngineModules();
    const safeArgs = toolRuntime.redact(args);
    const safeResult = { ...result, output: String(toolRuntime.redact(result.output)) };
    const evidence = evidenceFromTool(safeResult, member, name);
    job.toolCalls += 1;
    if (taskService) {
      const taskRecords = [
        { taskId: job.taskId, stepId: step.id, suffix: 'root' },
        ...(step.responsibilityTaskId ? [{ taskId: step.responsibilityTaskId, stepId: 'step-1', suffix: 'responsibility' }] : []),
      ];
      for (const record of taskRecords) {
        await taskService.recordToolAttempt(record.taskId, {
          id: `attempt-${job.taskId}-${step.id}-${job.toolCalls}-${record.suffix}`, stepId: record.stepId, toolName: name,
          status: result.success === true ? 'succeeded' : 'failed',
          errorClass: result.success === true ? undefined : (result.errorCategory || result.error?.category || 'unknown'),
          inputSummary: JSON.stringify(safeArgs), outputSummary: safeResult.output,
          evidenceIds: evidence.map((item) => item.artifact?.path || item.summary).slice(0, 12),
          startedAt: result.startedAt, finishedAt: result.completedAt,
        }).catch(() => {});
        for (const artifact of safeResult.structuredEvidence?.artifacts || []) {
          if (!artifact.path && !artifact.diskPath) continue;
          await taskService.addArtifact(record.taskId, {
            id: `${record.taskId}:${artifact.path || artifact.diskPath}`,
            name: artifact.filename || artifact.path || artifact.diskPath,
            path: artifact.path || artifact.diskPath, diskPath: artifact.diskPath,
            workspaceId: artifact.workspaceId || run.workspaceId, category: artifact.category,
            verified: artifact.verified === true, source: name,
          }).catch(() => {});
        }
      }
    }
    await updateRun(job.taskId, (next) => {
      const current = next.steps.find((item) => item.id === step.id);
      if (!current) return;
      current.events ||= [];
      current.events.push({ ts: Date.now(), type: result.success ? 'tool' : 'error', detail: `${name} ${JSON.stringify(safeArgs).slice(0, 500)} → ${safeResult.output.slice(0, 800)}` });
      current.evidence = [...(current.evidence || []), ...evidence].slice(-30);
      next.evidence = [...(next.evidence || []), ...evidence].slice(-120);
      if (next.recoveryContext) {
        next.recoveryContext.budget = contextRouter.recordContextUsage(next.recoveryContext.budget, { toolAttempts: 1, progress: result.success === true });
        if (result.success) next.recoveryContext.completedEvidence = [...next.recoveryContext.completedEvidence, evidence.map((item) => item.summary).join('；')].slice(-30);
        else next.recoveryContext.unresolvedIssues = [...next.recoveryContext.unresolvedIssues, `${name}：${safeResult.output.slice(0, 320)}`].slice(-20);
      }
      next.recoveryCapsule = contextRouter.createRecoveryCapsule(next, { reason: `工具 ${name} 执行后检查点` });
    }, `${member.name}原生调用 ${name}`);
    const report = `**${member.name}** 调用 **${name}**\n${JSON.stringify(safeArgs)}\n\n${result.success ? '成功' : '失败'}：${safeResult.output}`;
    await appendExecutionMessage(job, run, member, report, 'execution', { name, args: safeArgs, success: result.success }, { stepId: step.id });
    emit(job, 'tool_result', {
      stepId: step.id, teamId: run.teamId, workspaceId: run.workspaceId, member: publicMember(member),
      toolName: name, arguments: safeArgs, success: result.success,
      failureClass: result.success === true ? undefined : (result.errorCategory || result.error?.category),
      output: safeResult.output.slice(0, 1200),
      artifacts: (safeResult.structuredEvidence?.artifacts || []).map((artifact) => ({ ...artifact })),
    });
  }

  async function requestToolApproval(job, run, step, member, name, args, result) {
    const approval = taskApprovalContract(job, run, step, member, name, args, result.approvalRequest);
    await updateRun(job.taskId, (next) => {
      next.pendingApproval = approval;
      next.approvals ||= [];
      next.handoff = {
        ts: Date.now(), completed: next.steps.filter((item) => item.status === 'completed').map((item) => item.title),
        blocked: `${approval.requestedByName}申请：${approval.title}`,
        nextAction: '请查看授权卡中的目的、读取范围、写入范围和风险，再决定允许或拒绝。',
        resumeCondition: `授权 ${approval.id} 已处理`,
      };
      if (next.recoveryContext) {
        next.recoveryContext.summary = `正在等待你决定“${approval.title}”。`;
        next.recoveryContext.waitingFor = approval.title;
        next.recoveryContext.autoResume = false;
      }
    }, `记录结构化授权请求 ${approval.id}`);
    await appendExecutionMessage(job, run, { id: 'assistant', name: '章北海助理', role: 'custom' },
      `${approval.requestedByName}需要你的授权后才能继续“${step.title}”。`, 'approval', undefined, { approval, stepId: step.id });
    emit(job, 'approval_requested', { stepId: step.id, approval, member: publicMember(member), toolName: name });
    return approval;
  }

  async function appendStageSummary(job, run, step, member, result) {
    const latest = await readRun(job.taskId);
    const current = latest.steps.find((item) => item.id === step.id) || step;
    const remainingSteps = latest.steps.filter((item) => item.status !== 'completed' && item.id !== step.id && item.compensationOnly !== true);
    const nextStep = remainingSteps.find((candidate) => (candidate.dependsOnStepIds || []).every((dependency) => latest.steps.find((item) => item.id === dependency)?.status === 'completed'));
    const nextOwner = nextStep ? job.members.get(nextStep.employeeId) : undefined;
    const evidence = (current.evidence || []).filter((item) => item.verified === true).map((item) => text(item.summary, 500)).slice(-8);
    const operations = (current.events || []).slice(-20).map((event) => ({ ts: Number(event.ts) || Date.now(), type: event.type || 'status', detail: text(event.detail, 1200), success: event.type !== 'error' }));
    const summary = {
      summaryVersion: 1, id: `stage-summary-${job.taskId}-${step.id}-${Date.now()}`, taskId: job.taskId, stepId: step.id,
      stageTitle: step.title, ownerId: member.id, ownerName: member.name, status: 'completed',
      problem: text(step.assignment || latest.goal || latest.request, 900),
      rationale: (step.dependsOnStepIds || []).length
        ? `该阶段依赖前置成果，完成后才能把经过验证的结果交给${nextOwner?.name || '下一位负责人'}。`
        : `这是当前计划中最先可执行的阶段，用来为${nextOwner?.name || '后续工作'}建立可验证依据。`,
      completed: [text(result.content, 900)].filter(Boolean), evidence,
      remaining: remainingSteps.map((item) => item.title).slice(0, 12),
      nextOwnerId: nextOwner?.id, nextOwnerName: nextOwner?.name,
      nextAction: nextStep ? `下一步由${nextOwner?.name || '下一位成员'}处理“${nextStep.title}”。` : '所有计划阶段已完成，接下来进入整体交付与最终验收。',
      durationMs: Math.max(0, Number(current.completedAt || Date.now()) - Number(current.startedAt || latest.createdAt || Date.now())),
      operations, createdAt: Date.now(),
    };
    await updateRun(job.taskId, (next) => {
      next.stageSummaries = [...(next.stageSummaries || []).filter((item) => item.stepId !== step.id), summary].slice(-80);
    }, `记录阶段总结 ${step.id}`);
    await appendExecutionMessage(job, latest, { id: 'assistant', name: '章北海助理', role: 'custom' },
      `${member.name}已完成“${step.title}”。${summary.nextAction}`, 'stage_summary', undefined, { stageSummary: summary, stepId: step.id });
  }

  async function decideApproval(taskId, approvalId, decision, note = '') {
    const normalizedTaskId = String(taskId || '');
    const normalizedDecision = decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : '';
    if (!normalizedTaskId || !approvalId || !normalizedDecision) return { ok: false, error: '授权决定参数不完整' };
    const current = await readRun(normalizedTaskId).catch(() => undefined);
    const pending = current?.pendingApproval;
    if (!pending || pending.id !== approvalId || pending.status !== 'pending') return { ok: false, error: '找不到待处理的授权请求' };
    const decidedAt = Date.now();
    const decided = { ...pending, status: normalizedDecision, decidedAt, note: text(note, 700) || undefined };
    await updateRun(normalizedTaskId, (run) => {
      run.approvals = [...(run.approvals || []).filter((item) => item.id !== decided.id), decided].slice(-80);
      run.pendingApproval = undefined;
      run.executionMessages = (run.executionMessages || []).map((message) => message.approval?.id === decided.id ? { ...message, approval: decided } : message);
      run.lastError = undefined;
      const step = run.steps.find((item) => item.id === decided.stepId);
      if (step && ['paused', 'failed', 'running'].includes(step.status)) step.status = 'queued';
      run.status = 'queued';
      run.phase = 'executing';
      run.handoff = {
        ts: decidedAt, completed: run.steps.filter((item) => item.status === 'completed').map((item) => item.title), blocked: '',
        nextAction: normalizedDecision === 'approved'
          ? `授权已通过，${decided.requestedByName}将继续当前步骤。`
          : '授权已拒绝，章北海会保留当前成果并改用不需要该权限的路线。',
      };
      if (run.recoveryContext) {
        run.recoveryContext.summary = run.handoff.nextAction;
        run.recoveryContext.waitingFor = undefined;
        run.recoveryContext.autoResume = true;
        if (normalizedDecision === 'rejected') run.recoveryContext.steeringMessages = [...(run.recoveryContext.steeringMessages || []), `用户拒绝授权“${decided.title}”，必须改用不需要该权限的路线。`].slice(-20);
      }
    }, `用户${normalizedDecision === 'approved' ? '批准' : '拒绝'}授权 ${approvalId}`);
    const job = jobs.get(normalizedTaskId);
    if (job) {
      job.approvalGrants ||= new Set();
      job.approvalDenials ||= new Set();
      if (normalizedDecision === 'approved') {
        job.approvalGrants.add(decided.approvalKey);
        job.approvalDenials.delete(decided.approvalKey);
      } else {
        job.approvalGrants.delete(decided.approvalKey);
        job.approvalDenials.add(decided.approvalKey);
        job.steering.push(`用户拒绝授权“${decided.title}”，不得重复申请同一动作，必须选择替代路线。`);
      }
      job.control = undefined;
      job.waitingFor = undefined;
      job.lastError = undefined;
      job.finishedAt = undefined;
      enqueueJob(job, normalizedDecision === 'approved' ? 'approval-granted' : 'approval-rejected-replan');
      await appendExecutionMessage(job, current, { id: 'assistant', name: '章北海助理', role: 'custom' },
        normalizedDecision === 'approved'
          ? `授权已通过：${decided.title}。团队将从当前步骤继续。`
          : `授权已拒绝：${decided.title}。我会保留现有成果并重新安排替代路线。`, 'text');
      emit(job, `approval_${normalizedDecision}`, { approval: decided });
    }
    return { ok: true, approval: decided, job: job ? safeJob(job) : undefined };
  }

  return { appendExecutionMessage, recordTool, requestToolApproval, appendStageSummary, decideApproval };
}

module.exports = { createNativeCollaborationProtocol };
