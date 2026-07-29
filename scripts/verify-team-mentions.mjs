import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { classifyTeamMention, isTeamMentionTask } from '../src/engine/teamMentionRouting.mjs';

assert.equal(classifyTeamMention('@铁柱 你现在做到哪了'), 'reply');
assert.equal(classifyTeamMention('@铁柱 重新起草一份脚本'), 'task');
assert.equal(classifyTeamMention('@铁柱 查一下最新的接口文档'), 'task');
assert.equal(classifyTeamMention('@铁柱 你看到了吗'), 'reply');
assert.equal(classifyTeamMention('@铁柱 汇报一下模型'), 'control');
assert.equal(classifyTeamMention('@铁柱 请回复老板当前进度', { assistantRelay: true }), 'reply');
assert.equal(classifyTeamMention('@铁柱 请汇报当前进度', { assistantRelay: true }), 'reply');
assert.equal(isTeamMentionTask('@铁柱 修改页面'), true);
assert.equal(isTeamMentionTask('@铁柱 还在吗'), false);

const store = await fs.readFile(new URL('../src/store.tsx', import.meta.url), 'utf8');
const discussion = await fs.readFile(new URL('../src/engine/teamDiscussion.ts', import.meta.url), 'utf8');
assert.match(store, /runTeamMentionReply/);
assert.match(store, /runDirectEmployeeReply/);
assert.match(store, /relayAssistantMentions/);
assert.match(discussion, /export async function runTeamMentionReply/);
assert.match(discussion, /不要擅自创建任务、安排其他成员或生成文件/);

console.log(JSON.stringify({ passed: true, cases: 9, contract: 'direct-mention-routing-v1' }, null, 2));
