import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import taskRuntimeStore from '../electron/taskRuntimeStore.cjs';
import taskServiceModule from '../electron/taskService.cjs';
import { projectGraphToTaskSteps, readyAdaptiveNodes } from '../src/engine/adaptivePlanGraph.mjs';

const { createTaskRuntimeStore } = taskRuntimeStore;
const { createTaskService } = taskServiceModule;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-v510-deliverable-kernel-'));

const contract = (type, description, inputRefs = []) => ({
  contractVersion: 1,
  inputRefs,
  output: { type, path: `artifacts/${description}`, description },
  completionConditions: [`${description} is complete`],
  verification: [`Verify ${description}`],
  budget: { maxModelRounds: 8, maxToolCalls: 24, maxReworkAttempts: 2 },
  escalationConditions: ['Escalate after the rework budget is exhausted'],
});

try {
  const service = createTaskService(createTaskRuntimeStore(root));
  const members = [
    { id: 'frontend', name: 'Frontend', title: 'Frontend specialist', role: 'coder', capabilities: ['frontend'] },
    { id: 'backend', name: 'Backend', title: 'Backend specialist', role: 'coder', capabilities: ['backend'] },
    { id: 'coordinator', name: 'Coordinator', title: 'Coordinator', role: 'pm', capabilities: ['coordination'] },
  ];
  const steps = [
    {
      id: 'client', title: 'Client deliverable', assignment: 'Build and verify the client', employeeId: 'frontend',
      deliverableType: 'file', dependsOnStepIds: [], acceptanceCriteria: ['Client builds'], requiredCapabilities: ['frontend'],
      expectedEvidence: ['Client build output'], outputPath: 'artifacts/client', maxRetries: 2, taskContract: contract('file', 'client'),
    },
    {
      id: 'api', title: 'API deliverable', assignment: 'Build and verify the API', employeeId: 'backend',
      deliverableType: 'file', dependsOnStepIds: [], acceptanceCriteria: ['API tests pass'], requiredCapabilities: ['backend'],
      expectedEvidence: ['API test output'], outputPath: 'artifacts/api', maxRetries: 2, taskContract: contract('file', 'api'),
    },
    {
      id: 'integration', title: 'Integrate deliverables', assignment: 'Read back both deliverables and verify the result', employeeId: 'coordinator',
      deliverableType: 'mixed', dependsOnStepIds: ['client', 'api'], acceptanceCriteria: ['Integrated result passes'], requiredCapabilities: ['coordination'],
      expectedEvidence: ['Integration verification'], maxRetries: 2, taskContract: contract('mixed', 'integration', ['verified:client', 'verified:api']),
    },
  ];

  const created = await service.create({
    taskType: 'team', projectId: 'project-v510', conversationId: 'conversation-v510', teamId: 'team-v510',
    title: 'Deliverable-driven team execution', goal: 'Produce and integrate two independent deliverables',
    acceptanceCriteria: ['Integrated result passes'], memberSnapshot: members, steps,
  });
  assert.equal(created.ok, true);
  assert.deepEqual(created.task.steps.find((step) => step.id === 'client').requiredCapabilities, ['frontend']);
  assert.equal(created.task.steps.find((step) => step.id === 'client').taskContract.output.path, 'artifacts/client');
  assert.equal(created.task.adaptivePlanGraph.nodes.find((node) => node.id === 'api').taskContract.output.path, 'artifacts/api');
  assert.deepEqual(readyAdaptiveNodes(created.task.adaptivePlanGraph).map((node) => node.id), ['client', 'api']);
  assert.deepEqual(projectGraphToTaskSteps(created.task.adaptivePlanGraph).find((step) => step.id === 'integration').taskContract.inputRefs, ['verified:client', 'verified:api']);

  await service.ensureTeamExecutionBinding({ taskId: created.task.id, members });
  const bound = (await service.read({ taskId: created.task.id })).runs[0];
  for (const step of bound.steps) {
    const child = (await service.read({ taskId: step.responsibilityTaskId })).runs[0];
    assert.equal(child.parentTaskId, created.task.id);
    assert.deepEqual(child.steps[0].taskContract, step.taskContract);
    assert.deepEqual(child.steps[0].expectedEvidence, step.expectedEvidence);
  }

  const restarted = createTaskService(createTaskRuntimeStore(root));
  const restored = (await restarted.read({ taskId: created.task.id })).runs[0];
  assert.equal(restored.steps.find((step) => step.id === 'client').taskContract.output.path, 'artifacts/client');
  assert.equal(restored.adaptivePlanGraph.nodes.find((node) => node.id === 'integration').taskContract.inputRefs.length, 2);

  console.log(JSON.stringify({
    passed: true,
    rootTaskId: created.task.id,
    readyNodes: readyAdaptiveNodes(restored.adaptivePlanGraph).map((node) => node.id),
    responsibilityTasks: restored.steps.map((step) => step.responsibilityTaskId),
    persistedContractVersion: restored.steps[0].taskContract.contractVersion,
  }, null, 2));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
