function errorResult(error) {
  return { ok: false, error: error?.message ?? String(error) };
}

function createSafeHandler(handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResult(error);
    }
  };
}

function registerTaskServiceIpc(ipcMain, taskService) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new Error('TaskService IPC requires ipcMain');
  if (!taskService) throw new Error('TaskService IPC requires taskService');

  const register = (channel, handler) => ipcMain.handle(channel, createSafeHandler(handler));
  register('task-service:read', (_event, options) => taskService.read(options));
  register('task-service:create', (_event, input) => taskService.create(input));
  register('task-service:update', (_event, input) => taskService.update(
    input?.taskId,
    (task) => Object.assign(task, input?.patch || {}),
    input?.detail || '统一任务服务更新任务',
  ));
  register('task-service:tool-attempt', (_event, input) => taskService.recordToolAttempt(input?.taskId, input));
  register('task-service:artifact', (_event, input) => taskService.addArtifact(input?.taskId, input));
  register('task-service:reference', (_event, input) => taskService.addReference(input?.taskId, input));
  register('task-service:create-child', (_event, input) => taskService.createChild(input?.parentTaskId, input));
  register('task-service:context', (_event, input) => taskService.context(input?.taskId, input));
  register('task-service:ready-steps', (_event, taskId) => taskService.readySteps(taskId));
  register('task-service:complete-step', (_event, input) => taskService.completeStep(input?.taskId, input));
  register('task-service:review-decision', (_event, input) => taskService.recordReviewDecision(input?.taskId, input));
  register('task-service:fail-step', (_event, input) => taskService.failStep(input?.taskId, input));
  register('task-service:request-approval', (_event, input) => taskService.requestApproval(input?.taskId, input));
  register('task-service:decide-approval', (_event, input) => taskService.decideApproval(input?.taskId, input));
  register('task-service:usage', (_event, input) => taskService.recordUsage(input?.taskId, input));
  register('task-service:metrics', (_event, taskId) => taskService.metrics(taskId));
  register('task-service:tree', (_event, taskId) => taskService.tree(taskId));
  register('task-service:recovery-plan', (_event, taskId) => taskService.recoveryPlan(taskId));
  register('task-service:heartbeat', (_event, input) => taskService.heartbeat(input?.taskId, input));
  register('task-service:lifecycle', (_event, input) => taskService.recordLifecycle(input?.taskId, input));
  register('task-service:checkpoint', (_event, input) => taskService.recordCheckpoint(input?.taskId, input));
  register('task-service:verification', (_event, input) => taskService.recordVerification(input?.taskId, input));
  register('task-service:validate-completion', (_event, taskId) => taskService.validateCompletion(taskId));
  register('task-service:status', (_event, input) => taskService.setStatus(input?.taskId, input?.status, input?.detail));
}

module.exports = { createSafeHandler, registerTaskServiceIpc };
