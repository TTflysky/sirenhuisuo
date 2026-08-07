const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTelemetryLedger } = require('../electron/telemetryLedger.cjs');
const { createOperationDiagnostics } = require('../electron/operationDiagnostics.cjs');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-v59-telemetry-'));
  try {
    const ledger = createTelemetryLedger(root, { maxEvents: 500 });
    const diagnostics = createOperationDiagnostics(root, {
      onRecord(entry) {
        return ledger.record({ type: 'diagnostic.recorded', source: entry.scope, severity: entry.level, taskId: entry.taskId, failureClass: entry.failureClass, summary: entry.message, metadata: entry.context });
      },
    });
    await ledger.record({ type: 'task.task_created', source: 'task-service', taskId: 'task-1', projectId: 'project-1', status: 'running', summary: '已创建任务合同', usage: { totalTokens: 42 } });
    await ledger.record({ type: 'execution.tool_result', source: 'native-execution', taskId: 'task-1', toolCallId: 'tool-1', durationMs: 125, summary: '文件已写入', metadata: { apiKey: 'sk_secret-value-abcdefghijklmnop', reasoning_content: 'must-not-be-visible' } });
    await diagnostics.record({ scope: 'renderer', operation: 'storage-write', taskId: 'task-1', message: 'QuotaExceededError', context: { authorization: 'Bearer secretsecretsecretsecret' } });
    const query = await ledger.query({ taskId: 'task-1' });
    assert.equal(query.total, 3, '任务、工具和诊断必须汇总到同一可查询轨迹');
    assert.equal(query.entries[0].failureClass, 'unknown');
    const serialized = JSON.stringify(query);
    assert.equal(serialized.includes('sk_secret-value'), false, '遥测不得保留密钥');
    assert.equal(serialized.includes('Bearer secret'), false, '遥测不得保留凭据');
    assert.equal(serialized.includes('reasoning_content'), false, '遥测不得保留隐藏推理字段');
    const summary = await ledger.summary({ taskId: 'task-1' });
    assert.equal(summary.total, 3);
    assert.equal(summary.errors, 1);
    assert.equal(summary.totalTokens, 42);
    assert.equal(summary.activeTask.taskId, 'task-1');
    const exported = await ledger.exportData({ taskId: 'task-1' });
    assert.equal(exported.format, 'taiji-runtime-telemetry/v1');
    assert.equal(exported.events.length, 3);
    const reloaded = createTelemetryLedger(root);
    assert.equal((await reloaded.summary()).total, 3, '追加式账本必须在重启后可恢复');
    await reloaded.record({ type: 'runtime.after_restart', source: 'test', summary: '重启后继续追加' });
    assert.equal((await reloaded.summary()).total, 4, '首次追加不能覆盖尚未载入内存的历史事件');

    const repoRoot = path.resolve(__dirname, '..');
    const [main, preload, ui, packageJson] = await Promise.all([
      fs.readFile(path.join(repoRoot, 'electron', 'main.cjs'), 'utf8'),
      fs.readFile(path.join(repoRoot, 'electron', 'preload.cjs'), 'utf8'),
      fs.readFile(path.join(repoRoot, 'src', 'components', 'settings', 'DiagnosticsTab.tsx'), 'utf8'),
      fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'),
    ]);
    for (const marker of ['createTelemetryLedger', 'telemetry:query', 'telemetry:summary', 'telemetry:export', 'taiji-runtime-problem-package/v1']) assert(main.includes(marker));
    for (const marker of ['telemetryQuery', 'telemetrySummary', 'telemetryExport']) assert(preload.includes(marker));
    for (const marker of ['运行监控台', '导出问题包', 'runtime-monitor-timeline']) assert(ui.includes(marker));
    assert.match(JSON.parse(packageJson).scripts['verify:v59'], /verify:v59-runtime-telemetry/u);
    console.log('verify-v59-runtime-telemetry: PASS');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
