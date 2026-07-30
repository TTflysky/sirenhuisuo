import assert from 'node:assert/strict';
import { appendDelegation, transitionDelegation } from '../src/engine/taskDelegation.mjs';

const run = {
  id: 'run-dynamic',
  memberSnapshot: [
    { id: 'writer', name: '编剧', role: 'custom', title: '脚本编剧', prompt: '负责剧本和文案', soul: '', isOnline: true, isWorking: false },
    { id: 'coder', name: '程序员', role: 'coder', title: '开发工程师', prompt: '负责代码实现', soul: '', isOnline: true, isWorking: true },
  ],
  steps: [{ id: 'parent', employeeId: 'coder', status: 'completed' }],
  delegations: [],
};
const created = appendDelegation(run, { assignment: '请编写一份脚本', title: '脚本初稿', dependsOnStepIds: ['parent'] });
assert.equal(created.delegation.employeeId, 'writer');
assert.equal(typeof created.delegation.selectionReason, 'string');
assert.ok(created.delegation.selectionReason.length > 0);
assert.equal(created.delegation.availability, 'available');
const running = transitionDelegation(created.run, created.delegation.id, 'running');
const completed = transitionDelegation(running.run, created.delegation.id, 'completed', { output: { path: 'script.md' } });
assert.equal(completed.delegation.status, 'completed');
assert.throws(() => appendDelegation(run, { assignment: '无效依赖', dependsOnStepIds: ['missing'] }), /依赖不存在/);
console.log(JSON.stringify({ passed: true, version: 2, employee: created.delegation.employeeName }));
