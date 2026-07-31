import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { createEventFanout } from '../src/engine/eventFanout.mjs';

const require = createRequire(import.meta.url);
const { createExecutionObservability } = require('../electron/executionObservability.cjs');
const { publicMember } = require('../electron/nativeExecutionPolicy.cjs');

const catalogSource = await fs.readFile(new URL('../src/data/generatedExpertCatalog.ts', import.meta.url), 'utf8');
const expertCount = (catalogSource.match(/"id":\s*"agency:/gu) || []).length;
assert.ok(expertCount >= 200, `expected the full expert catalog, found ${expertCount}`);

const employees = Array.from({ length: Math.max(320, expertCount) }, (_, index) => ({
  id: `employee-${index}`,
  name: `专家 ${index}`,
  title: index % 3 === 0 ? '工程部' : index % 3 === 1 ? '设计部' : '项目管理',
  role: index % 5 === 0 ? 'coder' : 'custom',
  isOnline: index % 7 !== 0,
  modelConfig: { model: 'gpt-5' },
}));
const rosterStartedAt = performance.now();
let projected = [];
for (let iteration = 0; iteration < 500; iteration += 1) {
  projected = employees.filter((employee) => employee.isOnline).map(publicMember);
}
const rosterDurationMs = performance.now() - rosterStartedAt;
assert.ok(projected.length > 250);
assert.ok(rosterDurationMs < 1500, `large roster projection took ${rosterDurationMs.toFixed(1)}ms`);

const beforeHeap = process.memoryUsage().heapUsed;
const observability = createExecutionObservability();
const taskStartedAt = performance.now();
for (let task = 0; task < 40; task += 1) {
  for (let sequence = 0; sequence < 300; sequence += 1) {
    observability.record({
      taskId: `task-${task}`,
      occurredAt: sequence + 1,
      type: sequence % 25 === 0 ? 'model_retry' : sequence % 5 === 0 ? 'tool_result' : 'activity',
      success: sequence % 40 !== 0,
      job: { state: sequence === 299 ? 'completed' : 'running' },
    });
  }
}
const taskDurationMs = performance.now() - taskStartedAt;
const heapDeltaMb = Math.max(0, process.memoryUsage().heapUsed - beforeHeap) / 1024 / 1024;
assert.equal(observability.list().length, 40);
assert.ok(taskDurationMs < 1500, `long task projection took ${taskDurationMs.toFixed(1)}ms`);
assert.ok(heapDeltaMb < 64, `long task projection retained ${heapDeltaMb.toFixed(1)}MB`);

const fanout = createEventFanout();
const received = Array(12).fill(0);
const unsubscribe = received.map((_, index) => fanout.subscribe('store:action', () => { received[index] += 1; }));
const fanoutStartedAt = performance.now();
for (let event = 0; event < 5000; event += 1) fanout.deliver('store:action', { event });
const fanoutDurationMs = performance.now() - fanoutStartedAt;
assert.ok(received.every((count) => count === 5000), 'every simulated window must receive every event');
unsubscribe.forEach((off) => off());
assert.equal(fanout.listenerCount(), 0, 'closed windows must not leave event listeners behind');
assert.ok(fanoutDurationMs < 1500, `multi-window fanout took ${fanoutDurationMs.toFixed(1)}ms`);

console.log(JSON.stringify({
  passed: true,
  expertCount,
  employees: employees.length,
  rosterDurationMs: Math.round(rosterDurationMs),
  taskEvents: 12000,
  taskDurationMs: Math.round(taskDurationMs),
  heapDeltaMb: Number(heapDeltaMb.toFixed(2)),
  windows: 12,
  fanoutEvents: 5000,
  fanoutDurationMs: Math.round(fanoutDurationMs),
}, null, 2));
