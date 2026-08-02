const assert = require('assert');
const {
  toolKey,
  toolCacheKey,
  isWorkspaceMutationTool,
  isWorkspaceSnapshotTool,
  isPreparationTool,
  isVerifiedArtifact,
  inferStepDeliverableType,
  supportsDynamicDelegation,
  toolAvailableForStep,
  structuredReviewCompletesStep,
  verifiedFileStepCompletesStep,
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
assert.equal(inferStepDeliverableType({ kind: 'review', deliverableType: 'mixed' }, {}), 'decision');
assert.equal(inferStepDeliverableType({}, { contract: { deliverableType: 'mixed' } }), 'mixed');
assert.equal(supportsDynamicDelegation({}), true);
assert.equal(supportsDynamicDelegation({ codingProject: { codingProjectVersion: 2 } }), false);
assert.equal(toolAvailableForStep('delegate_subtask', { codingProject: { codingProjectVersion: 2 } }, { kind: 'work' }), false);
assert.equal(toolAvailableForStep('submit_review', {}, { kind: 'work' }), false);
assert.equal(toolAvailableForStep('submit_review', {}, { kind: 'review' }), true);
assert.equal(toolAvailableForStep('write_file', {}, { kind: 'work' }), true);
assert.equal(structuredReviewCompletesStep({ kind: 'work' }, 'decision', { decision: 'pass' }), false);
assert.equal(structuredReviewCompletesStep({ kind: 'review' }, 'decision', { decision: 'reject' }), true);
assert.equal(structuredReviewCompletesStep({ kind: 'review', deliverableType: 'mixed' }, 'mixed', { decision: 'reject' }), true);
assert.equal(verifiedFileStepCompletesStep(
  { kind: 'work' },
  'file',
  [{ name: 'run_command', success: true, args: '{"cmd":"node --check app.js","verification":true}' }],
  [{ kind: 'file', verified: true }],
), true);
assert.equal(verifiedFileStepCompletesStep({ kind: 'work' }, 'file', [], [{ kind: 'file', verified: true }]), false);
assert.equal(verifiedFileStepCompletesStep({ kind: 'review' }, 'file', [{ name: 'run_command', success: true, args: '{"verification":true}' }], [{ kind: 'file', verified: true }]), false);

assert.equal(compensationNeedsApproval({ assignment: '删除已发布页面' }, {}), true);
assert.equal(compensationNeedsApproval({ assignment: '清理本地草稿' }, {}), false);
assert.equal(compensationNeedsApproval({ approvalRequired: true }, {}), true);
assert.equal(isVerifiedArtifact({ verified: true, persistence: 'disk', diskPath: 'C:/out/report.md', path: 'report.md' }), true);
assert.equal(isVerifiedArtifact({ verified: true, path: 'report.md' }), false);

assert.equal(isPreparationTool('read_file'), true);
assert.equal(isPreparationTool('write_file'), false);
assert.equal(toolKey('run_command', { b: 2, a: 1 }), toolKey('run_command', { a: 1, b: 2 }));
assert.equal(isWorkspaceMutationTool('write_file', {}), true);
assert.equal(isWorkspaceMutationTool('run_command', { verification: false }), true);
assert.equal(isWorkspaceSnapshotTool('run_command', { verification: true }), true);
assert.notEqual(toolCacheKey('read_file', { path: 'app.js' }, 1), toolCacheKey('read_file', { path: 'app.js' }, 2));
assert.equal(toolCacheKey('web_search', { query: 'Taiji' }, 1), toolCacheKey('web_search', { query: 'Taiji' }, 2));

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

console.log(JSON.stringify({ passed: true, policies: 27 }, null, 2));
