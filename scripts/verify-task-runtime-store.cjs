const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTaskRuntimeStore, SCHEMA_VERSION, LEDGER_VERSION, eventHash, verifyEnvelope } = require('../electron/taskRuntimeStore.cjs');

function makeRun(id, overrides = {}) {
  return {
    id,
    teamId: 'team-test',
    title: `任务 ${id}`,
    status: 'queued',
    steps: [],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

async function readLedger(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

function assertValidChain(events) {
  let previousHash = '';
  events.forEach((event, index) => {
    assert.equal(event.eventVersion, LEDGER_VERSION);
    assert.equal(event.sequence, index + 1);
    assert.equal(event.previousHash, previousHash);
    assert.equal(event.hash, eventHash(event));
    previousHash = event.hash;
  });
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-task-runtime-'));
  try {
    const store = createTaskRuntimeStore(root, { maxRuns: 10 });
    const first = await store.read();
    assert.equal(first.ok, true);
    assert.equal(first.exists, false);
    assert.deepEqual(first.runs, []);
    assert.deepEqual(first.events, []);
    assert.equal(first.integrity.eventCount, 0);

    const created = await store.write([makeRun('one'), makeRun('two')], { source: 'test', sessionId: 'session-1' });
    assert.equal(created.ok, true);
    assert.equal(created.eventsAppended, 2);
    assert.deepEqual(created.events.map((event) => event.type), ['task_created', 'task_created']);
    assert.equal(created.events[0].source, 'test');
    assert.equal(created.events[0].sessionId, 'session-1');

    const updatedOne = makeRun('one', {
      status: 'running',
      updatedAt: 200,
      steps: [{ id: 'step-1', status: 'running' }],
      recoveryContext: { summary: '执行中' },
    });
    const changed = await store.write([updatedOne, makeRun('two')]);
    assert.equal(changed.eventsAppended, 1);
    assert.equal(changed.events[0].type, 'task_changed');
    assert.equal(changed.events[0].previousStatus, 'queued');
    assert.equal(changed.events[0].nextStatus, 'running');
    assert.deepEqual(changed.events[0].domains, ['recoveryContext', 'status', 'steps', 'updatedAt']);
    assert.ok(changed.events[0].payload.changes.every((change) => Array.isArray(change.path)));

    const duplicate = await store.write([updatedOne, makeRun('two')]);
    assert.equal(duplicate.eventsAppended, 0);

    // A renderer may still hold an old task list while a native job is
    // running. Omitting that task must not append task_removed to the ledger.
    const rendererRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-renderer-stale-'));
    try {
      const rendererStore = createTaskRuntimeStore(rendererRoot, { maxRuns: 10 });
      const activeParent = makeRun('active-parent', { status: 'running' });
      const terminalTask = makeRun('terminal-task', { status: 'completed' });
      await rendererStore.write([activeParent, terminalTask], { source: 'native-execution-adapter' });
      const staleSave = await rendererStore.write([terminalTask], { source: 'renderer' });
      assert.equal(staleSave.eventsAppended, 0);
      assert.deepEqual(staleSave.skippedRemovals, ['active-parent']);
      assert.deepEqual((await rendererStore.read()).runs.map((run) => run.id).sort(), ['active-parent', 'terminal-task']);
      const blockedExplicitRemoval = await rendererStore.write([terminalTask], { source: 'renderer', removedTaskIds: ['active-parent'] });
      assert.deepEqual(blockedExplicitRemoval.skippedRemovals, ['active-parent']);
      const acceptedRemoval = await rendererStore.write([activeParent], { source: 'renderer', removedTaskIds: ['terminal-task'] });
      assert.equal(acceptedRemoval.eventsAppended, 1);
      assert.equal(acceptedRemoval.events[0].type, 'task_removed');
      assert.deepEqual((await rendererStore.read()).runs.map((run) => run.id), ['active-parent']);
    } finally {
      await fs.rm(rendererRoot, { recursive: true, force: true });
    }

    const recovery = await store.createRecoveryPoint({ taskId: 'one', label: '运行中基线' });
    assert.equal(recovery.ok, true);
    assert.equal(verifyEnvelope(recovery.recoveryPoint), true);
    assert.equal(recovery.recoveryPoint.runs.length, 1);
    const recoveryList = await store.listRecoveryPoints({ taskId: 'one' });
    assert.equal(recoveryList.recoveryPoints.length, 1);

    const failed = await store.updateTask('one', (run) => { run.status = 'failed'; run.lastError = '模拟失败'; });
    assert.equal(failed.ok, true);
    const restoredPoint = await store.restoreRecoveryPoint(recovery.recoveryPoint.recoveryPointId, { source: 'test-recovery' });
    assert.equal(restoredPoint.ok, true);
    assert.equal(restoredPoint.runs.find((run) => run.id === 'one').status, 'running');
    const rebuiltAtFailure = await store.rebuild({ taskId: 'one', sequence: failed.events[0].sequence });
    assert.equal(rebuiltAtFailure.ok, true);
    assert.equal(rebuiltAtFailure.runs[0].status, 'failed');

    const query = await store.read({ teamId: 'team-test', status: 'running', query: '任务 one', limit: 10 });
    assert.deepEqual(query.runs.map((run) => run.id), ['one']);
    assert.equal(query.page.total, 1);
    const evidenceRun = makeRun('evidence-search', {
      status: 'failed',
      updatedAt: 250,
      lastError: 'Word 文件格式校验失败',
      steps: [{ id: 'format-check', title: '检查交付文件', assignment: '验证文档可打开', status: 'failed', events: [{ detail: 'officeparser 无法读取正文' }], evidence: [{ summary: '合同草案.docx 未通过打开验证' }] }],
    });
    await store.write([updatedOne, makeRun('two'), evidenceRun]);
    const evidenceQuery = await store.read({ query: '合同草案', limit: 10 });
    assert.deepEqual(evidenceQuery.runs.map((run) => run.id), ['evidence-search']);
    const errorQuery = await store.read({ query: 'officeparser', limit: 10 });
    assert.deepEqual(errorQuery.runs.map((run) => run.id), ['evidence-search']);
    const audit = await store.audit({ taskId: 'one', afterSequence: 1, limit: 20 });
    assert.equal(audit.runs, undefined);
    assert.ok(audit.events.every((event) => event.taskId === 'one' && event.sequence > 1));

    const removed = await store.write([updatedOne]);
    assert.equal(removed.eventsAppended, 2);
    assert.ok(removed.events.every((event) => event.type === 'task_removed'));

    await Promise.all([
      store.write([makeRun('three')]),
      store.write([makeRun('four')]),
    ]);
    const ordered = await store.read();
    assert.deepEqual(ordered.runs.map((run) => run.id), ['four']);
    assert.equal(ordered.schemaVersion, SCHEMA_VERSION);
    assert.equal(ordered.ledgerVersion, LEDGER_VERSION);

    const events = await readLedger(store.ledgerPath);
    assertValidChain(events);
    assert.equal(ordered.integrity.lastSequence, events.length);
    assert.equal(ordered.integrity.lastHash, events.at(-1).hash);
    const checkpointEnvelope = JSON.parse(await fs.readFile(store.filePath, 'utf8'));
    const indexEnvelope = JSON.parse(await fs.readFile(store.indexPath, 'utf8'));
    assert.equal(verifyEnvelope(checkpointEnvelope), true);
    assert.equal(verifyEnvelope(indexEnvelope), true);
    assert.equal(indexEnvelope.entries[0].id, 'four');

    await fs.writeFile(store.filePath, JSON.stringify({ schemaVersion: 2, runs: [makeRun('forged')] }), 'utf8');
    const restarted = createTaskRuntimeStore(root, { maxRuns: 10 });
    const rebuilt = await restarted.read();
    assert.deepEqual(rebuilt.runs.map((run) => run.id), ['four']);
    assert.equal(rebuilt.integrity.snapshotRebuilt, true);

    const filtered = await restarted.read({ taskId: 'one', limit: 2 });
    assert.equal(filtered.events.length, 2);
    assert.ok(filtered.events.every((event) => event.taskId === 'one'));

    const tampered = { ...events.at(-1), detail: '被篡改的尾部' };
    await fs.appendFile(store.ledgerPath, `${JSON.stringify(tampered)}\n${JSON.stringify({ bad: true })}\n`, 'utf8');
    const recoveringStore = createTaskRuntimeStore(root, { maxRuns: 10 });
    const recovered = await recoveringStore.read();
    assert.equal(recovered.ok, true);
    assert.equal(recovered.integrity.recovered, true);
    assert.match(path.basename(recovered.integrity.corruptPath), /^task-events-corrupt-\d+\.jsonl$/u);
    assert.deepEqual(recovered.runs.map((run) => run.id), ['four']);
    assertValidChain(await readLedger(store.ledgerPath));
    const corruptFiles = (await fs.readdir(root)).filter((name) => name.startsWith('task-events-corrupt-'));
    assert.equal(corruptFiles.length, 1);

    const invalid = await recoveringStore.write([{}]);
    assert.equal(invalid.ok, false);

    const migrationRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-task-migration-'));
    try {
      await fs.writeFile(path.join(migrationRoot, 'task-runs.json'), JSON.stringify({
        schemaVersion: 1,
        runs: [makeRun('legacy-one'), makeRun('legacy-two')],
      }), 'utf8');
      await fs.writeFile(path.join(migrationRoot, 'task-events.jsonl'), '', 'utf8');
      const migrationStore = createTaskRuntimeStore(migrationRoot);
      const [migrated, concurrentRead] = await Promise.all([migrationStore.read(), migrationStore.read()]);
      assert.deepEqual(migrated.runs.map((run) => run.id), ['legacy-one', 'legacy-two']);
      assert.deepEqual(migrated.events.map((event) => event.type), ['task_migrated', 'task_migrated']);
      assert.equal(concurrentRead.events.length, 2);
      assertValidChain(migrated.events);
      const checkpoint = JSON.parse(await fs.readFile(migrationStore.filePath, 'utf8'));
      assert.equal(checkpoint.schemaVersion, SCHEMA_VERSION);
      assert.equal(checkpoint.lastSequence, 2);
    } finally {
      await fs.rm(migrationRoot, { recursive: true, force: true });
    }

    console.log(JSON.stringify({ passed: true, schemaVersion: SCHEMA_VERSION, ledgerVersion: LEDGER_VERSION, events: events.length }));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
