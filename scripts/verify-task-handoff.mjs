import assert from 'node:assert/strict';
import { createTaskHandoff, mergeTaskHandoff, validateTaskHandoff } from '../src/engine/taskHandoff.mjs';

const initial = createTaskHandoff({
  taskId: 'run-1', completed: ['需求拆解'], completedEvidence: ['已写入 brief.md'],
  blockers: [{ category: 'network', summary: '搜索服务超时', retryable: true, stepId: 'research' }],
  attemptedRoutes: ['web_search'], nextAction: '等待网络恢复后重试',
});
assert.equal(validateTaskHandoff(initial).valid, true);
assert.equal(initial.blockers[0].category, 'network');
const merged = mergeTaskHandoff(initial, { completed: ['需求拆解', '方案设计'], completedEvidence: ['已写入 plan.md'], clearBlockers: true, attemptedRoutes: ['connector_fallback'] });
assert.deepEqual(merged.completed, ['需求拆解', '方案设计']);
assert.equal(merged.blockers.length, 0);
assert.deepEqual(merged.attemptedRoutes, ['web_search', 'connector_fallback']);
assert.equal(validateTaskHandoff({ ...merged, nextAction: '' }).valid, false);
console.log(JSON.stringify({ passed: true, version: initial.handoffVersion, completed: merged.completed.length }));
