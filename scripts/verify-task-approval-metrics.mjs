import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTaskRuntimeStore } = require('../electron/taskRuntimeStore.cjs');
const { createTaskService } = require('../electron/taskService.cjs');
const root = await mkdtemp(path.join(os.tmpdir(), 'taiji-approval-metrics-'));
try {
  const service = createTaskService(createTaskRuntimeStore(root));
  const created = await service.create({ goal: '验证授权与指标', idempotencyKey: 'metrics-001' });
  const taskId = created.task.id;
  const requested = await service.requestApproval(taskId, { reason: '需要访问外部连接器', scope: 'connector' });
  const approval = (await service.read({ taskId })).runs[0].approvals[0];
  assert.equal(requested.ok, true);
  assert.equal(approval.status, 'pending');
  await service.decideApproval(taskId, { approvalId: approval.id, decision: 'approved', note: '允许本次任务使用' });
  await service.recordUsage(taskId, { modelRounds: 2, promptTokens: 100, completionTokens: 40 });
  await service.recordToolAttempt(taskId, { toolName: 'test_connector', status: 'failed', errorClass: 'network', outputSummary: '连接超时' });
  const metrics = await service.metrics(taskId);
  assert.equal(metrics.approvals.pending, 0);
  assert.equal(metrics.tools.failed, 1);
  assert.equal(metrics.tools.byErrorClass.network, 1);
  assert.equal(metrics.usage.promptTokens, 100);
  assert.equal(metrics.integrity.ok, true);
  console.log('verify-task-approval-metrics: PASS');
} finally {
  await rm(root, { recursive: true, force: true });
}
