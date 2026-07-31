const assert = require('assert');
const {
  toolKey,
  isPreparationTool,
  isVerifiedArtifact,
  inferStepDeliverableType,
  compensationNeedsApproval,
  summarizeChildTask,
  buildChildTaskContext,
  buildInheritedTaskContext,
  resolveEndpoint,
  modelName,
  publicMember,
} = require('../electron/nativeExecutionPolicy.cjs');

assert.equal(resolveEndpoint({ apiHost: 'https://api.example.com' }), 'https://api.example.com/v1/chat/completions');
assert.equal(resolveEndpoint({ apiHost: 'https://api.example.com/v1/' }), 'https://api.example.com/v1/chat/completions');
assert.equal(resolveEndpoint({ apiHost: 'https://api.example.com/v1/chat/completions' }), 'https://api.example.com/v1/chat/completions');
assert.throws(() => resolveEndpoint({}), /API 地址/u);

assert.equal(inferStepDeliverableType({ assignment: '创建并验证 HTML 页面' }, {}), 'file');
assert.equal(inferStepDeliverableType({ assignment: '连接 Obsidian 知识库' }, {}), 'connection');
assert.equal(inferStepDeliverableType({ assignment: '部署并运行服务' }, {}), 'operation');
assert.equal(inferStepDeliverableType({ assignment: '评审产品方案' }, {}), 'decision');
assert.equal(inferStepDeliverableType({}, { contract: { deliverableType: 'mixed' } }), 'mixed');

assert.equal(compensationNeedsApproval({ assignment: '删除已发布页面' }, {}), true);
assert.equal(compensationNeedsApproval({ assignment: '清理本地草稿' }, {}), false);
assert.equal(compensationNeedsApproval({ approvalRequired: true }, {}), true);
assert.equal(isVerifiedArtifact({ verified: true, persistence: 'disk', diskPath: 'C:/out/report.md', path: 'report.md' }), true);
assert.equal(isVerifiedArtifact({ verified: true, path: 'report.md' }), false);

assert.equal(isPreparationTool('read_file'), true);
assert.equal(isPreparationTool('write_file'), false);
assert.equal(toolKey('run_command', { b: 2, a: 1 }), toolKey('run_command', { a: 1, b: 2 }));

const child = {
  id: 'child-1', title: '实现界面', goal: '交付真实页面', status: 'completed',
  steps: [{ id: 's1', title: '实现', status: 'completed', output: { summary: '页面已构建并验证' } }],
  artifacts: [{ verified: true, name: 'index.html', path: 'final/index.html', category: 'final', verification: 'read-back' }],
};
const summary = summarizeChildTask(child);
assert.equal(summary.summary, '页面已构建并验证');
assert.equal(summary.artifacts.length, 1);
assert.match(buildChildTaskContext({ childTaskResults: { child: summary } }), /已验收的子任务交接/u);
assert.match(buildInheritedTaskContext({ inheritedContext: { parentGoal: '完成客户端', acceptanceCriteria: ['可以运行'], verifiedArtifacts: [{ path: 'dist/app.exe' }] } }), /dist\/app\.exe/u);
assert.equal(modelName({}), 'gpt-4o-mini');
assert.deepEqual(publicMember({ id: 'e1', name: '前端工程师', title: '前端', role: 'coder', modelConfig: { model: 'gpt-5' }, secret: 'hidden' }), {
  id: 'e1', name: '前端工程师', title: '前端', role: 'coder', model: 'gpt-5',
});

console.log(JSON.stringify({ passed: true, policies: 11 }, null, 2));
