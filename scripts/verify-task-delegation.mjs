import assert from 'node:assert/strict';
import {
  TASK_DELEGATION_VERSION,
  appendDelegation,
  createDelegationRevision,
  delegationSummary,
  selectDelegate,
  transitionDelegation,
} from '../src/engine/taskDelegation.mjs';

function fixture() {
  return {
    id: 'task-parent', teamId: 'team-a', title: '构建应用', request: '构建应用', goal: '构建应用', status: 'running', phase: 'executing',
    createdAt: 1, updatedAt: 1,
    memberSnapshot: [
      { id: 'planner', name: '规划员', title: '架构', role: 'planner' },
      { id: 'coder', name: '开发员', title: '开发', role: 'coder' },
      { id: 'checker', name: '审查员', title: '质量', role: 'checker' },
    ],
    steps: [
      { id: 'plan', employeeId: 'planner', title: '设计方案', kind: 'work', assignment: '设计', order: 1, dependsOnStepIds: [], status: 'completed', attempts: 1, evidence: [], events: [] },
      { id: 'review', employeeId: 'checker', title: '审查', kind: 'review', assignment: '审查', order: 2, dependsOnStepIds: ['plan'], status: 'completed', attempts: 1, evidence: [], events: [] },
    ],
    evidence: [],
  };
}

assert.equal(TASK_DELEGATION_VERSION, 1);
assert.equal(selectDelegate(fixture().memberSnapshot, '实现代码并运行构建').id, 'coder');
assert.equal(selectDelegate(fixture().memberSnapshot, '检查测试结果').id, 'checker');

const appended = appendDelegation(fixture(), {
  parentStepId: 'plan', assignment: '实现代码并运行构建', title: '实现核心模块', acceptanceCriteria: ['构建通过'],
});
assert.equal(appended.delegation.employeeId, 'coder');
assert.equal(appended.step.delegationId, appended.delegation.id);
assert.deepEqual(appended.step.dependsOnStepIds, ['plan']);
assert.equal(appended.run.steps.length, 3);

const running = transitionDelegation(appended.run, appended.delegation.id, 'running');
assert.equal(running.run.steps.at(-1).status, 'running');
const completed = transitionDelegation(running.run, appended.delegation.id, 'completed', { output: { file: 'build.zip' }, evidence: [{ verified: true }] });
assert.equal(delegationSummary(completed.run).counts.completed, 1);
assert.equal(completed.delegation.output.file, 'build.zip');

const rejectedBase = structuredClone(appended.run);
rejectedBase.steps.at(-1).status = 'completed';
rejectedBase.delegations[0].status = 'completed';
const revision = createDelegationRevision(rejectedBase, appended.delegation.id, {
  reviewStepId: 'review', responsibleEmployeeId: 'coder', reason: '缺少错误处理',
});
assert.equal(revision.run.delegations.length, 2);
assert.equal(revision.delegation.revisionOfDelegationId, appended.delegation.id);
assert.match(revision.step.assignment, /只修改/u);
assert.equal(revision.run.steps.find((step) => step.id === 'plan').status, 'completed', '无关已完成步骤不应回退');
assert.throws(() => appendDelegation(fixture(), { assignment: '执行', employeeId: 'missing' }), /不在当前任务成员/u);

console.log(JSON.stringify({ passed: true, delegationVersion: TASK_DELEGATION_VERSION, delegate: appended.delegation.employeeName, revisions: revision.run.delegations.length }));
