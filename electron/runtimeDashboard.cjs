const TERMINAL = new Set(['completed', 'failed', 'stopped']);
const NOISY_EVENT = /(?:heartbeat|lease|command_(?:submitted|completed)|task_changed)$/iu;

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function text(value, limit = 500) { return String(value ?? '').trim().slice(0, limit); }

function runProjectKey(run) {
  return text(run?.projectId || run?.rootTaskId || run?.parentTaskId || run?.id, 240);
}

function selectProject(runs, options = {}) {
  const requested = text(options.projectId, 240);
  if (requested) return requested;
  const taskId = text(options.taskId, 240);
  const selectedTask = taskId ? runs.find((run) => run.id === taskId) : undefined;
  if (selectedTask) return runProjectKey(selectedTask);
  const active = runs.find((run) => !TERMINAL.has(run.status));
  return active ? runProjectKey(active) : runProjectKey(runs[0]);
}

function employeeName(run, employeeId) {
  const member = (run.memberSnapshot || []).find((item) => String(item.id) === String(employeeId));
  return text(member?.name || member?.title || employeeId || '未分配负责人', 120);
}

function buildRuntimeDashboard(runsInput = [], telemetryInput = [], options = {}) {
  const runs = [...runsInput].sort((left, right) => (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0));
  const projectKey = selectProject(runs, options);
  const projectRuns = projectKey ? runs.filter((run) => runProjectKey(run) === projectKey) : [];
  const taskIds = new Set(projectRuns.map((run) => run.id));
  const telemetry = telemetryInput.filter((event) => taskIds.has(event.taskId) || (projectKey && event.projectId === projectKey));
  const statusCounts = projectRuns.reduce((counts, run) => {
    counts[run.status] = (counts[run.status] || 0) + 1;
    return counts;
  }, {});

  const activeWork = projectRuns.flatMap((run) => (run.steps || [])
    .filter((step) => run.status === 'running' && step.status === 'running')
    .map((step) => ({
      taskId: run.id,
      stepId: step.id,
      actorId: step.employeeId,
      actorName: employeeName(run, step.employeeId),
      title: text(step.title || run.title, 240),
      activity: text(run.worker?.activity || step.events?.at(-1)?.detail || step.assignment || step.title, 500),
      startedAt: Number(step.startedAt) || Number(run.updatedAt) || Date.now(),
    }))).slice(0, 12);

  const approvals = projectRuns.flatMap((run) => (run.approvals || [])
    .filter((approval) => approval.status === 'pending')
    .map((approval) => ({
      taskId: run.id,
      approvalId: approval.approvalId || approval.id,
      title: text(approval.title || `确认“${run.title}”的受控操作`, 240),
      reason: text(approval.reason || run.recoveryContext?.waitingFor || run.handoff?.blocked, 800),
      requestedBy: text(approval.requestedBy || employeeName(run, approval.employeeId), 160),
      scope: text(approval.scope || 'operation', 80),
      createdAt: Number(approval.requestedAt || approval.createdAt || run.updatedAt) || Date.now(),
    }))).slice(0, 12);

  const waitingConditions = projectRuns.filter((run) => run.status === 'awaiting_user' && !(run.approvals || []).some((approval) => approval.status === 'pending'))
    .map((run) => ({
      taskId: run.id,
      title: text(run.title, 240),
      reason: text(run.recoveryContext?.waitingFor || run.handoff?.blocked || run.recoveryContext?.summary || '任务在等待外部条件，但没有有效审批卡。', 800),
    })).slice(0, 8);

  const meaningfulEvents = telemetry
    .filter((event) => !NOISY_EVENT.test(String(event.type || '')))
    .slice(0, 20)
    .map((event) => clone(event));
  const root = projectRuns.find((run) => !run.parentTaskId) || projectRuns[0];
  const artifacts = projectRuns.reduce((sum, run) => sum + (run.artifacts || []).length, 0);
  const verifiedArtifacts = projectRuns.reduce((sum, run) => sum + (run.artifacts || []).filter((artifact) => artifact.verified === true).length, 0);
  const completedSteps = projectRuns.reduce((sum, run) => sum + (run.steps || []).filter((step) => step.status === 'completed').length, 0);
  const totalSteps = projectRuns.reduce((sum, run) => sum + (run.steps || []).filter((step) => step.compensationOnly !== true).length, 0);

  return {
    ok: true,
    generatedAt: Date.now(),
    project: projectKey ? {
      projectId: root?.projectId || projectKey,
      rootTaskId: root?.id,
      title: text(root?.title || root?.goal || root?.request || projectKey, 240),
      phase: text(root?.phase || (activeWork.length ? 'executing' : 'idle'), 80),
      lastMeaningfulAction: meaningfulEvents[0]?.public?.summary || activeWork[0]?.activity || text(root?.recoveryContext?.summary, 500),
    } : undefined,
    counts: {
      total: projectRuns.length,
      completed: statusCounts.completed || 0,
      running: statusCounts.running || 0,
      queued: statusCounts.queued || 0,
      waitingUser: statusCounts.awaiting_user || 0,
      paused: statusCounts.paused || 0,
      failed: statusCounts.failed || 0,
      stopped: statusCounts.stopped || 0,
      completedSteps,
      totalSteps,
      artifacts,
      verifiedArtifacts,
    },
    approvals,
    waitingConditions,
    activeWork,
    meaningfulEvents,
    technical: {
      telemetryEvents: telemetry.length,
      errors: telemetry.filter((event) => event.severity === 'error').length,
      warnings: telemetry.filter((event) => event.severity === 'warning').length,
      latest: telemetry.slice(0, 30).map((event) => clone(event)),
    },
  };
}

module.exports = { buildRuntimeDashboard, runProjectKey };
