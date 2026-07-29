import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createLifecycleRecoveryCapsule,
  createTurnLifecycle,
  finalizeTurnLifecycle,
  recordLifecycleContext,
  recordLifecycleDecision,
  recordLifecycleSteering,
  recordLifecycleToolFinished,
  recordLifecycleToolStarted,
  restoreTurnLifecycle,
  synchronizeTurnLifecycle,
} from '../src/engine/turnLifecycle.mjs';
import { createTurnRuntime, finalizeTurn, observeModelDecision, observeToolResult } from '../src/engine/turnRuntime.mjs';

let lifecycle = createTurnLifecycle({
  taskId: 'task-lifecycle-1',
  conversationId: 'conversation-a',
  scope: 'assistant',
  goal: '查询天气并保存一份通俗说明',
  deliverableType: 'file',
  contextWindowTokens: 128000,
  maxModelRounds: 36,
  maxToolCalls: 48,
});
const initialSequence = lifecycle.sequence;
assert.equal(lifecycle.status, 'running');
assert.equal(lifecycle.goal, '查询天气并保存一份通俗说明');

lifecycle = recordLifecycleDecision(lifecycle, {
  decisionId: 'decision-1',
  round: 1,
  action: 'act',
  reason: '先取得实时天气证据',
  toolCalls: [{ name: 'web_search', args: { query: '上海今日天气', apiKey: 'must-not-persist' }, fingerprint: 'weather-1', valid: true }],
});
lifecycle = recordLifecycleToolStarted(lifecycle, {
  callId: 'call-weather',
  name: 'web_search',
  args: { query: '上海今日天气', authorization: 'Bearer secret' },
});
lifecycle = recordLifecycleToolFinished(lifecycle, {
  callId: 'call-weather',
  name: 'web_search',
  success: true,
  output: '最高温 33 度，午后阵雨。',
  resultRef: 'https://weather.example.test/shanghai?token=secret',
  evidenceIds: ['evidence-weather'],
});
assert.equal(lifecycle.toolCalls.length, 1, '工具开始和结果必须按 callId 配成一条记录');
assert.equal(lifecycle.toolCalls[0].status, 'succeeded');
assert.equal(lifecycle.toolCalls[0].args.authorization, '[REDACTED]');
assert.match(lifecycle.toolCalls[0].resultRef, /token=%5BREDACTED%5D/);
assert.equal(lifecycle.decisions[0].toolCalls[0].args.apiKey, '[REDACTED]');

lifecycle = recordLifecycleSteering(lifecycle, '下午两点是否适合出门也一起回答');
lifecycle = recordLifecycleContext(lifecycle, {
  compacted: true,
  stage: 2,
  estimatedTokens: 92000,
  contextWindowTokens: 128000,
  summary: '保留原始目标、天气证据、文件交付要求和最新插话。',
  unresolvedIssues: ['还没有写入说明文件'],
});
assert.equal(lifecycle.context.compactions, 1);
assert.equal(lifecycle.context.contextWindowTokens, 128000, '上下文用量字段不是凭据，必须保留');
assert.equal(lifecycle.steering.at(-1).message, '下午两点是否适合出门也一起回答');

const waiting = finalizeTurnLifecycle(lifecycle, {
  status: 'waiting_user',
  summary: '查询已完成，但目标目录需要用户授权。',
  waitingFor: '授权目标目录写入',
  reason: 'missing_user_input',
});
assert.equal(waiting.status, 'waiting_user');
assert.equal(waiting.recovery.resumable, true);
assert.equal(waiting.exit.waitingFor, '授权目标目录写入');
const restored = restoreTurnLifecycle(JSON.parse(JSON.stringify(waiting)));
assert.equal(restored.sequence, waiting.sequence);
assert.equal(restored.goal, waiting.goal);
assert.equal(restored.toolCalls[0].callId, 'call-weather');
const capsule = createLifecycleRecoveryCapsule(restored);
assert.equal(capsule.goal, restored.goal);
assert.equal(capsule.completedToolCalls.length, 1);
assert.equal(capsule.steering.length, 1);

let runtime = createTurnRuntime({ taskId: 'task-lifecycle-2', goal: '安装并验证技能', contract: { deliverableType: 'operation' } });
runtime = observeModelDecision(runtime, {
  toolCalls: [{ name: 'install_skill', arguments: { slug: 'frontend-design' } }],
}).runtime;
runtime = observeToolResult(runtime, {
  toolCallId: 'skill-install-1',
  name: 'install_skill',
  args: { slug: 'frontend-design' },
  success: true,
  useful: true,
  output: '安装后回读和健康检查通过',
}).runtime;
const finalizedRuntime = finalizeTurn(runtime, { status: 'completed', content: '技能已安装并验证' });
const synchronized = synchronizeTurnLifecycle(undefined, finalizedRuntime.runtime, finalizedRuntime.finalization, { conversationId: 'conversation-b' });
assert.equal(synchronized.status, 'completed');
assert.equal(synchronized.toolCalls[0].callId, 'skill-install-1');
assert.equal(synchronized.conversationId, 'conversation-b');
assert(synchronized.sequence > initialSequence);

let interruptedLifecycle = recordLifecycleToolStarted(createTurnLifecycle({ goal: '恢复未闭合工具调用' }), {
  callId: 'interrupted-call',
  name: 'read_file',
  args: { path: 'handoff.md' },
});
let recoveredRuntime = createTurnRuntime({ goal: '恢复未闭合工具调用' });
recoveredRuntime = observeToolResult(recoveredRuntime, {
  toolCallId: 'interrupted-call',
  name: 'read_file',
  args: { path: 'handoff.md' },
  success: true,
  useful: true,
  output: '已读取交接文件',
}).runtime;
interruptedLifecycle = synchronizeTurnLifecycle(interruptedLifecycle, recoveredRuntime);
assert.equal(interruptedLifecycle.toolCalls.length, 1, '恢复时不得复制相同 callId 的工具调用');
assert.equal(interruptedLifecycle.toolCalls[0].status, 'succeeded', '恢复时必须用真实证据闭合进行中的工具调用');

const [client, bridge, assistant, dm, adapter, service, preload, main] = await Promise.all([
  readFile('src/data/hermesClient.ts', 'utf8'),
  readFile('src/engine/taskServiceBridge.ts', 'utf8'),
  readFile('src/components/chat/AssistantChat.tsx', 'utf8'),
  readFile('src/components/chat/DmChatApp.tsx', 'utf8'),
  readFile('electron/nativeExecutionAdapter.cjs', 'utf8'),
  readFile('electron/taskService.cjs', 'utf8'),
  readFile('electron/preload.cjs', 'utf8'),
  readFile('electron/main.cjs', 'utf8'),
]);
assert.match(client, /onTurnLifecycle\?:/);
assert.match(client, /recordLifecycleToolStarted/);
assert.match(client, /recordLifecycleToolFinished/);
assert.match(client, /recordLifecycleContext/);
assert.match(client, /recordLifecycleSteering/);
assert.match(bridge, /taskServiceLifecycle/);
assert.match(bridge, /finalStatus === 'waiting_user'/);
assert.match(bridge, /finalStatus === 'paused' \|\| finalStatus === 'checkpointed'/);
assert.match(assistant, /onTurnLifecycle\(state\)/);
assert.match(dm, /onTurnLifecycle\(state\)/);
assert.match(adapter, /turnLifecycle\.synchronizeTurnLifecycle/);
assert.match(adapter, /persistControlledLifecycle/);
assert.match(service, /async function recordLifecycle/);
assert.match(preload, /taskServiceLifecycle/);
assert.match(main, /task-service:lifecycle/);

console.log(JSON.stringify({
  passed: true,
  protocolVersion: lifecycle.protocolVersion,
  pairedToolCalls: lifecycle.toolCalls.length,
  finalStatus: waiting.status,
  secretsPersisted: JSON.stringify(lifecycle).includes('must-not-persist') || JSON.stringify(lifecycle).includes('Bearer secret'),
  entriesAligned: ['assistant', 'dm', 'team'],
}, null, 2));
