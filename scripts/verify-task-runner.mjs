import assert from 'node:assert/strict';
import { createPlan, createTaskContract } from '../src/engine/taskPlan.mjs';
import {
  approveTaskStep,
  appendTaskRunnerSteps,
  beginTaskStep,
  createTaskRunner,
  getRunnableTaskSteps,
  recordTaskStepResult,
  recordTaskReviewDecision,
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

const revisionPlan = createPlan({
  planId: 'review-revision-plan', contract,
  steps: [
    { stepId: 'draft', type: 'tool', connector: 'team-member:writer', expectedOutputSchema: { type: 'object' }, sideEffect: true, idempotencyKey: 'draft-v1' },
    { stepId: 'review-v1', type: 'review', connector: 'team-member:reviewer', expectedOutputSchema: { type: 'object' }, dependsOn: ['draft'] },
  ],
});
let revisionRunner = createTaskRunner(revisionPlan, { traceId: 'trace-review-revision' });
revisionRunner = beginTaskStep(revisionRunner, 'draft');
revisionRunner = recordTaskStepResult(revisionRunner, { stepId: 'draft', success: true, output: { path: 'draft.md' } });
revisionRunner = beginTaskStep(revisionRunner, 'review-v1');
revisionRunner = recordTaskReviewDecision(revisionRunner, {
  stepId: 'review-v1', approved: false, reason: '缺少风险说明', responsibleStepId: 'draft', responsibleEmployeeId: 'writer', checkedArtifacts: ['draft.md'],
});
revisionRunner = appendTaskRunnerSteps(revisionRunner, [
  {
    stepId: 'revision-v1', type: 'tool', connector: 'team-member:writer', input: {}, expectedOutputSchema: { type: 'object' },
    dependsOn: ['review-v1'], retryPolicy: { maxRetries: 3, backoffMs: 1000, maxBackoffMs: 30000 }, idempotencyKey: 'revision-v1', sideEffect: true,
    compensateStepId: '', approvalRequired: false, metadata: { revisionOfStepId: 'draft' },
  },
  {
    stepId: 'review-v2', type: 'review', connector: 'team-member:reviewer', input: {}, expectedOutputSchema: { type: 'object' },
    dependsOn: ['revision-v1'], retryPolicy: { maxRetries: 3, backoffMs: 1000, maxBackoffMs: 30000 }, idempotencyKey: '', sideEffect: false,
    compensateStepId: '', approvalRequired: false, metadata: {},
  },
]);
assert.deepEqual(getRunnableTaskSteps(revisionRunner).map((step) => step.stepId), ['revision-v1']);
revisionRunner = beginTaskStep(revisionRunner, 'revision-v1');
revisionRunner = recordTaskStepResult(revisionRunner, { stepId: 'revision-v1', success: true, output: { path: 'draft.md', revision: 1 } });
revisionRunner = beginTaskStep(revisionRunner, 'review-v2');
revisionRunner = recordTaskReviewDecision(revisionRunner, { stepId: 'review-v2', approved: true, reason: '风险说明完整', checkedArtifacts: ['draft.md'] });
assert.equal(revisionRunner.status, 'completed');
assert.equal(revisionRunner.reviews.length, 2);
assert.equal(revisionRunner.events.some((event) => event.type === 'review_rejected' && event.responsibleStepId === 'draft'), true);
assert.equal(revisionRunner.events.some((event) => event.type === 'plan_extended'), true);

console.log(JSON.stringify({ passed: true, events: restored.events.length, traceId: restored.traceId, revisionEvents: revisionRunner.events.length, reviews: revisionRunner.reviews.length }));
