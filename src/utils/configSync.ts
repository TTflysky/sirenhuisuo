import type { Employee, Team } from '../types';
import { APP_VERSION } from '../appVersion';
import type { UserMemoryItem } from '../data/hermesClient';
import type { TaskLearning } from '../engine/taskLearningMemory';

export interface SyncProfile {
  schemaVersion?: number;
  settings?: Record<string, unknown>;
  employees?: Employee[];
  teams?: Array<Partial<Team> & Pick<Team, 'id' | 'name' | 'memberIds'>>;
  connectors?: unknown[];
  assistantSystemPrompt?: string;
  userProfile?: string;
  userMemory?: UserMemoryItem[];
  taskLearnings?: TaskLearning[];
}

const SECRET_KEY = /(?:api.?key|password|passwd|token|secret|credential|authorization|client.?secret)/iu;

function clearSecretPlaceholders(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clearSecretPlaceholders);
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = child === '__REQUIRED_LOCAL_SECRET__' ? '' : clearSecretPlaceholders(child);
    }
    return output;
  }
  return value;
}

function redactLocalSecrets(value: unknown, parentKey = ''): unknown {
  if (Array.isArray(value)) return value.map((child) => redactLocalSecrets(child, parentKey));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      SECRET_KEY.test(key) && typeof child === 'string' && child ? '__REQUIRED_LOCAL_SECRET__' : redactLocalSecrets(child, key),
    ]));
  }
  return SECRET_KEY.test(parentKey) && typeof value === 'string' && value ? '__REQUIRED_LOCAL_SECRET__' : value;
}

function parseStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export function createSyncProfile(): SyncProfile {
  const settings = parseStorage<Record<string, unknown>>('hermes_office_settings', {});
  const connectors = parseStorage<unknown[]>('hermes_office_connectors', []);
  return {
    schemaVersion: 2,
    settings: redactLocalSecrets(settings) as Record<string, unknown>,
    employees: parseStorage<Employee[]>('hermes_office_employees', []),
    teams: parseStorage<SyncProfile['teams']>('hermes_office_teams', []),
    connectors: redactLocalSecrets(connectors) as unknown[],
    assistantSystemPrompt: localStorage.getItem('hermes_office_assistant_system_prompt') ?? undefined,
    userProfile: localStorage.getItem('hermes_office_user_profile') ?? '',
    userMemory: parseStorage<UserMemoryItem[]>('hermes_office_user_memory', []),
    taskLearnings: parseStorage<TaskLearning[]>('hermes_office_task_learning_memory_v1', []),
  };
}

export function applySyncProfile(input: unknown): { employees: number; teams: number; models: number; memories: number; taskLearnings: number } {
  if (!input || typeof input !== 'object') throw new Error('同步文件不是有效的 JSON 对象');
  const profile = input as SyncProfile;
  if (!Array.isArray(profile.employees) || !Array.isArray(profile.teams)) {
    throw new Error('同步文件缺少 employees 或 teams 配置');
  }

  const settings = clearSecretPlaceholders(profile.settings ?? {}) as Record<string, unknown>;
  localStorage.setItem('hermes_office_employees', JSON.stringify(profile.employees));
  localStorage.setItem('hermes_office_teams', JSON.stringify(profile.teams));
  localStorage.setItem('hermes_office_settings', JSON.stringify(settings));
  if (Array.isArray(profile.connectors)) {
    localStorage.setItem('hermes_office_connectors', JSON.stringify(clearSecretPlaceholders(profile.connectors)));
  }
  if (typeof profile.assistantSystemPrompt === 'string') {
    localStorage.setItem('hermes_office_assistant_system_prompt', profile.assistantSystemPrompt);
  }
  if (typeof profile.userProfile === 'string') {
    localStorage.setItem('hermes_office_user_profile', profile.userProfile);
  }
  if (Array.isArray(profile.userMemory)) {
    localStorage.setItem('hermes_office_user_memory', JSON.stringify(profile.userMemory));
  }
  if (Array.isArray(profile.taskLearnings)) {
    localStorage.setItem('hermes_office_task_learning_memory_v1', JSON.stringify(profile.taskLearnings));
  }

  const modelLibrary = Array.isArray(settings.modelLibrary) ? settings.modelLibrary : [];
  return {
    employees: profile.employees.length,
    teams: profile.teams.length,
    models: modelLibrary.length,
    memories: Array.isArray(profile.userMemory) ? profile.userMemory.length : 0,
    taskLearnings: Array.isArray(profile.taskLearnings) ? profile.taskLearnings.length : 0,
  };
}

export function createUpgradeSnapshot(): UpgradeSnapshot {
  const values: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith('hermes_office_')) continue;
    const value = localStorage.getItem(key);
    if (value !== null) values[key] = value;
  }
  return { schema: 1, appVersion: APP_VERSION, createdAt: new Date().toISOString(), localStorage: values };
}

export function restoreUpgradeSnapshot(snapshot: UpgradeSnapshot): void {
  if (!snapshot || snapshot.schema !== 1 || !snapshot.localStorage || typeof snapshot.localStorage !== 'object') throw new Error('更新备份格式无效');
  for (const [key, value] of Object.entries(snapshot.localStorage)) {
    if (!key.startsWith('hermes_office_') || typeof value !== 'string') continue;
    localStorage.setItem(key, value);
  }
}
