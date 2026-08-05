import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  applyExternalCapabilityProbe,
  createExternalCapabilityMatrix,
} from '../src/engine/externalCapabilityMatrix.mjs';
import {
  buildUnifiedHostState,
  capabilityKindForTool,
  validateUnifiedHostAction,
} from '../src/engine/unifiedHost.mjs';
import { reconcileAutonomousControl } from '../src/engine/autonomousControl.mjs';
import { createFactLedger, recordFactObservation } from '../src/engine/factLedger.mjs';
import { createTaskService } from '../electron/taskService.cjs';

const now = Date.parse('2026-08-05T00:00:00.000Z');
const profile = { id: 'connector:web', kind: 'web_page', label: 'Web', configured: true, resourceIdentity: 'https://example.test' };
let matrix = createExternalCapabilityMatrix([profile]);
matrix = applyExternalCapabilityProbe(matrix, { profile, actualCall: true, ok: true, validated: true, responseReceived: true, checkedAt: now });

assert.equal(capabilityKindForTool('web_search'), 'web_page');
const readyHost = buildUnifiedHostState({ taskId: 'task-ready', goalId: 'goal-ready', goal: 'read a page', entrypoint: 'team', capabilityMatrix: matrix, requiredCapabilities: ['web_page'], now });
assert.equal(readyHost.singleHost, true);
assert.equal(readyHost.entrypoint, 'team');
assert.equal(readyHost.capabilityReadiness.ready, true);

const blockedMatrix = createExternalCapabilityMatrix([{ ...profile, configured: false }]);
const blockedHost = buildUnifiedHostState({ taskId: 'task-blocked', goalId: 'goal-blocked', goal: 'read a page', entrypoint: 'worker', capabilityMatrix: blockedMatrix, requiredCapabilities: ['web_page'], now });
assert.equal(blockedHost.capabilityReadiness.enforced, true);
assert.equal(blockedHost.capabilityReadiness.ready, false);
assert.equal(blockedHost.capabilityReadiness.blocked.length, 1);
assert.equal(blockedHost.capabilityReadiness.missing.length, 0);
assert.equal(validateUnifiedHostAction({
  run: { id: 'task-blocked', goalState: { goalId: 'goal-blocked' }, capabilityMatrix: blockedMatrix },
  action: { kind: 'use_tool', toolName: 'web_search' },
  capabilityMatrix: blockedMatrix,
  requiredCapabilities: ['web_page'],
}).allowed, false);

const legacyHost = buildUnifiedHostState({ taskId: 'legacy', goalId: 'legacy-goal', goal: 'legacy task', requiredCapabilities: ['web_page'] });
assert.equal(legacyHost.capabilityReadiness.enforced, false);
assert.equal(legacyHost.capabilityReadiness.ready, true);

const reconciled = reconcileAutonomousControl({
  id: 'task-reconcile', taskType: 'team', teamId: 'team-v317', request: 'read a page', goal: 'read a page',
  requiredCapabilities: ['web_page'], capabilityMatrix: blockedMatrix, status: 'queued',
  steps: [{ id: 'step-1', title: 'Read', order: 1, status: 'queued', dependsOnStepIds: [], employeeId: 'employee-1' }],
  memberSnapshot: [], createdAt: now, updatedAt: now,
}, { now });
assert.equal(reconciled.unifiedHost.entrypoint, 'team');
assert.equal(reconciled.autonomousControl.currentDecision.selectedAction.kind, 'await_user');

let ledger = createFactLedger({ now, observations: [{ factKey: 'connector:web', statement: 'available', source: 'test', verified: true, at: now }] });
const conflict = recordFactObservation(ledger, { factKey: 'connector:web', statement: 'unavailable', source: 'test', verified: true, at: now + 1 });
ledger = conflict.ledger;
let runs = [{ id: 'task-conflict', teamId: 'team-v317', status: 'queued', steps: [], factLedger: ledger, situationModel: { factLedger: ledger } }];
const store = {
  async read(options = {}) { return { ok: true, runs: options.taskId ? runs.filter((run) => run.id === options.taskId) : runs }; },
  async write(next) { runs = next; return { ok: true }; },
  async updateTask(taskId, mutate) { const task = runs.find((run) => run.id === taskId); assert.ok(task); mutate(task); return { ok: true }; },
};
const service = createTaskService(store);
const resolved = await service.resolveFactConflict('task-conflict', { conflictId: conflict.conflict.id, resolution: 'accept_latest', resolvedBy: 'verify-v317' });
assert.equal(resolved.ok, true);
assert.equal(resolved.task.factLedger.conflicts.at(-1).status, 'resolved');

const [ipc, preload, taskService] = await Promise.all([
  fs.readFile(new URL('../electron/taskServiceIpc.cjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../electron/taskService.cjs', import.meta.url), 'utf8'),
]);
assert.match(ipc, /task-service:resolve-fact-conflict/u);
assert.match(preload, /taskServiceResolveFactConflict/u);
assert.match(taskService, /resolveFactConflict/u);

console.log(JSON.stringify({
  passed: true,
  unifiedHostVersion: readyHost.hostVersion,
  entrypoints: ['assistant', 'employee', 'team', 'worker', 'background'],
  capabilityPreflight: { ready: readyHost.capabilityReadiness.ready, blocked: blockedHost.capabilityReadiness.ready === false },
  factConflictResolution: resolved.task.factLedger.conflicts.at(-1).resolution,
}, null, 2));
