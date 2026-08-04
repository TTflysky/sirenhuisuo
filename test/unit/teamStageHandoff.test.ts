import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { initialAppState, reduceAppState } from '../../src/store/appStateReducer';
import type { AppState, TaskApprovalContract, TaskRun, TaskStageSummary, Team } from '../../src/types';
import { messagesToMarkdown } from '../../src/utils/clipboard';

function approval(status: TaskApprovalContract['status']): TaskApprovalContract {
  return {
    approvalVersion: 1,
    id: 'approval-1',
    taskId: 'run-1',
    stepId: 'step-1',
    requestedById: 'employee-1',
    requestedByName: '前端工程师',
    title: '运行本地构建',
    purpose: '验证页面可以真实构建',
    action: '运行项目构建命令',
    toolName: 'run_command',
    approvalKey: 'run_command:build',
    reads: ['项目源码'],
    writes: ['构建输出目录'],
    risks: ['会占用少量 CPU'],
    approveEffect: '只运行本次构建。',
    rejectEffect: '保留源码并改用静态检查。',
    status,
    requestedAt: 1,
  };
}

describe('team stage handoff', () => {
  it('exports stage conclusions before folded operations', () => {
    const summary: TaskStageSummary = {
      summaryVersion: 1,
      id: 'summary-1',
      taskId: 'run-1',
      stepId: 'step-1',
      stageTitle: '完成页面原型',
      ownerId: 'employee-1',
      ownerName: '前端工程师',
      status: 'completed',
      problem: '交付可运行的页面原型',
      rationale: '先验证核心交互再接入数据',
      completed: ['页面已经生成并通过构建'],
      evidence: ['dist/index.html'],
      remaining: ['接入真实数据'],
      nextOwnerName: '后端工程师',
      nextAction: '由后端工程师接入数据接口。',
      operations: [{ ts: 1, type: 'tool', detail: '运行构建', success: true }],
      createdAt: 2,
    };
    const markdown = messagesToMarkdown([{ role: '常驻主助理', author: '章北海助理', content: '阶段完成', kind: 'stage_summary', stageSummary: summary }], '团队记录');
    expect(markdown).toContain('解决什么');
    expect(markdown).toContain('下一步');
    expect(markdown).toContain('<summary>执行过程</summary>');
    expect(markdown.indexOf('解决什么')).toBeLessThan(markdown.indexOf('执行过程'));
  });

  it('refreshes an existing approval card after the decision is persisted', () => {
    const pending = approval('pending');
    const team: Team = { id: 'team-1', name: '测试团队', icon: 'T', memberIds: [], chatMessages: [], tasks: [] };
    const base = { ...initialAppState, teams: [team] } as AppState;
    const run = {
      id: 'run-1', teamId: 'team-1', title: '测试', request: '测试', goal: '测试', status: 'paused', phase: 'blocked',
      createdAt: 1, updatedAt: 1, memberSnapshot: [], steps: [], evidence: [],
      executionMessages: [{ id: 'approval-message', authorId: 'assistant', roleId: 'custom', content: '等待授权', mentions: [], timestamp: 1, kind: 'approval', approval: pending }],
    } as TaskRun;
    const hydrated = reduceAppState(base, { type: 'HYDRATE_TASK_RUNS', runs: [run] });
    const decidedRun = { ...run, executionMessages: [{ ...run.executionMessages![0], approval: approval('rejected') }] } as TaskRun;
    const refreshed = reduceAppState(hydrated, { type: 'PATCH_TASK_RUN', run: decidedRun });
    expect(refreshed.teams[0].chatMessages).toHaveLength(1);
    expect(refreshed.teams[0].chatMessages[0].approval?.status).toBe('rejected');
  });

  it('keeps the collaboration rules in the runtime and built-in persona', () => {
    const discussionRuntimeSource = readFileSync('src/store/teamDiscussionRuntime.ts', 'utf8');
    const supervisorSource = readFileSync('src/engine/teamSupervisor.ts', 'utf8');
    const personaSource = readFileSync('src/components/settings/AssistantSettingsModal.tsx', 'utf8');
    expect(supervisorSource).toContain('当前项目真实状态');
    expect(discussionRuntimeSource).toContain("kind: 'stage_summary'");
    expect(personaSource).toContain('v3.3 团队主持、插话与阶段交接协议');
    expect(personaSource).toContain('用户拒绝某个完全相同的动作后不得原样再次申请');
  });
});
