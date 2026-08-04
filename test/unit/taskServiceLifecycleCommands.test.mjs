import { describe, expect, it } from 'vitest';
import lifecycleModule from '../../electron/taskServiceLifecycleCommands.cjs';

const { createTaskServiceLifecycleCommands } = lifecycleModule;

function createHarness(task) {
  const update = async (_taskId, mutate) => {
    mutate(task);
    return { ok: true, task };
  };
  return createTaskServiceLifecycleCommands(update, { sanitizeInput: async (input) => input });
}

describe('TaskService lifecycle commands', () => {
  it('ignores stale lifecycle snapshots and records a newer waiting state', async () => {
    const task = { turnLifecycle: { sequence: 2, status: 'running' }, serviceEvents: [] };
    const commands = createHarness(task);
    await commands.recordLifecycle('task-1', { lifecycle: { sequence: 1, status: 'failed' } });
    expect(task.turnLifecycle.sequence).toBe(2);

    await commands.recordLifecycle('task-1', {
      lifecycle: {
        sequence: 3,
        status: 'waiting_user',
        exit: { waitingFor: '确认发送对象' },
        events: [{ type: 'approval_required' }],
      },
    });
    expect(task).toMatchObject({
      status: 'awaiting_user',
      phase: 'awaiting_user',
      waitingFor: '确认发送对象',
      turnLifecycle: { sequence: 3 },
    });
  });

  it('advances queued work on heartbeat and clears stale waits on resume', async () => {
    const task = { status: 'queued', phase: 'preflight', waitingFor: '旧提示', serviceEvents: [] };
    const commands = createHarness(task);
    await commands.heartbeat('task-2', { state: 'running', observedAt: 1000, progressAt: 900 });
    expect(task.status).toBe('running');
    expect(task.heartbeat.leaseExpiresAt).toBe(91000);

    await commands.setStatus('task-2', 'running', '继续执行');
    expect(task).toMatchObject({ status: 'running', phase: 'executing', waitingFor: undefined });
  });
});
