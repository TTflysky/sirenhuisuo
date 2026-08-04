import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import taskRuntimeStore from '../electron/taskRuntimeStore.cjs';
import taskServiceModule from '../electron/taskService.cjs';
import nativeToolRuntimeModule from '../electron/nativeToolRuntime.cjs';

const { createTaskRuntimeStore } = taskRuntimeStore;
const { createTaskService } = taskServiceModule;
const { createNativeToolRuntime, NATIVE_TOOL_DEFINITIONS } = nativeToolRuntimeModule;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-adaptive-plan-'));

try {
  const store = createTaskRuntimeStore(root);
  const service = createTaskService(store);
  const toolRuntime = createNativeToolRuntime({
    workspaceRoot: root,
    projectRoot: path.resolve('.'),
    taskService: service,
  });
  assert.ok(NATIVE_TOOL_DEFINITIONS.some((item) => item.function?.name === 'revise_task_plan'));
  assert.ok(NATIVE_TOOL_DEFINITIONS.some((item) => item.function?.name === 'reassign_task_node'));
  const created = await service.create({
    taskType: 'team',
    projectId: 'adaptive-project',
    conversationId: 'adaptive-conversation',
    goal: 'Build and verify a small desktop client',
    acceptanceCriteria: ['The client file exists', 'A real verification passes'],
    memberSnapshot: [
      { id: 'product', name: 'Product', title: 'Product', role: 'pm' },
      { id: 'frontend', name: 'Frontend', title: 'Frontend', role: 'coder' },
      { id: 'reviewer', name: 'Reviewer', title: 'Reviewer', role: 'reviewer' },
      { id: 'frontend-two', name: 'Frontend Two', title: 'Frontend', role: 'coder' },
    ],
    steps: [
      { id: 'brief', title: 'Confirm scope', employeeId: 'product', status: 'completed' },
      { id: 'build', title: 'Build client', employeeId: 'frontend', dependsOnStepIds: ['brief'] },
      { id: 'review', title: 'Review client', employeeId: 'reviewer', kind: 'review', dependsOnStepIds: ['build'] },
    ],
  });
  assert.equal(created.task.adaptivePlanGraph.graphVersion, 1);
  assert.equal(created.task.autonomousControl.mode, 'adaptive');
  assert.equal(created.task.adaptivePlanGraph.revision, 1);
  assert.equal(created.task.adaptivePlanGraph.nodes.find((node) => node.id === 'brief').status, 'completed');

  await service.reassignAdaptiveNode(created.task.id, {
    nodeId: 'build', employeeId: 'frontend-two', employeeName: 'Frontend Two', reason: 'The original owner is unavailable.',
  });
  let snapshot = await service.read({ taskId: created.task.id });
  let run = snapshot.runs[0];
  assert.equal(run.adaptivePlanGraph.revision, 2);
  assert.equal(run.steps.find((step) => step.id === 'build').employeeId, 'frontend-two');
  assert.equal(run.adaptivePlanGraph.revisionHistory.at(-1).trigger, 'staffing');

  const toolRevision = await toolRuntime.execute('revise_task_plan', {
    trigger: 'staffing',
    reason: 'Add a narrow-screen specialist without discarding completed discovery work.',
    operations: [{
      type: 'register_member', employeeId: 'responsive-specialist', employeeName: 'Responsive Specialist',
      reason: 'The project now requires narrow-screen expertise.', affectedNodeIds: ['build'],
      acceptanceCriteria: ['The interface remains usable at 375px.'],
    }],
  }, { taskId: created.task.id, workspaceId: created.task.workspaceId });
  assert.equal(toolRevision.success, true);
  assert.equal(toolRevision.structuredEvidence.adaptivePlanRevision.trigger, 'staffing');
  snapshot = await service.read({ taskId: created.task.id });
  run = snapshot.runs[0];
  assert.equal(run.adaptivePlanGraph.revision, 3);
  assert.equal(run.adaptivePlanGraph.rosterChanges.at(-1).employeeId, 'responsive-specialist');
  assert.deepEqual(run.adaptivePlanGraph.revisionHistory.at(-1).affectedNodeIds, ['build']);

  await service.update(created.task.id, (task) => {
    task.steps.find((step) => step.id === 'brief').status = 'completed';
    task.steps.find((step) => step.id === 'build').status = 'completed';
    task.steps.find((step) => step.id === 'review').status = 'running';
  }, 'Prepare adaptive review rejection');
  await service.recordReviewDecision(created.task.id, {
    reviewStepId: 'review', responsibleStepId: 'build', approved: false, reason: 'The narrow screen verification failed.',
  });
  snapshot = await service.read({ taskId: created.task.id });
  run = snapshot.runs[0];
  assert.equal(run.adaptivePlanGraph.revision, 4);
  assert.equal(run.steps.find((step) => step.id === 'brief').status, 'completed');
  assert.equal(run.steps.find((step) => step.id === 'build').status, 'queued');
  assert.equal(run.steps.find((step) => step.id === 'review').status, 'queued');
  assert.ok(run.adaptivePlanGraph.revisionHistory.at(-1).preservedCompletedNodeIds.includes('brief'));

  await service.failStep(created.task.id, {
    stepId: 'build', error: 'verification result mismatch', errorClass: 'result_mismatch', alternativeStrategy: {
      routeId: 'browser-verification', toolName: 'verify_web_artifact', description: 'Verify the real desktop and narrow viewports.', fingerprint: 'browser-verification-v1',
    },
  });
  snapshot = await service.read({ taskId: created.task.id });
  run = snapshot.runs[0];
  assert.equal(run.adaptivePlanGraph.revision, 5);
  assert.equal(run.status, 'queued');
  assert.equal(run.steps.find((step) => step.id === 'build').adaptiveStrategy.fingerprint, 'browser-verification-v1');
  assert.equal(run.autonomousControl.planRevision, 5);
  assert.match(run.autonomousControl.publicSummary.planChange, /verification result mismatch/u);

  const restarted = createTaskService(createTaskRuntimeStore(root));
  const restored = await restarted.read({ taskId: created.task.id });
  assert.equal(restored.runs[0].adaptivePlanGraph.revision, 5);
  assert.equal(restored.runs[0].adaptivePlanGraph.graphId, run.adaptivePlanGraph.graphId);

  console.log(JSON.stringify({
    passed: true,
    graphVersion: run.adaptivePlanGraph.graphVersion,
    revision: run.adaptivePlanGraph.revision,
    preservedCompletedNodeIds: run.adaptivePlanGraph.revisionHistory.at(-2).preservedCompletedNodeIds,
    activeRoute: run.steps.find((step) => step.id === 'build').adaptiveStrategy.fingerprint,
  }, null, 2));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
