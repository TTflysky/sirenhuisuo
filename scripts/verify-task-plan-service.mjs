import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTaskRuntimeStore } = require('../electron/taskRuntimeStore.cjs');
const { createTaskService } = require('../electron/taskService.cjs');
const root = await mkdtemp(path.join(os.tmpdir(), 'taiji-task-plan-'));
try {
  const service = createTaskService(createTaskRuntimeStore(root));
  const result = await service.create({
    taskType: 'team', goal: '验证步骤依赖', idempotencyKey: 'plan-001',
    steps: [
      { id: 'first', title: '第一步', employeeId: 'one' },
      { id: 'second', title: '第二步', employeeId: 'two', dependsOnStepIds: ['first'] },
    ],
  });
  assert.equal(result.task.plan.planVersion, 1);
  assert.equal(result.task.contract.constraints.requiresEvidence, true);
  let ready = await service.readySteps(result.task.id);
  assert.deepEqual(ready.steps.map((step) => step.id), ['first']);
  await service.completeStep(result.task.id, { stepId: 'first', summary: '第一步已验证' });
  ready = await service.readySteps(result.task.id);
  assert.deepEqual(ready.steps.map((step) => step.id), ['second']);
  await service.failStep(result.task.id, { stepId: 'second', error: '网络超时', retryable: true });
  ready = await service.readySteps(result.task.id);
  assert.deepEqual(ready.steps.map((step) => step.id), ['second']);
  console.log('verify-task-plan-service: PASS');
} finally {
  await rm(root, { recursive: true, force: true });
}
