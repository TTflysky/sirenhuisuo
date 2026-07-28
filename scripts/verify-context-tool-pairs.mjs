import assert from 'node:assert/strict';
import { compactMessageWindow, groupAtomicMessages, validateToolMessageSequence } from '../src/engine/taskContextRouter.mjs';

const chatter = Array.from({ length: 16 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `历史消息 ${index}` }));
const messages = [
  { role: 'system', content: 'system' },
  ...chatter,
  { role: 'assistant', content: null, tool_calls: [
    { id: 'call-a', type: 'function', function: { name: 'read_file', arguments: '{}' } },
    { id: 'call-b', type: 'function', function: { name: 'web_search', arguments: '{}' } },
  ] },
  { role: 'tool', tool_call_id: 'call-a', content: 'file result' },
  { role: 'tool', tool_call_id: 'call-b', content: 'search result' },
  { role: 'assistant', content: '继续处理' },
];

assert.equal(validateToolMessageSequence(messages).valid, true);
const compacted = compactMessageWindow(messages, { keepRecent: 2 });
assert.equal(validateToolMessageSequence(compacted.messages).valid, true);
const group = groupAtomicMessages(compacted.messages).find((unit) => unit.kind === 'tool-group');
assert(group);
assert.equal(group.messages.length, 3);
assert.deepEqual(group.toolCallIds, ['call-a', 'call-b']);

const boundaryMessages = [
  { role: 'system', content: 'system' },
  ...Array.from({ length: 12 }, (_, index) => ({ role: 'user', content: `old ${index}` })),
  { role: 'assistant', content: null, tool_calls: [{ id: 'call-tail', type: 'function', function: { name: 'run_command', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 'call-tail', content: 'exit 0' },
  { role: 'assistant', content: 'done' },
];
const boundary = compactMessageWindow(boundaryMessages, { keepRecent: 2 });
assert.equal(validateToolMessageSequence(boundary.messages).valid, true);
assert(boundary.messages.some((message) => message.role === 'assistant' && message.tool_calls?.[0]?.id === 'call-tail'));
assert(boundary.messages.some((message) => message.role === 'tool' && message.tool_call_id === 'call-tail'));

const incomplete = [...Array.from({ length: 12 }, (_, index) => ({ role: 'user', content: `old ${index}` })), { role: 'assistant', content: null, tool_calls: [{ id: 'unfinished', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }];
const incompleteResult = compactMessageWindow(incomplete, { keepRecent: 2 });
assert(incompleteResult.messages.some((message) => message.tool_calls?.[0]?.id === 'unfinished'));
console.log(`context tool pairs verified: removed ${compacted.removed} messages, protected ${compacted.protectedToolGroups} group(s)`);
