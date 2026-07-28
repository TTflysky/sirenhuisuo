import assert from 'node:assert/strict';
import { createPlan, createTaskContract } from '../src/engine/taskPlan.mjs';
import {
  approveTaskStep,
  beginTaskStep,
  createTaskRunner,
  getRunnableTaskSteps,
  recordTaskStepResult,
  restoreTaskRunner,
} from '../src/engine/taskRunner.mjs';

const contract = createTaskContract({
  contractId: 'runner-contract',
  decision: { mode: 'execute', goal: '先生成文件再审查', primaryRoute: 'team_dispatch', acceptanceCriteria: ['有文件', '审查通过'] },
});
const plan = createPlan({
  planId: 'runner-plan', contract,
  steps: [
    { stepId: 'write', type: 'tool', connector: 'write_file', expectedOutputSchema: { type: 'object' }, sideEffect: true, idempotencyKey: 'runner-write' },
    { stepId: 'review', type: 'review', connector: 'review', expectedOutputSchema: { type: 'object' }, dependsOn: ['write'], approvalRequired: true },
  ],
});
let runner = createTaskRunner(plan, { traceId: 'trace-runner' });
assert.deepEqual(getRunnableTaskSteps(runner).map((step) => step.stepId), ['write']);
runner = beginTaskStep(runner, 'write');
runner = recordTaskStepResult(runner, { stepId: 'write', success: false, retryable: true, error: 'network timeout' });
assert.equal(runner.steps[0].status, 'pending');
runner = beginTaskStep(runner, 'write');
runner = recordTaskStepResult(runner, { stepId: 'write', success: true, output: { path: 'out.md' } });
assert.equal(getRunnableTaskSteps(runner).length, 0);
runner = beginTaskStep(runner, 'review');
assert.equal(runner.status, 'waiting_approval');
runner = approveTaskStep(runner, 'review', 'approved');
runner = beginTaskStep(runner, 'review');
runner = recordTaskStepResult(runner, { stepId: 'review', success: true, output: { passed: true } });
assert.equal(runner.status, 'completed');
const restored = restoreTaskRunner(runner);
assert.equal(restored.status, 'completed');
assert.equal(restored.idempotency['runner-write'].status, 'succeeded');
console.log(JSON.stringify({ passed: true, events: restored.events.length, traceId: restored.traceId }));
