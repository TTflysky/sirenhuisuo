import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {
  capabilityCoverage,
  inferCapabilityIds,
} from '../src/engine/capabilityGraph.mjs';
import { matchProjectMembers } from '../src/engine/taskMatcher.ts';
import { normalizeTaskDecision } from '../src/engine/taskDecisionKernel.mjs';
import { messagesToMarkdown } from '../src/utils/clipboard.ts';

const membershipSource = await fs.readFile('src/engine/teamMembership.ts', 'utf8');
const matcherUrl = new URL('../src/engine/taskMatcher.ts', import.meta.url).href;
const membershipJs = ts.transpileModule(membershipSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  fileName: 'src/engine/teamMembership.ts',
}).outputText.replace("from './taskMatcher';", `from '${matcherUrl}';`);
const membership = await import(`data:text/javascript;base64,${Buffer.from(membershipJs).toString('base64')}`);

const employees = [
  { id: 'coordinator', name: '产品经理', title: '产品经理', role: 'pm', capabilities: ['coordination'], stationIndex: 0, isOnline: true },
  { id: 'drupal', name: 'Drupal 购物车工程师', title: '工程部', role: 'coder', capabilities: ['backend', 'coding'], stationIndex: 1, isOnline: true },
  { id: 'wordpress', name: 'WordPress 购物车工程师', title: '工程部', role: 'coder', capabilities: ['backend', 'coding'], stationIndex: 2, isOnline: true },
  { id: 'architect', name: '软件架构师', title: '软件架构师', role: 'planner', capabilities: ['architecture', 'coding'], stationIndex: 3, isOnline: true },
  { id: 'ui', name: 'UI 设计师', title: 'UI 设计师', role: 'planner', capabilities: ['ui_ux'], stationIndex: 4, isOnline: true },
  { id: 'frontend', name: '前端开发者', title: '前端开发工程师', role: 'coder', capabilities: ['frontend', 'coding'], stationIndex: 5, isOnline: true },
  { id: 'backend', name: '后端架构师', title: '后端架构师', role: 'coder', capabilities: ['backend', 'coding'], stationIndex: 6, isOnline: true },
  { id: 'qa', name: '审查者', title: 'QA 工程师', role: 'checker', capabilities: ['review'], stationIndex: 7, isOnline: true },
  { id: 'teacher', name: '幼师', title: '幼儿教育', role: 'custom', capabilities: ['content'], stationIndex: 8, isOnline: true },
];

employees.find((employee) => employee.id === 'architect').prompt = '架构设计必须包含 UI 层，并在交付前执行完整测试和 QA 审查。';
assert.equal(capabilityCoverage(employees.find((employee) => employee.id === 'architect'), ['ui_ux', 'review']).covered.length, 0, '提示词提及相邻职责不能让架构师冒充 UI 或 QA');

const request = '我需要做一个个人创作者发布平台客户端，你安排人帮我做一下。';
const baseline = ['coordination', 'architecture', 'ui_ux', 'frontend', 'backend', 'coding', 'review'];
assert.deepEqual(inferCapabilityIds(request), baseline, '完整软件产品必须编译为不可删减的职责基线');

const modelDecision = normalizeTaskDecision({
  mode: 'execute', goal: request, primaryRoute: 'team_dispatch', deliverableType: 'mixed',
  acceptanceCriteria: ['完成组队'], requiredCapabilities: ['coding'],
  teamPolicy: { requiresTeam: true }, requiresEvidence: true, needsUser: false,
  missingUserCondition: '', searchQuery: '', decisionReason: '需要团队', confidence: 0.9,
}, { latestMessage: request, availableTools: [] });
assert.deepEqual(modelDecision.requiredCapabilities, baseline, '模型漏项不能删除确定性的项目职责');

const initialRoster = matchProjectMembers(employees, request);
const initialIds = initialRoster.map((member) => member.employeeId);
for (const id of ['coordinator', 'architect', 'ui', 'frontend', 'backend', 'qa']) {
  assert.ok(initialIds.includes(id), `软件项目缺少职责员工 ${id}`);
}
for (const id of ['drupal', 'wordpress', 'teacher']) {
  assert.equal(initialIds.includes(id), false, `无关员工 ${id} 不得作为兜底候选`);
}
const covered = new Set(initialIds.flatMap((id) => capabilityCoverage(employees.find((employee) => employee.id === id), baseline).covered));
assert.deepEqual([...covered].sort(), [...baseline].sort(), '初始团队必须覆盖完整职责基线');

const project = { request, requiredCapabilities: baseline };
const corrections = [
  '人员不对哦，重新看一下我的需求然后从员工里面挑选。',
  '这里还是有问题，不对的，连个框架设计都没有吗？谁写代码，谁负责设计，谁负责审核，谁负责UI全没有吗？重新选人。',
  '不对，重新看看我的需求。客户端开发。',
];
for (const correction of corrections) {
  assert.equal(membership.isProjectRosterRematchRequest(correction), true, `必须识别同草案纠错：${correction}`);
  const rematchedIds = membership.rematchProjectRoster(project, correction, employees).map((member) => member.employeeId);
  assert.deepEqual(rematchedIds, initialIds, '纠错必须沿用原始目标并稳定修改同一草案');
}

const markdown = messagesToMarkdown([{ role: '用户', content: '测试' }], '聊天记录');
assert.match(markdown, /_由太极助手导出_/u);
assert.doesNotMatch(markdown, /Hermes 助手导出/u);

const [assistantSource, officeSource, themeSource] = await Promise.all([
  fs.readFile('src/components/chat/AssistantChat.tsx', 'utf8'),
  fs.readFile('src/components/office/OfficeView.tsx', 'utf8'),
  Promise.all(['core', 'collaboration', 'appearance', 'settings', 'workspace']
    .map((name) => fs.readFile(`src/styles/${name}.css`, 'utf8'))).then((sources) => sources.join('\n')),
]);
assert.ok(assistantSource.indexOf('isProjectRosterRematchRequest(enriched)') < assistantSource.indexOf('isTeamMemberAdditionRequest(enriched)'), '草案重匹配必须先于单人添加处理');
assert.match(assistantSource, /安排\.\{0,12\}\(\?:员工\|成员\|人\|人手\|专员\|同事\)/u, '“安排人”必须进入显式团队调度');
assert.match(officeSource, /onWheel=\{\(event\)/u, '分类导航必须支持鼠标滚轮横向浏览');
assert.match(officeSource, /scrollIntoView\(\{ behavior: 'smooth', block: 'nearest', inline: 'nearest' \}\)/u, '激活分类必须自动滚动到可见区域');
assert.match(officeSource, /aria-label="查看前面的员工分类"/u);
assert.match(officeSource, /aria-label="查看更多员工分类"/u);
assert.match(themeSource, /\.office-category-arrow:focus-visible/u, '分类滚动按钮必须有键盘焦点反馈');

console.log(JSON.stringify({
  passed: true,
  capabilityGraphVersion: 3,
  baseline,
  roster: initialIds,
  corrections: corrections.length,
  exportBrand: '太极助手',
  categoryNavigation: ['wheel', 'buttons', 'active-visible', 'keyboard-focus'],
}, null, 2));
