import assert from 'node:assert/strict';
import {
  applyExecutionSteering,
  blockExecution,
  canExecuteRoute,
  createExecutionController,
  evaluateExecutionConclusion,
  executionControllerGuidance,
  markExecutionBudgetReached,
  observeExecutionResult,
  restoreExecutionController,
} from '../src/engine/executionController.mjs';

let transient = createExecutionController({ goal: '下载并验证资料' });
transient = observeExecutionResult(transient, { toolName: 'web_search', routeKey: 'web_search:source-a', success: false, result: '连接超时' });
assert.equal(transient.decision.kind, 'retry');
assert.equal(canExecuteRoute(transient, { toolName: 'web_search', routeKey: 'web_search:source-a' }).allowed, true);
transient = observeExecutionResult(transient, { toolName: 'web_search', routeKey: 'web_search:source-a', success: false, result: '连接超时' });
assert.equal(transient.decision.kind, 'switch_route');
assert.equal(canExecuteRoute(transient, { toolName: 'web_search', routeKey: 'web_search:source-a' }).allowed, false);
transient = observeExecutionResult(transient, { toolName: 'web_search', routeKey: 'web_search:source-b', success: true, result: '找到 5 条结果', contributesEvidence: true });
assert.equal(transient.activeFailureId, undefined);
assert.equal(transient.progressCount, 1);
assert.equal(transient.failures.every((failure) => failure.resolved), true);

let deterministic = createExecutionController({ goal: '调用接口' });
deterministic = observeExecutionResult(deterministic, { toolName: 'run_command', routeKey: 'bad-json', success: false, result: 'JSON 参数格式错误' });
assert.equal(deterministic.decision.kind, 'switch_route');
assert.equal(deterministic.failures.at(-1).classification, 'invalid_input');

let auth = createExecutionController({ goal: '连接知识库' });
auth = observeExecutionResult(auth, { toolName: 'test_connector', routeKey: 'ima', success: false, result: 'HTTP 401 API Key 无效' });
assert.equal(auth.decision.kind, 'await_user');
assert.equal(auth.status, 'awaiting_user');
assert.match(executionControllerGuidance(auth), /只询问无法由客户端自行取得/u);
const restoredAuth = restoreExecutionController(auth, { goal: auth.goal });
assert.equal(restoredAuth.decision.kind, 'await_user');
assert.equal(restoredAuth.status, 'awaiting_user');

let evidence = createExecutionController({ goal: '生成文件' });
evidence = evaluateExecutionConclusion(evidence, { content: '已经完成', reviewed: false });
assert.equal(evidence.decision.kind, 'act');
evidence = observeExecutionResult(evidence, { toolName: 'write_file', routeKey: 'write:a.md', success: true, result: 'saved', contributesEvidence: true });
evidence = evaluateExecutionConclusion(evidence, { content: '已经完成', reviewed: false });
assert.equal(evidence.decision.kind, 'verify');
evidence = evaluateExecutionConclusion(evidence, { content: '已重新读取并确认', reviewed: true });
assert.equal(evidence.decision.kind, 'complete');
assert.equal(evidence.status, 'completed');

let offTarget = createExecutionController({ goal: '查询今天全椒县天气', acceptanceCriteria: ['必须包含全椒县当天气象数据'] });
offTarget = observeExecutionResult(offTarget, { toolName: 'web_search', routeKey: 'generic-anhui', success: true, result: '安徽省百科', contributesEvidence: true });
offTarget = evaluateExecutionConclusion(offTarget, { content: '安徽省简介', reviewed: false, acceptancePassed: false, acceptanceIssues: ['没有全椒县天气数据'] });
assert.equal(offTarget.decision.kind, 'verify');
offTarget = evaluateExecutionConclusion(offTarget, { content: '安徽省简介', reviewed: true, acceptancePassed: false, acceptanceIssues: ['没有全椒县天气数据'] });
assert.equal(offTarget.decision.kind, 'switch_route');
assert.equal(offTarget.status, 'running');
assert.deepEqual(offTarget.acceptanceIssues, ['没有全椒县天气数据']);

const restored = restoreExecutionController(transient, { goal: transient.goal });
assert.equal(restored.status, 'running');
assert.equal(restored.progressCount, 1);
const steered = applyExecutionSteering(restored, '改为输出中文报告');
assert.equal(steered.latestInstruction, '改为输出中文报告');
assert.equal(steered.decision.kind, 'act');
const stopped = markExecutionBudgetReached(steered);
assert.equal(stopped.decision.kind, 'stop');

let modelRetry = createExecutionController({ goal: '等待模型完成长上下文任务' });
for (let attempt = 0; attempt < 4; attempt += 1) {
  modelRetry = observeExecutionResult(modelRetry, { toolName: 'model_request', routeKey: 'primary-model', success: false, result: '模型响应超时', retryLimit: 4 });
  assert.equal(modelRetry.decision.kind, 'retry');
}
modelRetry = observeExecutionResult(modelRetry, { toolName: 'model_request', routeKey: 'primary-model', success: false, result: '模型响应超时', retryLimit: 4 });
assert.equal(modelRetry.decision.kind, 'switch_route');
modelRetry = blockExecution(modelRetry, '没有可用的替代模型路线', 'timeout');
assert.equal(modelRetry.status, 'blocked');
assert.equal(modelRetry.decision.kind, 'stop');

console.log(JSON.stringify({
  passed: true,
  transientRouteChanges: transient.routeChanges,
  deterministicFailure: deterministic.failures.at(-1).classification,
  userBoundary: auth.failures.at(-1).classification,
  finalDecision: evidence.decision.kind,
  modelAttemptsBeforeRouteChange: modelRetry.routeHistory[0].attempts,
}, null, 2));
