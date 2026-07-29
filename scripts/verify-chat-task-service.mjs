import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');

const [client, assistant, dm, bridge] = await Promise.all([
  read('src/data/hermesClient.ts'),
  read('src/components/chat/AssistantChat.tsx'),
  read('src/components/chat/DmChatApp.tsx'),
  read('src/engine/taskServiceBridge.ts'),
]);

assert.match(client, /onTaskPrepared\?: \(decision: TaskDecision\) => Promise<void> \| void/);
assert.match(client, /if \(!conversationOnly\) await onTaskPrepared\?\./);
assert.match(assistant, /onTaskPrepared: \(decision\) => taskBridge\.prepare\(decision\)/);
assert.match(assistant, /taskBridge\.toolStarted\(/);
assert.match(assistant, /taskBridge\.toolFinished\(/);
assert.match(assistant, /taskBridge\.artifacts\(structuredEvidence\)/);
assert.match(assistant, /await taskBridge\.finish\(/);
assert.match(dm, /taskType: 'dm'/);
assert.match(dm, /idempotencyKey: `dm-chat:\$\{empId\}:\$\{job\.id\}`/);
assert.match(dm, /onTaskPrepared: \(decision\) => taskBridge\?\.prepare\(decision\)/);
assert.match(dm, /await taskBridge\?\.finish\(/);
assert.match(dm, /taskBridge\?\.artifacts\(structuredEvidence\)/);
assert.match(bridge, /taskServiceCreate/);
assert.match(bridge, /taskServiceToolAttempt/);
assert.match(bridge, /taskServiceValidateCompletion/);
assert.match(bridge, /taskServiceArtifact/);
assert.match(bridge, /taskServiceHeartbeat/);
assert.match(bridge, /taskWorkerCommand/);
assert.match(bridge, /type: 'claim'/);
assert.match(bridge, /type: 'release'/);
assert.match(bridge, /await Promise\.allSettled\(pendingWrites\.splice\(0\)\)/);

console.log('verify-chat-task-service: PASS');
