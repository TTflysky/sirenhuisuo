import type { Employee, Project, Team } from '../types';
import { scoreEmployeeForTask } from './taskMatcher';

const TEAM_ADDITION_PATTERNS = [
  /(?:加入|添加|加进|拉进|调进|并入).{0,18}(?:团队|小组|群|进来)/u,
  /(?:团队|小组|群).{0,18}(?:加入|添加|加上|拉进|调进)/u,
  /(?:把|将|让).{0,28}(?:加入|添加|加进|拉进|调进|并入|成为成员)/u,
  /(?:队员|成员).{0,16}(?:拉|加).{0,8}(?:不对|不全|少了|漏了|没进)/u,
  /(?:只拉了|只加了).{0,20}(?:一个|一名|员工|成员|队员|人进去|人进来)/u,
  /(?:没把|没有把).{0,24}(?:拉进|加进|加入|添加)/u,
  /(?:还缺|少了|漏了).{0,20}(?:员工|成员|队员)/u,
  /(?:不是有|明明有).{0,24}(?:员工|成员|设计师|开发|工程师)?.{0,12}(?:为什么|怎么).{0,10}(?:不叫|不拉|不加|不用|不选|没叫|没拉|没加|没选)/u,
  /(?:为什么|怎么).{0,16}(?:不叫|不拉|不加|不用|不选|没叫|没拉|没加|没选).{0,24}(?:员工|成员|设计师|开发|工程师|他|她|上)/u,
];

const TEAM_MEMBER_CORRECTION_RE = /(?:拉|加|选|成员|队员).{0,12}(?:不对|错了|不合理|不匹配|漏了|少了)|(?:为什么|怎么).{0,16}(?:不叫|不拉|不加|不用|不选|没叫|没拉|没加|没选)|不是有|明明有/u;

function compact(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function isTeamMemberAdditionRequest(text: string): boolean {
  const normalized = text.trim();
  return TEAM_ADDITION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isTeamMemberCorrectionRequest(text: string): boolean {
  return TEAM_MEMBER_CORRECTION_RE.test(text.trim());
}

export function resolveMentionedEmployees(text: string, employees: Employee[]): Employee[] {
  const normalized = compact(text);
  const named = employees.filter((employee) => {
    const name = compact(employee.name);
    return name.length > 0 && normalized.includes(name);
  });
  if (named.length) return named;

  // The boss often refers to a specialist by title instead of remembering the
  // employee name. Prefer the most specific matching title, not every generic
  // title such as “设计师”.
  const titleMatches = employees
    .map((employee) => ({ employee, title: compact(employee.title) }))
    .filter((item) => item.title.length >= 3 && normalized.includes(item.title))
    .sort((a, b) => b.title.length - a.title.length);
  if (titleMatches.length) {
    const mostSpecific = titleMatches[0].title.length;
    return titleMatches.filter((item) => item.title.length === mostSpecific).map((item) => item.employee);
  }

  if (!/设计师|开发|工程师|前端|后端|全栈|UI|UX|交互|视觉|策划|编剧|文案|审核|测试/iu.test(text)) return [];
  const ranked = employees
    .map((employee) => ({ employee, score: scoreEmployeeForTask(employee, text) }))
    .filter((item) => item.score >= 18)
    .sort((a, b) => b.score - a.score || a.employee.name.localeCompare(b.employee.name, 'zh-CN'));
  if (!ranked.length) return [];
  const topScore = ranked[0].score;
  return ranked.filter((item) => item.score === topScore).map((item) => item.employee);
}

export function resolveTargetProject(text: string, projects: Project[]): Project | undefined {
  const candidates = projects
    .filter((project) => project.status === 'awaiting_approval' || project.status === 'running')
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const normalized = compact(text);
  const explicit = candidates.find((project) => normalized.includes(compact(project.title)));
  if (explicit) return explicit;
  return candidates.find((project) => project.status === 'awaiting_approval') ?? candidates[0];
}

export function resolveTargetTeam(text: string, teams: Team[], recentMessages: string[] = [], preferredTeamIds: string[] = []): Team | undefined {
  const activeTeams = teams.filter((team) => !team.archived);
  const normalized = text.replace(/\s+/g, '');
  const explicit = [...activeTeams].reverse().find((team) => normalized.includes(team.name.replace(/\s+/g, '')));
  if (explicit) return explicit;

  const preferred = preferredTeamIds
    .map((teamId) => activeTeams.find((team) => team.id === teamId))
    .find((team): team is Team => !!team);
  if (preferred) return preferred;

  for (const message of [...recentMessages].reverse()) {
    const compact = message.replace(/\s+/g, '');
    const contextual = [...activeTeams].reverse().find((team) => compact.includes(team.name.replace(/\s+/g, '')));
    if (contextual) return contextual;
  }

  const refersToRecentTeam = /(?:这个|该|刚才|刚刚|刚拉的|你拉的|新建的|队员拉得|队员拉的|成员拉得|成员拉的).{0,12}(?:团队|小组|队员|成员)?/u.test(normalized);
  if (refersToRecentTeam || activeTeams.length === 1) return activeTeams.at(-1);
  return undefined;
}
