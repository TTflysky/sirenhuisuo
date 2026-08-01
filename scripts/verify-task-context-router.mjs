import assert from 'node:assert/strict';
import {
  TASK_CONTEXT_ROUTER_VERSION,
  assessContextBudget,
  buildRecoveryPrompt,
  classifyTaskInput,
  compactMessageWindow,
  createContextBudget,
  createRecoveryCapsule,
  findTaskContinuationTarget,
  isTaskContinuationApproval,
  recordContextUsage,
  routeTaskInput,
  verifyRecoveryCapsule,
} from '../src/engine/taskContextRouter.mjs';
import { createTaskContext } from '../src/engine/taskContext.mjs';

function run(overrides = {}) {
  return {
    id: 'task-router-test', teamId: 'team-a', title: '配置知识库', request: '配置 IMA 知识库并验证可用', goal: '配置 IMA 知识库并验证可用',
    status: 'running', phase: 'executing', workspaceId: 'tasks/router-test', createdAt: 100, updatedAt: 100,
    acceptanceCriteria: ['连接测试通过', '留下真实配置证据'], memberSnapshot: [], evidence: [],
    steps: [
      { id: 'inspect', title: '阅读说明', status: 'completed', attempts: 1, dependsOnStepIds: [], evidence: [{ verified: true, summary: '已读取连接器说明' }] },
      { id: 'configure', title: '写入并验证配置', status: 'running', attempts: 2, dependsOnStepIds: ['inspect'], evidence: [] },
    ],
    context: createTaskContext({ taskId: 'task-router-test', goal: '配置 IMA 知识库并验证可用', acceptanceCriteria: ['连接测试通过'] }),
    recoveryContext: { summary: '正在配置', completedEvidence: ['已读取说明'], unresolvedIssues: ['缺少一次真实调用'], steeringMessages: [], budget: createContextBudget({ contextWindowTokens: 16000 }) },
    ...overrides,
  };
}

assert.equal(TASK_CONTEXT_ROUTER_VERSION, 1);
assert.deepEqual(classifyTaskInput('暂停任务', run()).action, 'pause');
assert.deepEqual(classifyTaskInput('你理解错了，不是安装技能', run()).action, 'preempt_and_replan');
assert.deepEqual(classifyTaskInput('现在做到哪一步了？', run()).action, 'reply_then_continue');
assert.deepEqual(classifyTaskInput('另外帮我写一份总结', run()).action, 'queue_separately');
assert.equal(isTaskContinuationApproval('立即进入原型实现阶段', run({ status: 'awaiting_user', steps: [{ id: 'frontend', status: 'queued' }] })), true);
assert.equal(isTaskContinuationApproval('@章北海助理 继续', run({ status: 'awaiting_user', steps: [{ id: 'frontend', status: 'queued' }] })), true);
assert.equal(isTaskContinuationApproval('先不进入原型实现阶段', run({ status: 'awaiting_user', steps: [{ id: 'frontend', status: 'queued' }] })), false);
assert.equal(isTaskContinuationApproval('立即进入原型实现阶段', run({ status: 'running', steps: [{ id: 'frontend', status: 'queued' }] })), false);
const continuationRoot = run({ id: 'project-root', status: 'awaiting_user', updatedAt: 10, steps: [{ id: 'frontend', status: 'queued' }] });
const continuationChild = run({ id: 'ux-child', parentTaskId: 'project-root', status: 'paused', updatedAt: 20, steps: [{ id: 'ux', status: 'paused' }] });
assert.equal(findTaskContinuationTarget('立即进入原型实现阶段', [continuationRoot, continuationChild])?.id, 'project-root');
assert.equal(findTaskContinuationTarget('先不继续', [continuationRoot, continuationChild]), undefined);

const routed = routeTaskInput(run(), '不要重复读技能，直接按说明配置并测试。', { createdAt: 200 });
assert.equal(routed.route.shouldPreempt, true);
assert.equal(routed.run.recoveryContext.steeringMessages.length, 1);
assert.equal(routed.run.context.events.at(-1).source, 'user');
assert.equal(verifyRecoveryCapsule(routed.run.recoveryCapsule), true);

const capsule = createRecoveryCapsule(routed.run, { reason: '单元验证', createdAt: 300 });
assert.equal(verifyRecoveryCapsule(capsule), true);
capsule.immutableGoal = '被篡改';
assert.equal(verifyRecoveryCapsule(capsule), false);

let budget = createContextBudget({ contextWindowTokens: 16000, reserveTokens: 2000 });
budget = recordContextUsage(budget, { promptTokens: 8000, completionTokens: 800, estimatedTokens: 10500, modelRounds: 1 });
assert.equal(assessContextBudget(budget).action, 'compact');
budget = recordContextUsage(budget, { progress: false });
budget = recordContextUsage(budget, { progress: false });
budget = recordContextUsage(budget, { progress: false });
budget = recordContextUsage(budget, { progress: false });
budget = recordContextUsage(budget, { progress: false });
assert.equal(assessContextBudget(budget).action, 'replan');

const messages = [{ role: 'system', content: '不可变目标' }, ...Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'tool', content: `历史消息 ${index}` }))];
const compacted = compactMessageWindow(messages, { keepRecent: 8 });
assert.ok(compacted.removed > 0);
assert.equal(compacted.messages[0].content, '不可变目标');
assert.match(compacted.summary, /阶段压缩摘要/u);
assert.match(buildRecoveryPrompt(routed.run), /原始目标（不可改写）/u);
assert.match(buildRecoveryPrompt(routed.run), /写入并验证配置/u);

console.log(JSON.stringify({ passed: true, routerVersion: TASK_CONTEXT_ROUTER_VERSION, route: routed.route.action, budgetAction: assessContextBudget(budget).action, compacted: compacted.removed }));
