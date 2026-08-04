import { describe, expect, it } from 'vitest';
import type { TaskRun } from '../../src/types';
import { reconcileAutonomousControl } from '../../src/engine/autonomousControl.mjs';
import { createTeamAutonomousDecisionRecorder } from '../../src/store/teamAutonomousDecision';

function makeRun(): TaskRun {
  return reconcileAutonomousControl({
    id: 'team-run', teamId: 'team-one', conversationId: 'conversation-one', title: '构建页面', request: '构建页面', goal: '构建页面',
    status: 'running', createdAt: 1, updatedAt: 1, memberSnapshot: [{ id: 'frontend', name: '前端', title: '前端工程师', role: 'coder' }],
    acceptanceCriteria: ['文件存在'],
    steps: [{ id: 'build', employeeId: 'frontend', title: '实现', order: 1, kind: 'work', assignment: '实现页面', dependsOnStepIds: [], status: 'running', attempts: 1, events: [] }],
  } as TaskRun, { now: 2 });
}

describe('team autonomous decision recorder', () => {
  it('binds a member tool action to the current goal, plan and responsibility step', async () => {
    let run = makeRun();
    const record = createTeamAutonomousDecisionRecorder({
      getRun: () => run,
      updateRun: (mutate) => {
        const next = structuredClone(run);
        mutate(next);
        run = reconcileAutonomousControl(next, { now: Date.now() });
      },
    });
    await record('frontend', 'build', 'write_file');
    expect(run.autonomousControl?.decisionAuthority).toMatchObject({ accepted: true, source: 'model' });
    expect(run.autonomousControl?.currentDecision.selectedAction).toMatchObject({ kind: 'use_tool', stepId: 'build', toolName: 'write_file' });
  });
});
