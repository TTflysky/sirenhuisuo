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

  const simple = await restarted.create({
    taskType: 'assistant',
    projectId: 'project-v510-simple',
    conversationId: 'conversation-v510-simple',
    title: 'Verify a small deliverable',
    goal: 'Create and verify one small deliverable',
    deliverableType: 'file',
    acceptanceCriteria: ['The deliverable is present'],
    steps: [{
      id: 'step-1',
      title: 'Create the deliverable',
      assignment: 'Create the deliverable and record verification evidence',
      outputPath: 'artifacts/simple',
      expectedEvidence: ['The deliverable exists'],
    }],
  });
  const simpleId = simple.task.id;
  const simpleStep = simple.task.steps.find((step) => step.id === 'step-1');
  assert.equal(simpleStep.taskContract.output.type, 'file');
  assert.equal(simpleStep.taskContract.output.path, 'artifacts/simple');
  await restarted.addArtifact(simpleId, {
    id: 'simple-artifact',
    stepId: 'step-1',
    name: 'simple.txt',
    path: 'artifacts/simple/simple.txt',
    verified: true,
  });
  await restarted.recordVerification(simpleId, {
    id: 'simple-verification',
    stepId: 'step-1',
    label: 'Simple deliverable verification',
    status: 'passed',
    command: 'verify simple deliverable',
    detail: 'The simple deliverable exists',
  });
  const simpleRestarted = createTaskService(createTaskRuntimeStore(root));
  const simpleRestored = (await simpleRestarted.read({ taskId: simpleId })).runs[0];
  const simpleContext = await simpleRestarted.context(simpleId, { limit: 10 });
  const simpleNode = simpleRestored.adaptivePlanGraph.nodes.find((node) => node.id === 'step-1');
  assert.equal(simpleRestored.steps[0].taskContract.contractVersion, 1);
  assert.equal(simpleRestored.steps[0].evidence.some((item) => item.id === 'simple-artifact'), true);
  assert.equal(simpleNode.evidenceIds.includes('simple-artifact'), true);
  assert.equal(simpleContext.contractCoverage.complete, true);
  assert.equal(simpleContext.verifiedEvidence.length, 2);

  console.log(JSON.stringify({
    passed: true,
    rootTaskId: created.task.id,
    readyNodes: readyAdaptiveNodes(restored.adaptivePlanGraph).map((node) => node.id),
    responsibilityTasks: restored.steps.map((step) => step.responsibilityTaskId),
    persistedContractVersion: restored.steps[0].taskContract.contractVersion,
    simpleTaskId: simpleId,
    simpleVerifiedEvidence: simpleContext.verifiedEvidence.length,
    simpleContractCoverage: simpleContext.contractCoverage,
  }, null, 2));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
