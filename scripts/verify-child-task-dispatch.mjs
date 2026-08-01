import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../electron/nativeExecutionAdapter.cjs', import.meta.url), 'utf8');

assert.match(source, /employeeId: appended\.delegation\.employeeId/);
assert.match(source, /delegation\.childTaskId = child\.task\.id/);
assert.match(source, /delegatedStep\.childTaskId = child\.task\.id/);
assert.match(source, /delegatedStep\.externalChild = true/);
assert.match(source, /await start\(\{[\s\S]*taskId: child\.task\.id/);
assert.match(source, /new ExecutionControlSignal\('delegate_wait'/);
assert.match(source, /async function syncChildTaskTerminal/);
assert.match(source, /summarizeChildTask/);
assert.match(source, /parent\.childTaskResults/);
assert.match(source, /async function cascadeChildControl/);
assert.match(source, /child_task_control_cascaded/);
assert.match(source, /queued child has no active execute\(\) catch block/u);
assert.match(source, /await runCompensations\(childJob/);
assert.match(source, /queued_child_compensation_finished/);
assert.match(source, /function enqueueCompensation/);
assert.match(source, /compensating_queue/);
assert.match(source, /queued_task_compensation_finished/);
assert.match(source, /Queued task \$\{taskId\} was/);
assert.match(source, /child_task_resumed/);
assert.match(source, /resumed child task/);
assert.match(source, /await syncChildTaskTerminal\(step\.childTaskId, 'failed', reason\)/);
assert.match(source, /async function delegate\(taskId, input = \{\}\)/);
assert.match(source, /manually delegated by/);
assert.match(source, /childTask: child\?\.task/);
assert.match(source, /await syncChildTaskTerminal\(job\.taskId, 'completed'/);
assert.match(source, /await syncChildTaskTerminal\(job\.taskId, 'failed'/);

console.log('verify-child-task-dispatch: PASS');
