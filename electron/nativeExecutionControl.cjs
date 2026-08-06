const crypto = require('crypto');

function createNativeExecutionControl(deps) {
  const {
    NATIVE_ADAPTER_VERSION,
    ACTIVE_JOB_STATES,
    options,
    jobs,
    queue,
    observability,
    getActiveJob,
    safeJob,
    clone,
    text,
    refreshQueuePositions,
    enqueueJob,
    enqueueCompensation,
    emit,
    ensureRun,
    bindTeamExecution,
    readRun,
    updateRun,
    runCompensations,
    loadEngineModules,
    formalStep,
    buildStaffingPlanRevision,
  } = deps;

  async function start(input) {
    const taskId = String(input?.taskId || input?.run?.id || '');
    if (!taskId) return { ok: false, error: '原生 Adapter 缺少 taskId' };
    const existing = jobs.get(taskId);
    if (existing && ACTIVE_JOB_STATES.has(existing.state)) return { ok: true, idempotencyHit: true, job: safeJob(existing) };
    let storedRun;
    try {
      storedRun = await ensureRun({ ...input, taskId });
      if (bindTeamExecution && storedRun?.teamId) {
        storedRun = await bindTeamExecution({ taskId, run: storedRun, members: input.members, adapter: 'native-execution-adapter' });
      }
    }
    catch (error) { return { ok: false, error: error?.message || String(error) }; }
    if (storedRun?.worktree && options.worktreeManager) {
      const recovered = await options.worktreeManager.recover(taskId);
      if (!recovered.ok) return { ok: false, error: recovered.error || '任务 Git Worktree 无法恢复' };
      await updateRun(taskId, (next) => { next.workspaceId = recovered.worktree.workspaceId; next.worktree = { ...next.worktree, ...recovered.worktree }; }, '原生 Adapter 恢复 Git Worktree');
    }
    const members = new Map((input.members || []).map((member) => [String(member.id), { ...member, id: String(member.id) }]));
    if (!members.size) return { ok: false, error: '原生 Adapter 没有收到可执行成员与模型配置' };
    const connectorActions = [];
    for (const connector of input.connectors || []) {
      for (const action of connector.discoveredActions || connector.actions || []) {
        connectorActions.push({ name: `connector_${connector.id}_${action.mcpToolName || action.name}`, connectorId: connector.id, action });
      }
    }
    const job = {
      protocolVersion: NATIVE_ADAPTER_VERSION,
      jobId: `native-job-${taskId}-${crypto.randomUUID()}`,
      taskId, state: 'queued', createdAt: Date.now(), updatedAt: Date.now(), lastProgressAt: Date.now(), currentActivity: '等待进入后台队列',
      members, attachments: clone(input.attachments || []), extraSystemContext: text(input.extraSystemContext, 80000),
      reviewModelConfig: clone(input.reviewModelConfig || undefined),
      memoryWriteApproval: input.memoryWriteApproval !== false,
      executionPolicy: clone(input.executionPolicy || { sandboxEnabled: true, approvalMode: 'delegate', connectorApprovalMode: 'delegate' }),
      connectors: clone(input.connectors || []), connectorActions,
      connectorTools: clone(input.connectorTools || []), steering: [], events: [], eventSequence: 0, messageSequence: 0,
      approvalGrants: new Set((storedRun?.approvals || []).filter((item) => item.status === 'approved' || item.status === 'consumed').map((item) => item.approvalKey).filter(Boolean)),
      approvalDenials: new Set((storedRun?.approvals || []).filter((item) => item.status === 'rejected').map((item) => item.approvalKey).filter(Boolean)),
      checkpointSequence: 0, modelRounds: 0, toolCalls: 0,
      claimSequence: 0,
    };
    jobs.set(taskId, job);
    enqueueJob(job, 'submitted');
    return { ok: true, job: safeJob(job) };
  }

  function removeQueuedJob(job) {
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
    refreshQueuePositions();
  }

  function applyJobControl(job, type) {
    if (!job) return false;
    const wasQueued = job.state === 'queued';
    if (type === 'resume') {
      job.control = undefined;
      // The durable worker has already moved a failed/paused run back to
      // queued before this control reaches the in-memory adapter. A failed
      // job is therefore resumable; keeping it terminal here made the UI's
      // "continue" button appear to work while no job was ever re-enqueued.
      if (!['completed', 'stopped'].includes(job.state)) {
        job.state = 'queued';
        job.finishedAt = undefined;
        job.lastError = undefined;
        enqueueJob(job, 'resumed');
      }
      emit(job, 'control_received', { control: 'resume' });
      return false;
    }
    const effectiveType = type === 'close' ? 'stop' : type;
    job.control = effectiveType;
    job.abortController?.abort();
    if (effectiveType === 'pause') job.state = 'paused';
    if (effectiveType === 'stop') job.state = 'stopped';
    removeQueuedJob(job);
    emit(job, 'control_received', { control: type });
    return wasQueued;
  }

  async function cascadeChildControl(parentTaskId, type) {
    if (!['pause', 'resume', 'stop', 'close'].includes(type)) return;
    const snapshot = await options.store.read();
    if (!snapshot.ok) return;
    const descendants = [];
    const pending = [String(parentTaskId)];
    while (pending.length) {
      const ancestorId = pending.shift();
      for (const candidate of snapshot.runs.filter((run) => run.parentTaskId === ancestorId)) {
        if (descendants.some((item) => item.id === candidate.id)) continue;
        descendants.push(candidate);
        pending.push(candidate.id);
      }
    }
    const forwardedType = type === 'close' ? 'stop' : type;
    const controllableDescendants = type === 'resume'
      ? descendants.filter((item) => ['paused', 'failed', 'awaiting_user'].includes(item.status))
      : descendants.filter((item) => !['completed', 'failed', 'stopped'].includes(item.status));
    for (const child of controllableDescendants) {
      const childJob = jobs.get(child.id);
      // Resume the durable state before enqueueing the in-memory job. Doing
      // this in the opposite order lets drainQueue race ahead and attempt to
      // claim a task that is still paused/awaiting_user in the ledger.
      const queuedBeforeControl = forwardedType === 'resume' ? false : applyJobControl(childJob, forwardedType);
      const result = await options.worker.dispatch({
        commandId: `native-cascade-${forwardedType}-${parentTaskId}-${child.id}-${crypto.randomUUID()}`,
        taskId: child.id,
        type: forwardedType,
        requestedBy: `parent-task:${parentTaskId}`,
        sessionId: options.sessionId,
        payload: {},
      });
      if (result?.ok) {
        if (forwardedType === 'resume') applyJobControl(childJob, forwardedType);
        // A queued child has no active execute() catch block to initiate rollback.
        // Complete its declared compensation before the active parent may compensate shared state.
        if (queuedBeforeControl && forwardedType === 'stop' && childJob) {
          await runCompensations(childJob, `Parent task ${parentTaskId} stopped before queued child ${child.id} could run`).catch(() => {});
          emit(childJob, 'queued_child_compensation_finished', { parentTaskId });
        }
      }
    }
    const parentJob = jobs.get(String(parentTaskId));
    if (parentJob && descendants.length) emit(parentJob, 'child_task_control_cascaded', {
      control: type,
      childTaskIds: descendants.map((item) => item.id),
    });
  }

  async function handleControl(command, result) {
    if (!result?.ok) return;
    const taskId = String(command?.taskId || '');
    const type = String(command?.type || '');
    if (!['pause', 'resume', 'stop', 'close'].includes(type)) return;
    const job = jobs.get(taskId);
    if (type === 'resume' && job?.state === 'stopped') {
      try {
        const run = await readRun(taskId);
        const approvedCompensationStepIds = new Set((run?.approvals || [])
          .filter((approval) => approval.scope === 'compensation' && approval.status === 'approved')
          .map((approval) => approval.stepId)
          .filter(Boolean));
        const hasApprovedBlockedCompensation = (run?.compensation || []).some((item) => (
          item.status === 'awaiting_approval'
          && approvedCompensationStepIds.has(item.compensateStepId)
        ));
        if (hasApprovedBlockedCompensation) {
          // A stopped active job can still be unwinding its original stop
          // signal. Keep this resume on the compensation-only path so that
          // normal queue recovery cannot overwrite the compensation state.
          job.control = undefined;
          enqueueCompensation(job, 'User approved a previously blocked compensation');
          emit(job, 'approved_compensation_resumed', { taskId });
          return;
        }
      } catch (error) {
        emit(job, 'approved_compensation_resume_failed', { error: text(error?.message || error, 600) });
      }
    }
    if (type === 'resume') {
      // Resume descendants first. Otherwise the parent can re-enter execute(),
      // observe a still-paused child and immediately fall back to awaiting_user.
      if (job && !['completed', 'stopped'].includes(job.state)) {
        job.control = undefined;
        job.state = 'queued';
        emit(job, 'resume_waiting_for_children');
      }
      try {
        await cascadeChildControl(taskId, type);
        applyJobControl(job, type);
      } catch (error) {
        emit(job, 'child_task_control_failed', { control: type, error: text(error?.message || error, 600) });
      }
      return;
    }
    const queuedBeforeControl = applyJobControl(job, type);
    const cascade = cascadeChildControl(taskId, type).catch(() => {});
    if (queuedBeforeControl && (type === 'stop' || type === 'close') && job) {
      // The parent is not inside execute(), so queue compensation after child control
      // rather than running a second tool loop in parallel with the active descendant.
      void cascade.then(() => enqueueCompensation(job, `Queued task ${taskId} was ${type === 'close' ? 'closed' : 'stopped'} while a descendant was active`));
    }
  }

  async function steer(taskId, message) {
    const job = jobs.get(String(taskId || ''));
    const value = text(message, 2000);
    if (!job || !ACTIVE_JOB_STATES.has(job.state)) return { ok: false, error: '任务当前没有由原生 Adapter 执行' };
    if (!value) return { ok: false, error: '插话内容不能为空' };
    const { contextRouter, turnLifecycle } = await loadEngineModules();
    const current = await readRun(job.taskId);
    const routed = current ? contextRouter.routeTaskInput(current, value) : { route: contextRouter.classifyTaskInput(value, { status: job.state }) };
    job.steering.push(value);
    if (job.steering.length > 20) job.steering.splice(0, job.steering.length - 20);
    job.steeringRoutes ||= [];
    job.steeringRoutes.push(routed.route);
    if (job.steeringRoutes.length > 20) job.steeringRoutes.splice(0, job.steeringRoutes.length - 20);
    if (routed.run) {
      await updateRun(job.taskId, (next) => {
        next.context = routed.run.context;
        next.recoveryContext = routed.run.recoveryContext;
        next.recoveryCapsule = routed.run.recoveryCapsule;
        next.turnLifecycle = turnLifecycle.recordLifecycleSteering(
          turnLifecycle.restoreTurnLifecycle(next.turnLifecycle, {
            taskId: next.id,
            conversationId: next.conversationId,
            scope: `team:${next.teamId}`,
            goal: next.goal || next.request,
            deliverableType: next.contract?.deliverableType,
          }),
          value,
        );
        next.lifecycleRecovery = turnLifecycle.createLifecycleRecoveryCapsule(next.turnLifecycle);
      }, `上下文路由：${routed.route.kind} -> ${routed.route.action}`);
    }
    if (routed.run && options.taskService?.recordSteering) {
      await options.taskService.recordSteering(job.taskId, {
        source: 'user', message: value, route: routed.route,
        affectedStepIds: (current?.steps || []).filter((step) => ['running', 'queued', 'paused', 'failed'].includes(step.status)).map((step) => step.id),
        before: { status: current?.status, phase: current?.phase, planRevision: current?.adaptivePlanGraph?.revision },
        after: { action: routed.route.action, shouldPreempt: routed.route.shouldPreempt === true },
      }).catch(() => {});
    }
    if (routed.route.action === 'pause') {
      job.control = 'pause';
      job.abortController?.abort();
    } else if (routed.route.action === 'stop') {
      job.control = 'stop';
      job.abortController?.abort();
    } else if (job.state === 'running' && routed.route.shouldPreempt) {
      job.interruptReason = 'steer';
      job.abortController?.abort();
    }
    emit(job, 'steering_received', { message: value, route: routed.route });
    return { ok: true, job: safeJob(job) };
  }

  async function delegate(taskId, input = {}) {
    const current = await readRun(String(taskId || '')).catch(() => undefined);
    if (!current) return { ok: false, error: '找不到要委派子任务的父任务' };
    const job = jobs.get(current.id);
    const { runner, taskDelegation } = await loadEngineModules();
    try {
      const appended = taskDelegation.appendDelegation(current, input);
      if (job && !job.members.has(appended.delegation.employeeId)) {
        return { ok: false, error: `员工 ${appended.delegation.employeeName} 不在当前执行器成员列表中，请先把员工加入团队后再委派` };
      }
      const child = options.taskService
        ? await options.taskService.createChild(current.id, {
          employeeId: appended.delegation.employeeId,
          title: appended.delegation.title,
          assignment: appended.delegation.assignment,
          goal: appended.delegation.assignment,
          acceptanceCriteria: appended.delegation.acceptanceCriteria,
        })
        : undefined;
      if (child?.task?.id && current.conversationId) {
        await updateRun(child.task.id, (next) => {
          next.conversationId = current.conversationId;
          next.teamId = current.teamId;
        }, `继承父任务 ${current.id} 的聊天会话`);
      }
      await updateRun(current.id, (next) => {
        next.delegations = appended.run.delegations;
        next.steps = appended.run.steps;
        if (child?.task?.id) {
          const delegation = next.delegations.find((item) => item.id === appended.delegation.id);
          if (delegation) delegation.childTaskId = child.task.id;
          const delegatedStep = next.steps.find((item) => item.id === appended.step.id);
          if (delegatedStep) {
            delegatedStep.childTaskId = child.task.id;
            delegatedStep.externalChild = true;
          }
        }
        if (next.runner) {
          try { next.runner = runner.appendTaskRunnerSteps(next.runner, [formalStep(next.id, appended.step)], `手动添加子任务：${appended.delegation.title}`); next.plan = next.runner.plan; } catch {}
        }
      }, `手动动态委派 ${appended.delegation.employeeName}`);
      const childStart = child?.task?.id && job
        ? await start({
          taskId: child.task.id,
          members: [...job.members.values()],
          attachments: job.attachments,
          extraSystemContext: `Parent task ${current.id}; manually delegated by ${appended.delegation.employeeName}.`,
          reviewModelConfig: job.reviewModelConfig,
          memoryWriteApproval: job.memoryWriteApproval,
          executionPolicy: job.executionPolicy,
          connectors: job.connectors,
          connectorTools: job.connectorTools,
        })
        : undefined;
      if (child && job && !childStart?.ok) throw new Error(childStart?.error || 'Child task could not enter the native execution queue');
      const delegation = { ...appended.delegation, childTaskId: child?.task?.id };
      const step = { ...appended.step, childTaskId: child?.task?.id, externalChild: Boolean(child?.task?.id) };
      if (job) emit(job, 'subtask_delegated', { parentStepId: input.parentStepId, delegation, childJob: childStart?.job, source: 'manual' });
      return { ok: true, delegation, step, childTask: child?.task, childJob: childStart?.job, job: job ? safeJob(job) : undefined };
    } catch (error) {
      return { ok: false, error: text(error?.message || error, 1000) };
    }
  }

  // Team membership is allowed to grow while a project is running. Keep the
  // durable member snapshot and in-memory execution roster in lockstep before
  // a new expert can receive delegated work.
  async function syncMembers(taskId, input = {}) {
    const current = await readRun(String(taskId || '')).catch(() => undefined);
    if (!current) return { ok: false, error: '找不到需要同步成员的任务' };
    const incoming = Array.isArray(input.members) ? input.members
      .filter((member) => member && text(member.id, 180))
      .map((member) => ({ ...member, id: text(member.id, 180) })) : [];
    if (!incoming.length) return { ok: false, error: '没有提供有效的团队成员名单' };
    const job = jobs.get(current.id);
    const known = new Map((current.memberSnapshot || []).map((member) => [String(member.id), member]));
    const additions = incoming.filter((member) => !known.has(member.id));
    if (!additions.length) return { ok: true, changed: false, job: job ? safeJob(job) : undefined };
    if (job) {
      for (const member of additions) job.members.set(member.id, { ...member });
    }
    const { teamExecutionProtocol } = await loadEngineModules();
    await updateRun(current.id, (next) => {
      const snapshots = incoming.map((member) => {
        const snapshot = { ...member };
        delete snapshot.modelConfig;
        return snapshot;
      });
      const snapshotById = new Map((next.memberSnapshot || []).map((member) => [String(member.id), member]));
      for (const member of snapshots) snapshotById.set(String(member.id), { ...snapshotById.get(String(member.id)), ...member });
      next.memberSnapshot = [...snapshotById.values()];
      next.memberRosterVersion = Number(next.memberRosterVersion || 0) + 1;
      if (next.executionProtocol) {
        next.executionProtocol = teamExecutionProtocol.reconcileTeamExecutionProtocol(next.executionProtocol, {
          members: next.memberSnapshot,
          steps: next.steps,
        });
      }
    }, `团队执行名单已扩充：${additions.map((member) => text(member.name || member.id, 120)).join('、')}`);
    let adaptivePlanRevision;
    if (options.taskService) {
      const revisionResult = await options.taskService.reviseAdaptivePlan(current.id, buildStaffingPlanRevision(additions, input));
      const revisedGraph = revisionResult?.run?.adaptivePlanGraph || revisionResult?.task?.adaptivePlanGraph;
      adaptivePlanRevision = revisedGraph?.revisionHistory?.at(-1);
    }
    if (job) emit(job, 'member_roster_updated', { additions: additions.map((member) => ({ id: member.id, name: text(member.name, 120) })), rosterSize: job.members.size });
    return { ok: true, changed: true, additions: additions.map((member) => ({ id: member.id, name: text(member.name, 120) })), adaptivePlanRevision, job: job ? safeJob(job) : undefined };
  }

  async function delegationStatus(taskId) {
    const run = await readRun(String(taskId || '')).catch(() => undefined);
    if (!run) return { ok: false, error: '找不到任务' };
    const { taskDelegation } = await loadEngineModules();
    return { ok: true, ...taskDelegation.delegationSummary(run), delegations: clone(run.delegations || []) };
  }

  function status(taskId) {
    if (taskId) {
      const job = jobs.get(String(taskId));
      return { ok: true, job: job ? safeJob(job) : undefined, queue: { activeTaskId: getActiveJob()?.taskId, queuedTaskIds: queue.map((item) => item.taskId), total: queue.length } };
    }
    return { ok: true, jobs: [...jobs.values()].map(safeJob), queue: { activeTaskId: getActiveJob()?.taskId, queuedTaskIds: queue.map((item) => item.taskId), total: queue.length } };
  }

  function events(taskId, afterSequence = 0) {
    const job = jobs.get(String(taskId || ''));
    return { ok: true, events: job ? job.events.filter((event) => event.sequence > Number(afterSequence || 0)).map(clone) : [] };
  }

  function observabilityStatus(taskId) {
    const queueState = { activeTaskId: getActiveJob()?.taskId, queuedTaskIds: queue.map((item) => item.taskId), total: queue.length };
    return taskId
      ? { ok: true, task: observability.get(taskId), queue: queueState }
      : { ok: true, tasks: observability.list(), queue: queueState };
  }

  function stopAll() {
    for (const job of jobs.values()) {
      if (!ACTIVE_JOB_STATES.has(job.state)) continue;
      job.control = 'pause';
      job.abortController?.abort();
      if (job.heartbeat) clearInterval(job.heartbeat);
    }
  }

  return {
    start,
    steer,
    delegate,
    syncMembers,
    delegationStatus,
    status,
    events,
    observability: observabilityStatus,
    handleControl,
    stopAll,
  };
}

module.exports = { createNativeExecutionControl };
