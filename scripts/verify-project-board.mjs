import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildProjectBoard, projectBoardSections } from '../src/engine/projectBoard.mjs';
import { createFallbackTaskDecision } from '../src/engine/taskDecisionKernel.mjs';

const root = {
  id: 'project-root', teamId: 'team-a', title: '做一个智能体工作室客户端 demo',
  goal: '做一个智能体工作室客户端 demo', status: 'running', createdAt: 10, updatedAt: 30,
  steps: [
    { id: 'design', title: 'UI/UX 设计', assignment: '完成交互方案与页面信息架构', employeeId: 'ux', status: 'completed', startedAt: 10, completedAt: 20, evidence: [{ verified: true }], output: { summary: '已提交交互方案。' } },
    { id: 'build', title: 'HTML 实现', assignment: '实现客户端 HTML 页面', employeeId: 'web', status: 'running', startedAt: 25, evidence: [{ verified: true }, { verified: false }], events: [{ ts: 30, detail: '正在实现主界面。' }] },
    { id: 'review', title: '最终验收', assignment: '检查真实产出', employeeId: 'check', kind: 'review', status: 'queued', dependsOnStepIds: ['build'] },
  ],
};
const child = {
  id: 'project-child', parentTaskId: 'project-root', teamId: 'team-a', title: '数据接入子任务',
  goal: '接入数据中心', status: 'failed', createdAt: 20, updatedAt: 40, lastError: '缺少数据中心访问令牌',
  steps: [{ id: 'integration', title: '数据接入', assignment: '核对数据接口和连接条件', employeeId: 'data', status: 'failed' }],
};

const projects = buildProjectBoard([root, child]);
assert.equal(projects.length, 1, '同一根任务的子任务不能显示成第二个项目');
assert.equal(projects[0].title, '做一个智能体工作室客户端 demo');
assert.equal(projects[0].total, 4);
assert.equal(projects[0].completed, 1);
assert.equal(projects[0].currentStage.id, 'build');
assert.equal(projects[0].actionRun.id, 'project-child');
assert.equal(projects[0].latestResult, '缺少数据中心访问令牌');
assert.equal(projects[0].stages.find((stage) => stage.id === 'integration').entries.length, 1);
assert.equal(projects[0].currentStage.verifiedEvidence, 1);
assert.equal(projects[0].currentStage.evidenceTotal, 2);
assert.equal(projects[0].currentStage.nextAction, '正在实现主界面。');
assert.match(projects[0].stages.find((stage) => stage.id === 'review').waitingCondition, /HTML 实现/u);
assert.ok(projects[0].elapsedMs > 0);
assert.equal(projectBoardSections(projects).current.length, 1);

const projectRecord = {
  id: 'project-meta', title: '智能体工作室客户端 Demo', request: '完成智能体工作室客户端 Demo 并验证数据中心接入条件', status: 'running',
};
const named = buildProjectBoard([{ ...root, projectId: projectRecord.id }, child], [projectRecord]);
assert.equal(named[0].title, projectRecord.title, '项目看板必须优先显示稳定项目标题，而不是聊天原文');
assert.equal(named[0].goal, projectRecord.request);
const archived = buildProjectBoard([{ ...root, projectId: projectRecord.id }, child], [{ ...projectRecord, status: 'archived' }]);
assert.equal(archived[0].status, 'archived');
assert.equal(projectBoardSections(archived).stopped.length, 1, '已归档项目不应继续出现在当前项目列表');

const feasibility = createFallbackTaskDecision({
  latestMessage: '这个页面能否接入我们的数据中心？请给出可行性判断和需要补齐的条件。',
  availableTools: ['inspect_connectors'],
});
assert.notEqual(feasibility.deliverableType, 'connection', '连接可行性判断不能被硬判为真实连接交付');

const [storeSource, teamMessageCommands, teamRunFinalization] = await Promise.all([
  fs.readFile(new URL('../src/store.tsx', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/store/teamMessageCommands.ts', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/store/teamRunFinalization.ts', import.meta.url), 'utf8'),
]);
assert.doesNotMatch(storeSource, /assistant-supervisor|relayAssistantMentions|监工禁止/u, '临时调度身份或自动抢答链路不应残留');
assert.match(teamMessageCommands, /任务简报/u, '团队执行必须先由章北海发一条简洁任务简报');
assert.match(teamRunFinalization, /deliverableType === 'file'/u, '团队执行必须按任务交付类型验收');
assert.doesNotMatch(teamRunFinalization, /label: '真实产出'/u, '方案和回答任务不能再被无条件要求文件交付');

console.log(JSON.stringify({ passed: true, projects: projects.length, stages: projects[0].stages.map((stage) => stage.id), feasibility: feasibility.deliverableType, archived: archived[0].section }));
