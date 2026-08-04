import { describe, expect, it } from 'vitest';
import {
  createTaskResidencyCheckpoint,
  explainResidencyConflict,
  verifyTaskResidencyCheckpoint,
} from '../../src/engine/taskResidencyCheckpoint.mjs';

function makeRun() {
  return {
    id: 'residency-task', request: '生成并验收一个界面', goal: '生成并验收一个界面', acceptanceCriteria: ['文件可用', '布局正确'],
    goalState: { goalId: 'goal-residency', goalVersion: 1, goal: '生成并验收一个界面', successCriteria: ['文件可用', '布局正确'] },
    plan: { planId: 'plan-residency', planVersion: 1, steps: [
      { stepId: 'design', dependsOn: [] },
      { stepId: 'build', dependsOn: ['design'] },
    ] },
    worker: { checkpointSequence: 2 },
    steps: [
      { id: 'design', status: 'completed', dependsOnStepIds: [], evidence: [{ id: 'design-proof', verified: true }] },
      { id: 'build', status: 'running', dependsOnStepIds: ['design'], evidence: [] },
    ],
    evidence: [{ id: 'workspace-proof', verified: true }],
    recoveryCapsule: { checksum: 'capsule-stable' },
  };
}

describe('task residency checkpoint', () => {
  it('captures the durable recovery identity and next executable step', () => {
    const run = makeRun();
    const checkpoint = createTaskResidencyCheckpoint(run, { updatedAt: 100, reason: 'test' });
    expect(checkpoint).toMatchObject({
      taskId: 'residency-task', goalId: 'goal-residency', planId: 'plan-residency', planRevision: 1,
      completedStepIds: ['design'], verifiedEvidenceIds: ['design-proof', 'workspace-proof'],
      nextExecutableStepId: 'build', checkpointSequence: 2,
    });
    expect(verifyTaskResidencyCheckpoint(run, checkpoint)).toMatchObject({ valid: true, errors: [] });
  });

  it('blocks automatic recovery when goal, plan or completed evidence drifts', () => {
    const run = makeRun();
    const checkpoint = createTaskResidencyCheckpoint(run, { updatedAt: 100 });
    const changed = structuredClone(run);
    changed.goal = '另一个目标';
    changed.goalState.goal = '另一个目标';
    changed.plan.planVersion = 2;
    changed.steps[0].status = 'queued';
    const result = verifyTaskResidencyCheckpoint(changed, checkpoint);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      '任务目标在检查点后发生变化',
      '任务计划或计划版本在检查点后发生变化',
      '已完成步骤记录与当前任务不一致',
    ]));
    expect(explainResidencyConflict(result.errors)).toContain('恢复前核对未通过');
  });

  it('rejects a tampered checkpoint and a stale worker sequence', () => {
    const run = makeRun();
    const checkpoint = createTaskResidencyCheckpoint(run, { updatedAt: 100 });
    expect(verifyTaskResidencyCheckpoint(run, { ...checkpoint, nextExecutableStepId: 'design' }).errors).toContain('恢复检查点自身校验失败');
    run.worker.checkpointSequence = 3;
    expect(verifyTaskResidencyCheckpoint(run, checkpoint).errors).toContain('Worker 检查点序号与任务记录不一致');
  });
});
