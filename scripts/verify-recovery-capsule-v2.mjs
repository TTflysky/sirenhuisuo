import assert from 'node:assert/strict';
import { createRecoveryCapsule, verifyRecoveryCapsule, buildRecoveryPrompt } from '../src/engine/taskContextRouter.mjs';

const run = {
  id: 'run-recovery', teamId: 'team-1', goal: '生成可验收脚本', request: '生成可验收脚本', status: 'paused', phase: 'blocked', workspaceId: 'tasks/team-1/run-recovery',
  acceptanceCriteria: ['文件真实落盘'], contract: { contractVersion: 2, goal: '生成可验收脚本' }, plan: { planId: 'plan-recovery', steps: [] },
  steps: [{ id: 'step-1', title: '脚本', status: 'paused', attempts: 1, dependsOnStepIds: [], evidence: [] }],
  handoff: { blocked: '模型超时', nextAction: '检查网络后继续', resumeCondition: '网络恢复', completed: [], completedEvidence: [], blockers: [] },
  context: undefined, recoveryContext: { unresolvedIssues: ['模型超时'], steeringMessages: [], budget: {} },
};
const capsule = createRecoveryCapsule(run, { reason: '测试' });
assert.equal(verifyRecoveryCapsule(capsule), true);
assert.equal(capsule.planId, 'plan-recovery');
assert.equal(capsule.nextStepId, 'step-1');
assert.equal(capsule.handoff.nextAction, '检查网络后继续');
assert.equal(verifyRecoveryCapsule({ ...capsule, immutableGoal: '被替换的目标' }), false);
assert.match(buildRecoveryPrompt(run), /检查网络后继续/);
console.log(JSON.stringify({ passed: true, version: 2, nextStepId: capsule.nextStepId }));
