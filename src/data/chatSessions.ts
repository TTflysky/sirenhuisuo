import type { ChatMessage } from '../types';
import { conversationProjectId, initializeProjectContext, projectDocumentPath, projectWorkspaceId } from '../utils/projectContext';

export type ChatSessionScope = 'assistant' | `dm:${string}` | `team:${string}`;

export interface ChatSessionRecord {
  id: string;
  scope: ChatSessionScope;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface ChatSessionIndex {
  version: 1;
  activeByScope: Record<string, string>;
  sessions: ChatSessionRecord[];
}

const STORAGE_KEY = 'taiji_chat_sessions_v1';
const MAX_SESSIONS_PER_SCOPE = 40;
const DEFAULT_INDEX: ChatSessionIndex = { version: 1, activeByScope: {}, sessions: [] };

function readIndex(): ChatSessionIndex {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<ChatSessionIndex>;
    return {
      version: 1,
      activeByScope: parsed.activeByScope && typeof parsed.activeByScope === 'object' ? parsed.activeByScope : {},
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions.filter((item): item is ChatSessionRecord => (
        !!item && typeof item.id === 'string' && typeof item.scope === 'string'
      )) : [],
    };
  } catch {
    return { ...DEFAULT_INDEX, activeByScope: {}, sessions: [] };
  }
}

function writeIndex(index: ChatSessionIndex): void {
  try {
    const scopes = [...new Set(index.sessions.map((session) => session.scope))];
    const sessions = scopes.flatMap((scope) => index.sessions
      .filter((session) => session.scope === scope)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_SESSIONS_PER_SCOPE));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...index, sessions }));
  } catch {}
}

function safeScope(scope: ChatSessionScope): string {
  return scope.replace(/[^a-zA-Z0-9_-]+/gu, '-');
}

export function legacyConversationId(scope: ChatSessionScope): string {
  return `conversation-legacy-${safeScope(scope)}`;
}

function defaultTitle(scope: ChatSessionScope): string {
  if (scope === 'assistant') return '助理对话';
  if (scope.startsWith('dm:')) return '员工私聊';
  return '团队对话';
}

export function titleFromMessages(messages: ChatMessage[], fallback = '新对话'): string {
  const firstUserMessage = messages.find((message) => message.roleId === 'human')?.content.trim();
  return (firstUserMessage || fallback).replace(/\s+/gu, ' ').slice(0, 36);
}

export function registerChatSession(record: ChatSessionRecord): ChatSessionRecord {
  const index = readIndex();
  const previous = index.sessions.find((session) => session.id === record.id && session.scope === record.scope);
  const next = previous
    ? { ...previous, ...record, createdAt: previous.createdAt || record.createdAt }
    : record;
  index.sessions = [next, ...index.sessions.filter((session) => !(session.id === next.id && session.scope === next.scope))];
  writeIndex(index);
  return next;
}

export function ensureActiveChatSession(scope: ChatSessionScope): string {
  const index = readIndex();
  const existing = index.activeByScope[scope];
  if (existing) {
    if (!index.sessions.some((session) => session.id === existing && session.scope === scope)) {
      index.sessions.unshift({ id: existing, scope, title: defaultTitle(scope), createdAt: Date.now(), updatedAt: Date.now() });
      writeIndex(index);
    }
    return existing;
  }
  const id = legacyConversationId(scope);
  const now = Date.now();
  index.activeByScope[scope] = id;
  index.sessions.unshift({ id, scope, title: defaultTitle(scope), createdAt: now, updatedAt: now });
  writeIndex(index);
  return id;
}

export function createChatSession(scope: ChatSessionScope, title = '新对话'): ChatSessionRecord {
  const now = Date.now();
  const record: ChatSessionRecord = {
    id: `conversation-${safeScope(scope)}-${now}-${Math.random().toString(36).slice(2, 7)}`,
    scope,
    title,
    createdAt: now,
    updatedAt: now,
  };
  const index = readIndex();
  index.activeByScope[scope] = record.id;
  index.sessions = [record, ...index.sessions];
  writeIndex(index);
  const projectId = conversationProjectId(record.id);
  void initializeProjectContext({
    id: projectId,
    title: title || defaultTitle(scope),
    request: '',
    conversationId: record.id,
    steps: [],
    expectedOutputs: [],
    members: [],
    status: 'running',
    workspaceId: projectWorkspaceId(projectId),
    documentPath: projectDocumentPath(projectId),
    createdAt: now,
    updatedAt: now,
  });
  return record;
}

export function activateChatSession(scope: ChatSessionScope, conversationId: string): boolean {
  const index = readIndex();
  const target = index.sessions.find((session) => session.scope === scope && session.id === conversationId);
  if (!target) return false;
  index.activeByScope[scope] = conversationId;
  target.updatedAt = Date.now();
  writeIndex(index);
  return true;
}

export function touchChatSession(scope: ChatSessionScope, conversationId: string, title?: string): void {
  const index = readIndex();
  const existing = index.sessions.find((session) => session.scope === scope && session.id === conversationId);
  const now = Date.now();
  const next: ChatSessionRecord = existing
    ? { ...existing, title: title?.trim() ? titleFromMessages([], title) : existing.title, updatedAt: now }
    : { id: conversationId, scope, title: titleFromMessages([], title || defaultTitle(scope)), createdAt: now, updatedAt: now };
  index.sessions = [next, ...index.sessions.filter((session) => !(session.scope === scope && session.id === conversationId))];
  writeIndex(index);
}

export function listChatSessions(scope: ChatSessionScope): ChatSessionRecord[] {
  return readIndex().sessions
    .filter((session) => session.scope === scope)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function messageBelongsToConversation(message: ChatMessage, conversationId: string, scope: ChatSessionScope): boolean {
  return message.conversationId === conversationId
    || (!message.conversationId && conversationId === legacyConversationId(scope));
}

export function normalizeConversationMessages(messages: ChatMessage[], scope: ChatSessionScope): ChatMessage[] {
  const legacyId = legacyConversationId(scope);
  return messages.map((message) => message.conversationId ? message : { ...message, conversationId: legacyId });
}

export function syncChatSessionsFromMessages(scope: ChatSessionScope, messages: ChatMessage[]): void {
  const normalized = normalizeConversationMessages(messages, scope);
  const grouped = new Map<string, ChatMessage[]>();
  for (const message of normalized) {
    const current = grouped.get(message.conversationId!) ?? [];
    current.push(message);
    grouped.set(message.conversationId!, current);
  }
  for (const [conversationId, conversationMessages] of grouped) {
    registerChatSession({
      id: conversationId,
      scope,
      title: titleFromMessages(conversationMessages, defaultTitle(scope)),
      createdAt: Math.min(...conversationMessages.map((message) => message.timestamp)),
      updatedAt: Math.max(...conversationMessages.map((message) => message.timestamp)),
    });
  }
}
