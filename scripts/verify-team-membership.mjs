import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const matcherUrl = new URL('../src/engine/taskMatcher.ts', import.meta.url).href;
const source = await fs.readFile('src/engine/teamMembership.ts', 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  fileName: 'src/engine/teamMembership.ts',
}).outputText.replace("from './taskMatcher';", `from '${matcherUrl}';`);
const membership = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`);
const employees = [
  { id: 'xiaowang', name: '小王', title: '设计师' },
  { id: 'xiaoli', name: '小李', title: '开发工程师' },
  { id: 'ux', name: '小美', title: 'UI UX前端设计师' },
];
const teams = [
  { id: 'old-team', name: '旧项目', memberIds: [], archived: false },
  { id: 'fruit-demo', name: '水果饮料网站demo', memberIds: [], archived: false },
];

assert.equal(membership.isTeamMemberAdditionRequest('把小王拉进团队'), true);
assert.equal(membership.isTeamMemberAdditionRequest('让小李加入进来一起做'), true);
assert.equal(membership.isTeamMemberAdditionRequest('请小王查询天气'), false);
assert.equal(membership.isTeamMemberAdditionRequest('网页还缺响应式布局'), false);
assert.equal(membership.isTeamMemberAdditionRequest('你队员拉得不对呀，只拉了一个，小王和小李都不在'), true);
assert.deepEqual(membership.resolveMentionedEmployees('把小王和@小李加进团队', employees).map((item) => item.id), ['xiaowang', 'xiaoli']);
assert.deepEqual(membership.resolveMentionedEmployees('把小张加进团队', employees), []);
assert.equal(membership.isTeamMemberAdditionRequest('不是有UI UX前端设计师吗，为什么不叫上'), true);
assert.equal(membership.isTeamMemberCorrectionRequest('成员拉得不对'), true);
assert.equal(membership.isTeamMemberReplacementRequest('换一个UI设计师，在员工里面再找一找'), true);
assert.equal(membership.isTeamMemberRemovalRequest('把小王从团队移除'), true);
assert.equal(membership.isProjectApprovalIntent('就这个团队，你拉群吧'), true);
assert.equal(membership.isProjectApprovalIntent('可以'), true);
assert.deepEqual(membership.resolveMentionedEmployees('不是有UI UX前端设计师吗，为什么不叫上', employees).map((item) => item.id), ['ux']);
assert.deepEqual(membership.resolveMentionedEmployees('换一个UI设计师', employees).map((item) => item.id), ['ux']);
assert.equal(membership.resolveTargetTeam('把小王加入水果饮料网站demo', teams)?.id, 'fruit-demo');
assert.equal(membership.resolveTargetTeam('你刚拉的队员不对', teams)?.id, 'fruit-demo');
assert.equal(membership.resolveTargetTeam('把小王加进去', teams, ['刚创建了水果饮料网站demo'])?.id, 'fruit-demo');
const projects = [
  { id: 'old', title: '旧项目', status: 'running', updatedAt: 1 },
  { id: 'pending', title: '操作系统前端改造', status: 'awaiting_approval', updatedAt: 2 },
];
assert.equal(membership.resolveTargetProject('为什么不叫UI设计师', projects)?.id, 'pending');

const scopedProjects = [
  { id: 'other-chat', title: '另一个项目', status: 'awaiting_approval', conversationId: 'chat-other', updatedAt: 9 },
  { id: 'knowledge-base', title: '太极知识库存储软件', status: 'awaiting_approval', conversationId: 'chat-knowledge', updatedAt: 8 },
];
assert.equal(membership.resolveTargetProject('就这个团队', scopedProjects, 'chat-knowledge')?.id, 'knowledge-base');

const rejectedProjects = [
  { id: 'rejected-old', title: '旧草案', status: 'archived', rejectionReason: '成员不全', conversationId: 'chat-knowledge', updatedAt: 4 },
  { id: 'rejected-latest', title: '安卓图片生成器', status: 'archived', rejectionReason: '重新选人', conversationId: 'chat-knowledge', updatedAt: 12 },
  { id: 'other-rejected', title: '其他会话', status: 'archived', rejectionReason: '不采用', conversationId: 'chat-other', updatedAt: 20 },
];
assert.equal(membership.resolveLatestRejectedProject(rejectedProjects, 'chat-knowledge')?.id, 'rejected-latest');

const rosterEmployees = [
  { id: 'planner', name: '规划者', title: '软件架构师', role: 'planner' },
  { id: 'old-ui', name: '旧设计师', title: 'UI 设计师', role: 'planner' },
  { id: 'new-ui', name: '新设计师', title: 'UI UX前端设计师', role: 'planner' },
  { id: 'frontend', name: '前端工程师', title: '网页开发工程师', role: 'coder' },
  { id: 'database', name: '数据库优化师', title: '数据库工程师', role: 'coder' },
];
const replacedRoster = membership.applyProjectRosterMutation(
  ['planner', 'old-ui', 'frontend', 'database'],
  [rosterEmployees.find((employee) => employee.id === 'new-ui')],
  rosterEmployees,
  'replace',
);
assert.deepEqual(replacedRoster, ['planner', 'frontend', 'database', 'new-ui'], 'replacement must preserve the agreed non-UI roster');
assert.equal(replacedRoster.includes('old-ui'), false, 'the old UI member must be removed structurally');

const officeCommandsSource = await fs.readFile('src/store/officeCommands.ts', 'utf8');
assert.match(officeCommandsSource, /project\?\.status === 'archived' && Boolean\(project\.rejectionReason\)/u, 'rejected drafts must be revisable');
assert.match(officeCommandsSource, /status: 'awaiting_approval',[\s\S]{0,120}rejectionReason: undefined/u, 'revising a rejected draft must restore approval state');
assert.match(officeCommandsSource, /project\?\.status === 'archived' && Boolean\(project\.rejectionReason\) && Boolean\(override\?\.memberIds\?\.length\)/u, 'an explicit revised roster approval must restore a rejected draft atomically');

console.log(JSON.stringify({ passed: true, recognizedEmployees: employees.length, continuity: 'scoped-project-roster-replacement', rejectedDraftRecovery: true }, null, 2));
