import { describe, expect, it } from 'vitest';
import type { TaskRun } from '../../src/types';
import { finalizeTeamRun } from '../../src/store/teamRunFinalization';

function run(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: 'run-1', teamId: 'team-1', title: '测试项目', request: '交付文件', goal: '交付文件',
    status: 'running', phase: 'executing', createdAt: 1, updatedAt: 1, memberSnapshot: [],
    steps: [{ id: 'step-1', order: 1, title: '实现', assignment: '生成文件', kind: 'work', status: 'completed', attempts: 1, events: [], deliverableType: 'file' }],
    evidence: [],
    ...overrides,
  } as TaskRun;
}

describe('team run finalization', () => {
  it('blocks a file task that has no verified file evidence', () => {
    const value = run();
    finalizeTeamRun(value, false, false);
    expect(value.status).toBe('failed');
    expect(value.lastError).toContain('没有可交接的真实文件');
  });

  it('completes a file task only after verified evidence exists', () => {
    const value = run({ evidence: [{ ts: 2, source: 'tool', kind: 'file', summary: 'dist/index.html', verified: true }] });
    finalizeTeamRun(value, false, false);
    expect(value.status).toBe('completed');
    expect(value.phase).toBe('completed');
  });

  it('preserves a paused running step for recovery', () => {
    const value = run({ steps: [{ ...run().steps[0], status: 'running' }] });
    finalizeTeamRun(value, true, false);
    expect(value.status).toBe('paused');
    expect(value.steps[0].status).toBe('paused');
  });
});
