import { describe, expect, it } from 'vitest';
import { projectNativeWorkingEmployees } from '../../src/store/nativeEmployeeProjection';

describe('native employee projection', () => {
  it('shows only employees with a running durable step', () => {
    const active = projectNativeWorkingEmployees([
      { status: 'running', steps: [{ status: 'running', employeeId: 'coder', title: '构建客户端' }, { status: 'queued', employeeId: 'reviewer', title: '等待审查' }] },
      { status: 'paused', steps: [{ status: 'running', employeeId: 'paused-worker', title: '不应显示' }] },
    ]);
    expect([...active.entries()]).toEqual([['coder', '执行：构建客户端']]);
  });
});
