const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createOperationDiagnostics, classifyFailure } = require('../electron/operationDiagnostics.cjs');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-operation-diagnostics-'));
  try {
    const diagnostics = createOperationDiagnostics(root, { maxEntries: 3 });
    const network = await diagnostics.record({ scope: 'native-execution-adapter', operation: 'tool-result', taskId: 'task-1', teamId: 'team-1', message: 'fetch failed: ECONNRESET', context: { apiKey: 'sk_verysecretvalue123456789', nested: { authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' } } });
    assert.equal(network.ok, true);
    assert.equal(network.entry.failureClass, 'network');
    assert.equal(network.entry.recoverable, true);
    assert.equal(network.entry.context.apiKey, '[redacted]');
    assert.equal(network.entry.context.nested.authorization, '[redacted]');
    await diagnostics.record({ scope: 'task-runtime-store', operation: 'update-task', taskId: 'task-2', message: '找不到任务：task-2' });
    await diagnostics.record({ scope: 'renderer', operation: 'window-error', message: 'Unhandled TypeError' });
    const filtered = await diagnostics.query({ taskId: 'task-1' });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.entries[0].failureClass, 'network');
    const summary = await diagnostics.summary();
    assert.equal(summary.total, 3);
    assert.equal(summary.byFailureClass.network, 1);
    assert.equal(summary.byFailureClass.missing_resource, 1);
    const exported = await diagnostics.exportData({ taskId: 'task-1' });
    assert.equal(exported.diagnostics.length, 1);
    assert.equal(exported.diagnostics[0].context.apiKey, '[redacted]');
    assert.deepEqual(classifyFailure({ message: 'permission denied' }), { failureClass: 'permission', recoverable: false });
    await diagnostics.record({ scope: 'runtime', operation: 'one', message: 'one' });
    const trimmed = await diagnostics.query({ limit: 10 });
    assert.equal(trimmed.total, 3);
    console.log('verify-operation-diagnostics: PASS');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
