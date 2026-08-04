import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatTaskBridge } from '../../src/engine/taskServiceBridge';

function makeApi(options: { accepted?: boolean } = {}) {
  const order: string[] = [];
  const api = {
    taskServiceCreate: vi.fn(async () => ({
      ok: true,
      task: { id: 'task-one', goalState: { goalId: 'goal-one' }, adaptivePlanGraph: { revision: 3 } },
    })),
    taskServiceStatus: vi.fn(async () => ({ ok: true })),
    taskWorkerCommand: vi.fn(async () => ({ ok: true, run: { worker: {} } })),
    taskServiceReference: vi.fn(async () => ({ ok: true })),
    taskServiceUpdate: vi.fn(async (input: any) => {
      const proposal = input.patch.autonomousDecisionProposal;
      if (!proposal) return { ok: true, run: { adaptivePlanGraph: { revision: 3 } } };
      order.push('decision');
      return {
        ok: true,
        run: {
          goalState: { goalId: 'goal-one' },
          adaptivePlanGraph: { revision: 3, nodes: [{ id: 'execution', status: 'queued', ownerEmployeeId: 'assistant', dependsOn: [] }] },
          autonomousDecisionProposal: proposal,
          autonomousControl: {
            decisionAuthority: {
              accepted: options.accepted !== false,
              proposalId: proposal.proposalId,
              reason: options.accepted === false ? '计划版本已经变化' : 'accepted',
            },
          },
        },
      };
    }),
    taskServiceToolAttempt: vi.fn(async () => { order.push('attempt'); return { ok: true }; }),
    taskServiceHeartbeat: vi.fn(async () => ({ ok: true })),
    taskServiceLifecycle: vi.fn(async () => ({ ok: true })),
    taskServiceUsage: vi.fn(async () => ({ ok: true })),
    taskServiceCompleteStep: vi.fn(async () => ({ ok: true })),
    taskServiceValidateCompletion: vi.fn(async () => ({ ok: true, passed: true })),
    taskServiceFailStep: vi.fn(async () => ({ ok: true })),
    taskServiceCheckpoint: vi.fn(async () => ({ ok: true })),
  };
  return { api, order };
}

function makeBridge() {
  return createChatTaskBridge({
    taskType: 'assistant', ownerId: 'assistant', title: '测试', goal: '生成真实文件',
    workspaceId: 'tasks/task-one', idempotencyKey: 'bridge-test', conversationId: 'conversation-one',
  });
}

afterEach(() => {
  Reflect.deleteProperty(window, 'electronAPI');
});

describe('chat task bridge autonomous decision authority', () => {
  it('records and validates a tool action before the tool attempt starts', async () => {
    const { api, order } = makeApi();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
    const bridge = makeBridge();
    await bridge.prepare({ mode: 'execute', goal: '生成真实文件', acceptanceCriteria: ['文件存在'], requiredConstraints: [], deliverableType: 'file' } as any);
    await bridge.toolStarted('write_file', '{"path":"result.md"}');
    expect(order).toEqual(['decision', 'attempt']);
    expect(api.taskServiceUpdate.mock.calls[0][0].patch.autonomousDecisionProposal).toMatchObject({
      source: 'model', goalId: 'goal-one', planRevision: 3,
      selectedAction: { kind: 'use_tool', stepId: 'execution', employeeId: 'assistant', toolName: 'write_file' },
    });
  });

  it('blocks the tool attempt when the current goal or plan rejects the proposal', async () => {
    const { api, order } = makeApi({ accepted: false });
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
    const bridge = makeBridge();
    await bridge.prepare({ mode: 'execute', goal: '生成真实文件', acceptanceCriteria: ['文件存在'], requiredConstraints: [], deliverableType: 'file' } as any);
    await expect(bridge.toolStarted('write_file', '{"path":"result.md"}')).rejects.toThrow(/计划版本已经变化/u);
    expect(order).toEqual(['decision']);
    expect(api.taskServiceToolAttempt).not.toHaveBeenCalled();
  });

  it('closes a completed chat task only after the completion decision and evidence gate pass', async () => {
    const { api } = makeApi();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
    const bridge = makeBridge();
    await bridge.prepare({ mode: 'execute', goal: '生成真实文件', acceptanceCriteria: ['文件存在'], requiredConstraints: [], deliverableType: 'file' } as any);
    await bridge.finish({
      executionState: { status: 'completed', phase: 'finalize' } as any,
      usage: { totalTokens: 120 }, output: 'result.md 已写入并回读',
      turnFinalization: { status: 'completed' },
    });
    expect(api.taskServiceCompleteStep).toHaveBeenCalledTimes(1);
    expect(api.taskServiceValidateCompletion).toHaveBeenCalledWith('task-one');
    expect(api.taskServiceStatus).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: 'task-one', status: 'completed' }));
    const completionProposal = api.taskServiceUpdate.mock.calls.at(-1)?.[0].patch.autonomousDecisionProposal;
    expect(completionProposal.selectedAction.kind).toBe('verify_completion');
  });

  it('keeps the task waiting when execution returns completed without passing the evidence gate', async () => {
    const { api } = makeApi();
    api.taskServiceValidateCompletion.mockResolvedValueOnce({ ok: true, passed: false });
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
    const bridge = makeBridge();
    await bridge.prepare({ mode: 'execute', goal: '生成真实文件', acceptanceCriteria: ['文件存在'], requiredConstraints: [], deliverableType: 'file' } as any);
    await bridge.finish({
      executionState: { status: 'completed', phase: 'finalize' } as any,
      usage: {}, output: '模型声称已经完成', turnFinalization: { status: 'completed' },
    });
    expect(api.taskServiceStatus).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: 'task-one', status: 'awaiting_user' }));
  });

  it('records a failed execution on the responsible step instead of marking the task completed', async () => {
    const { api } = makeApi();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
    const bridge = makeBridge();
    await bridge.prepare({ mode: 'execute', goal: '生成真实文件', acceptanceCriteria: ['文件存在'], requiredConstraints: [], deliverableType: 'file' } as any);
    await bridge.finish({
      executionState: { status: 'failed', phase: 'act' } as any,
      usage: {}, output: 'network timeout', turnFinalization: { status: 'failed' },
    });
    expect(api.taskServiceFailStep).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'task-one', stepId: 'execution', errorClass: 'timeout' }));
    expect(api.taskServiceValidateCompletion).not.toHaveBeenCalled();
  });
});
