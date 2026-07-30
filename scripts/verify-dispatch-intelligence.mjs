import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { requiresFreshWebResearch } from '../src/engine/agentGuardrails.mjs';

const matcher = await import('../src/engine/taskMatcher.ts');
const directory = await import('../src/engine/officeDirectory.ts');
const employees = [
  { id: 'iron', name: '铁柱', title: '行政助理', role: 'custom', stationIndex: 0, isOnline: true },
  { id: 'teacher', name: '小林', title: '幼师', role: 'custom', prompt: '儿童活动设计', stationIndex: 1, isOnline: true },
  { id: 'web', name: '森森', title: '网页开发工程师', role: 'coder', prompt: 'React HTML CSS 前端开发', stationIndex: 2, isOnline: true },
  { id: 'ux', name: '小美', title: 'UI UX前端设计师', role: 'planner', prompt: '交互设计 用户体验 原型设计', stationIndex: 3, isOnline: true },
  { id: 'review', name: '严谨', title: '质量验收', role: 'checker', stationIndex: 4, isOnline: true },
];
const request = '拉一个团队，改造操作系统前端界面';
assert.deepEqual(matcher.inferTaskCapabilities(request), ['ui_ux', 'frontend']);
const selected = matcher.matchProjectMembers(employees, request).map((member) => member.employeeId);
assert.equal(selected.includes('ux'), true, 'UI/UX specialist is mandatory');
assert.equal(selected.includes('web'), true, 'frontend implementation specialist is mandatory');
assert.equal(selected.includes('teacher'), false, 'generic design wording must not select kindergarten staff');
assert.equal(selected.includes('iron'), false, 'unrelated online order must not affect selection');
assert.equal(selected.includes('review'), true, 'deliverable work keeps validation coverage');

assert.equal(directory.classifyLocalOfficeQuery('你不知道自己办公室多少人吗？'), 'employee_count');
assert.equal(directory.classifyLocalOfficeQuery('办公室现在谁在线'), 'employee_online');
assert.equal(directory.classifyLocalOfficeQuery('把办公室员工拉进团队'), undefined);
const answer = directory.formatLocalOfficeAnswer('employee_count', employees, []);
assert.match(answer, /共有 5 名员工/);
assert.equal(requiresFreshWebResearch('你不知道自己办公室多少人吗？'), false);

const assistantSource = await fs.readFile('src/components/chat/AssistantChat.tsx', 'utf8');
assert.match(assistantSource, /compileTaskDecision\(decisionTurns/);
assert.match(assistantSource, /resolveTargetProject\(enriched, state\.projects, conversationIdRef\.current\)/);
assert.match(assistantSource, /isProjectApprovalIntent\(enriched\)/);
assert.ok(assistantSource.indexOf('classifyLocalOfficeQuery(content)') < assistantSource.indexOf('resolveSkillContextWithEvidence(refs)'), 'local office facts must bypass skill resolution');
assert.doesNotMatch(assistantSource, /recentUserContext[\s\S]{0,240}老板最新调度要求/);

console.log(JSON.stringify({ passed: true, selected, localQuery: 'employee_count', contract: 'semantic-decision-plus-deterministic-dispatch-v1' }, null, 2));
