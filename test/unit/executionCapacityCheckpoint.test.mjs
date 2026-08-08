import { describe, expect, it } from 'vitest';
import {
  buildExecutionHandoff,
  canExecuteRoute,
  createExecutionController,
  evaluateExecutionConclusion,
  observeExecutionResult,
  recordExecutionUsage,
  restoreExecutionController,
} from '../../src/engine/executionController.mjs';

describe('execution capacity checkpoint', () => {
  it('lets verified work pass final acceptance after the token budget is reached', () => {
    let state = createExecutionController({ goal: '交付网页', maxTokens: 1000 });
    state = observeExecutionResult(state, {
      toolName: 'write_file', routeKey: 'write:index.html', success: true,
      result: 'index.html 已写入并回读', contributesEvidence: true,
    });
    state = recordExecutionUsage(state, { modelCalls: 1, tokens: 1000 });

    expect(state).toMatchObject({ status: 'checkpointed', phase: 'checkpoint', budgetStopReason: 'tokens' });
    expect(canExecuteRoute(state, { toolName: 'run_command', routeKey: 'test:index.html' }).allowed).toBe(false);

    state = evaluateExecutionConclusion(state, {
      content: '已经依据真实文件完成最终验收', reviewed: true, acceptancePassed: true,
    });
    expect(state).toMatchObject({ status: 'completed', phase: 'complete' });
  });

  it('preserves an unfinished task as a resumable checkpoint instead of a failure', () => {
    let state = createExecutionController({ goal: '继续长任务', maxTokens: 1000 });
    state = recordExecutionUsage(state, { modelCalls: 1, tokens: 1000 });
    state = evaluateExecutionConclusion(state, { content: '仍缺最终产物', reviewed: true, acceptancePassed: false, acceptanceIssues: ['缺最终产物'] });

    expect(state.status).toBe('checkpointed');
    expect(buildExecutionHandoff(state)).toContain('没有被判定失败');

    const resumed = restoreExecutionController(state, { goal: state.goal });
    expect(resumed.status).toBe('running');
    expect(resumed.usage.tokens).toBe(0);
    expect(resumed.lifetimeUsage.tokens).toBeGreaterThanOrEqual(1000);
  });

  it('keeps non-capacity safety budgets as hard stops', () => {
    let state = createExecutionController({ goal: '限制模型循环', maxModelCalls: 1, maxTokens: 10000 });
    state = recordExecutionUsage(state, { modelCalls: 1, tokens: 10 });
    expect(state).toMatchObject({ status: 'blocked', budgetStopReason: 'modelCalls' });
  });
});
