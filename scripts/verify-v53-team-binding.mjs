import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTaskService } = require('../electron/taskService.cjs');

const clone = (value) => structuredClone(value);
let runs = [{
  id: 'run-team-v53',
  teamId: 'team-v53',
  projectId: 'project-v53',
  conversationId: 'conversation-v53',
  workspaceId: 'projects/project-v53/tasks/team/run-team-v53',
  title: 'V5.3 team binding',
  request: 'Build a small verified project',
  goal: 'Build a small verified project',
  status: 'queued',
  phase: 'preflight',
  acceptanceCriteria: ['Each member step has durable evidence'],
  memberSnapshot: [
    { id: 'architect', name: 'Architect', title: 'Architect', role: 'custom', capabilities: ['architecture'] },
    { id: 'builder', name: 'Builder', title: 'Builder', role: 'custom', capabilities: ['coding'] },
  ],
  steps: [
    { id: 'step-architecture', employeeId: 'architect', title: 'Architecture', assignment: 'Define the design', dependsOnStepIds: [], status: 'queued', attempts: 0, evidence: [], events: [] },
    { id: 'step-build', employeeId: 'builder', title: 'Build', assignment: 'Implement the project', dependsOnStepIds: ['step-architecture'], status: 'queued', attempts: 0, evidence: [], events: [] },
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
}];

const store = {
  async read(options = {}) {
    const selected = options.taskId ? runs.filter((run) => run.id === options.taskId) : runs;
    return { ok: true, runs: clone(selected), integrity: { valid: true } };
  },
  async write(nextRuns) {
    runs = clone(nextRuns);
    return { ok: true };
  },
  async updateTask(taskId, mutate) {
    const index = runs.findIndex((run) => run.id === taskId);
    if (index < 0) return { ok: false, error: `missing ${taskId}` };
    const next = clone(runs[index]);
    mutate(next);
    next.updatedAt = Date.now();
    runs[index] = next;
    return { ok: true, run: clone(next) };
  },
};

const service = createTaskService(store);
const first = await service.ensureTeamExecutionBinding({
  taskId: 'run-team-v53',
  run: runs[0],
  members: runs[0].memberSnapshot,
});
assert.equal(first.ok, true);
assert.equal(first.bindings.length, 2);

let root = (await store.read({ taskId: 'run-team-v53' })).runs[0];
const childIds = root.steps.map((step) => step.responsibilityTaskId);
assert.ok(childIds.every(Boolean), 'every fixed member step must have a responsibility task');
assert.equal(new Set(childIds).size, 2, 'responsibility task ids must be unique');
assert.ok(root.executionBinding?.kind === 'team-root');

const second = await service.ensureTeamExecutionBinding({ taskId: 'run-team-v53', run: root, members: root.memberSnapshot });
assert.equal(second.bindings.length, 2);
root = (await store.read({ taskId: 'run-team-v53' })).runs[0];
assert.deepEqual(root.steps.map((step) => step.responsibilityTaskId), childIds, 'rebinding must be idempotent');
assert.equal((await store.read()).runs.length, 3, 'rebinding must not create duplicate child tasks');

const childId = childIds[0];
await service.setStatus(childId, 'running', 'Architect started');
await service.recordToolAttempt(childId, {
  id: 'attempt-v53-child', stepId: 'step-1', toolName: 'write_file', status: 'succeeded',
  inputSummary: '{"path":"plan.md"}', outputSummary: 'plan.md written', evidenceIds: ['plan.md'],
});
await service.addArtifact(childId, { id: 'artifact-v53-child', name: 'plan.md', path: 'artifacts/final/plan.md', verified: true, category: 'final' });
await service.completeStep(childId, { stepId: 'step-1', summary: 'Architecture submitted', output: { summary: 'Architecture submitted' } });
await service.setStatus(childId, 'completed', 'Architect completed');
await service.recordSteering('run-team-v53', { message: 'Please prioritize the smallest usable version', route: { action: 'replan', shouldPreempt: true }, affectedStepIds: ['step-build'] });

const child = (await store.read({ taskId: childId })).runs[0];
const finalRoot = (await store.read({ taskId: 'run-team-v53' })).runs[0];
assert.equal(child.status, 'completed');
assert.equal(child.toolAttempts.length, 1);
assert.equal(child.artifacts[0].verified, true);
assert.equal(finalRoot.steeringHistory.length, 1);
assert.equal(finalRoot.steeringHistory[0].affectedStepIds[0], 'step-build');

console.log('V5.3 team execution binding gate passed');
