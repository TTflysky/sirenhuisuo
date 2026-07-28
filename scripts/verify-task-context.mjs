import assert from 'node:assert/strict';
import {
  appendTaskContextEvent,
  buildTaskContextPrompt,
  createTaskContext,
  restoreTaskContext,
  searchTaskContext,
} from '../src/engine/taskContext.mjs';

let context = createTaskContext({
  taskId: 'context-test',
  goal: '生成并验收脚本',
  acceptanceCriteria: ['有真实文件', '审查通过'],
});
context = appendTaskContextEvent(context, { type: 'decision', source: 'system', summary: '先由编写者生成脚本，再由审查者验收', verified: true });
context = appendTaskContextEvent(context, { type: 'progress', source: 'tool', stepId: 'write', summary: 'write_file 已生成 script.js', verified: true });
context = appendTaskContextEvent(context, { type: 'blocked', source: 'review', stepId: 'review', summary: '审查发现参数校验缺失', verified: false });

assert.equal(context.decisions.length, 1);
assert.equal(context.openIssues.length, 1);
assert.equal(searchTaskContext(context, '参数校验')[0].stepId, 'review');
assert.match(buildTaskContextPrompt(context), /已生成 script\.js/u);
const restored = restoreTaskContext({ taskId: 'legacy', goal: '旧任务', events: [] }, { acceptanceCriteria: ['继续完成'] });
assert.equal(restored.contextVersion, 1);
assert.deepEqual(restored.acceptanceCriteria, ['继续完成']);
console.log(JSON.stringify({ passed: true, events: context.events.length, issues: context.openIssues.length }));
