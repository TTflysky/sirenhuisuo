import { describe, expect, it } from 'vitest';
import { enforceSupervisorWorkspaceTruth, resolveSupervisorRun } from '../../src/engine/teamSupervisor';
import type { Employee, TaskRun } from '../../src/types';

const run = {
  id: 'project-1',
  workspaceId: 'workspace-project-1',
  status: 'running',
  steps: [
    { id: 'ux', employeeId: 'ui', title: 'UX/UI', status: 'completed', events: [], attempts: 1, order: 1, kind: 'work', assignment: 'design', dependsOnStepIds: [] },
    { id: 'frontend', employeeId: 'frontend', title: 'Frontend implementation', status: 'running', events: [], attempts: 1, order: 2, kind: 'work', assignment: 'build', dependsOnStepIds: ['ux'] },
  ],
} as TaskRun;

const employees = [{ id: 'frontend', name: '前端开发者' }] as Employee[];

describe('team supervisor workspace truth', () => {
  it('replaces a false workspace denial with durable task facts', () => {
    const reply = enforceSupervisorWorkspaceTruth('当前阻塞点：本会话没有可用的工作区写入与运行验证入口。', run, employees);
    expect(reply).toContain('项目工作区已经建立');
    expect(reply).toContain('已完成 1/2');
    expect(reply).toContain('前端开发者');
    expect(reply).not.toContain('没有可用的工作区');
  });

  it('preserves a factual reply', () => {
    expect(enforceSupervisorWorkspaceTruth('前端实现正在执行。', run, employees)).toBe('前端实现正在执行。');
  });

  it('does not invent a workspace when none exists', () => {
    expect(enforceSupervisorWorkspaceTruth('当前没有工作区。', { ...run, workspaceId: undefined }, employees)).toBe('当前没有工作区。');
  });

  it('inherits the durable workspace from a project parent', () => {
    const child = { ...run, id: 'child', parentTaskId: 'project-1', workspaceId: undefined, updatedAt: 20 };
    const root = { ...run, id: 'project-1', updatedAt: 10 };
    expect(resolveSupervisorRun([root, child])?.workspaceId).toBe('workspace-project-1');
  });
});
