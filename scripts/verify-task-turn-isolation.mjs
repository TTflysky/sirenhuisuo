import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  buildTaskDecisionMessages,
  createFallbackTaskDecision,
  normalizeTaskDecision,
} from '../src/engine/taskDecisionKernel.mjs';

const availableTools = ['list_files', 'search_skills', 'install_skill', 'run_command'];
const activeTaskGoal = '根据官方来源安装 social-content Skill 并完成回读验证';

const independent = createFallbackTaskDecision({
  latestMessage: '查看本地有多少技能，并告诉我名称',
  activeTaskGoal,
  availableTools,
});
assert.equal(independent.mode, 'execute');
assert.equal(independent.turnRelation, 'new_task');
assert.notEqual(independent.goal, activeTaskGoal);

const control = createFallbackTaskDecision({
  latestMessage: '继续执行',
  activeTaskGoal,
  availableTools,
});
assert.equal(control.turnRelation, 'control');

const correction = createFallbackTaskDecision({
  latestMessage: '不对，你没有按我给的链接安装，重新理解。',
  previousUserMessage: activeTaskGoal,
  activeTaskGoal,
  availableTools,
});
assert.equal(correction.turnRelation, 'correction');

const question = createFallbackTaskDecision({
  latestMessage: '现在做到哪一步了，为什么还没有完成？',
  activeTaskGoal,
  availableTools,
});
assert.equal(question.turnRelation, 'question');

const modelDecision = normalizeTaskDecision({
  mode: 'execute',
  turnRelation: 'new_task',
  goal: '不要替换真实目标',
  primaryRoute: 'list_files',
  deliverableType: 'answer',
  acceptanceCriteria: ['列出本地技能'],
  requiredConstraints: [],
  requiresEvidence: true,
  needsUser: false,
  missingUserCondition: '',
  searchQuery: '',
  decisionReason: '用户提出了独立查询。',
  confidence: 0.95,
}, {
  latestMessage: '能帮我统计一下本地 Skill 数量吗？',
  activeTaskGoal,
  availableTools,
});
assert.equal(modelDecision.turnRelation, 'new_task');
assert.equal(modelDecision.goal, '能帮我统计一下本地 Skill 数量吗？');

const decisionMessages = buildTaskDecisionMessages({
  latestMessage: '能帮我统计一下本地 Skill 数量吗？',
  activeTaskGoal,
  availableTools,
});
assert.match(decisionMessages[1].content, /"activeTaskGoal":"根据官方来源安装 social-content Skill 并完成回读验证"/u);

const assistantSource = await fs.readFile('src/components/chat/AssistantChat.tsx', 'utf8');
assert.match(assistantSource, /activeTaskGoalRef/u);
assert.match(assistantSource, /followUpCompilation\.decision\.turnRelation === 'new_task'/u);
assert.match(assistantSource, /独立新任务，已单独排队/u);

console.log(JSON.stringify({
  passed: true,
  cases: ['independent-task', 'resume-control', 'correction', 'status-question', 'model-relation', 'assistant-queue-boundary'],
}, null, 2));
