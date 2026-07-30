const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createTaskRuntimeStore } = require('../electron/taskRuntimeStore.cjs');
const { createTaskService } = require('../electron/taskService.cjs');
const { createTaskWorker } = require('../electron/taskWorker.cjs');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-task-service-'));
  let worker;
  try {
    const store = createTaskRuntimeStore(root);
    const service = createTaskService(store);
    const created = await service.create({
      taskType: 'assistant',
      title: '统一任务服务验收',
      goal: '验证任务可以持久化、产生子任务并记录真实证据',
      idempotencyKey: 'acceptance-001',
      conversationId: 'conversation-task-service',
      memberSnapshot: [{ id: 'researcher', name: '研究员工', role: 'researcher', modelConfig: { model: 'mock-model' } }],
      steps: [{ id: 'research', title: '检索资料', employeeId: 'researcher' }],
    });
    assert.equal(created.ok, true);
    assert.equal(created.created, true);
    const duplicate = await service.create({
      taskType: 'assistant', teamId: 'scope:assistant', goal: '不应重复创建', idempotencyKey: 'acceptance-001',
    });
    assert.equal(duplicate.idempotent, true);
    assert.equal(duplicate.task.id, created.task.id);

    const skillTask = await service.create({
      taskType: 'assistant',
      goal: '请根据 https://skillhub.cn/install/skillhub.md，安装 diagram-builder。',
      idempotencyKey: 'skill-contract-001',
      taskDecision: {
        mode: 'execute', primaryRoute: 'install_skill', deliverableType: 'operation',
        acceptanceCriteria: ['安装并回读目标 Skill'], requiredConstraints: [],
        deliverables: [{ label: '已验证的 diagram-builder', format: 'operation', type: 'operation', required: true }],
        requiresEvidence: true, needsUser: false, missingUserCondition: '', searchQuery: '',
        decisionReason: '显式技能安装任务', confidence: 1, source: 'rules',
      },
      steps: [{ id: 'install', title: '安装技能', deliverableType: 'operation' }],
    });
    assert.equal(skillTask.task.contract.primaryRoute, 'install_skill', 'TaskService 不得覆盖语义决策路线');
    assert.equal(skillTask.task.contract.deliverableType, 'operation', '技能安装必须保持操作型交付');
    assert.equal(skillTask.task.contract.deliverables[0].type, 'operation');
    assert.equal(skillTask.task.steps[0].deliverableType, 'operation');

    const taskId = created.task.id;
    const attempt = await service.recordToolAttempt(taskId, {
      stepId: 'research', toolName: 'search_skills', status: 'succeeded',
      outputSummary: '返回一个可读取的技能来源',
    });
    assert.equal(attempt.ok, true);
    await service.addReference(taskId, { kind: 'skill', id: 'social-content', label: 'social-content', state: 'verified' });
    const artifact = await service.addArtifact(taskId, {
      name: '验收报告.md', path: 'workspace/验收报告.md', verified: true,
      diskPath: 'C:/tmp/task-service/workspace/验收报告.md', workspaceId: 'workspace/task-service',
      bytes: 256, contentType: 'text/markdown', verification: 'read_back', category: 'final',
    });
    assert.equal(artifact.ok, true);
    const child = await service.createChild(taskId, { employeeId: 'researcher', title: '员工子任务', goal: '执行资料检索' });
    assert.equal(child.ok, true);
    assert.equal(child.task.parentTaskId, taskId);
    assert.equal(child.task.conversationId, 'conversation-task-service');
    assert.equal(child.task.steps[0].employeeId, 'researcher');
    assert.deepEqual(child.task.memberSnapshot, created.task.memberSnapshot, 'child task must inherit executable team member snapshots');
    const childContext = await service.context(child.task.id);
    assert.equal(childContext.inheritedContext.parentTaskId, taskId);
    assert.equal(childContext.references[0].id, 'social-content');
    await service.update(child.task.id, (task) => {
      task.handoff = { blocked: '等待子任务需要的授权', nextAction: '完成授权后继续' };
      task.compensation = [{ status: 'blocked', targetStepId: 'step-1', error: '补偿负责人不可用' }];
    }, 'prepare task tree verification');
    const tree = await service.tree(taskId);
    assert.equal(tree.ok, true);
    assert.equal(tree.tree.totals.tasks, 2);
    assert.deepEqual(tree.tree.nodes.map((node) => node.id), [taskId, child.task.id]);
    assert.equal(tree.tree.nodes[1].depth, 1);
    assert.equal(tree.tree.nodes[1].blocked, '等待子任务需要的授权');
    assert.equal(tree.tree.nodes[1].compensation.blocked, 1);
    const recoveryPlan = await service.recoveryPlan(taskId);
    assert.equal(recoveryPlan.plan.ready, false);
    assert.equal(recoveryPlan.plan.blockers[0].taskId, child.task.id);
    assert.equal(recoveryPlan.plan.compensationOrder[0].taskId, child.task.id);
    const resumableParent = await service.create({
      taskType: 'team',
      title: 'Parent resume cascade',
      goal: 'Verify a paused child resumes before its parent',
      idempotencyKey: 'parent-resume-cascade',
      memberSnapshot: [{ id: 'researcher', name: 'Researcher', role: 'researcher', modelConfig: { model: 'mock-model' } }],
      steps: [{ id: 'parent-step', title: 'Wait for child', employeeId: 'researcher' }],
    });
    const resumableChild = await service.createChild(resumableParent.task.id, {
      employeeId: 'researcher', title: 'Paused child', goal: 'Resume before the parent task',
    });
    await service.setStatus(resumableParent.task.id, 'awaiting_user', 'Parent is waiting for a child task');
    await service.setStatus(resumableChild.task.id, 'paused', 'Child task is paused');
    const cascadePlan = await service.recoveryPlan(resumableParent.task.id);
    assert.equal(cascadePlan.plan.ready, true, 'A paused child must be resumable through the parent control');
    assert.deepEqual(cascadePlan.plan.resumeOrder.map((item) => item.taskId), [resumableChild.task.id, resumableParent.task.id]);
    await service.setStatus(taskId, 'running', 'Worker 已领取任务');

    const decisionChild = await service.createChild(taskId, {
      employeeId: 'researcher', title: 'UX decision', goal: 'Provide a UX design decision', deliverableType: 'decision',
    });
    assert.equal(decisionChild.task.contract.deliverableType, 'decision');
    assert.equal(decisionChild.task.steps[0].deliverableType, 'decision');

    const collisionParent = await service.create({
      taskType: 'team', title: 'Legacy delegation collision', goal: 'Repair two distinct delegated outcomes',
      idempotencyKey: 'legacy-delegation-collision',
      memberSnapshot: created.task.memberSnapshot,
      steps: [{ id: 'parent-work', title: 'Delegate work', employeeId: 'researcher' }],
    });
    const collisionChild = await service.createChild(collisionParent.task.id, {
      employeeId: 'researcher', title: 'UX plan', goal: 'Produce a UX design plan', deliverableType: 'decision',
    });
    await service.update(collisionParent.task.id, (task) => {
      task.steps.push(
        { id: 'legacy-ux', employeeId: 'researcher', title: 'UX plan', assignment: 'Produce a UX design plan', childTaskId: collisionChild.task.id, externalChild: true, status: 'failed', attempts: 0, events: [] },
        { id: 'legacy-html', employeeId: 'researcher', title: 'HTML demo', assignment: 'Produce a single-file HTML demo and read it back', childTaskId: collisionChild.task.id, externalChild: true, status: 'queued', attempts: 0, events: [] },
      );
    }, 'seed legacy duplicate child reference');
    const repairedCollision = await service.repairDelegationCollisions(collisionParent.task.id);
    assert.equal(repairedCollision.repaired.length, 1, 'exactly one duplicated child reference should be repaired');
    const collisionSnapshot = await service.read({ taskId: collisionParent.task.id });
    const repairedHtml = collisionSnapshot.runs[0].steps.find((step) => step.id === 'legacy-html');
    assert.notEqual(repairedHtml.childTaskId, collisionChild.task.id, 'distinct legacy assignments must not share a child task');
    assert.equal(repairedHtml.deliverableType, 'file', 'legacy file assignment should receive a file delivery contract');
    const replacementSnapshot = await service.read({ taskId: repairedHtml.childTaskId });
    assert.equal(replacementSnapshot.runs[0].contract.deliverableType, 'file');

    worker = createTaskWorker({ rootDir: root, store, sessionId: 'task-service-test' });
    const claim = await worker.dispatch({ taskId, type: 'claim', requestedBy: 'test', payload: { adapter: 'renderer-chat-task-service', jobId: 'test-job' } });
    assert.equal(claim.ok, true);
    assert.ok(claim.run.worker.leaseId);
    const workerHeartbeat = await worker.dispatch({ taskId, type: 'heartbeat', requestedBy: 'test', payload: { leaseId: claim.run.worker.leaseId } });
    assert.equal(workerHeartbeat.ok, true);
    const released = await worker.dispatch({ taskId, type: 'release', requestedBy: 'test', payload: { leaseId: claim.run.worker.leaseId } });
    assert.equal(released.ok, true);
    await service.heartbeat(taskId, { state: 'act', detail: 'native tool is running', workspaceId: 'workspace/task-service', observedAt: 1700000000000 });
    await service.recordLifecycle(taskId, {
      lifecycle: {
        protocolVersion: 1, lifecycleId: 'lifecycle-task-service', turnId: 'turn-task-service',
        taskId, conversationId: 'conversation-task-service', scope: 'assistant', goal: created.task.goal,
        deliverableType: 'answer', status: 'running', phase: 'act', sequence: 5,
        activity: '正在执行真实工具', progressAt: 1700000000500, updatedAt: 1700000000500,
        events: [{ sequence: 5, type: 'tool_started', activity: '正在执行真实工具', at: 1700000000500, detail: { authorization: 'Bearer task-service-secret' } }],
      },
      recovery: { protocolVersion: 1, goal: created.task.goal, resumable: true, token: 'recovery-secret' },
    });
    await service.recordLifecycle(taskId, {
      lifecycle: {
        protocolVersion: 1, lifecycleId: 'conflict', turnId: 'conflict', taskId,
        status: 'running', phase: 'observe', sequence: 5, activity: '同序号冲突状态', progressAt: 2, updatedAt: 2,
      },
    });
    await service.recordLifecycle(taskId, {
      lifecycle: {
        protocolVersion: 1, lifecycleId: 'stale', turnId: 'stale', taskId,
        status: 'running', phase: 'observe', sequence: 4, activity: '过期状态', progressAt: 1, updatedAt: 1,
      },
    });
    const restartedStore = createTaskRuntimeStore(root);
    const restarted = await createTaskService(restartedStore).read({ taskId });
    assert.equal(restarted.ok, true);
    assert.equal(restarted.runs.length, 1);
    assert.equal(restarted.runs[0].toolAttempts.length, 1);
    assert.equal(restarted.runs[0].artifacts[0].verified, true);
    assert.equal(restarted.runs[0].artifacts[0].diskPath, 'C:/tmp/task-service/workspace/验收报告.md');
    assert.equal(restarted.runs[0].artifacts[0].verification, 'read_back');
    assert.equal(restarted.runs[0].references[0].id, 'social-content');
    assert.equal(restarted.runs[0].heartbeat.state, 'act');
    assert.equal(restarted.runs[0].heartbeat.leaseExpiresAt, 1700000090000);
    assert.equal(restarted.runs[0].conversationId, 'conversation-task-service');
    assert.equal(restarted.runs[0].turnLifecycle.sequence, 5, '旧生命周期快照不得覆盖新快照');
    assert.equal(restarted.runs[0].turnLifecycle.activity, '正在执行真实工具');
    assert.equal(restarted.runs[0].turnLifecycle.events[0].detail.authorization, '[REDACTED]', '主进程必须再次脱敏生命周期');
    assert.equal(restarted.runs[0].lifecycleRecovery.resumable, true);
    assert.equal(restarted.runs[0].lifecycleRecovery.token, '[REDACTED]', '恢复胶囊不得持久化凭据');
    const restoredContext = await createTaskService(restartedStore).context(taskId);
    assert.equal(restoredContext.turnLifecycle.sequence, 5);
    assert.equal(restoredContext.lifecycleRecovery.goal, created.task.goal);
    const all = await createTaskService(restartedStore).read({});
    assert.equal(all.runs.length, 9);
    assert.equal(all.integrity.ok, true);
    console.log('verify-task-service: PASS');
  } finally {
    worker?.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`verify-task-service: FAIL: ${error.message}`);
  process.exitCode = 1;
});
