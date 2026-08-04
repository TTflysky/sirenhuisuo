import { describe, expect, it } from 'vitest';
import recoveryModule from '../../electron/taskServiceRecoveryCommands.cjs';

const { createTaskServiceRecoveryCommands } = recoveryModule;

function createHarness(task, recoveryAction = 'retry') {
  const update = async (_taskId, mutate) => {
    mutate(task);
    return { ok: true, run: task };
  };
  const adaptive = {
    selectAdaptiveRecovery: () => recoveryAction === 'await_user'
      ? { action: 'await_user' }
      : recoveryAction === 'revise'
        ? { action: 'revise', proposal: { trigger: 'failure', reason: '换一条路线', operations: [] } }
        : { action: 'retry', delayMs: 10 },
    applyAdaptivePlanRevision: (graph, input) => ({
      ...graph,
      revision: graph.revision + 1,
      revisionHistory: [...(graph.revisionHistory || []), { revision: graph.revision + 1, affectedNodeIds: input.operations?.map((item) => item.nodeId).filter(Boolean) || [] }],
    }),
  };
  const commands = createTaskServiceRecoveryCommands(update, {
    text: (value, max = 1200) => String(value ?? '').trim().slice(0, max),
    clone: (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value)),
    updateStep: (currentTask, stepId, mutate) => {
      const step = currentTask.steps.find((item) => item.id === stepId);
      if (!step) throw new Error(`unknown ${stepId}`);
      mutate(step);
      return step;
    },
    appendServiceEvent: (currentTask, type, detail, payload) => currentTask.serviceEvents.push({ type, detail, payload }),
    loadAdaptivePlan: async () => adaptive,
    synchronizeTaskFromAdaptiveGraph: () => undefined,
    classifyFailure: (reason) => /401/u.test(reason) ? { category: 'authentication', retryable: false } : { category: 'network', retryable: true },
  });
  return commands;
}

function makeTask() {
  return {
    status: 'running', phase: 'execution', serviceEvents: [],
    adaptivePlanGraph: { revision: 1, revisionHistory: [], nodes: [
      { id: 'build', status: 'completed', attempts: 0 },
      { id: 'review', status: 'running', attempts: 0 },
    ] },
    steps: [
      { id: 'build', title: '实现', kind: 'work', status: 'completed', attempts: 0, events: [] },
      { id: 'review', title: '审查', kind: 'review', status: 'running', attempts: 0, events: [] },
    ],
  };
}

describe('TaskService recovery commands', () => {
  it('returns only the responsible step after review rejection', async () => {
    const task = makeTask();
    const commands = createHarness(task);
    await commands.recordReviewDecision('task-one', { reviewStepId: 'review', responsibleStepId: 'build', approved: false, reason: '缺少窄屏证据' });
    expect(task.steps.find((step) => step.id === 'build')).toMatchObject({ status: 'queued', lastError: '缺少窄屏证据' });
    expect(task.steps.find((step) => step.id === 'review')).toMatchObject({ status: 'queued' });
    expect(task.adaptivePlanGraph.revision).toBe(2);
  });

  it('pauses authentication failures for the user instead of terminating the task', async () => {
    const task = makeTask();
    task.steps[0].status = 'running';
    const commands = createHarness(task, 'await_user');
    await commands.failStep('task-one', { stepId: 'build', error: '401 API key missing' });
    expect(task).toMatchObject({ status: 'awaiting_user', phase: 'awaiting_user', waitingFor: '401 API key missing' });
    expect(task.steps[0]).toMatchObject({ status: 'paused', errorClass: 'authentication', attempts: 1 });
  });

  it('reassigns one node through the same adaptive revision path', async () => {
    const task = makeTask();
    const commands = createHarness(task);
    await commands.reassignAdaptiveNode('task-one', { nodeId: 'build', employeeId: 'frontend-two', employeeName: '前端二号', reason: '补充响应式能力' });
    expect(task.adaptivePlanGraph.revision).toBe(2);
    expect(task.serviceEvents.at(-1).type).toBe('adaptive_plan_revised');
  });
});
