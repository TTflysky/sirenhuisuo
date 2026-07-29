import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTaskRuntimeStore } from '../electron/taskRuntimeStore.cjs';
import { createTaskService } from '../electron/taskService.cjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'taiji-unified-evidence-'));
try {
  const service = createTaskService(createTaskRuntimeStore(root));
  const created = await service.create({ goal: '验证统一工具证据', idempotencyKey: 'evidence-001' });
  const taskId = created.task.id;
  await service.recordToolAttempt(taskId, {
    id: 'attempt-1', stepId: 'step-1', toolName: 'read_file', status: 'failed',
    errorClass: 'configuration', outputSummary: '文件不存在',
  });
  await service.recordToolAttempt(taskId, {
    id: 'attempt-2', stepId: 'step-1', toolName: 'write_file', status: 'succeeded',
    outputSummary: '文件已真实写入', evidenceIds: ['workspace/result.md'],
  });
  await service.addArtifact(taskId, { name: 'result.md', path: 'workspace/result.md', category: 'final', verified: true });
  const result = await service.read({ taskId });
  const task = result.runs[0];
  assert.equal(result.integrity.ok, true);
  assert.equal(task.toolAttempts.length, 2);
  assert.equal(task.toolAttempts[0].errorClass, 'configuration');
  assert.equal(task.artifacts[0].verified, true);
  console.log('verify-unified-tool-evidence: PASS');
} finally {
  await rm(root, { recursive: true, force: true });
}
