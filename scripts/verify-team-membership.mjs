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
assert.deepEqual(membership.resolveMentionedEmployees('不是有UI UX前端设计师吗，为什么不叫上', employees).map((item) => item.id), ['ux']);
assert.equal(membership.resolveTargetTeam('把小王加入水果饮料网站demo', teams)?.id, 'fruit-demo');
assert.equal(membership.resolveTargetTeam('你刚拉的队员不对', teams)?.id, 'fruit-demo');
assert.equal(membership.resolveTargetTeam('把小王加进去', teams, ['刚创建了水果饮料网站demo'])?.id, 'fruit-demo');
const projects = [
  { id: 'old', title: '旧项目', status: 'running', updatedAt: 1 },
  { id: 'pending', title: '操作系统前端改造', status: 'awaiting_approval', updatedAt: 2 },
];
assert.equal(membership.resolveTargetProject('为什么不叫UI设计师', projects)?.id, 'pending');

console.log(JSON.stringify({ passed: true, recognizedEmployees: employees.length }, null, 2));
