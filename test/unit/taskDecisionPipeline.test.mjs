import { describe, expect, it } from 'vitest';
import { buildTaskDecisionAudit, compileLayeredTaskDecision } from '../../src/engine/taskDecisionPipeline.mjs';
import { createFallbackTaskDecision, normalizeTaskDecision } from '../../src/engine/taskDecisionKernel.mjs';

const tools = ['read_web_page', 'web_search', 'read_file', 'list_files', 'write_file', 'run_command', 'search_skills', 'install_skill', 'inspect_connectors'];

describe('task decision pipeline', () => {
  it('records four bounded decision layers without exposing hidden reasoning', () => {
    const input = {
      latestMessage: '请读取 https://example.com/source 并总结正文。',
      previousUserMessage: '请先搜索资料。',
      activeTaskGoal: '搜索资料',
      recentHistory: Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `history ${index}` })),
      availableTools: tools,
      attachments: [{ name: 'source.png', kind: 'image', size: 100 }],
    };
    const fallback = createFallbackTaskDecision(input);
    const candidate = { mode: 'execute', turnRelation: 'continuation', primaryRoute: 'web_search', goal: 'search something else' };
    const decision = normalizeTaskDecision(candidate, input);
    const audit = buildTaskDecisionAudit(input, decision, { fallback, candidate, modelAttempted: true });
    expect(Object.keys(audit.layers)).toEqual(['understanding', 'context', 'governance', 'plan']);
    expect(audit.layers.understanding.input.latestMessage).toContain('example.com');
    expect(audit.layers.context.input.recentHistory).toHaveLength(8);
    expect(audit.layers.governance.input.explicitResource.url).toBe('https://example.com/source');
    expect(audit.layers.plan.result.primaryRoute).toBe('read_web_page');
    expect(audit.layers.plan.rejectedReasons.some((item) => item.code === 'route_guard')).toBe(true);
    expect(JSON.stringify(audit)).not.toMatch(/chain.of.thought|hidden.reasoning|思维链/iu);
  });

  it('keeps the audit on the decision returned by the pipeline', () => {
    const result = compileLayeredTaskDecision({ latestMessage: '停止执行，不要再继续。', activeTaskGoal: 'demo', availableTools: tools });
    expect(result.decision.mode).toBe('conversation');
    expect(result.decision.turnRelation).toBe('control');
    expect(result.decision.decisionAudit).toBe(result.audit);
    expect(result.audit.layers.context.result.control).toBe(true);
  });
});
