import assert from 'node:assert/strict';
import {
  applySteering,
  classifyExecutionError,
  compactRuntimeEvidence,
  createTurnRuntime,
  decideRecovery,
  finalizeTurn,
  inferDeliverableType,
  normalizeToolCall,
  observeModelDecision,
  observeToolResult,
  requiresFileEvidence,
} from '../src/engine/turnRuntime.mjs';
import { aggregateAdvisorGuidance, buildAdvisorMessages, shouldConsultAdvisors } from '../src/engine/moaRuntime.mjs';
import { presentModelFailure } from '../src/engine/modelFailurePresentation.mjs';

const exactQuery = '上海 2026年7月29日 天气 最高温 最低温 降雨';
const normalized = normalizeToolCall('web_search', JSON.stringify({ query: exactQuery, limit: 5 }));
assert.equal(normalized.ok, true);
assert.equal(normalized.args.query, exactQuery, '运行时不得把模型查询词替换成整段任务');
assert.equal(normalizeToolCall('web_search', {}).ok, false, '缺少精确查询词时必须回到模型修复参数');

let runtime = createTurnRuntime({ goal: '查询今天上海天气并告诉我是否需要带伞' });
assert.equal(runtime.deliverableType, 'answer');
assert.equal(inferDeliverableType({ deliverableType: 'connection' }), 'connection');
assert.equal(requiresFileEvidence({ deliverableType: 'answer' }), false);
assert.equal(requiresFileEvidence({ deliverableType: 'file' }), true);

let observed = observeModelDecision(runtime, {
  toolCalls: [{ name: 'web_search', arguments: JSON.stringify({ query: exactQuery }) }],
  reason: '先取得当天气象数据',
});
runtime = observed.runtime;
assert.equal(observed.decision.toolCalls[0].args.query, exactQuery);

let toolResult = observeToolResult(runtime, {
  toolCallId: 'weather-1',
  name: 'web_search',
  args: { query: exactQuery },
  success: true,
  useful: false,
  output: '上海是一座国际化城市，拥有丰富的旅游资源。',
});
runtime = toolResult.runtime;
assert.equal(runtime.unresolvedIssues.length, 1, '偏题结果不能被记为已解决');

const correctedQuery = '上海市气象局 2026-07-29 实况 预报 降水概率';
observed = observeModelDecision(runtime, {
  toolCalls: [{ name: 'web_search', arguments: { query: correctedQuery } }],
  reason: '前一结果偏题，改查权威气象来源',
});
runtime = observed.runtime;
assert.equal(observed.decision.toolCalls[0].args.query, correctedQuery);
assert.notEqual(observed.decision.toolCalls[0].fingerprint, normalized.fingerprint, '换路线必须形成不同调用');

toolResult = observeToolResult(runtime, {
  toolCallId: 'weather-2',
  name: 'web_search',
  args: { query: correctedQuery },
  success: true,
  useful: true,
  output: '上海今日最高温33摄氏度，午后有阵雨，降水概率70%。',
  resultRef: 'https://example.test/weather/shanghai',
});
runtime = toolResult.runtime;
assert.equal(toolResult.evidence.resultRef, 'https://example.test/weather/shanghai');

runtime = applySteering(runtime, '顺便告诉我下午两点是否适合出门');
assert.deepEqual(runtime.pendingSteering, ['顺便告诉我下午两点是否适合出门']);
assert.equal(runtime.phase, 'observe', '插话必须先回到观察阶段');

const compacted = compactRuntimeEvidence(runtime, { keepRecent: 8 });
assert.equal(compacted.evidence.at(-1).arguments.query, correctedQuery);
assert.equal(compacted.evidence.at(-1).resultRef, 'https://example.test/weather/shanghai');
assert.deepEqual(compacted.pendingSteering, runtime.pendingSteering);

const authError = classifyExecutionError({ status: 401, message: 'API key expired' });
assert.equal(authError.type, 'authentication');
const authRecovery = decideRecovery(runtime, authError);
assert.equal(authRecovery.decision.action, 'waiting_user');
assert.equal(authRecovery.runtime.phase, 'waiting_user');

let verificationRuntime = createTurnRuntime({ goal: 'build and verify a frontend' });
let verificationResult = observeToolResult(verificationRuntime, {
  name: 'run_command',
  args: { cmd: 'npm test', verification: true },
  success: false,
  output: 'exit code 1',
  errorType: 'verification_failed',
});
assert.equal(verificationResult.error.type, 'verification_failed');
let verificationRecovery = decideRecovery(verificationResult.runtime, verificationResult.error, { routeAttempts: 1 });
assert.equal(verificationRecovery.decision.action, 'switch_route', 'a new failed verification route must return to the model');
verificationResult = observeToolResult(verificationRecovery.runtime, {
  name: 'run_command',
  args: { cmd: 'npm run lint', verification: true },
  success: false,
  output: 'exit code 1',
  errorType: 'verification_failed',
});
verificationRecovery = decideRecovery(verificationResult.runtime, verificationResult.error, { routeAttempts: 1 });
assert.equal(verificationRecovery.decision.action, 'switch_route', 'a different verification route must not inherit the prior route limit');

let repeatedRoute = verificationRecovery.runtime;
for (let routeAttempt = 2; routeAttempt <= 3; routeAttempt += 1) {
  const observedFailure = observeToolResult(repeatedRoute, {
    name: 'run_command',
    args: { cmd: 'npm run lint', verification: true },
    success: false,
    output: 'exit code 1',
    errorType: 'verification_failed',
  });
  const decision = decideRecovery(observedFailure.runtime, observedFailure.error, { routeAttempts: routeAttempt });
  repeatedRoute = decision.runtime;
  if (routeAttempt === 3) assert.equal(decision.decision.action, 'checkpoint', 'only the repeatedly identical failed route should checkpoint');
}

const serverError = classifyExecutionError('模型响应 503: {"error":{"message":"Service temporarily unavailable"}}');
assert.equal(serverError.type, 'server', '文本形式的 HTTP 503 也必须归类为上游服务异常');
assert.equal(serverError.retryable, true);
assert.match(presentModelFailure(serverError.type), /稍后点击“继续执行”重试/);

let overflowRuntime = createTurnRuntime({ goal: '长任务' });
let recovery = decideRecovery(overflowRuntime, new Error('context length exceeded'));
assert.equal(recovery.decision.action, 'compact');
recovery = decideRecovery(recovery.runtime, new Error('context length exceeded'));
assert.equal(recovery.decision.action, 'checkpoint');
const checkpoint = finalizeTurn(recovery.runtime, { status: 'checkpointed', summary: '已保存证据，等待从恢复点继续' });
assert.equal(checkpoint.finalization.status, 'checkpointed');
assert.equal(checkpoint.finalization.recoveryAttempts.context_overflow, 2);

const advisorMessages = buildAdvisorMessages({ goal: '升级前端', evidence: runtime.evidence });
assert.equal(advisorMessages.some((message) => Object.hasOwn(message, 'tools')), false);
assert.match(advisorMessages[0].content, /不能调用工具/);
assert.equal(shouldConsultAdvisors({ memberCount: 3, requiredCapabilities: ['ui_ux', 'frontend'] }), true);
const advice = aggregateAdvisorGuidance([{ label: '审查员', content: '先核对用户目标，再检查真实构建结果。' }]);
assert.equal(advice.used, 1);
assert.match(advice.guidance, /顾问没有调用工具，也没有完成任务/);

const completed = finalizeTurn(runtime, { completed: true, summary: '已根据权威来源回答天气问题' });
assert.equal(completed.finalization.status, 'completed');
assert.ok(completed.finalization.verifiedEvidenceIds.length >= 1);

console.log(JSON.stringify({
  passed: true,
  runtimeVersion: runtime.runtimeVersion,
  exactQueryPreserved: true,
  detourRecovered: true,
  steeringObserved: true,
  advisorToolAccess: false,
}, null, 2));
