import { describe, expect, it } from 'vitest';
import queryModule from '../../electron/taskServiceContextQueries.cjs';

const { createTaskServiceContextQueries } = queryModule;

function createStore(task, integrity = { valid: true }) {
  return {
    async read({ taskId } = {}) {
      const runs = !taskId || task.id === taskId ? [task] : [];
      return { ok: true, runs, integrity };
    },
  };
}

describe('TaskService context queries', () => {
  it('returns bounded context and dependency-ready steps', async () => {
    const task = {
      id: 'task-1',
      goal: '完成项目',
      acceptanceCriteria: ['真实交付'],
      artifacts: [{ id: 'a1', verified: true }, { id: 'a2', verified: false }],
      references: [{ id: 'r1' }],
      steps: [
        { id: 'first', title: '第一步', status: 'completed', output: { ok: true }, dependsOnStepIds: [] },
        { id: 'second', title: '第二步', status: 'queued', dependsOnStepIds: ['first'] },
        { id: 'third', title: '第三步', status: 'queued', dependsOnStepIds: ['second'] },
      ],
    };
    const queries = createTaskServiceContextQueries(createStore(task));

    const context = await queries.context(task.id, { limit: 1 });
    expect(context.verifiedArtifacts).toEqual([{ id: 'a1', verified: true }]);
    expect(context.completedSteps).toEqual([{ id: 'first', title: '第一步', output: { ok: true } }]);
    await expect(queries.readySteps(task.id)).resolves.toMatchObject({ steps: [{ id: 'second' }] });
  });

  it('requires coding checkpoints and passing verification before completion', async () => {
    const task = {
      id: 'coding-1',
      status: 'awaiting_user',
      steps: [{ id: 'build', status: 'completed' }],
      approvals: [],
      workspace: { mode: 'task-workspace', status: 'ready', requiresEvidence: true },
      checkpoints: [{ id: 'checkpoint-1' }],
      verifications: [{ id: 'test-1', status: 'passed' }],
    };
    const queries = createTaskServiceContextQueries(createStore(task));
    await expect(queries.validateCompletion(task.id)).resolves.toMatchObject({
      passed: true,
      integrity: { valid: true },
    });
  });
});
