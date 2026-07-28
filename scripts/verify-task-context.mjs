import assert from 'node:assert/strict';
import {
  appendTaskContextEvent,
  applyModelTaskSummary,
  buildTaskContextPrompt,
  buildTaskSummaryMaterial,
  compactTaskContext,
  createTaskContext,
  restoreTaskContext,
  searchTaskContext,
  shouldModelSummarizeTaskContext,
} from '../src/engine/taskContext.mjs';

let context = createTaskContext({
  taskId: 'context-test',
  goal: '生成并验收脚本',
  acceptanceCriteria: ['有真实文件', '审查通过'],
});
context = appendTaskContextEvent(context, { type: 'decision', source: 'system', summary: '先由编写者生成脚本，再由审查者验收', verified: true });
context = appendTaskContextEvent(context, { type: 'progress', source: 'tool', stepId: 'write', summary: 'write_file 已生成 script.js', verified: true });
context = appendTaskContextEvent(context, {
  type: 'progress', source: 'tool', stepId: 'write', summary: 'script.js 已重新读取并验证', verified: true,
  data: { artifact: { path: 'script.js', diskPath: 'C:/workspace/script.js' } },
});
context = appendTaskContextEvent(context, {
  type: 'progress', source: 'tool', stepId: 'verify', summary: '连接器客户端验证通过', verified: true,
  data: { connectorProtocol: { protocolVersion: 1, stage: 'completed', ok: true, latencyMs: 18 } },
});
context = appendTaskContextEvent(context, { type: 'blocked', source: 'review', stepId: 'review', summary: '审查发现参数校验缺失', verified: false });

assert.equal(context.decisions.length, 1);
assert.equal(context.openIssues.length, 1);
assert.equal(searchTaskContext(context, '参数校验')[0].stepId, 'review');
assert.match(buildTaskContextPrompt(context), /已生成 script\.js/u);
assert.equal(context.events.find((event) => event.stepId === 'verify')?.data?.connectorProtocol?.stage, 'completed');
assert.deepEqual(context.summary.artifactPaths, ['script.js']);
assert.match(context.summary.narrative, /已验证/u);

const restored = restoreTaskContext({ contextVersion: 1, taskId: 'legacy', goal: '旧任务', events: [] }, { acceptanceCriteria: ['继续完成'] });
assert.equal(restored.contextVersion, 2);
assert.deepEqual(restored.acceptanceCriteria, ['继续完成']);

let longContext = createTaskContext({ taskId: 'long', goal: '长任务上下文压缩' });
for (let index = 0; index < 130; index += 1) {
  longContext = appendTaskContextEvent(longContext, {
    ts: 1000 + index,
    type: 'progress',
    source: index % 2 === 0 ? 'tool' : 'member',
    stepId: `step-${index}`,
    summary: `第 ${index} 步执行记录：${'已完成结构化处理并保留验证信息。'.repeat(12)}`,
    verified: index % 3 === 0,
  });
}
longContext = compactTaskContext(longContext);
assert.equal(longContext.events.length, 120);
assert.equal(longContext.events[0].stepId, 'step-10');
assert.equal(longContext.summary.sourceEventCount, 130);
assert.equal(shouldModelSummarizeTaskContext(longContext), true);
assert.match(buildTaskSummaryMaterial(longContext), /长任务上下文压缩/u);

const withModelSummary = applyModelTaskSummary(longContext, {
  narrative: '已完成前置处理，下一步从未决验收继续。',
  modelName: 'summary-model',
  sourceEventCount: longContext.summary.sourceEventCount,
});
assert.equal(withModelSummary.summary.modelName, 'summary-model');
assert.equal(withModelSummary.summary.modelCoveredEventCount, 130);
assert.equal(shouldModelSummarizeTaskContext(withModelSummary), false);
assert.match(buildTaskContextPrompt(withModelSummary), /仅用于导航/u);

const withHistory = appendTaskContextEvent(withModelSummary, {
  type: 'history', source: 'system', summary: '找到相似历史任务', data: { taskIds: ['old-1', 'old-2'] },
});
assert.deepEqual(withHistory.relatedTaskIds, ['old-1', 'old-2']);
let refreshedContext = withHistory;
for (let index = 0; index < 4; index += 1) {
  refreshedContext = appendTaskContextEvent(refreshedContext, { type: 'progress', source: 'tool', summary: `摘要后新增执行记录 ${index}` });
}
assert.equal(refreshedContext.summary.sourceEventCount, 135);
assert.equal(shouldModelSummarizeTaskContext(refreshedContext), true);

console.log(JSON.stringify({ passed: true, events: refreshedContext.events.length, sourceEvents: refreshedContext.summary.sourceEventCount, issues: context.openIssues.length, contextVersion: restored.contextVersion }));
