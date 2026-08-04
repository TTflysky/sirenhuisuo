const crypto = require('crypto');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value, limit = 4000) {
  return String(value ?? '').trim().slice(0, limit);
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function appendEvent(task, type, detail, payload = {}) {
  task.serviceEvents = Array.isArray(task.serviceEvents) ? task.serviceEvents : [];
  task.serviceEvents.push({ ts: Date.now(), type, detail: text(detail, 1000), payload: clone(payload) });
  task.serviceEvents = task.serviceEvents.slice(-500);
}

function createTaskServiceApprovalCommands(update) {
  async function requestApproval(taskId, input = {}) {
    const approval = {
      id: text(input.id, 180) || id('approval'),
      stepId: text(input.stepId, 160) || undefined,
      scope: text(input.scope, 120) || 'task',
      reason: text(input.reason, 1600),
      requestedBy: text(input.requestedBy, 180) || 'assistant',
      status: 'pending',
      requestedAt: Date.now(),
    };
    if (!approval.reason) throw new Error('TaskService: approval reason is required');
    return update(taskId, (task) => {
      task.approvals = Array.isArray(task.approvals) ? task.approvals : [];
      task.approvals.push(approval);
      task.status = 'awaiting_user';
      task.phase = 'awaiting_user';
      task.waitingFor = approval.reason;
      appendEvent(task, 'approval_requested', `等待授权：${approval.reason}`, { approvalId: approval.id, stepId: approval.stepId });
    }, '任务请求人工授权');
  }

  async function decideApproval(taskId, input = {}) {
    const decision = input.decision === 'approved' ? 'approved' : input.decision === 'rejected' ? 'rejected' : '';
    if (!decision) throw new Error('TaskService: approval decision must be approved or rejected');
    return update(taskId, (task) => {
      const approval = (task.approvals || []).find((item) => item.id === input.approvalId && item.status === 'pending');
      if (!approval) throw new Error(`找不到待处理授权：${input.approvalId}`);
      approval.status = decision;
      approval.decidedAt = Date.now();
      approval.decidedBy = text(input.decidedBy, 180) || 'user';
      approval.note = text(input.note, 1000) || undefined;
      task.waitingFor = undefined;
      const approvedCompensation = decision === 'approved' && approval.scope === 'compensation';
      task.status = decision === 'approved' ? (approvedCompensation ? 'paused' : 'queued') : 'failed';
      task.phase = decision === 'approved' ? (approvedCompensation ? 'awaiting_user' : 'preflight') : 'blocked';
      if (approvedCompensation && task.handoff?.compensation?.compensateStepId === approval.stepId) task.handoff = undefined;
      if (decision === 'rejected') task.lastError = approval.note || '用户拒绝了任务授权';
      appendEvent(task, `approval_${decision}`, `授权${decision === 'approved' ? '通过' : '拒绝'}`, { approvalId: approval.id });
    }, '记录人工授权决定');
  }

  return { requestApproval, decideApproval };
}

module.exports = { createTaskServiceApprovalCommands };
