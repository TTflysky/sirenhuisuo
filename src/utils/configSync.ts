import type { Employee, Team } from '../types';

export interface SyncProfile {
  schemaVersion?: number;
  settings?: Record<string, unknown>;
  employees?: Employee[];
  teams?: Array<Partial<Team> & Pick<Team, 'id' | 'name' | 'memberIds'>>;
  connectors?: unknown[];
  assistantSystemPrompt?: string;
}

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

export function applySyncProfile(input: unknown): { employees: number; teams: number; models: number } {
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

  const modelLibrary = Array.isArray(settings.modelLibrary) ? settings.modelLibrary : [];
  return { employees: profile.employees.length, teams: profile.teams.length, models: modelLibrary.length };
}
