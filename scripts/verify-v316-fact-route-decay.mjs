import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  FACT_LEDGER_VERSION,
  createFactLedger,
  openFactConflicts,
  recordFactObservation,
  resolveFactConflict,
} from '../src/engine/factLedger.mjs';
import {
  createExecutionController,
  observeExecutionResult,
  summarizeRoutePerformance,
} from '../src/engine/executionController.mjs';
import { memoryDecayScore } from '../src/engine/userMemoryQuality.mjs';
import { createMemoryManager, memoryDecayMultiplier } from '../electron/memoryManager.cjs';
import { reconcileAutonomousControl } from '../src/engine/autonomousControl.mjs';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-08-05T00:00:00.000Z');

let ledger = createFactLedger({
  now,
  observations: [{ factKey: 'connector:ima', statement: 'IMA 连接测试通过', source: 'connector-test', sourceId: 'evidence-1', verified: true, at: now }],
});
const repeated = recordFactObservation(ledger, { factKey: 'connector:ima', statement: 'IMA 连接测试通过', source: 'connector-test', sourceId: 'evidence-2', verified: true, at: now + 1 });
assert.equal(repeated.action, 'confirmed');
assert.equal(openFactConflicts(repeated.ledger).length, 0);
const conflicting = recordFactObservation(repeated.ledger, { factKey: 'connector:ima', statement: 'IMA 连接测试失败', source: 'connector-test', sourceId: 'evidence-3', verified: true, at: now + 2 });
assert.equal(conflicting.action, 'conflict');
assert.equal(conflicting.conflict.requiresUser, true);
assert.equal(openFactConflicts(conflicting.ledger).length, 1);
ledger = resolveFactConflict(conflicting.ledger, conflicting.conflict.id, 'accept_latest', { resolvedBy: 'test', now: now + 3 });
assert.equal(openFactConflicts(ledger).length, 0);
assert.equal(ledger.factVersions.at(-1).status, 'current');
assert.equal(FACT_LEDGER_VERSION, 1);

const conflictedRun = reconcileAutonomousControl({
  id: 'v316-conflict-run',
  teamId: 'team-v316',
  request: '核对连接状态',
  goal: '核对连接状态',
  status: 'queued',
  steps: [{ id: 'step-v316', title: '核对', order: 1, status: 'queued', dependsOnStepIds: [], employeeId: 'employee-v316' }],
  evidence: [
    { id: 'fact-a', factKey: 'connector:ima', summary: 'IMA 连接测试通过', source: 'connector-test', verified: true, ts: now },
    { id: 'fact-b', factKey: 'connector:ima', summary: 'IMA 连接测试失败', source: 'connector-test', verified: true, ts: now + 1 },
  ],
  memberSnapshot: [],
  createdAt: now,
  updatedAt: now + 1,
}, { now: now + 1 });
assert.equal(conflictedRun.situationModel.openFactConflicts.length, 1);
assert.equal(conflictedRun.autonomousControl.currentDecision.selectedAction.kind, 'await_user');

let controller = createExecutionController({ goal: '测试路线统计' });
controller = observeExecutionResult(controller, { toolName: 'read_web_page', routeKey: 'page:a', success: true, result: '页面已读取' });
controller = observeExecutionResult(controller, { toolName: 'read_web_page', routeKey: 'page:a', success: false, result: '页面内容不完整' });
const route = summarizeRoutePerformance(controller)[0];
assert.equal(route.attempts, 2);
assert.equal(route.successes, 1);
assert.equal(route.failures, 1);
assert.equal(route.successRate, 0.5);
assert.equal(route.failureRate, 0.5);

const freshUserMemory = { category: 'preference', content: '用户希望使用清晰的主题', updatedAt: now };
const staleUserMemory = { category: 'preference', content: '用户希望使用旧主题', updatedAt: now - 360 * DAY };
assert(memoryDecayScore(freshUserMemory, now) > memoryDecayScore(staleUserMemory, now));
const freshLayeredMemory = { memoryKind: 'semantic', content: 'fresh', updatedAt: now };
const staleLayeredMemory = { memoryKind: 'semantic', content: 'stale', updatedAt: now - 730 * DAY };
assert(memoryDecayMultiplier(freshLayeredMemory, now) > memoryDecayMultiplier(staleLayeredMemory, now));

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-v316-memory-'));
try {
  const manager = createMemoryManager(root);
  await manager.upsert({ scope: 'user', category: 'preference', memoryKind: 'preference', content: '新偏好', source: 'test', updatedAt: now });
  await manager.upsert({ scope: 'user', category: 'preference', memoryKind: 'preference', content: '旧偏好', source: 'test', updatedAt: now - 720 * DAY });
  const listed = await manager.list({ scope: 'user' });
  assert(listed.entries.every((entry) => typeof entry.decayScore === 'number'));
  const context = await manager.context({ query: '偏好', now, limit: 10 });
  assert(context.entries.every((entry) => typeof entry.decayScore === 'number'));
  assert.equal((await manager.list()).version, 3);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log(JSON.stringify({
  passed: true,
  factLedgerVersion: FACT_LEDGER_VERSION,
  conflictsHandled: 1,
  routeSuccessRate: route.successRate,
  decay: 'exponential-half-life',
}, null, 2));
