import assert from 'node:assert/strict';
import { buildTaskDecisionAudit, compileLayeredTaskDecision } from '../src/engine/taskDecisionPipeline.mjs';
import { createFallbackTaskDecision, normalizeTaskDecision } from '../src/engine/taskDecisionKernel.mjs';

const tools = ['read_web_page', 'web_search', 'read_file', 'list_files', 'write_file', 'run_command', 'search_skills', 'install_skill', 'inspect_connectors'];
const input = {
  latestMessage: '请读取 https://example.com/pipeline 并总结正文。',
  activeTaskGoal: '搜索资料',
  previousUserMessage: '请搜索资料。',
  recentHistory: [{ role: 'user', content: 'old' }],
  availableTools: tools,
};
const fallback = createFallbackTaskDecision(input);
const candidate = { mode: 'execute', primaryRoute: 'web_search', turnRelation: 'continuation', goal: 'other' };
const decision = normalizeTaskDecision(candidate, input);
const audit = buildTaskDecisionAudit(input, decision, { fallback, candidate, modelAttempted: true });
assert.deepEqual(Object.keys(audit.layers), ['understanding', 'context', 'governance', 'plan']);
assert.equal(audit.layers.plan.result.primaryRoute, 'read_web_page');
assert.ok(audit.layers.plan.rejectedReasons.length > 0);
const compiled = compileLayeredTaskDecision({ latestMessage: '停止执行，不要再继续。', activeTaskGoal: 'demo', availableTools: tools });
assert.equal(compiled.decision.turnRelation, 'control');
assert.equal(compiled.decision.decisionAudit.version, 1);
console.log(JSON.stringify({ passed: true, pipelineVersion: audit.version, layers: Object.keys(audit.layers) }, null, 2));
