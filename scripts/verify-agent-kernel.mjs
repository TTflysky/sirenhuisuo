import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  canonicalToolCallKey,
  getDirectExecutionControl,
  getToolCallLimit,
  isConversationOnlyMessage,
  isExplicitPauseSteering,
  isExplicitResumeSteering,
  isExplicitStopSteering,
  isPreparationOnlyTool,
  shouldHoldTaskForFeedback,
  toolResourceKey,
} from '../src/engine/agentGuardrails.mjs';

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
