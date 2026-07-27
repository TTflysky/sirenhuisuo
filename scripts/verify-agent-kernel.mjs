import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  canonicalToolCallKey,
  buildFreshWebQuery,
  getDirectExecutionControl,
  getToolCallLimit,
  isActionableCapabilityCorrection,
  isConversationOnlyMessage,
  isExplicitPauseSteering,
  isExplicitResumeSteering,
  isExplicitStopSteering,
  isPreparationOnlyTool,
  requiresFreshWebResearch,
  requiresObservableExecutionEvidence,
  resolveActionableUserGoal,
  shouldHoldTaskForFeedback,
  toolResourceKey,
} from '../src/engine/agentGuardrails.mjs';
import {
  buildTaskContract,
  createFallbackTaskDecision,
  normalizeTaskDecision,
} from '../src/engine/taskDecisionKernel.mjs';

const allToolNames = ['web_search', 'inspect_connectors', 'read_file', 'list_files', 'search_skills', 'write_file', 'run_command'];

const webDecision = createFallbackTaskDecision({
  latestMessage: '查一下今天的抖音热度榜，然后给我',
  availableTools: allToolNames,
});
assert.equal(webDecision.mode, 'execute');
assert.equal(webDecision.primaryRoute, 'web_search');
assert.equal(webDecision.requiresEvidence, true);

const localFileDecision = createFallbackTaskDecision({
  latestMessage: '读取工作区里的合同.docx，告诉我有没有错字',
  availableTools: allToolNames,
});
assert.equal(localFileDecision.mode, 'execute');
assert.equal(localFileDecision.primaryRoute, 'read_file');

const connectorDecision = createFallbackTaskDecision({
  latestMessage: '把 IMA 知识库连接好并验证能用',
  availableTools: allToolNames,
});
assert.equal(connectorDecision.primaryRoute, 'inspect_connectors');
assert.ok(connectorDecision.acceptanceCriteria.some((item) => /连接测试/u.test(item)));

const outputDecision = createFallbackTaskDecision({
  latestMessage: '生成一份 Word 报告并保存到产出物',
  availableTools: allToolNames,
});
assert.equal(outputDecision.primaryRoute, 'write_file');

const chatDecision = createFallbackTaskDecision({
  latestMessage: '我今天有点累，先陪我聊两句',
  availableTools: allToolNames,
});
assert.equal(chatDecision.mode, 'conversation');

const pausedButNewWorkDecision = createFallbackTaskDecision({
  latestMessage: '我已经暂停了之前的任务，现在把这个内核问题修复并验证',
  availableTools: allToolNames,
});
assert.equal(pausedButNewWorkDecision.mode, 'execute', 'Explicit new work must win over feedback wording');

const correctionDecision = normalizeTaskDecision({
  mode: 'conversation',
  goal: '你怎么不会搜索',
  primaryRoute: 'direct_answer',
  acceptanceCriteria: ['解释能力'],
  requiresEvidence: false,
  needsUser: false,
  missingUserCondition: '',
  searchQuery: '',
  decisionReason: '误判为反馈',
  confidence: 0.9,
}, {
  latestMessage: '你难道不会用技能查询吗？',
  previousUserMessage: '查一下今天的抖音热度榜，然后给我',
  availableTools: allToolNames,
});
assert.equal(correctionDecision.mode, 'execute');
assert.equal(correctionDecision.goal, '查一下今天的抖音热度榜，然后给我');
assert.equal(correctionDecision.primaryRoute, 'web_search');

const unsafeNeedUserDecision = normalizeTaskDecision({
  mode: 'execute',
  goal: '检查项目状态',
  primaryRoute: 'list_files',
  acceptanceCriteria: ['读取状态'],
  requiresEvidence: true,
  needsUser: true,
  missingUserCondition: '需要用户告诉我下一步怎么办',
  searchQuery: '',
  decisionReason: '想先询问',
  confidence: 0.8,
}, { latestMessage: '检查项目状态', availableTools: allToolNames });
assert.equal(unsafeNeedUserDecision.needsUser, false, 'The kernel must not ask the user before inspecting available evidence');
assert.match(buildTaskContract(connectorDecision), /完成标准/u);
assert.match(buildTaskContract(connectorDecision), /当前不应先向用户索要条件/u);

assert.equal(
  canonicalToolCallKey('read_skill', '{"id":" IMA-Skill "}'),
  canonicalToolCallKey('read_skill', '{"id":"ima-skill"}'),
  'Skill ID normalization must block cosmetic duplicates',
);
assert.notEqual(
  canonicalToolCallKey('read_file', '{"path":"guide.md","offset":"0"}'),
  canonicalToolCallKey('read_file', '{"path":"guide.md","offset":"12000"}'),
  'Long files must still support real pagination',
);
assert.equal(
  toolResourceKey('read_file', JSON.stringify({ path: 'Docs\\SKILL.md', offset: '0' })),
  toolResourceKey('read_file', JSON.stringify({ path: 'docs/skill.md', offset: '12000' })),
  'Resource-level accounting must span pagination arguments',
);

assert.equal(isConversationOnlyMessage('你这样没有意义，一直在重复做无用功。'), true);
assert.equal(isConversationOnlyMessage('需要帮助吗？卡在哪里了？'), true);
assert.equal(isConversationOnlyMessage('现在请重新配置 IMA 知识库并验证。'), false);
assert.equal(isConversationOnlyMessage('把这个内核问题修复。'), false);
assert.equal(isConversationOnlyMessage('把刚才的问题改掉。'), false);
assert.equal(requiresFreshWebResearch('查一下今天的抖音热度榜，然后给我'), true);
assert.equal(isConversationOnlyMessage('查一下今天的抖音热度榜，然后给我'), false);
assert.equal(buildFreshWebQuery('查一下今天的抖音热度榜，然后给我'), '今天的抖音热度榜，然后给我');
assert.equal(requiresFreshWebResearch('查一下这个本地文件有没有问题'), false);
assert.equal(isActionableCapabilityCorrection('你难道不会用技能查询吗？'), true);
assert.equal(
  resolveActionableUserGoal('你难道不会用技能查询吗？', '查一下今天的抖音热度榜，然后给我'),
  '查一下今天的抖音热度榜，然后给我',
);
assert.equal(isConversationOnlyMessage('我今天有点累，先聊两句。'), true);
assert.equal(isConversationOnlyMessage('继续'), false);
assert.equal(isExplicitStopSteering(['停止任务']), true);
assert.equal(isExplicitStopSteering(['不要停止，继续检查']), false);
assert.equal(isExplicitPauseSteering(['暂停任务']), true);
assert.equal(isExplicitResumeSteering(['继续，刚刚掉线了']), true);
assert.equal(getDirectExecutionControl('继续任务'), 'resume');
assert.equal(shouldHoldTaskForFeedback('这样的操作没有任何意义，一直重复读取技能。'), true);
assert.equal(shouldHoldTaskForFeedback('换一条路线继续完成。'), false);
assert.equal(isPreparationOnlyTool('read_skill'), true);
assert.equal(isPreparationOnlyTool('run_command'), false);
assert.ok(getToolCallLimit('read_skill', true) <= 3);
assert.ok(getToolCallLimit('inspect_connectors', true) <= 2);
assert.equal(requiresObservableExecutionEvidence('帮我分析这段提示词并给建议'), false);
assert.equal(requiresObservableExecutionEvidence('修改项目代码并重新打包'), true);
assert.equal(requiresObservableExecutionEvidence('联网搜索今天的 AI 资讯'), true);

const repeatedSkillCalls = Array.from({ length: 118 }, () => '{"id":"ima-skill"}');
const resources = new Set();
let executableReads = 0;
for (const argumentsText of repeatedSkillCalls) {
  const resource = toolResourceKey('read_skill', argumentsText);
  if (resources.has(resource) || executableReads >= getToolCallLimit('read_skill', true)) continue;
  resources.add(resource);
  executableReads += 1;
}
assert.equal(executableReads, 1, '118 repeated Skill reads must collapse to one real read');

const mainSource = await fs.readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
const clientSource = await fs.readFile(new URL('../src/data/hermesClient.ts', import.meta.url), 'utf8');
const assistantChatSource = await fs.readFile(new URL('../src/components/chat/AssistantChat.tsx', import.meta.url), 'utf8');
const dmChatSource = await fs.readFile(new URL('../src/components/chat/DmChatApp.tsx', import.meta.url), 'utf8');
const teamDiscussionSource = await fs.readFile(new URL('../src/engine/teamDiscussion.ts', import.meta.url), 'utf8');
const storeSource = await fs.readFile(new URL('../src/store.tsx', import.meta.url), 'utf8');
const executionHookSource = await fs.readFile(new URL('../src/hooks/useAgentExecutionControl.ts', import.meta.url), 'utf8');
const taskLearningSource = await fs.readFile(new URL('../src/engine/taskLearningMemory.ts', import.meta.url), 'utf8');
const configSyncSource = await fs.readFile(new URL('../src/utils/configSync.ts', import.meta.url), 'utf8');
const settingsSource = await fs.readFile(new URL('../src/components/settings/SettingsModal.tsx', import.meta.url), 'utf8');
assert.match(mainSource, /connector-config'\) return \{ width: 620, height: 820,/u);
assert.match(mainSource, /const height = Math\.min\(spec\.height,/u);
assert.match(clientSource, /maxTotalToolAttempts = connectorSetupTask \? 24 : 96/u);
assert.match(clientSource, /export function isConnectorSetupRequest/u);
assert.match(clientSource, /export function isConnectorVerificationOnlyRequest/u);
assert.match(clientSource, /model: 'client-connector-adapter'/u);
assert.match(clientSource, /客户端已自动阅读/u);
assert.match(clientSource, /isResearchDeliveryDeflection/u);
assert.match(clientSource, /验证\|测试\|检查\|诊断\|连通\|可用\|能不能用/u);
assert.match(clientSource, /required-connector-/u);
assert.ok(clientSource.indexOf("runRequiredConnectorTool('inspect_connectors'") < clientSource.indexOf("runRequiredConnectorTool('test_connector'"));
const toolsSource = await fs.readFile(new URL('../src/engine/tools.ts', import.meta.url), 'utf8');
const connectorsSource = await fs.readFile(new URL('../src/data/connectors.ts', import.meta.url), 'utf8');
const connectorAdapterSource = await fs.readFile(new URL('../electron/connectorAdapters.cjs', import.meta.url), 'utf8');
const connectorModalSource = await fs.readFile(new URL('../src/components/sidebar/ConnectorConfigModal.tsx', import.meta.url), 'utf8');
assert.match(connectorsSource, /search_knowledge_base/u);
assert.match(toolsSource, /读取了已关联 Skill/u);
assert.match(toolsSource, /preset-verified/u);
assert.match(connectorsSource, /adapter: 'ima'/u);
assert.match(mainSource, /connector:verifyPreset/u);
assert.match(mainSource, /buildPowerShellCommand/u);
assert.match(toolsSource, /connectorVerifyPreset/u);
assert.match(connectorAdapterSource, /DEFAULT_RETRY_DELAYS_MS = \[0, 1200, 3000\]/u);
assert.doesNotMatch(connectorModalSource, /调用 run_command 执行该命令/u);
assert.doesNotMatch(connectorModalSource, /调用 read_skill，读取/u);
assert.match(connectorModalSource, /不要再次调用 inspect_connectors、test_connector 或 read_skill/u);
const skillsSource = await fs.readFile(new URL('../electron/skills.cjs', import.meta.url), 'utf8');
assert.match(skillsSource, /referencedPaths/u);
assert.match(skillsSource, /documents\.push\(\{ path:/u);
assert.match(toolsSource, /skillInstructionText/u);
assert.match(clientSource, /respondToSteering/u);
assert.match(clientSource, /steeringCheckpointTurns/u);
assert.match(clientSource, /canExecuteRoute\(executionState/u);
assert.match(clientSource, /observeExecutionResult\(executionState/u);
assert.match(clientSource, /evaluateExecutionConclusion\(executionState/u);
assert.match(clientSource, /markExecutionBudgetReached\(executionState/u);
assert.match(clientSource, /retryLimit: maxResearchSummaryAttempts - 1/u);
assert.match(clientSource, /executionRetryExhausted = true/u);
assert.match(clientSource, /executionControllerGuidance\(executionState\)/u);
assert.match(clientSource, /compileTaskDecision\(turns, tools/u);
assert.match(clientSource, /buildTaskContract\(taskDecision/u);
assert.match(clientSource, /recordTaskLearning/u);
assert.match(clientSource, /resumedFromCapabilityCorrection/u);
assert.match(clientSource, /cognitiveOnlyCompletion/u);
assert.doesNotMatch(clientSource, /buildRecoveryGuide\(/u);
assert.match(assistantChatSource, /onExecutionState\(state\)/u);
assert.match(dmChatSource, /controllerState\?: ExecutionControllerSnapshot/u);
assert.match(dmChatSource, /initialExecutionState,/u);
assert.match(teamDiscussionSource, /sharedExecutionState/u);
assert.match(teamDiscussionSource, /executionRouteScope/u);
assert.match(storeSource, /recoveryContext\.controller = controller/u);
assert.match(executionHookSource, /steeringWakePendingRef/u);
assert.match(executionHookSource, /race where the model is aborted just before the loop starts waiting/u);
assert.match(taskLearningSource, /hermes_office_task_learning_memory_v1/u);
assert.match(taskLearningSource, /rankTaskLearnings/u);
assert.match(configSyncSource, /taskLearnings\?: TaskLearning\[\]/u);
assert.match(configSyncSource, /userMemory\?: UserMemoryItem\[\]/u);
assert.match(configSyncSource, /__REQUIRED_LOCAL_SECRET__/u);
assert.match(settingsSource, /任务经验/u);
assert.match(settingsSource, /导出同步配置/u);
assert.doesNotMatch(storeSource, /step\.status = \/\^⚠️\|无法响应\|执行失败/u);
assert.ok(
  clientSource.indexOf('await waitIfPaused?.();', clientSource.indexOf('for (let iter = 0; iter < maxIter; iter++)'))
    < clientSource.indexOf('const atTurnStartGuidance = consumeSteeringMessages?.() ?? [];'),
  'A paused loop must process steering before resuming the old model plan',
);

console.log(JSON.stringify({
  passed: true,
  repeatedSkillCalls: repeatedSkillCalls.length,
  executableReads,
  connectorReadSkillLimit: getToolCallLimit('read_skill', true),
  feedbackDoesNotResumeTask: true,
  connectorWindowDefaultHeight: 820,
}, null, 2));
