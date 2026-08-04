import { describe, expect, it } from 'vitest';
import approvalModule from '../../electron/taskServiceApprovalCommands.cjs';

const { createTaskServiceApprovalCommands } = approvalModule;

function createHarness(task) {
  const update = async (_taskId, mutate) => {
    mutate(task);
    return { ok: true, task };
  };
  return createTaskServiceApprovalCommands(update);
}

describe('TaskService approval commands', () => {
  it('returns an approved task to the queue and clears the waiting reason', async () => {
    const task = { status: 'running', phase: 'executing', approvals: [], serviceEvents: [] };
    const commands = createHarness(task);
    await commands.requestApproval('task-1', { id: 'approval-1', reason: '允许发送邮件', stepId: 'send' });
    expect(task).toMatchObject({ status: 'awaiting_user', phase: 'awaiting_user', waitingFor: '允许发送邮件' });

    await commands.decideApproval('task-1', { approvalId: 'approval-1', decision: 'approved' });
    expect(task).toMatchObject({ status: 'queued', phase: 'preflight', waitingFor: undefined });
    expect(task.approvals[0].status).toBe('approved');
  });

  it('keeps approved compensation paused for the compensation runner', async () => {
    const task = {
      status: 'awaiting_user',
      phase: 'awaiting_user',
      waitingFor: '允许回滚',
      approvals: [{ id: 'approval-2', stepId: 'rollback', scope: 'compensation', status: 'pending' }],
      handoff: { compensation: { compensateStepId: 'rollback' } },
      serviceEvents: [],
    };
    const commands = createHarness(task);
    await commands.decideApproval('task-2', { approvalId: 'approval-2', decision: 'approved' });
    expect(task.status).toBe('paused');
    expect(task.phase).toBe('awaiting_user');
    expect(task.handoff).toBeUndefined();
  });
});
