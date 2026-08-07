const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createMemoryManager } = require('../electron/memoryManager.cjs');
const { createLearningReviewQueue, collectInput, hasVerifiedAcceptance } = require('../electron/learningReviewQueue.cjs');

async function waitFor(check, timeout = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('等待复盘队列完成超时');
}

function fixture() {
  const now = Date.now();
  return {
    id: 'task-review-fixture', projectId: 'project-review', teamId: 'team-review', goal: '生成并验证一份报告', request: '生成并验证一份报告', status: 'completed', createdAt: now - 1000, updatedAt: now,
    memberSnapshot: [{ id: 'writer', name: '写作员工', role: 'coder' }],
    steps: [{ id: 'step-1', employeeId: 'writer', title: '生成报告', kind: 'work', status: 'completed', attempts: 1, events: [
      { type: 'tool', detail: 'write_file {} → 成功' }, { type: 'tool', detail: 'read_file {} → 成功' }, { type: 'tool', detail: 'run_command {} → 成功' },
    ], evidence: [{ kind: 'file', verified: true, summary: 'report.md 已写入并读回' }] }],
    evidence: [{ kind: 'file', verified: true, summary: 'report.md 已写入并读回' }, { kind: 'run', verified: true, summary: '验证命令退出码 0' }],
    recoveryContext: { steeringMessages: ['必须确认文件能打开'] },
  };
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-learning-'));
  const candidateObservations = [];
  try {
    const memoryManager = createMemoryManager(path.join(root, 'memory'));
    let reviewCalls = 0;
    const fetchImpl = async () => {
      reviewCalls += 1;
      if (reviewCalls < 3) return new Response('temporary unavailable', { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      memory_updates: [{ target: 'team', action: 'add', content: '报告任务必须验证文件可重新打开', category: 'workflow', importance: 5, confidence: 0.92 }],
      skill_candidates: [{ action: 'create', name: 'verified-report', description: '生成并验证报告', steps: ['写入报告', '读回验证'], inputs: ['报告内容'], outputs: ['已验证报告'], success_criteria: ['文件可重新打开'], permissions: ['filesystem:write', 'filesystem:read'], positive_example: '生成报告并成功读回', failure_example: '文件无法读回时停止', reason: '多步骤稳定流程' }],
    }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const skillLifecycle = { observe: async (input, hints) => { candidateObservations.push({ input, hints }); return { ok: true, candidateIds: ['candidate-1'], skillDraftIds: [] }; } };
    const queue = createLearningReviewQueue(path.join(root, 'runtime'), { memoryManager, fetchImpl, skillLifecycle });
    await queue.enqueue(fixture(), { reviewModelConfig: { apiHost: 'https://review.invalid/v1', model: 'review-model' }, memoryWriteApproval: true });
    const completed = await waitFor(async () => {
      const status = await queue.status();
      return status.items.find((item) => item.taskId === 'task-review-fixture' && item.status === 'completed');
    });
    assert.equal(completed.result.verifiedMemories >= 2, true);
    assert.equal(completed.result.memoryProposalIds.length, 1);
    assert.equal(completed.result.skillCandidateIds.length, 1);
    assert.equal(completed.result.skillDraftIds.length, 0, '单次任务不得直接生成 Skill 草案');
    assert.equal(completed.attempts, 3);
    assert.equal(reviewCalls, 3);
    assert.equal(candidateObservations.length, 1);
    const memories = await memoryManager.list({ proposalStatus: 'pending' });
    assert(memories.entries.some((entry) => entry.scope === 'team' && entry.scopeId === 'team-review' && entry.memoryKind === 'procedural' && entry.acceptanceVerified));
    assert(memories.entries.some((entry) => entry.scope === 'employee' && entry.scopeId === 'writer' && entry.memoryKind === 'procedural' && entry.acceptanceVerified));
    assert.equal(memories.proposals.filter((proposal) => proposal.status === 'pending').length, 1);
    const restored = createLearningReviewQueue(path.join(root, 'runtime'), { memoryManager, fetchImpl, skillLifecycle });
    const restoredStatus = await restored.status();
    assert.equal(restoredStatus.items[0].status, 'completed');

    const unverified = fixture();
    unverified.id = 'task-unverified-complete';
    unverified.recoveryContext = { steeringMessages: [] };
    unverified.evidence = [];
    unverified.steps[0].events = [{ type: 'tool', detail: 'write_file {} → 成功' }];
    unverified.steps[0].evidence = [];
    assert.equal(hasVerifiedAcceptance(collectInput(unverified)), false);
    await queue.enqueue(unverified, { memoryWriteApproval: true });
    await waitFor(async () => (await queue.status({ taskId: unverified.id })).items[0]?.status === 'completed');
    const afterUnverified = await memoryManager.list({ taskId: unverified.id });
    assert.equal(afterUnverified.entries.length, 0, '没有真实验收证据的完成声明不得进入程序记忆');
    console.log(`learning review verified: ${completed.result.verifiedMemories} verified memories, ${candidateObservations.length} candidate observation`);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
