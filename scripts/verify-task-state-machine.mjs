import assert from 'node:assert/strict';
import { allowedTaskRunTransitions, canTransitionTaskRun, transitionTaskRunStatus, validateTaskRunState } from '../src/engine/taskStateMachine.mjs';

assert.equal(canTransitionTaskRun('queued', 'running'), true);
assert.equal(canTransitionTaskRun('completed', 'queued'), false);
assert.equal(canTransitionTaskRun('failed', 'queued'), true);
assert(allowedTaskRunTransitions('running').includes('awaiting_user'));
const run = { id: 'run-1', status: 'queued', updatedAt: 1, executionSessionId: 'session-1' };
const running = transitionTaskRunStatus(run, 'running', { phase: 'executing' });
assert.equal(running.status, 'running');
assert.equal(validateTaskRunState(running).valid, true);
assert.throws(() => transitionTaskRunStatus({ ...running, status: 'completed' }, 'queued'), /非法任务状态迁移/);
assert.equal(validateTaskRunState({ status: 'failed' }).valid, false);
console.log(JSON.stringify({ passed: true, version: 1, terminal: ['completed', 'stopped'] }));
