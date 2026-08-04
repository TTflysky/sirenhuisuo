import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createLifecycleRecoveryCapsule,
  createTurnLifecycle,
  recordLifecycleContext,
  recordLifecycleSteering,
} from '../src/engine/turnLifecycle.mjs';

const require = createRequire(import.meta.url);
const { createTaskRuntimeStore } = require('../electron/taskRuntimeStore.cjs');
const { createTaskService } = require('../electron/taskService.cjs');
const { createTaskWorker } = require('../electron/taskWorker.cjs');

const minutesArg = process.argv.find((value) => value.startsWith('--minutes='));
const requestedMinutes = Math.max(0.01, Number(minutesArg?.split('=')[1]) || 0.02);
const durationMs = requestedMinutes * 60_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-v315-soak-'));
const workers = [];
try {
  const store = createTaskRuntimeStore(root);
  const service = createTaskService(store);
  const taskId = `v315-soak-${Date.now()}`;
  const goal = '持续整理可恢复的项目检查清单，并在客户端重启后保留目标、证据、上下文摘要和用户插话。';
  const created = await service.create({
    id: taskId, taskType: 'team', teamId: 'v315-soak-team', conversationId: 'v315-soak-conversation', goal,
    acceptanceCriteria: ['检查点连续', '跨客户端会话自动恢复', '上下文压缩与用户插话完整保留'],
    steps: [
      { id: 'sustain', title: '持续整理检查清单', employeeId: 'operator', assignment: '持续记录并保存阶段进展。' },
      { id: 'finalize', title: '核对并完成', employeeId: 'reviewer', assignment: '根据恢复后的上下文完成最终核对。', dependsOnStepIds: ['sustain'] },
    ],
  });
  assert.equal(created.ok, true);

  const workerA = createTaskWorker({ rootDir: root, store, sessionId: 'v315-client-a', leaseMs: 60_000, sweepMs: 60_000 });
  workers.push(workerA);
  await workerA.start();
  const claimA = await workerA.dispatch({ commandId: 'claim-a', taskId, type: 'claim', payload: { adapter: 'main-native-execution-adapter', activity: '长任务开始' } });
  assert.equal(claimA.ok, true, claimA.error);
  const leaseA = claimA.run.worker.leaseId;

  let lifecycle = createTurnLifecycle({ taskId, conversationId: 'v315-soak-conversation', goal, deliverableType: 'answer' });
  lifecycle = recordLifecycleContext(lifecycle, {
    compacted: true, stage: 2, estimatedTokens: 42000, contextWindowTokens: 128000,
    summary: '目标保持为整理可恢复检查清单；尚未完成最终核对。', unresolvedIssues: ['仍需验证跨客户端恢复'],
  });
  lifecycle = recordLifecycleSteering(lifecycle, '用户插话：不要重建任务，必须从现有检查点继续。');
  await service.recordLifecycle(taskId, { lifecycle, recovery: createLifecycleRecoveryCapsule(lifecycle, { reason: '首次长任务胶囊', nextAction: '继续 sustain' }) });

  const cp1 = await workerA.dispatch({
    commandId: 'cp-1', taskId, type: 'checkpoint',
    payload: { leaseId: leaseA, checkpoint: { checkpointId: 'cp-1', sequence: 1, kind: 'step_started', stepId: 'sustain', summary: '开始持续整理' } },
  });
  assert.equal(cp1.ok, true, cp1.error);
  const startedAt = Date.now();
  let heartbeatCount = 0;
  while (Date.now() - startedAt < durationMs) {
    const heartbeat = await workerA.dispatch({
      commandId: `heartbeat-${heartbeatCount + 1}`, taskId, type: 'heartbeat',
      payload: { leaseId: leaseA, progressAt: Date.now(), activity: `持续整理进度 ${heartbeatCount + 1}` },
    });
    assert.equal(heartbeat.ok, true, heartbeat.error);
    heartbeatCount += 1;
    await sleep(Math.min(250, Math.max(0, durationMs - (Date.now() - startedAt))));
  }

  lifecycle = recordLifecycleContext(lifecycle, {
    compacted: true, stage: 3, estimatedTokens: 21000, contextWindowTokens: 128000,
    summary: '原目标未变化；持续整理已完成，下一步是恢复后执行最终核对。', unresolvedIssues: ['客户端会话更换后完成 finalize'],
  });
  lifecycle = recordLifecycleSteering(lifecycle, '用户插话：最终报告要说明恢复前后的检查点序号。');
  await service.recordLifecycle(taskId, { lifecycle, recovery: createLifecycleRecoveryCapsule(lifecycle, { reason: '重启前恢复胶囊', nextAction: '从 finalize 继续' }) });
  const cp2 = await workerA.dispatch({
    commandId: 'cp-2', taskId, type: 'checkpoint',
    payload: { leaseId: leaseA, checkpoint: { checkpointId: 'cp-2', sequence: 2, kind: 'step_completed', stepId: 'sustain', summary: '持续整理完成' } },
  });
  assert.equal(cp2.ok, true, cp2.error);
  const cp3 = await workerA.dispatch({
    commandId: 'cp-3', taskId, type: 'checkpoint',
    payload: { leaseId: leaseA, checkpoint: { checkpointId: 'cp-3', sequence: 3, kind: 'step_started', stepId: 'finalize', summary: '开始最终核对' } },
  });
  assert.equal(cp3.ok, true, cp3.error);
  workerA.stop();

  const workerB = createTaskWorker({ rootDir: root, store, sessionId: 'v315-client-b', leaseMs: 60_000, sweepMs: 60_000 });
  workers.push(workerB);
  const restarted = await workerB.start();
  assert.deepEqual(restarted.recoveredTasks, [taskId]);
  const recovered = (await service.read({ taskId })).runs[0];
  assert.equal(recovered.status, 'queued');
  assert.equal(recovered.recoveryContext.autoResume, true);
  assert.equal(recovered.residencyCheckpoint.checkpointSequence, 3);
  assert.equal(recovered.steps.find((step) => step.id === 'sustain').status, 'completed');
  assert.equal(recovered.steps.find((step) => step.id === 'finalize').status, 'queued');
  assert.equal(recovered.turnLifecycle.context.compactions, 2);
  assert.ok(recovered.turnLifecycle.steering.some((item) => item.message.includes('检查点序号')));

  const claimB = await workerB.dispatch({ commandId: 'claim-b', taskId, type: 'claim', payload: { adapter: 'main-native-execution-adapter', activity: '从检查点恢复最终核对' } });
  assert.equal(claimB.ok, true, claimB.error);
  const leaseB = claimB.run.worker.leaseId;
  const cp4 = await workerB.dispatch({
    commandId: 'cp-4', taskId, type: 'checkpoint',
    payload: { leaseId: leaseB, checkpoint: { checkpointId: 'cp-4', sequence: 4, kind: 'step_completed', stepId: 'finalize', summary: '恢复后的最终核对完成' } },
  });
  assert.equal(cp4.ok, true, cp4.error);
  const cp5 = await workerB.dispatch({
    commandId: 'cp-5', taskId, type: 'checkpoint',
    payload: { leaseId: leaseB, checkpoint: { checkpointId: 'cp-5', sequence: 5, kind: 'run_finished', finalStatus: 'completed', summary: '长任务完成' } },
  });
  assert.equal(cp5.ok, true, cp5.error);

  const finalRun = (await service.read({ taskId })).runs[0];
  assert.equal(finalRun.status, 'completed');
  assert.equal(finalRun.worker.checkpointSequence, 5);
  assert.equal(finalRun.residencyCheckpoint.checkpointSequence, 5);
  assert.equal(finalRun.turnLifecycle.context.compactions, 2);
  assert.match(finalRun.turnLifecycle.context.summary, /原目标未变化/u);
  const journal = await workerB.readCommands({ taskId, limit: 200 });
  assert.equal(journal.integrity.ok, true);
  assert.ok(journal.records.some((record) => record.type === 'command_completed' && record.commandId === 'cp-5'));

  console.log(JSON.stringify({
    passed: true, requestedMinutes, heartbeatCount, recoveredAcrossSessions: true,
    taskId, finalStatus: finalRun.status, checkpointSequence: finalRun.worker.checkpointSequence,
    contextCompactions: finalRun.turnLifecycle.context.compactions,
    retainedSteering: finalRun.turnLifecycle.steering.map((item) => item.message),
    journalRecords: journal.records.length,
  }, null, 2));
} finally {
  workers.forEach((worker) => worker.stop());
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
}
