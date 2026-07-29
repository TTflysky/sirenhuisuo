import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

async function loadChatSessions() {
  const source = await fs.readFile('src/data/chatSessions.ts', 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
    fileName: 'src/data/chatSessions.ts',
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const savedStorage = globalThis.localStorage;
const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};

try {
  const sessions = await loadChatSessions();
  for (const scope of ['assistant', 'dm:employee-a', 'team:team-a']) {
    const legacyId = sessions.ensureActiveChatSession(scope);
    assert.equal(legacyId, sessions.legacyConversationId(scope));
    const oldMessage = { id: `${scope}-old`, authorId: 'me', roleId: 'human', content: '旧聊天', mentions: [], timestamp: 1, kind: 'text' };
    assert.equal(sessions.messageBelongsToConversation(oldMessage, legacyId, scope), true, '无编号旧消息必须只归入旧会话');

    const fresh = sessions.createChatSession(scope, '新聊天');
    assert.notEqual(fresh.id, legacyId, '新聊天必须建立独立边界');
    assert.equal(sessions.ensureActiveChatSession(scope), fresh.id);
    assert.equal(sessions.messageBelongsToConversation(oldMessage, fresh.id, scope), false, '新聊天不能继承旧消息');
    const freshMessage = { ...oldMessage, id: `${scope}-new`, content: '新聊天消息', conversationId: fresh.id, timestamp: 2 };
    assert.equal(sessions.messageBelongsToConversation(freshMessage, fresh.id, scope), true);
    assert.equal(sessions.messageBelongsToConversation(freshMessage, legacyId, scope), false);

    assert.equal(sessions.activateChatSession(scope, legacyId), true, '历史聊天必须可以恢复');
    assert.equal(sessions.ensureActiveChatSession(scope), legacyId);
    sessions.syncChatSessionsFromMessages(scope, [oldMessage, freshMessage]);
    const history = sessions.listChatSessions(scope);
    assert(history.some((item) => item.id === legacyId));
    assert(history.some((item) => item.id === fresh.id));
  }

  const [assistant, dm, team, store, native] = await Promise.all([
    fs.readFile('src/components/chat/AssistantChat.tsx', 'utf8'),
    fs.readFile('src/components/chat/DmChatApp.tsx', 'utf8'),
    fs.readFile('src/components/chat/TeamChatApp.tsx', 'utf8'),
    fs.readFile('src/store.tsx', 'utf8'),
    fs.readFile('electron/nativeExecutionAdapter.cjs', 'utf8'),
  ]);
  for (const [label, source] of [['assistant', assistant], ['dm', dm], ['team', team]]) {
    assert.match(source, /新建聊天/u, `${label} 缺少明确的新建聊天控件`);
    assert.match(source, /历史对话/u, `${label} 缺少历史聊天入口`);
    assert.match(source, /createChatSession/u, `${label} 没有建立独立会话`);
    assert.match(source, /messageBelongsToConversation/u, `${label} 没有按会话过滤消息`);
  }
  assert.match(store, /run\.conversationId === conversationId/u, '团队调度没有限制到当前会话');
  assert.match(store, /conversationId: workerRun\.conversationId/u, '任务恢复没有继承原会话');
  assert.match(native, /run\?\.conversationId/u, '原生执行消息没有写入所属会话');
  assert.match(native, /继承父任务.*聊天会话/u, '动态子任务没有继承父会话');

  console.log(JSON.stringify({ passed: true, scopes: 3, historyPreserved: true, lateMessagesIsolated: true }));
} finally {
  globalThis.localStorage = savedStorage;
}
