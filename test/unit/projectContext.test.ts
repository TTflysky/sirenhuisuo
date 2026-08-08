import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeProjectContext, initializeProjectTaskRecord } from '../../src/utils/projectContext';

afterEach(() => {
  Reflect.deleteProperty(window, 'electronAPI');
});

describe('project context persistence', () => {
  it('preserves existing members while persisting explicit current deliverables', async () => {
    const writes = new Map<string, string>();
    const api = {
      fsInitWorkspace: vi.fn(async () => ({ ok: true })),
      fsMkdir: vi.fn(async () => ({ ok: true })),
      fsRead: vi.fn(async (path: string) => path.endsWith('/project.json')
        ? { ok: true, content: JSON.stringify({
          id: 'project-1', title: '原项目', request: '原始目标', status: 'running',
          members: [{ employeeId: 'architect', reason: '架构设计' }],
          expectedOutputs: ['方案'], createdAt: 100,
        }) }
        : { ok: false }),
      fsWrite: vi.fn(async (path: string, content: string) => { writes.set(path, content); return { ok: true, path }; }),
    };
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });

    const result = await initializeProjectContext({
      id: 'project-1', title: '新任务', request: '继续原目标并补实现', conversationId: 'conversation-1',
      steps: ['实现'], expectedOutputs: ['实现文件'], members: [], status: 'running', createdAt: 200, updatedAt: 200,
    });

    expect(result.ok).toBe(true);
    const manifest = JSON.parse(writes.get('projects/project-1/project.json') || '{}');
    expect(manifest.request).toBe('继续原目标并补实现');
    expect(manifest.members).toEqual([{ employeeId: 'architect', reason: '架构设计' }]);
    expect(manifest.expectedOutputs).toEqual(['实现文件']);
  });

  it('writes a traceable task record under the owning project', async () => {
    const writes = new Map<string, string>();
    const api = {
      fsMkdir: vi.fn(async () => ({ ok: true })),
      fsWrite: vi.fn(async (path: string, content: string) => { writes.set(path, content); return { ok: true, path }; }),
    };
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });

    const result = await initializeProjectTaskRecord({
      projectId: 'project-2', taskId: 'task-2', title: '生成风险看板', goal: '生成可运行风险看板',
      conversationId: 'conversation-2', workspaceId: 'tasks/assistant/run-2', parentTaskId: 'task-1',
      acceptanceCriteria: ['文件存在', '通过验证'], status: 'running', phase: 'evidence',
      artifacts: [{ path: 'artifacts/final/risk.html', category: 'final', verified: true }],
    });

    expect(result.ok).toBe(true);
    const record = writes.get('projects/project-2/tasks/task-2.md') || '';
    expect(record).toContain('项目 ID：project-2');
    expect(record).toContain('父任务：task-1');
    expect(record).toContain('artifacts/final/risk.html');
    expect(record).toContain('通过验证');
  });

  it('persists explicit current members and deliverables over an older manifest', async () => {
    const writes = new Map<string, string>();
    const api = {
      fsInitWorkspace: vi.fn(async () => ({ ok: true })),
      fsMkdir: vi.fn(async () => ({ ok: true })),
      fsRead: vi.fn(async (path: string) => path.endsWith('/project.json')
        ? { ok: true, content: JSON.stringify({
          id: 'project-3', members: [{ employeeId: 'old-member' }],
          expectedOutputs: ['模糊结果'], requiredCapabilities: ['旧能力'], createdAt: 100,
        }) }
        : { ok: false }),
      fsWrite: vi.fn(async (path: string, content: string) => { writes.set(path, content); return { ok: true, path }; }),
    };
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });

    await initializeProjectContext({
      id: 'project-3', title: '明确项目', request: '交付明确文件', conversationId: 'conversation-3',
      steps: ['实现'], expectedOutputs: ['index.html', 'README.md'], requiredCapabilities: ['前端开发'],
      members: [{ employeeId: 'frontend', reason: '实现页面' }], status: 'running', createdAt: 200, updatedAt: 200,
    });

    const manifest = JSON.parse(writes.get('projects/project-3/project.json') || '{}');
    expect(manifest.members).toEqual([{ employeeId: 'frontend', reason: '实现页面' }]);
    expect(manifest.expectedOutputs).toEqual(['index.html', 'README.md']);
    expect(manifest.requiredCapabilities).toEqual(['前端开发']);
  });
});
