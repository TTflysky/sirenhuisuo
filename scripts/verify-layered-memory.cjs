const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createMemoryManager } = require('../electron/memoryManager.cjs');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-memory-'));
  try {
    const manager = createMemoryManager(root, { limits: { organization: 1800, team: 1600, employee: 1200, user: 1200 } });
    const organization = await manager.upsert({ scope: 'organization', category: 'constraint', content: '所有连接器完成前必须做真实调用验证', source: '测试', importance: 5, confidence: 1 });
    assert.equal(organization.ok, true);
    const team = await manager.upsert({ scope: 'team', scopeId: 'team-a', category: 'workflow', content: '甲团队发布前先运行完整回归', source: '测试任务', sourceType: 'task-review', importance: 4, confidence: 0.95 });
    assert.equal(team.action, 'added');
    const duplicate = await manager.upsert({ scope: 'team', scopeId: 'team-a', category: 'workflow', content: '甲团队发布前先运行完整回归', source: '重复测试' });
    assert.equal(duplicate.action, 'ignored');
    await manager.upsert({ scope: 'employee', scopeId: 'emp-a', employeeId: 'emp-a', category: 'lesson', content: '处理文档任务时先验证生成文件可以重新打开', source: '测试任务', sourceType: 'task-review' });
    const removable = await manager.upsert({ scope: 'employee', scopeId: 'emp-b', employeeId: 'emp-b', category: 'lesson', content: '代码任务先运行静态检查', source: '测试任务', sourceType: 'task-review' });
    await manager.upsert({ scope: 'user', category: 'preference', content: '老板希望最终说明使用通俗中文', source: '手动' });
    await manager.upsert({ scope: 'user', category: 'constraint', content: 'API Key: secret-value-123456789', source: '脱敏测试' });

    const context = await manager.context({ query: '文档发布', teamId: 'team-a', employeeId: 'emp-a', limit: 20 });
    assert.match(context.context, /甲团队发布前先运行完整回归/u);
    assert.match(context.context, /处理文档任务时先验证生成文件/u);
    assert.doesNotMatch(context.context, /代码任务先运行静态检查/u);
    assert.match(context.context, /所有连接器完成前必须做真实调用验证/u);
    assert.match(context.context, /老板希望最终说明使用通俗中文/u);
    assert.doesNotMatch(context.context, /secret-value-123456789/u);

    const proposal = await manager.propose({ taskId: 'task-1', summary: '更新团队规则', update: { scope: 'team', scopeId: 'team-a', category: 'workflow', content: '甲团队发布前运行完整回归并检查安装包', replaceExact: '甲团队发布前先运行完整回归', source: '独立审查', sourceType: 'review-model' } });
    const approved = await manager.reviewProposal(proposal.proposal.id, 'approve');
    assert.equal(approved.action, 'updated');
    const afterApproval = await manager.context({ teamId: 'team-a', limit: 20 });
    assert.match(afterApproval.context, /并检查安装包/u);
    const invalidProposal = await manager.propose({ taskId: 'task-2', summary: '错误的精确替换', update: { scope: 'team', scopeId: 'team-a', category: 'workflow', content: '不应写入的内容', replaceExact: '不存在的旧内容', source: '独立审查', sourceType: 'review-model' } });
    await assert.rejects(() => manager.reviewProposal(invalidProposal.proposal.id, 'approve'), /当前匹配 0 条/u);
    const afterRejectedApply = await manager.list();
    assert.equal(afterRejectedApply.proposals.find((item) => item.id === invalidProposal.proposal.id).status, 'pending');
    assert(!afterRejectedApply.entries.some((item) => item.content === '不应写入的内容'));
    const restarted = createMemoryManager(root, { limits: { organization: 1800, team: 1600, employee: 1200, user: 1200 } });
    await assert.rejects(() => restarted.reviewProposal(invalidProposal.proposal.id, 'approve'), /当前匹配 0 条/u);
    const afterRestartedFailure = await restarted.list();
    assert(afterRestartedFailure.entries.some((item) => item.content === '甲团队发布前运行完整回归并检查安装包'));
    assert.equal(afterRestartedFailure.proposals.find((item) => item.id === invalidProposal.proposal.id).status, 'pending');

    const imported = await manager.importLegacy({ importId: 'legacy-fixture', userMemory: [{ content: '旧版偏好仍然保留', category: 'preference', source: '旧版', importance: 4, confidence: 0.9 }], taskLearnings: [{ goal: '生成报告', outcome: 'completed', successfulTools: ['write_file'], failedTools: [], lesson: '写完后读回验证' }] });
    assert.equal(imported.ok, true);
    assert.equal((await manager.importLegacy({ importId: 'legacy-fixture' })).unchanged, true);
    const files = await fs.readdir(path.join(root, 'projections'));
    assert(files.includes('README.md'));
    const listed = await manager.list({ includeAudit: true });
    assert(listed.entries.length >= 8);
    assert(listed.usage['team:team-a'].current > 0);
    assert.equal(listed.usage['team:team-a'].max, 1600);
    assert(listed.audit.some((event) => event.action === 'proposal_approved'));
    await manager.remove(removable.entry.id, { reason: '验证删除后投影同步清理' });
    await assert.rejects(() => fs.access(path.join(root, 'projections', 'employees', 'emp-b.md')));
    console.log(`layered memory verified: ${listed.entries.length} entries, ${listed.audit.length} audit events`);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
