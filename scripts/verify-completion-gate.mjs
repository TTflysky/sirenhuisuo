import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTaskRuntimeStore } = require('../electron/taskRuntimeStore.cjs');
const { createTaskService } = require('../electron/taskService.cjs');
const root = await mkdtemp(path.join(os.tmpdir(), 'taiji-completion-gate-'));
try {
  const service = createTaskService(createTaskRuntimeStore(root));
  const created = await service.create({ goal: '实现并测试一个脚本', idempotencyKey: 'gate-001' });
  const taskId = created.task.id;
  let gate = await service.validateCompletion(taskId);
  assert.equal(gate.passed, false);
  await service.completeStep(taskId, { stepId: 'step-1', summary: '脚本已写入' });
  await service.recordCheckpoint(taskId, { label: '代码检查点', workspaceId: 'worktrees/gate-001' });
  gate = await service.validateCompletion(taskId);
  assert.equal(gate.passed, false);
  await service.recordVerification(taskId, { label: '脚本测试', status: 'passed', exitCode: 0 });
  gate = await service.validateCompletion(taskId);
  assert.equal(gate.passed, true);
  console.log('verify-completion-gate: PASS');
} finally {
  await rm(root, { recursive: true, force: true });
}
