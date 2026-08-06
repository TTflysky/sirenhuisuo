const teamBindingLocks = new Map();

function createTaskServiceTeamExecution({
  store,
  create,
  createChild,
  update,
  appendServiceEvent,
  clone,
  text,
  id,
  list,
  inferLegacyDeliverableType,
}) {
  async function ensureTeamExecutionBinding(input = {}) {
    const rootTaskId = text(input.taskId || input.rootTaskId || input.run?.id, 180);
    if (!rootTaskId) throw new Error('TaskService: team taskId is required for execution binding');
    const previous = teamBindingLocks.get(rootTaskId) || Promise.resolve();
    const operation = previous.catch(() => undefined).then(async () => {
      let snapshot = await store.read({ taskId: rootTaskId });
      let root = snapshot.ok ? snapshot.runs?.[0] : undefined;
      const sourceRun = input.run && typeof input.run === 'object' ? input.run : undefined;
      if (!root && sourceRun) {
        await create({
          id: rootTaskId,
          taskType: 'team',
          teamId: sourceRun.teamId,
          conversationId: sourceRun.conversationId,
          projectId: sourceRun.projectId || input.projectId,
          ownerId: 'assistant',
          title: sourceRun.title,
          request: sourceRun.request,
          goal: sourceRun.goal || sourceRun.request,
          workspaceId: sourceRun.workspaceId,
          acceptanceCriteria: sourceRun.acceptanceCriteria,
          taskDecision: sourceRun.contract?.decision,
          deliverableType: sourceRun.contract?.deliverableType,
          memberSnapshot: sourceRun.memberSnapshot,
          steps: (sourceRun.steps || []).map((step) => ({
            ...step,
            id: step.id,
            employeeId: step.employeeId,
            title: step.title,
            assignment: step.assignment,
            dependsOnStepIds: step.dependsOnStepIds,
            acceptanceCriteria: step.acceptanceCriteria,
            deliverableType: step.deliverableType,
          })),
          idempotencyKey: `team-root:${rootTaskId}`,
        });
        snapshot = await store.read({ taskId: rootTaskId });
        root = snapshot.ok ? snapshot.runs?.[0] : undefined;
      }
      if (!root) throw new Error(`TaskService: team task ${rootTaskId} is missing from the durable task store`);

      const sanitizeMember = (member) => {
        const safe = clone(member || {});
        if (safe && typeof safe === 'object') {
          delete safe.modelConfig;
          delete safe.apiKey;
          delete safe.token;
          delete safe.secret;
          delete safe.credentials;
        }
        return safe;
      };
      const members = (Array.isArray(input.members) ? input.members : (root.memberSnapshot || [])).map(sanitizeMember);
      const memberById = new Map(members.filter((member) => member && member.id).map((member) => [String(member.id), member]));
      await update(rootTaskId, (task) => {
        task.taskType = task.taskType || 'team';
        task.hostEntrypoint = task.hostEntrypoint || 'team';
        task.teamId = task.teamId || text(input.teamId || sourceRun?.teamId, 180) || `scope:team`;
        task.projectId = task.projectId || text(input.projectId || sourceRun?.projectId, 180) || undefined;
        task.conversationId = task.conversationId || text(input.conversationId || sourceRun?.conversationId, 180) || undefined;
        task.memberSnapshot = Array.isArray(task.memberSnapshot) && task.memberSnapshot.length ? task.memberSnapshot : clone(members);
        task.executionBinding = {
          kind: 'team-root', rootTaskId, protocolVersion: 1,
          adapter: text(input.adapter || 'native-execution-adapter', 120), boundAt: Number(task.executionBinding?.boundAt) || Date.now(),
        };
        appendServiceEvent(task, 'team_execution_bound', 'Team root is bound to TaskService execution evidence', {
          rootTaskId, memberCount: task.memberSnapshot.length, stepCount: (task.steps || []).length,
        });
      }, 'Bind team root to TaskService execution evidence');

      const refreshed = await store.read({ taskId: rootTaskId });
      root = refreshed.ok ? refreshed.runs?.[0] : undefined;
      if (!root) throw new Error(`TaskService: team task ${rootTaskId} disappeared after binding`);
      const bindings = [];
      for (const step of root.steps || []) {
        if (step.compensationOnly === true) continue;
        let childId = text(step.responsibilityTaskId, 180);
        let child = childId ? (await store.read({ taskId: childId })).runs?.[0] : undefined;
        const member = memberById.get(String(step.employeeId)) || (root.memberSnapshot || []).find((item) => String(item.id) === String(step.employeeId));
        if (!child || child.parentTaskId !== rootTaskId) {
          const created = await createChild(rootTaskId, {
            employeeId: step.employeeId,
            title: step.title,
            assignment: step.assignment,
            goal: step.assignment || step.title,
            teamId: root.teamId,
            projectId: root.projectId,
            conversationId: root.conversationId,
            memberSnapshot: member ? [member] : root.memberSnapshot,
            acceptanceCriteria: step.acceptanceCriteria || root.acceptanceCriteria,
            deliverableType: step.deliverableType || root.deliverableType,
            idempotencyKey: `team-step:${rootTaskId}:${step.id}`,
          });
          childId = created.task?.id;
          child = childId ? (await store.read({ taskId: childId })).runs?.[0] : undefined;
        }
        if (!childId || !child) throw new Error(`TaskService: unable to bind team step ${step.id}`);
        const desiredStatus = step.status === 'completed' ? 'completed'
          : step.status === 'failed' ? 'failed'
            : step.status === 'paused' ? 'paused'
              : step.status === 'stopped' ? 'stopped' : 'queued';
        await update(childId, (task) => {
          task.executionBinding = {
            kind: 'team-step', rootTaskId, sourceStepId: step.id, protocolVersion: 1,
            employeeId: step.employeeId, boundAt: Number(task.executionBinding?.boundAt) || Date.now(),
          };
          task.externalExecution = true;
          task.rootTaskId = rootTaskId;
          task.ownerId = text(step.employeeId, 180) || task.ownerId;
          if (task.memberSnapshot?.length === 0 && member) task.memberSnapshot = [clone(member)];
          task.status = desiredStatus;
          task.phase = desiredStatus === 'completed' ? 'completed' : desiredStatus === 'failed' || desiredStatus === 'stopped' || desiredStatus === 'paused' ? 'blocked' : task.phase || 'preflight';
          const childStep = task.steps?.[0];
          if (childStep) {
            childStep.status = desiredStatus;
            childStep.startedAt = step.startedAt;
            childStep.completedAt = step.completedAt;
            childStep.lastError = step.lastError;
            childStep.output = clone(step.output);
          }
          appendServiceEvent(task, 'team_step_bound', `Bound to team step ${step.id}`, { rootTaskId, stepId: step.id, employeeId: step.employeeId });
        }, 'Bind fixed team member responsibility');
        await update(rootTaskId, (task) => {
          const current = (task.steps || []).find((item) => item.id === step.id);
          if (!current) return;
          current.responsibilityTaskId = childId;
          current.executionBinding = { kind: 'team-step', rootTaskId, sourceStepId: step.id, childTaskId: childId, employeeId: step.employeeId };
        }, `Link team step ${step.id} to responsibility task`);
        bindings.push({ stepId: step.id, employeeId: step.employeeId, responsibilityTaskId: childId });
      }
      const final = await store.read({ taskId: rootTaskId });
      return { ok: true, task: final.runs?.[0], bindings, bound: true };
    });
    teamBindingLocks.set(rootTaskId, operation);
    try { return await operation; }
    finally { if (teamBindingLocks.get(rootTaskId) === operation) teamBindingLocks.delete(rootTaskId); }
  }

  async function recordExecutionEvent(taskId, input = {}) {
    const eventType = text(input.type || 'team_execution_event', 120);
    const detail = text(input.detail || input.summary || eventType, 1200);
    return update(taskId, (task) => {
      appendServiceEvent(task, eventType, detail, {
        stepId: text(input.stepId, 180) || undefined,
        employeeId: text(input.employeeId, 180) || undefined,
        status: text(input.status, 80) || undefined,
        payload: clone(input.payload || {}),
      });
    }, `Record team execution event: ${eventType}`);
  }

  async function recordSteering(taskId, input = {}) {
    return update(taskId, (task) => {
      task.steeringHistory = Array.isArray(task.steeringHistory) ? task.steeringHistory : [];
      task.steeringHistory.push({
        id: id('steer'), source: text(input.source || 'user', 80), message: text(input.message, 2000),
        route: clone(input.route || {}), affectedStepIds: list(input.affectedStepIds),
        before: clone(input.before || {}), after: clone(input.after || {}), createdAt: Date.now(),
      });
      task.steeringHistory = task.steeringHistory.slice(-60);
      appendServiceEvent(task, 'steering_applied', 'User steering was recorded with affected steps and route', {
        affectedStepIds: list(input.affectedStepIds), route: clone(input.route || {}),
      });
    }, 'Record user steering and affected team steps');
  }

  async function repairDelegationCollisions(parentTaskId) {
    const snapshot = await store.read({ taskId: parentTaskId });
    const parent = snapshot.ok ? snapshot.runs?.[0] : undefined;
    if (!parent) throw new Error(snapshot.error || `找不到任务：${parentTaskId}`);
    const seen = new Set();
    const collisions = (parent.steps || []).filter((step) => {
      const childTaskId = text(step.childTaskId, 180);
      if (!childTaskId) return false;
      if (seen.has(childTaskId)) return true;
      seen.add(childTaskId);
      return false;
    });
    const repaired = [];
    for (const step of collisions) {
      const deliverableType = inferLegacyDeliverableType(step, parent);
      const created = await createChild(parent.id, {
        employeeId: step.employeeId, title: step.title, assignment: step.assignment,
        goal: step.assignment || step.title, deliverableType, teamId: parent.teamId,
        conversationId: parent.conversationId, memberSnapshot: parent.memberSnapshot,
      });
      if (!created.task?.id) throw new Error('修复重复子任务引用时未能创建新任务');
      const replacementId = created.task.id;
      const previousId = step.childTaskId;
      await update(parent.id, (current) => {
        const currentStep = (current.steps || []).find((item) => item.id === step.id && item.childTaskId === previousId);
        if (!currentStep) return;
        currentStep.childTaskId = replacementId;
        currentStep.deliverableType = deliverableType;
        currentStep.status = 'queued';
        currentStep.lastError = undefined;
        currentStep.events = [...(currentStep.events || []), { ts: Date.now(), type: 'migration', detail: '已修复旧版本重复复用的子任务引用，改为独立执行。' }].slice(-100);
        const delegation = (current.delegations || []).find((item) => item.delegationId === currentStep.delegationId || item.id === currentStep.delegationId);
        if (delegation && delegation.childTaskId === previousId) {
          delegation.childTaskId = replacementId;
          delegation.deliverableType = deliverableType;
          delegation.status = 'queued';
          delegation.error = undefined;
        }
        appendServiceEvent(current, 'delegation_collision_repaired', '已为旧版重复委派创建独立子任务。', {
          stepId: currentStep.id, previousChildTaskId: previousId, replacementChildTaskId: replacementId, deliverableType,
        });
      }, '修复旧版本动态委派重复子任务引用');
      repaired.push({ stepId: step.id, previousChildTaskId: previousId, replacementChildTaskId: replacementId, deliverableType });
    }
    return { ok: true, parentTaskId: parent.id, repaired };
  }

  return { ensureTeamExecutionBinding, recordExecutionEvent, recordSteering, repairDelegationCollisions };
}

module.exports = { createTaskServiceTeamExecution };
