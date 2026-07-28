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
  try {
    const store = createTaskRuntimeStore(root);
    await store.write([makeRun()], { source: 'test' });
    const workerA = createTaskWorker({ rootDir: root, store, sessionId: 'session-a', leaseMs: 60_000, sweepMs: 60_000 });
    assert.equal((await workerA.start()).ok, true);

    const claim = await workerA.dispatch({ commandId: 'claim-1', taskId: 'worker-task', type: 'claim', payload: { adapter: 'test-adapter' } });
    assert.equal(claim.ok, true, claim.error);
    assert.equal(claim.run.status, 'running');
    assert.equal(claim.run.worker.state, 'running');
    assert.equal(claim.run.worker.ownerSessionId, 'session-a');
    const leaseId = claim.run.worker.leaseId;

    const duplicate = await workerA.dispatch({ commandId: 'claim-1', taskId: 'worker-task', type: 'claim' });
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.idempotencyHit, true);

    const heartbeat = await workerA.dispatch({ commandId: 'heartbeat-1', taskId: 'worker-task', type: 'heartbeat', payload: { leaseId } });
    assert.equal(heartbeat.ok, true);
    assert.equal(heartbeat.run.worker.leaseId, leaseId);

    const paused = await workerA.dispatch({ commandId: 'pause-1', taskId: 'worker-task', type: 'pause' });
    assert.equal(paused.run.status, 'paused');
    assert.equal(paused.run.steps[0].status, 'paused');
    assert.equal(paused.run.worker.state, 'paused');

    const resumed = await workerA.dispatch({ commandId: 'resume-1', taskId: 'worker-task', type: 'resume' });
    assert.equal(resumed.run.status, 'queued');
    assert.equal(resumed.run.steps[0].status, 'queued');

    const claimedAgain = await workerA.dispatch({ commandId: 'claim-2', taskId: 'worker-task', type: 'claim' });
    assert.equal(claimedAgain.run.worker.ownerSessionId, 'session-a');
    workerA.stop();

    const workerB = createTaskWorker({ rootDir: root, store, sessionId: 'session-b', leaseMs: 60_000, sweepMs: 60_000 });
    const restarted = await workerB.start();
    assert.deepEqual(restarted.recoveredTasks, ['worker-task']);
    const recoveredRun = (await store.read()).runs[0];
    assert.equal(recoveredRun.status, 'paused');
    assert.equal(recoveredRun.worker.state, 'expired');
    assert.match(recoveredRun.recoveryContext.interruptionReason, /客户端进程已更换/u);

    const stopped = await workerB.dispatch({ commandId: 'stop-1', taskId: 'worker-task', type: 'stop' });
    assert.equal(stopped.run.status, 'stopped');
    assert.equal(stopped.run.worker.state, 'stopped');

    const commands = await workerB.readCommands({ taskId: 'worker-task' });
    assert.equal(commands.ok, true);
    assert.equal(commands.protocolVersion, WORKER_PROTOCOL_VERSION);
    assertJournalChain(commands.records);
    assert.ok(commands.records.some((record) => record.type === 'command_submitted'));
    assert.ok(commands.records.some((record) => record.type === 'command_completed'));

    const closed = await workerB.dispatch({ commandId: 'close-1', taskId: 'worker-task', type: 'close' });
    assert.equal(closed.ok, true);
    assert.equal((await store.read()).runs.length, 0);
    workerB.stop();

    await fs.appendFile(workerB.journalPath, '{"tampered":true}\n', 'utf8');
    const workerC = createTaskWorker({ rootDir: root, store, sessionId: 'session-c' });
    await workerC.start();
    const recoveredJournal = await workerC.readCommands();
    assert.equal(recoveredJournal.integrity.recovered, true);
    assert.match(path.basename(recoveredJournal.integrity.corruptPath), /^task-commands-corrupt-\d+\.jsonl$/u);
    assertJournalChain(recoveredJournal.records);
    const invalid = await workerC.dispatch({ taskId: 'missing', type: 'unknown' });
    assert.equal(invalid.ok, false);
    workerC.stop();

    console.log(JSON.stringify({
      passed: true,
      protocolVersion: WORKER_PROTOCOL_VERSION,
      commandRecords: commands.records.length,
      recoveredLease: recoveredRun.worker.state,
    }));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
