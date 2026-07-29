import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTaskRuntimeStore } = require('../electron/taskRuntimeStore.cjs');
const { createTaskService } = require('../electron/taskService.cjs');
const root = await mkdtemp(path.join(os.tmpdir(), 'taiji-task-retry-'));
try {
  const service = createTaskService(createTaskRuntimeStore(root));
  const created = await service.create({ goal: '验证重试策略', idempotencyKey: 'retry-001' });
  const taskId = created.task.id;
  const first = await service.failStep(taskId, { stepId: 'step-1', error: '模型请求超时' });
  assert.equal(first.ok, true);
  let task = (await service.read({ taskId })).runs[0];
  assert.equal(task.steps[0].status, 'queued');
  assert.equal(task.steps[0].errorClass, 'timeout');
  assert.ok(task.steps[0].retryAt);
  const denied = await service.failStep(taskId, { stepId: 'step-1', error: '权限拒绝' });
  assert.equal(denied.ok, true);
  task = (await service.read({ taskId })).runs[0];
  assert.equal(task.steps[0].status, 'failed');
  assert.equal(task.steps[0].errorClass, 'permission');
  console.log('verify-task-retry-policy: PASS');
} finally {
  await rm(root, { recursive: true, force: true });
}
