const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTaskRuntimeStore, SCHEMA_VERSION } = require('../electron/taskRuntimeStore.cjs');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-task-runtime-'));
  try {
    const store = createTaskRuntimeStore(root, { maxRuns: 2 });
    const first = await store.read();
    assert.equal(first.ok, true);
    assert.equal(first.exists, false);
    assert.deepEqual(first.runs, []);

    const makeRun = (id) => ({ id, teamId: 'team-test', status: 'queued', steps: [] });
    assert.equal((await store.write([makeRun('one'), makeRun('two'), makeRun('three')])).ok, true);
    const limited = await store.read();
    assert.equal(limited.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(limited.runs.map((run) => run.id), ['two', 'three']);

    await Promise.all([
      store.write([makeRun('four')]),
      store.write([makeRun('five')]),
    ]);
    const ordered = await store.read();
    assert.deepEqual(ordered.runs.map((run) => run.id), ['five']);

    await fs.writeFile(store.filePath, '{broken json', 'utf8');
    const rejected = await store.write([{}]);
    assert.equal(rejected.ok, false);
    const corrupted = await store.read();
    assert.equal(corrupted.ok, false);
    assert.equal(corrupted.exists, true);
    assert.match(corrupted.error, /snapshot|JSON|invalid/i);

    console.log(JSON.stringify({ passed: true, schemaVersion: SCHEMA_VERSION, retained: ordered.runs.map((run) => run.id) }));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
