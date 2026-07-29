import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTaskRuntimeStore } = require('../electron/taskRuntimeStore.cjs');
const { createTaskService } = require('../electron/taskService.cjs');
const root = await mkdtemp(path.join(os.tmpdir(), 'taiji-coding-contract-'));
try {
  const service = createTaskService(createTaskRuntimeStore(root));
  const created = await service.create({ goal: '修复代码并运行测试', idempotencyKey: 'coding-001' });
  assert.equal(created.task.workspace.mode, 'git-worktree');
  assert.equal(created.task.workspace.status, 'pending');
  await service.recordCheckpoint(created.task.id, { label: '工作树已创建', workspaceId: 'worktrees/coding-001' });
  await service.recordVerification(created.task.id, { label: 'npm test', command: 'npm test', status: 'passed', exitCode: 0 });
  const task = (await service.read({ taskId: created.task.id })).runs[0];
  assert.equal(task.checkpoints.length, 1);
  assert.equal(task.workspace.status, 'ready');
  assert.equal(task.verifications[0].status, 'passed');
  console.log('verify-coding-task-contract: PASS');
} finally {
  await rm(root, { recursive: true, force: true });
}
