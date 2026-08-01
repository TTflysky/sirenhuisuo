import type { ChatMessage, Employee, Project, Team } from '../types';

const LS_EMPLOYEES = 'hermes_office_employees';
const LS_TEAMS = 'hermes_office_teams';
const LS_PROJECTS = 'hermes_office_projects_v1';
const LS_CHAT_PREFIX = 'hermes_office_chat_';
const LS_DM_PREFIX = 'hermes_office_dm_';
const MAX_CHAT = 200;

export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(LS_PROJECTS);
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

export function saveProjects(projects: Project[]): void {
  try { localStorage.setItem(LS_PROJECTS, JSON.stringify(projects.slice(-80))); } catch (error) {
    console.warn('[appStateStorage] Failed to save projects:', error);
  }
}

export function saveEmployees(list: Employee[]): void {
  try { localStorage.setItem(LS_EMPLOYEES, JSON.stringify(list)); } catch (error) {
    console.warn('[appStateStorage] Failed to save employees:', error);
  }
}

export function upsertEmployee(employee: Employee, list: Employee[]): Employee[] {
  const index = list.findIndex((candidate) => candidate.id === employee.id);
  const next = [...list];
  if (index >= 0) next[index] = employee;
  else next.push(employee);
  saveEmployees(next);
  return next;
}

export function removeEmployee(id: string, list: Employee[]): Employee[] {
  const next = list.filter((employee) => employee.id !== id);
  saveEmployees(next);
  return next;
}

export function saveTeams(list: Team[]): void {
  try {
    const stripped = list.map((team) => ({ ...team, chatMessages: [] }));
    localStorage.setItem(LS_TEAMS, JSON.stringify(stripped));
  } catch (error) {
    console.warn('[appStateStorage] Failed to save teams:', error);
  }
}

function isRawBinaryChatContent(content: unknown): boolean {
  if (typeof content !== 'string') return true;
  const value = content.trim();
  if (!value) return false;
  if (/^data:[a-z][a-z0-9+.-]*\/[a-z0-9+.-]+;base64,/iu.test(value)) return true;
  const compact = value.replace(/\s/gu, '');
  return compact.length >= 1024
    && compact.length >= value.length * 0.95
    && /^[A-Za-z0-9+/_-]+={0,2}$/u.test(compact);
}

function cleanChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((message): message is ChatMessage => (
    !!message
    && typeof message === 'object'
    && typeof (message as ChatMessage).id === 'string'
    && !isRawBinaryChatContent((message as ChatMessage).content)
  ));
}

function loadMessages(key: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const messages = cleanChatMessages(parsed);
    if (Array.isArray(parsed) && messages.length !== parsed.length) {
      localStorage.setItem(key, JSON.stringify(messages));
    }
    return messages;
  } catch { return []; }
}

function appendMessages(key: string, messages: ChatMessage[]): void {
  try {
    const existing = loadMessages(key);
    const existingIds = new Set(existing.map((message) => message.id));
    const additions = cleanChatMessages(messages).filter((message) => !existingIds.has(message.id));
    if (!additions.length) return;
    localStorage.setItem(key, JSON.stringify([...existing, ...additions].slice(-MAX_CHAT)));
  } catch (error) {
    console.warn('[appStateStorage] Failed to append chat:', error);
  }
}

function replaceMessages(key: string, messages: ChatMessage[]): void {
  try { localStorage.setItem(key, JSON.stringify(cleanChatMessages(messages).slice(-MAX_CHAT))); } catch (error) {
    console.warn('[appStateStorage] Failed to replace chat:', error);
  }
}

export const loadChat = (id: string): ChatMessage[] => loadMessages(`${LS_CHAT_PREFIX}${id}`);
export const appendChat = (id: string, messages: ChatMessage[]): void => appendMessages(`${LS_CHAT_PREFIX}${id}`, messages);
export const replaceChat = (id: string, messages: ChatMessage[]): void => replaceMessages(`${LS_CHAT_PREFIX}${id}`, messages);
export const loadDm = (employeeId: string): ChatMessage[] => loadMessages(`${LS_DM_PREFIX}${employeeId}`);
export const appendDm = (employeeId: string, messages: ChatMessage[]): void => appendMessages(`${LS_DM_PREFIX}${employeeId}`, messages);
export const replaceDm = (employeeId: string, messages: ChatMessage[]): void => replaceMessages(`${LS_DM_PREFIX}${employeeId}`, messages);

export const APP_STATE_STORAGE_KEYS = {
  employees: LS_EMPLOYEES,
  teams: LS_TEAMS,
} as const;
