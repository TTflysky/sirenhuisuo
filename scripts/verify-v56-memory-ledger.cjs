const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createMemoryManager } = require('../electron/memoryManager.cjs');

async function main() {
  const repositoryRoot = path.resolve(__dirname, '..');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-v56-memory-'));
  try {
    const manager = createMemoryManager(root, { limits: { organization: 1800, project: 1800, team: 1600, employee: 1200, user: 1200 } });
    await manager.upsert({
      scope: 'organization', category: 'constraint', memoryKind: 'semantic',
      content: '所有正式交付都必须有真实验收证据。', source: 'fixture', importance: 5, confidence: 1,
    });
    const projectA = await manager.upsert({
      scope: 'project', scopeId: 'project-a', projectId: 'project-a', category: 'project', memoryKind: 'semantic',
      content: '项目 A 使用蓝色视觉规范。', source: 'fixture', taskId: 'task-a', evidenceIds: ['evidence-a'], importance: 4, confidence: 0.95,
    });
    assert.equal(projectA.entry.projectId, 'project-a');
    assert.equal(projectA.entry.evidenceIds[0], 'evidence-a');

    const firstContext = await manager.context({ query: '视觉规范', projectId: 'project-a', taskId: 'task-a', conversationId: 'conversation-a', limit: 12 });
    assert.match(firstContext.context, /蓝色视觉规范/u);
    assert.match(firstContext.context, /真实验收证据/u);
    assert(firstContext.retrievalId);
    assert(firstContext.references.some((item) => item.memoryId === projectA.entry.id && /当前项目|相关/u.test(item.reason)));

    const isolated = await manager.context({ query: '视觉规范', projectId: 'project-b', taskId: 'task-b', conversationId: 'conversation-b', limit: 12 });
    assert.doesNotMatch(isolated.context, /蓝色视觉规范/u);
    assert.match(isolated.context, /真实验收证据/u);

    const proposal = await manager.propose({
      taskId: 'task-a', summary: '更新项目 A 视觉规范', source: 'fixture',
      update: {
        scope: 'project', scopeId: 'project-a', projectId: 'project-a', category: 'project', memoryKind: 'semantic',
        content: '项目 A 使用青绿色视觉规范。', replaceExact: '项目 A 使用蓝色视觉规范。', source: 'fixture', sourceType: 'review-model', confidence: 0.9,
      },
    });
    const approved = await manager.reviewProposal(proposal.proposal.id, 'approve', { reviewedBy: 'user' });
    assert.equal(approved.action, 'updated');
    const withHistory = await manager.list({ projectId: 'project-a', includeHistory: true, includeRetrievals: true, includeAudit: true });
    assert(withHistory.entries.some((entry) => entry.content.includes('蓝色视觉规范') && entry.status === 'superseded'));
    assert(withHistory.entries.some((entry) => entry.content.includes('青绿色视觉规范') && entry.status === 'active'));
    assert(withHistory.retrievals.some((item) => item.retrievalId === firstContext.retrievalId));
    assert(withHistory.audit.some((item) => item.action === 'context_retrieved'));

    const prior = withHistory.entries.find((entry) => entry.content.includes('蓝色视觉规范'));
    const rolledBack = await manager.rollback(prior.id, { reason: 'fixture rollback' });
    assert.equal(rolledBack.action, 'rolled_back');
    const afterRollback = await manager.context({ query: '视觉规范', projectId: 'project-a', limit: 12 });
    assert.match(afterRollback.context, /蓝色视觉规范/u);
    assert.doesNotMatch(afterRollback.context, /青绿色视觉规范/u);

    const legacy = await manager.importLegacy({
      importId: 'legacy-task-learning-fixture',
      taskLearnings: [{ goal: '旧版项目经验', outcome: 'completed', successfulTools: ['write_file'], lesson: '写完后读回验证' }],
    });
    assert.equal(legacy.ok, true);
    const postLegacy = await manager.context({ query: '旧版项目经验', projectId: 'project-a', limit: 12 });
    assert.doesNotMatch(postLegacy.context, /旧版项目经验/u);
    const legacyEntries = await manager.list({ includeHistory: true });
    assert(legacyEntries.entries.some((entry) => entry.source.includes('旧版任务经验') && entry.status === 'legacy'));

    const automaticProjectProposal = await manager.propose({
      taskId: 'task-a', summary: '不应自动批准项目事实', source: 'fixture',
      update: {
        scope: 'project', scopeId: 'project-a', projectId: 'project-a', category: 'lesson', memoryKind: 'procedural',
        content: '项目记忆必须由用户批准。', source: 'fixture', sourceType: 'review-model', acceptanceVerified: true,
      },
    });
    await assert.rejects(() => manager.reviewProposal(automaticProjectProposal.proposal.id, 'approve', { reviewedBy: 'policy:auto-high-confidence' }), /必须由用户明确批准/u);

    const restarted = createMemoryManager(root);
    const afterRestart = await restarted.list({ projectId: 'project-a', includeHistory: true, includeRetrievals: true });
    assert(afterRestart.entries.some((entry) => entry.content.includes('蓝色视觉规范') && entry.status === 'active'));
    assert(afterRestart.retrievals.length >= 3);
    const clientSource = await fs.readFile(path.join(repositoryRoot, 'src', 'data', 'hermesClient.ts'), 'utf8');
    const bridgeSource = await fs.readFile(path.join(repositoryRoot, 'src', 'engine', 'taskServiceBridge.ts'), 'utf8');
    assert.doesNotMatch(clientSource, /userContext:\s*buildUserContext\(/u, 'browser memory must not be injected by chatCompletion');
    assert.match(clientSource, /memoryPropose/u, 'user insight extraction must create reviewable ledger proposals');
    assert.match(bridgeSource, /rememberMemoryRetrieval/u, 'chat tasks must bind memory retrieval evidence');
    console.log(`v5.6 memory ledger verified: ${afterRestart.entries.length} versions, ${afterRestart.retrievals.length} retrievals`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
