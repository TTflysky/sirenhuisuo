import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (path) => fs.readFile(path, 'utf8');
const [bridge, context, continuation, taskService, tests] = await Promise.all([
  read('src/engine/taskServiceBridge.ts'),
  read('src/utils/projectContext.ts'),
  read('src/engine/chatTaskContinuation.ts'),
  read('electron/taskService.cjs'),
  read('test/unit/projectContext.test.ts'),
]);

assert.match(bridge, /initializeProjectContext\(project\)/, '执行前必须初始化项目上下文');
assert.match(bridge, /projectId,/, 'TaskService 创建必须携带 projectId');
assert.match(bridge, /initializeProjectTaskRecord\(/, '执行任务必须写入项目任务记录');
assert.match(bridge, /artifact_registered/, '产物必须写入项目事件账本');
assert.match(bridge, /task_finished/, '任务结束必须写入项目事件账本');
assert.match(context, /JSON\.parse\(existingManifest\.content\)/, '项目清单必须读取后合并，不能盲目覆盖');
assert.match(continuation, /projectId: task\.projectId/, '续作必须继承原任务项目归属');
assert.match(taskService, /projectId: text\(input\.projectId/, 'TaskService 必须持久化 projectId');
assert.match(taskService, /projectId: input\.projectId \|\| parent\?\.projectId/, '子任务必须继承父任务 projectId');
assert.match(tests, /merges an existing project manifest/, '必须有项目清单不丢失的回归测试');
assert.match(tests, /traceable task record/, '必须有任务记录落盘回归测试');

console.log('V5.2 project context gate passed');
