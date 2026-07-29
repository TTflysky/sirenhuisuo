import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildFreshWebQuery, requiresFreshWebResearch, resolveActionableUserGoal } from '../src/engine/agentGuardrails.mjs';
import { createFallbackTaskDecision, normalizeTaskDecision } from '../src/engine/taskDecisionKernel.mjs';
import { createTaskContract } from '../src/engine/taskPlan.mjs';
import { classifyTaskInput } from '../src/engine/taskContextRouter.mjs';
import { selectCapabilityTeam } from '../src/engine/capabilityGraph.mjs';

const availableTools = ['web_search', 'write_file', 'inspect_connectors', 'search_tools', 'describe_tool', 'run_command'];

const weatherRequest = '帮我查询今天上海天气，告诉我下午是否需要带伞';
assert.equal(requiresFreshWebResearch(weatherRequest), true);
const weatherDecision = createFallbackTaskDecision({ latestMessage: weatherRequest, availableTools });
assert.equal(weatherDecision.mode, 'execute');
assert.equal(weatherDecision.primaryRoute, 'web_search');
assert.equal(weatherDecision.deliverableType, 'answer');
assert.match(weatherDecision.searchQuery, /上海天气/);
assert.equal(weatherDecision.searchQuery, '今天上海天气');
assert.doesNotMatch(weatherDecision.searchQuery, /国际化|地方特征|旅游资源/);
assert.equal(weatherDecision.searchQuery, buildFreshWebQuery(weatherRequest));

const answerDecision = createFallbackTaskDecision({ latestMessage: '为什么天空是蓝色的？', availableTools });
assert.equal(answerDecision.deliverableType, 'answer');
assert.notEqual(answerDecision.primaryRoute, 'write_file');

const fileDecision = createFallbackTaskDecision({ latestMessage: '创建一份项目总结 Word 文档并保存', availableTools });
assert.equal(fileDecision.mode, 'execute');
assert.equal(fileDecision.deliverableType, 'file');
assert.equal(fileDecision.primaryRoute, 'write_file');

const connectorDecision = createFallbackTaskDecision({ latestMessage: '配置 IMA 知识库连接器并测试可用性', availableTools });
assert.equal(connectorDecision.deliverableType, 'connection');
assert.equal(connectorDecision.primaryRoute, 'inspect_connectors');

const correctedGoal = resolveActionableUserGoal('不要只读本地，应该主动调用联网搜索完成', weatherRequest);
assert.equal(correctedGoal, weatherRequest, '能力纠正应恢复原目标，而不是把抱怨当成新任务');

const questionRoute = classifyTaskInput('现在做到哪了，卡在哪里？', { status: 'running' });
assert.equal(questionRoute.action, 'reply_then_continue');
assert.equal(questionRoute.replyRequired, true);
const correctionRoute = classifyTaskInput('不对，你查偏题了，重新理解', { status: 'running' });
assert.equal(correctionRoute.action, 'preempt_and_replan');

const employees = [
  { id: 'admin', name: '铁柱', title: '行政助理', role: 'custom', stationIndex: 0, isOnline: true },
  { id: 'teacher', name: '小林', title: '幼师', role: 'custom', prompt: '儿童活动设计', stationIndex: 1, isOnline: true },
  { id: 'web', name: '森森', title: '网页开发工程师', role: 'coder', prompt: 'React TypeScript HTML CSS 前端开发', stationIndex: 2, isOnline: true },
  { id: 'ux', name: '小美', title: 'UI UX设计师', role: 'custom', prompt: '交互设计 用户体验 原型设计', stationIndex: 3, isOnline: true },
  { id: 'review', name: '严谨', title: '质量验收', role: 'checker', stationIndex: 4, isOnline: true },
];
const team = selectCapabilityTeam(employees, {
  request: '改造操作系统前端界面',
  requiredCapabilities: ['ui_ux', 'frontend'],
  requiresTeam: true,
  requiresReview: true,
});
const selectedIds = team.selected.map((member) => member.employeeId);
assert.deepEqual(selectedIds, ['web', 'ux', 'review']);
assert.equal(selectedIds.includes('admin'), false);
assert.equal(selectedIds.includes('teacher'), false);

const modelDecision = normalizeTaskDecision({
  mode: 'execute',
  goal: '重构设置界面并完成构建验证',
  primaryRoute: 'team_dispatch',
  deliverableType: 'file',
  acceptanceCriteria: ['设置界面完成重构', '生产构建通过'],
  requiredConstraints: ['保留所有现有设置数据'],
  requiredCapabilities: ['ui_ux', 'frontend', 'review'],
  riskLevel: 'normal',
  requiresEvidence: true,
  needsUser: false,
  missingUserCondition: '',
  searchQuery: '',
  decisionReason: '需要设计、实现和验收协作',
  confidence: 0.96,
}, { latestMessage: '重构设置界面并完成构建验证', availableTools });
const contract = createTaskContract({
  sourceRequest: modelDecision.goal,
  decision: modelDecision,
  teamPolicy: { requiresTeam: true, explicitMemberIds: selectedIds },
});
assert.equal(contract.deliverableType, 'file');
assert.deepEqual(contract.constraints.acceptanceCriteria, modelDecision.acceptanceCriteria);
assert.ok(contract.requiredCapabilities.includes('ui_ux'));
assert.ok(contract.requiredCapabilities.includes('frontend'));

const taskRunsSource = await fs.readFile('src/data/taskRuns.ts', 'utf8');
const storeSource = await fs.readFile('src/store.tsx', 'utf8');
const clientSource = await fs.readFile('src/data/hermesClient.ts', 'utf8');
const adapterSource = await fs.readFile('electron/nativeExecutionAdapter.cjs', 'utf8');
assert.match(taskRunsSource, /taskDecision\?: TaskDecision/);
assert.match(taskRunsSource, /taskDecision\?\.requiredCapabilities/);
assert.match(storeSource, /skillRefs, undefined, taskDecision/);
assert.doesNotMatch(clientSource, /args\.query\s*=\s*(?:taskDecision\.goal|originalUserText|latestUserText)/);
assert.doesNotMatch(adapterSource, /args\.query\s*=\s*(?:run\.goal|run\.request)/);
assert.doesNotMatch(clientSource, /validateToolCallAgainstGoal/);
assert.doesNotMatch(adapterSource, /validateToolCallAgainstGoal/);

console.log(JSON.stringify({
  passed: true,
  trajectories: 9,
  weatherQuery: weatherDecision.searchQuery,
  selectedIds,
  contractCapabilities: contract.requiredCapabilities,
}, null, 2));
