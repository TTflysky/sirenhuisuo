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
    await service.setStatus(taskId, 'running', 'Worker 已领取任务');

    worker = createTaskWorker({ rootDir: root, store, sessionId: 'task-service-test' });
    const claim = await worker.dispatch({ taskId, type: 'claim', requestedBy: 'test', payload: { adapter: 'renderer-chat-task-service', jobId: 'test-job' } });
    assert.equal(claim.ok, true);
    assert.ok(claim.run.worker.leaseId);
    const workerHeartbeat = await worker.dispatch({ taskId, type: 'heartbeat', requestedBy: 'test', payload: { leaseId: claim.run.worker.leaseId } });
    assert.equal(workerHeartbeat.ok, true);
    const released = await worker.dispatch({ taskId, type: 'release', requestedBy: 'test', payload: { leaseId: claim.run.worker.leaseId } });
    assert.equal(released.ok, true);
    await service.heartbeat(taskId, { state: 'act', detail: 'native tool is running', workspaceId: 'workspace/task-service', observedAt: 1700000000000 });
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
    const all = await createTaskService(restartedStore).read({});
    assert.equal(all.runs.length, 2);
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
