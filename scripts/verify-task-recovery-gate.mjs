import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');

assert.match(source, /if \(command\?\.type === 'resume'\)/);
assert.match(source, /await taskService\.recoveryPlan\(command\?\.taskId\)/);
assert.match(source, /if \(!recovery\.plan\?\.ready\)/);
assert.match(source, /recoveryPlan: recovery\.plan/);
assert.match(source, /const result = await taskWorker\.dispatch\(command\)/);

console.log('verify-task-recovery-gate: PASS');
