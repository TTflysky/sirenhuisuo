const assert = require('node:assert/strict');
const { buildTaskObservability, createExecutionObservability, projectExecutionState, taskEvidenceCompleteness } = require('../electron/executionObservability.cjs');

let clock = 1_000;
const tracker = createExecutionObservability({ now: () => clock });
const queuedJob = { taskId: 'obs-1', jobId: 'job-1', state: 'queued', currentActivity: 'Waiting in queue' };
tracker.record({ taskId: 'obs-1', type: 'job_queued', occurredAt: clock, job: queuedJob, activity: 'Waiting in queue' });
clock += 100;
tracker.record({ taskId: 'obs-1', type: 'model_retry', occurredAt: clock, job: { ...queuedJob, state: 'running' }, activity: 'Retrying model' });
clock += 100;
tracker.record({ taskId: 'obs-1', type: 'tool_result', occurredAt: clock, job: { ...queuedJob, state: 'running' }, success: false, failureClass: 'network', artifacts: [] });
clock += 100;
tracker.record({ taskId: 'obs-1', type: 'tool_result', occurredAt: clock, job: { ...queuedJob, state: 'waiting_children' }, success: true, artifacts: [{ path: 'report.md', verified: true }] });
clock += 100;
tracker.record({ taskId: 'obs-1', type: 'job_completed', occurredAt: clock, job: { ...queuedJob, state: 'completed' } });

const live = tracker.get('obs-1');
assert.equal(live.retries, 1);
assert.deepEqual(live.tools, { total: 2, succeeded: 1, failed: 1 });
assert.equal(live.failures.network, 1);
assert.deepEqual(live.evidence, { total: 1, verified: 1 });
assert.equal(live.semanticState.status, 'completed');
assert.equal(live.durationMs, 400);
assert.deepEqual(projectExecutionState({ state: 'waiting_children' }), { status: 'running', phase: 'waiting_for_children', rawState: 'waiting_children', active: true, terminal: false, waiting: true });
assert.deepEqual(projectExecutionState({ state: 'compensating_queue' }), { status: 'running', phase: 'compensating', rawState: 'compensating_queue', active: true, terminal: false, waiting: false });

const fileTask = {
  id: 'obs-file', status: 'completed', phase: 'delivery', createdAt: 10, completedAt: 210, deliverableType: 'file',
  steps: [{ id: 'write', status: 'completed', deliverableType: 'file', attempts: 2 }],
  artifacts: [{ id: 'final', category: 'final', verified: true }],
  verifications: [{ status: 'passed' }],
  toolAttempts: [{ status: 'failed', errorClass: 'timeout' }, { status: 'succeeded' }],
  usage: { modelRounds: 3, toolCalls: 2 }, recoveryContext: { budget: { estimatedTokens: 120 } },
};
assert.deepEqual(taskEvidenceCompleteness(fileTask), { required: 1, verifiedArtifacts: 1, passedVerifications: 1, complete: true, missing: [] });
const taskMetrics = buildTaskObservability(fileTask, { queuePosition: undefined });
assert.equal(taskMetrics.durationMs, 200);
assert.equal(taskMetrics.retries, 1);
assert.equal(taskMetrics.failureClasses.timeout, 1);
assert.equal(taskMetrics.evidence.complete, true);

const missingEvidence = taskEvidenceCompleteness({ ...fileTask, artifacts: [], verifications: [] });
assert.equal(missingEvidence.complete, false);
assert(missingEvidence.missing.includes('verified_execution_evidence'));
assert(missingEvidence.missing.includes('verified_final_artifact'));

console.log('verify-execution-observability: PASS');
