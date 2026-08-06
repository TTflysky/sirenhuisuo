import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  canonicalToolCallKey,
  compactToolArgumentsForHistory,
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
  classifyTaskTurnIntent,
  createFallbackTaskDecision,
  isKnowledgeDirectoryReadRequest,
  normalizeTaskDecision,
} from '../src/engine/taskDecisionKernel.mjs';
import {
  isSkillHubDownloadUrl,
  isSkillInstallOnlyRequest,
  resolveSkillInstallRequest,
  skillHubDownloadUrl,
} from '../src/engine/skillInstallRouting.mjs';
import {
  assessEvidenceAlignment,
  assessTaskCompletion,
  extractTaskRequirements,
  validateSearchQueryAgainstGoal,
  validateToolCallAgainstGoal,
} from '../src/engine/taskFidelity.mjs';

const allToolNames = ['web_search', 'inspect_connectors', 'read_file', 'list_files', 'search_skills', 'install_skill', 'write_file', 'run_command'];

assert.equal(
  resolveActionableUserGoal('\u91cd\u65b0\u67e5\u4e00\u4e0b\u672c\u5730\u5df2\u5b89\u88c5\u6280\u80fd\u6570\u91cf', '\u5b89\u88c5\u4e0a\u4e00\u4e2a\u7f51\u4e0a\u627e\u5230\u7684 Skill'),
  '\u91cd\u65b0\u67e5\u4e00\u4e0b\u672c\u5730\u5df2\u5b89\u88c5\u6280\u80fd\u6570\u91cf',
  'a self-contained new request must not inherit the previous failed task',
);

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

const knowledgeDirectoryGoal = '查看 Obsidian 知识库目录，并告诉我有哪些笔记';
assert.equal(isKnowledgeDirectoryReadRequest(knowledgeDirectoryGoal), true);
const knowledgeDirectoryDecision = createFallbackTaskDecision({
  latestMessage: knowledgeDirectoryGoal,
  availableTools: allToolNames,
});
assert.equal(knowledgeDirectoryDecision.primaryRoute, 'run_command', 'Reading a knowledge directory must not be misclassified as connector setup');
assert.equal(knowledgeDirectoryDecision.deliverableType, 'operation');

const outputDecision = createFallbackTaskDecision({
  latestMessage: '生成一份 Word 报告并保存到产出物',
  availableTools: allToolNames,
});
assert.equal(outputDecision.primaryRoute, 'write_file');

const skillHubPrompt = '请根据 https://skillhub.cn/install/skillhub.md，安装 grill-me。';
const skillInstall = resolveSkillInstallRequest(skillHubPrompt);
assert.deepEqual(skillInstall, {
  instructionUrl: 'https://skillhub.cn/install/skillhub.md',
  sourceUrl: 'https://api.skillhub.cn/api/v1/download?slug=grill-me',
  name: 'grill-me',
  provider: 'skillhub',
  slug: 'grill-me',
});
assert.equal(skillHubDownloadUrl('grill-me'), skillInstall.sourceUrl);
assert.equal(isSkillHubDownloadUrl(skillInstall.sourceUrl), true);
assert.equal(isSkillInstallOnlyRequest(skillHubPrompt), true);
const explicitGitHubSkillPrompt = 'Install this Skill exactly from https://skillsmp.com/zh/creators/anthropics/skills/skills-skill-creator and https://github.com/anthropics/skills/tree/main/skills/skill-creator. Read the complete package before installing.';
const explicitGitHubSkill = resolveSkillInstallRequest(explicitGitHubSkillPrompt);
assert.equal(explicitGitHubSkill.sourceUrl, 'https://github.com/anthropics/skills/tree/main/skills/skill-creator', 'A concrete GitHub package must outrank a marketplace reference or generic instructions');
assert.equal(explicitGitHubSkill.provider, 'direct');
assert.equal(isSkillInstallOnlyRequest(explicitGitHubSkillPrompt), true);
const githubContentsSkill = resolveSkillInstallRequest('Install https://api.github.com/repos/anthropics/skills/contents/skills/skill-creator/SKILL.md?ref=main as a Skill.');
assert.equal(githubContentsSkill.sourceUrl, 'https://api.github.com/repos/anthropics/skills/contents/skills/skill-creator/SKILL.md?ref=main');
assert.equal(githubContentsSkill.provider, 'direct');
assert.equal(resolveSkillInstallRequest('Find a Skill for viral video analysis'), undefined, 'Discovery must not fabricate an install source');
assert.equal(isSkillInstallOnlyRequest('Find a Skill for viral video analysis'), false, 'Discovery must wait for user selection before installation');
const skillInstallDecision = createFallbackTaskDecision({ latestMessage: skillHubPrompt, availableTools: allToolNames });
assert.equal(skillInstallDecision.mode, 'execute');
assert.equal(skillInstallDecision.primaryRoute, 'install_skill');
const protectedSkillRoute = normalizeTaskDecision({
  mode: 'execute', goal: skillHubPrompt, primaryRoute: 'run_command', acceptanceCriteria: ['运行 skillhub 命令'],
  requiresEvidence: true, needsUser: false, missingUserCondition: '', searchQuery: '', decisionReason: '误走 CLI', confidence: 0.9,
}, { latestMessage: skillHubPrompt, availableTools: allToolNames });
assert.equal(protectedSkillRoute.primaryRoute, 'install_skill', 'Explicit Skill URLs must use the native installer');

const chatDecision = createFallbackTaskDecision({
  latestMessage: '我今天有点累，先陪我聊两句',
  availableTools: allToolNames,
});
assert.equal(chatDecision.mode, 'conversation');

const contextualFollowUp = '你自己判断我这句话到底是叫你重新查找，还是基于之前的回答问你？';
assert.equal(classifyTaskTurnIntent(contextualFollowUp), 'follow_up_question');
const contextualFollowUpDecision = createFallbackTaskDecision({
  latestMessage: contextualFollowUp,
  previousUserMessage: '重新查一下本地已安装技能数量',
  availableTools: allToolNames,
});
assert.notEqual(contextualFollowUpDecision.mode, 'execute', 'A question about the previous exchange must not inherit the old tool route');
assert.equal(contextualFollowUpDecision.primaryRoute, 'direct_answer');
const modelMisclassifiedFollowUp = normalizeTaskDecision({
  mode: 'execute', goal: '重新查找技能', primaryRoute: 'search_skills', acceptanceCriteria: ['重新检索'],
  requiresEvidence: true, needsUser: false, missingUserCondition: '', searchQuery: '技能', decisionReason: '误把追问当命令', confidence: 0.9,
}, { latestMessage: contextualFollowUp, previousUserMessage: '重新查一下本地已安装技能数量', availableTools: allToolNames });
assert.equal(modelMisclassifiedFollowUp.mode, 'answer', 'The kernel must keep a discourse follow-up in an answer-only mode even when the model requests tools');
assert.equal(modelMisclassifiedFollowUp.primaryRoute, 'direct_answer');

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

const weatherGoal = '查看一下今天的天气情况，安徽省滁州市全椒县';
const driftedWeatherDecision = normalizeTaskDecision({
  mode: 'execute',
  goal: '了解安徽省',
  primaryRoute: 'web_search',
  acceptanceCriteria: ['找到安徽省资料'],
  requiresEvidence: true,
  needsUser: false,
  missingUserCondition: '',
  searchQuery: '安徽省',
  decisionReason: '缩短查询',
  confidence: 0.9,
}, { latestMessage: weatherGoal, availableTools: allToolNames });
assert.equal(driftedWeatherDecision.goal, weatherGoal, 'The model must not rewrite away the authoritative user goal');
assert.equal(driftedWeatherDecision.searchQuery, '安徽省', '模型生成的精确工具参数应原样进入运行时，再根据真实结果纠偏');
assert.deepEqual(driftedWeatherDecision.requiredConstraints, ['时间：今天', '地点：安徽省滁州市全椒县', '主题：天气情况']);
assert.equal(validateSearchQueryAgainstGoal(weatherGoal, '安徽省').passed, false);
assert.equal(validateSearchQueryAgainstGoal(weatherGoal, driftedWeatherDecision.searchQuery).passed, false);
assert.equal(assessEvidenceAlignment(weatherGoal, '安徽省位于中国东部，是旅游目的地。').passed, false);
assert.equal(assessEvidenceAlignment(weatherGoal, '全椒县 2026-07-28 天气：29°C，湿度 89%。', { requireTime: true }).passed, true);
assert.ok(extractTaskRequirements(weatherGoal).some((item) => item.id === 'weather'));
assert.equal(validateToolCallAgainstGoal('使用生图工具生成一张小猫图片', 'write_file', JSON.stringify({ path: '小猫.svg' })).allowed, false);
assert.equal(assessTaskCompletion('使用生图工具生成一张小猫图片', '已经生成', [{ name: 'write_file', args: '{"path":"小猫.svg"}', result: 'saved', success: true }]).passed, false);

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
assert.notEqual(
  canonicalToolCallKey('run_command', '{"cmd":"node verify-a.js"}'),
  canonicalToolCallKey('run_command', '{"cmd":"node verify-b.js"}'),
  'different cmd commands must not collapse into the same execution route',
);
assert.equal(
  canonicalToolCallKey('run_command', '{"cmd":"node verify.js"}'),
  canonicalToolCallKey('run_command', '{"command":"node verify.js"}'),
  'cmd and command aliases must identify the same route',
);
const compactedWrite = JSON.parse(compactToolArgumentsForHistory('write_file', JSON.stringify({ path: 'large.html', content: 'x'.repeat(12000) }), true));
assert.equal(compactedWrite.path, 'large.html');
assert.match(compactedWrite.content, /12000 characters/u);
assert.ok(JSON.stringify(compactedWrite).length < 300, 'successful file writes must not be replayed in full model history');
assert.equal(
  JSON.parse(compactToolArgumentsForHistory('write_file', JSON.stringify({ path: 'retry.html', content: 'keep me' }), false)).content,
  'keep me',
  'failed writes retain arguments needed for correction',
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
assert.equal(
  resolveActionableUserGoal('我需要用生图工具生成，而不是你直接画一张。', '生成一张小猫图片'),
  '生成一张小猫图片\n新增约束：我需要用生图工具生成，而不是你直接画一张。',
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
const clientSource = `${await fs.readFile(new URL('../src/data/hermesClient.ts', import.meta.url), 'utf8')}\n${await fs.readFile(new URL('../src/data/agentLoopRuntime.ts', import.meta.url), 'utf8')}\n${await fs.readFile(new URL('../src/data/agentLoopSkillInstall.ts', import.meta.url), 'utf8')}\n${await fs.readFile(new URL('../src/data/agentLoopFinalization.ts', import.meta.url), 'utf8')}\n${await fs.readFile(new URL('../src/data/agentLoopPolicy.ts', import.meta.url), 'utf8')}`;
const assistantChatSource = await fs.readFile(new URL('../src/components/chat/AssistantChat.tsx', import.meta.url), 'utf8');
const dmChatSource = await fs.readFile(new URL('../src/components/chat/DmChatApp.tsx', import.meta.url), 'utf8');
const teamDiscussionSource = await fs.readFile(new URL('../src/engine/teamDiscussion.ts', import.meta.url), 'utf8');
const storeSource = `${await fs.readFile(new URL('../src/store.tsx', import.meta.url), 'utf8')}\n${await fs.readFile(new URL('../src/store/teamDiscussionRuntime.ts', import.meta.url), 'utf8')}`;
const executionHookSource = await fs.readFile(new URL('../src/hooks/useAgentExecutionControl.ts', import.meta.url), 'utf8');
const taskLearningSource = await fs.readFile(new URL('../src/engine/taskLearningMemory.ts', import.meta.url), 'utf8');
const configSyncSource = await fs.readFile(new URL('../src/utils/configSync.ts', import.meta.url), 'utf8');
const settingsSource = await fs.readFile(new URL('../src/components/settings/SettingsModal.tsx', import.meta.url), 'utf8');
assert.match(mainSource, /connector-config'\) return \{ width: 620, height: 820,/u);
assert.match(mainSource, /const height = Math\.min\(spec\.height,/u);
assert.match(clientSource, /maxTotalToolAttempts = connectorSetupTask \? 18 : 48/u);
assert.match(clientSource, /export function isConnectorSetupRequest/u);
assert.match(clientSource, /export function isConnectorVerificationOnlyRequest/u);
assert.match(clientSource, /isKnowledgeDirectoryReadRequest/u);
assert.doesNotMatch(clientSource, /model: 'client-connector-adapter'/u);
assert.doesNotMatch(clientSource, /model: 'client-skill-installer'/u);
assert.doesNotMatch(clientSource, /required-skill-/u);
assert.doesNotMatch(clientSource, /客户端已自动阅读/u);
assert.match(clientSource, /isResearchDeliveryDeflection/u);
assert.match(clientSource, /验证\|测试\|检查\|诊断\|连通\|可用\|能不能用/u);
assert.doesNotMatch(clientSource, /required-connector-/u);
assert.doesNotMatch(clientSource, /runRequiredConnectorTool/u);
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
const nativeToolSource = await fs.readFile(new URL('../electron/nativeToolRuntime.cjs', import.meta.url), 'utf8');
assert.match(skillsSource, /referencedPaths/u);
assert.match(skillsSource, /isSkillHubDownloadUrl/u);
assert.match(nativeToolSource, /技能 CLI 安装路线已停用/u);
assert.match(nativeToolSource, /isSkillsCliInstallCommand/u);
assert.match(skillsSource, /documents\.push\(\{ path:/u);
assert.match(toolsSource, /skillInstructionText/u);
assert.match(clientSource, /respondToSteering/u);
assert.match(clientSource, /steeringCheckpointTurns/u);
assert.match(clientSource, /canExecuteRoute\(executionState/u);
assert.match(clientSource, /observeExecutionResult\(executionState/u);
assert.match(clientSource, /evaluateExecutionConclusion\(executionState/u);
assert.match(clientSource, /markExecutionBudgetReached\(executionState/u);
assert.match(clientSource, /retryLimit: maxResearchSummaryAttempts - 1/u);
assert.match(clientSource, /decideTurnRecovery\(turnRuntime/u);
assert.match(clientSource, /executionControllerGuidance\(executionState\)/u);
assert.match(clientSource, /compileTaskDecision\(turns, tools/u);
assert.match(clientSource, /buildTaskContract\(taskDecision/u);
assert.match(clientSource, /recordTaskLearning/u);
assert.match(clientSource, /resumedFromCapabilityCorrection/u);
assert.match(clientSource, /cognitiveOnlyCompletion/u);
assert.match(clientSource, /指定 Skill 来源合同/u);
assert.match(clientSource, /不得改读市场页、聚合页或替代来源/u);
assert.match(clientSource, /const modelArgs = pinnedSkillSource/u);
assert.match(clientSource, /安装前必须先读取用户指定来源中的 SKILL\.md/u);
assert.match(clientSource, /native-skill-install-/u);
assert.doesNotMatch(clientSource, /pinnedSkillInstallAttempted/u);
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
  clientSource.indexOf('await waitIfPaused?.();', clientSource.indexOf('for (let iter = 0; !directInstallHandled && iter < maxIter; iter++)'))
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
