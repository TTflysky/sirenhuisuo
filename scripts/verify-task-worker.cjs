const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTaskRuntimeStore } = require('../electron/taskRuntimeStore.cjs');
const { createTaskWorker, WORKER_PROTOCOL_VERSION, recordHash } = require('../electron/taskWorker.cjs');

function makeRun() {
  return {
    id: 'worker-task',
    teamId: 'team-worker',
    title: 'Worker 验证任务',
    request: '验证后台 Worker 控制面',
    status: 'queued',
    phase: 'preflight',
    createdAt: 100,
    updatedAt: 100,
    memberSnapshot: [],
    steps: [{
      id: 'step-1', employeeId: 'employee-1', title: '执行', order: 1, kind: 'work', assignment: '执行任务',
      dependsOnStepIds: [], status: 'queued', attempts: 0, events: [],
    }],
    recoveryContext: {
      summary: '等待执行', completedEvidence: [], unresolvedIssues: [], steeringMessages: [],
      budget: { toolAttempts: 0, updatedAt: 100 },
    },
  };
}

function assertJournalChain(records) {
  let previousHash = '';
  records.forEach((record, index) => {
    assert.equal(record.sequence, index + 1);
    assert.equal(record.previousHash, previousHash);
    assert.equal(record.hash, recordHash(record));
    previousHash = record.hash;
  });
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-task-worker-'));
  const activeWorkers = [];
  try {
    const store = createTaskRuntimeStore(root);
    await store.write([makeRun()], { source: 'test' });
    const workerA = createTaskWorker({ rootDir: root, store, sessionId: 'session-a', leaseMs: 60_000, sweepMs: 60_000 });
    activeWorkers.push(workerA);
    assert.equal((await workerA.start()).ok, true);

    const unsupportedAdapter = await workerA.dispatch({ commandId: 'claim-unsupported', taskId: 'worker-task', type: 'claim', payload: { adapterProtocolVersion: 99 } });
    assert.equal(unsupportedAdapter.ok, false);

    const claim = await workerA.dispatch({ commandId: 'claim-1', taskId: 'worker-task', type: 'claim', payload: { adapter: 'test-adapter' } });
    assert.equal(claim.ok, true, claim.error);
    assert.equal(claim.run.status, 'running');
    assert.equal(claim.run.worker.state, 'running');
    assert.equal(claim.run.worker.ownerSessionId, 'session-a');
    const leaseId = claim.run.worker.leaseId;

    const startedStep = await workerA.dispatch({
      commandId: 'checkpoint-1', taskId: 'worker-task', type: 'checkpoint',
      payload: { leaseId, checkpoint: { checkpointId: 'cp-1', sequence: 1, kind: 'step_started', stepId: 'step-1', summary: '开始执行' } },
    });
    assert.equal(startedStep.ok, true, startedStep.error);
    assert.equal(startedStep.run.steps[0].status, 'running');
    assert.equal(startedStep.run.worker.checkpointSequence, 1);
    assert.equal(startedStep.run.residencyCheckpoint.nextExecutableStepId, 'step-1');
    assert.equal(startedStep.run.residencyCheckpoint.checkpointSequence, 1, JSON.stringify(startedStep.run.residencyCheckpoint));

    const skippedSequence = await workerA.dispatch({
      commandId: 'checkpoint-skipped', taskId: 'worker-task', type: 'checkpoint',
      payload: { leaseId, checkpoint: { checkpointId: 'cp-skipped', sequence: 3, kind: 'step_completed', stepId: 'step-1' } },
    });
    assert.equal(skippedSequence.ok, false);

    const duplicateSequence = await workerA.dispatch({
      commandId: 'checkpoint-invalid', taskId: 'worker-task', type: 'checkpoint',
      payload: { leaseId, checkpoint: { checkpointId: 'cp-invalid', sequence: 1, kind: 'step_completed', stepId: 'step-1' } },
    });
    assert.equal(duplicateSequence.ok, false);

    const completedStep = await workerA.dispatch({
      commandId: 'checkpoint-2', taskId: 'worker-task', type: 'checkpoint',
      payload: { leaseId, checkpoint: { checkpointId: 'cp-2', sequence: 2, kind: 'step_completed', stepId: 'step-1', summary: '执行完成' } },
    });
    assert.equal(completedStep.ok, true, completedStep.error);
    assert.equal(completedStep.run.steps[0].status, 'completed');

    const staleRendererRun = makeRun();
    staleRendererRun.status = 'running';
    staleRendererRun.worker = startedStep.run.worker;
    const staleWrite = await store.write([staleRendererRun], { source: 'renderer', sessionId: 'stale-renderer' });
    assert.equal(staleWrite.ok, true);
    const protectedProjection = (await store.read()).runs[0];
    assert.equal(protectedProjection.worker.checkpointSequence, 2);
    assert.equal(protectedProjection.worker.lastCheckpoint.checkpointId, 'cp-2');
    assert.equal(protectedProjection.steps[0].status, 'completed');

    const duplicate = await workerA.dispatch({ commandId: 'claim-1', taskId: 'worker-task', type: 'claim' });
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.idempotencyHit, true);

    const progressAt = Date.now();
    const heartbeat = await workerA.dispatch({ commandId: 'heartbeat-1', taskId: 'worker-task', type: 'heartbeat', payload: { leaseId, progressAt, activity: '正在等待模型返回' } });
    assert.equal(heartbeat.ok, true);
    assert.equal(heartbeat.run.worker.leaseId, leaseId);
    assert.equal(heartbeat.run.worker.progressAt, progressAt);
    assert.equal(heartbeat.run.worker.activity, '正在等待模型返回');
    const heartbeatOnly = await workerA.dispatch({ commandId: 'heartbeat-2', taskId: 'worker-task', type: 'heartbeat', payload: { leaseId } });
    assert.equal(heartbeatOnly.run.worker.progressAt, progressAt, '单纯续租不能伪装成真实进展');

    const paused = await workerA.dispatch({ commandId: 'pause-1', taskId: 'worker-task', type: 'pause' });
    assert.equal(paused.run.status, 'paused');
    assert.equal(paused.run.steps[0].status, 'completed');
    assert.equal(paused.run.worker.state, 'paused');
    const staleHeartbeat = await workerA.dispatch({ commandId: 'heartbeat-after-pause', taskId: 'worker-task', type: 'heartbeat', payload: { leaseId } });
    assert.equal(staleHeartbeat.ok, false, '暂停后的旧心跳不能重新制造工作中状态');
    const staleCheckpoint = await workerA.dispatch({ commandId: 'checkpoint-after-pause', taskId: 'worker-task', type: 'checkpoint', payload: { leaseId, checkpoint: { checkpointId: 'cp-after-pause', sequence: 3, kind: 'run_finished' } } });
    assert.equal(staleCheckpoint.ok, false, '暂停后的旧检查点不能覆盖暂停状态');

    const resumed = await workerA.dispatch({ commandId: 'resume-1', taskId: 'worker-task', type: 'resume' });
    assert.equal(resumed.run.status, 'queued');
    assert.equal(resumed.run.steps[0].status, 'completed');

    const claimedAgain = await workerA.dispatch({ commandId: 'claim-2', taskId: 'worker-task', type: 'claim' });
    assert.equal(claimedAgain.run.worker.ownerSessionId, 'session-a');

    const nativeRestartRun = makeRun();
    nativeRestartRun.id = 'native-restart-task';
    nativeRestartRun.title = 'Native restart recovery';
    const beforeNative = await store.read();
    await store.write([...beforeNative.runs, nativeRestartRun], { source: 'test' });
    const nativeClaim = await workerA.dispatch({ commandId: 'claim-native-restart', taskId: nativeRestartRun.id, type: 'claim', payload: { adapter: 'main-native-execution-adapter' } });
    assert.equal(nativeClaim.ok, true);
    const conflictingRun = makeRun();
    conflictingRun.id = 'native-conflict-task';
    conflictingRun.title = 'Native conflict recovery';
    await store.write([...(await store.read()).runs, conflictingRun], { source: 'test' });
    const conflictingClaim = await workerA.dispatch({ commandId: 'claim-native-conflict', taskId: conflictingRun.id, type: 'claim', payload: { adapter: 'main-native-execution-adapter' } });
    assert.equal(conflictingClaim.ok, true);
    await store.updateTask(conflictingRun.id, (run) => { run.goal = '检查点后被意外替换的目标'; }, { source: 'test-conflict' });
    workerA.stop();

    const workerB = createTaskWorker({ rootDir: root, store, sessionId: 'session-b', leaseMs: 60_000, sweepMs: 60_000 });
    activeWorkers.push(workerB);
    const restarted = await workerB.start();
    assert.deepEqual(new Set(restarted.recoveredTasks), new Set(['worker-task', nativeRestartRun.id, conflictingRun.id]));
    const recoveredSnapshot = await store.read();
    const recoveredRun = recoveredSnapshot.runs.find((run) => run.id === 'worker-task');
    assert.equal(recoveredRun.status, 'paused');
    assert.equal(recoveredRun.worker.state, 'expired');
    assert.match(recoveredRun.recoveryContext.interruptionReason, /客户端进程已更换/u);
    const recoveredNativeRun = recoveredSnapshot.runs.find((run) => run.id === nativeRestartRun.id);
    assert.equal(recoveredNativeRun.status, 'queued');
    assert.equal(recoveredNativeRun.recoveryContext.autoResume, true);
    const recoveredConflictRun = recoveredSnapshot.runs.find((run) => run.id === conflictingRun.id);
    assert.equal(recoveredConflictRun.status, 'paused');
    assert.equal(recoveredConflictRun.recoveryContext.autoResume, false);
    assert.match(recoveredConflictRun.recoveryContext.summary, /恢复前核对未通过/u);
    assert.match(recoveredConflictRun.recoveryContext.waitingFor, /核对任务目标/u);

    await store.updateTask(nativeRestartRun.id, (run) => {
      run.status = 'awaiting_user';
      run.phase = 'awaiting_user';
      run.recoveryContext.waitingFor = '完成授权';
    }, { source: 'test' });
    const resumedAwaiting = await workerB.dispatch({ commandId: 'resume-awaiting', taskId: nativeRestartRun.id, type: 'resume' });
    assert.equal(resumedAwaiting.ok, true);
    assert.equal(resumedAwaiting.run.status, 'queued');
    assert.equal(resumedAwaiting.run.recoveryContext.waitingFor, undefined);
    const stoppedNative = await workerB.dispatch({ commandId: 'stop-native', taskId: nativeRestartRun.id, type: 'stop' });
    assert.equal(stoppedNative.run.status, 'stopped');

    const stopped = await workerB.dispatch({ commandId: 'stop-1', taskId: 'worker-task', type: 'stop' });
    assert.equal(stopped.run.status, 'stopped');
    assert.equal(stopped.run.worker.state, 'stopped');

    const commands = await workerB.readCommands();
    assert.equal(commands.ok, true);
    assert.equal(commands.protocolVersion, WORKER_PROTOCOL_VERSION);
    assertJournalChain(commands.records);
    const taskCommands = await workerB.readCommands({ taskId: 'worker-task' });
    assert.ok(taskCommands.records.every((record) => record.taskId === 'worker-task'));
    assert.ok(taskCommands.records.some((record) => record.type === 'command_submitted'));
    assert.ok(taskCommands.records.some((record) => record.type === 'command_completed'));

    const closed = await workerB.dispatch({ commandId: 'close-1', taskId: 'worker-task', type: 'close' });
    assert.equal(closed.ok, true);
    const closedNative = await workerB.dispatch({ commandId: 'close-native', taskId: nativeRestartRun.id, type: 'close' });
    assert.equal(closedNative.ok, true);
    const closedConflict = await workerB.dispatch({ commandId: 'close-conflict', taskId: conflictingRun.id, type: 'close' });
    assert.equal(closedConflict.ok, true);
    assert.equal((await store.read()).runs.length, 0);
    workerB.stop();

    await fs.appendFile(workerB.journalPath, '{"tampered":true}\n', 'utf8');
    const workerC = createTaskWorker({ rootDir: root, store, sessionId: 'session-c' });
    activeWorkers.push(workerC);
    await workerC.start();
    const recoveredJournal = await workerC.readCommands();
    assert.equal(recoveredJournal.integrity.recovered, true);
    assert.match(path.basename(recoveredJournal.integrity.corruptPath), /^task-commands-corrupt-\d+\.jsonl$/u);
    assertJournalChain(recoveredJournal.records);
    const invalid = await workerC.dispatch({ taskId: 'missing', type: 'unknown' });
    assert.equal(invalid.ok, false);
    workerC.stop();

    const degradedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-task-worker-degraded-'));
    try {
      const brokenStore = {
        read: async () => ({ ok: false, error: '读取任务事件账本失败：Invalid string length', runs: [] }),
        updateTask: async () => { throw new Error('degraded control must not update the broken store'); },
      };
      const degradedWorker = createTaskWorker({ rootDir: degradedRoot, store: brokenStore, sessionId: 'session-degraded' });
      activeWorkers.push(degradedWorker);
      await degradedWorker.start();
      const emergencyPause = await degradedWorker.dispatch({ commandId: 'pause-degraded', taskId: 'blocked-task', type: 'pause' });
      assert.equal(emergencyPause.ok, true);
      assert.equal(emergencyPause.degraded, true);
      assert.equal(emergencyPause.status, 'paused');
      const emergencyStop = await degradedWorker.dispatch({ commandId: 'stop-degraded', taskId: 'blocked-task', type: 'stop' });
      assert.equal(emergencyStop.ok, true);
      assert.equal(emergencyStop.degraded, true);
      assert.equal(emergencyStop.status, 'stopped');
      const degradedCommands = await degradedWorker.readCommands({ taskId: 'blocked-task' });
      assert.equal(degradedCommands.records.filter((record) => record.type === 'command_completed').length, 2);
      degradedWorker.stop();
    } finally {
      await fs.rm(degradedRoot, { recursive: true, force: true });
    }

    console.log(JSON.stringify({
      passed: true,
      protocolVersion: WORKER_PROTOCOL_VERSION,
      commandRecords: commands.records.length,
      recoveredLease: recoveredRun.worker.state,
    }));
  } finally {
    activeWorkers.forEach((worker) => worker.stop());
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
