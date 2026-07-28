import type { Employee, Team } from '../types';

const TEAM_ADDITION_PATTERNS = [
  /(?:加入|添加|加进|拉进|调进|并入).{0,18}(?:团队|小组|群|进来)/u,
  /(?:团队|小组|群).{0,18}(?:加入|添加|加上|拉进|调进)/u,
  /(?:把|将|让).{0,28}(?:加入|添加|加进|拉进|调进|并入|成为成员)/u,
  /(?:队员|成员).{0,16}(?:拉|加).{0,8}(?:不对|不全|少了|漏了|没进)/u,
  /(?:只拉了|只加了).{0,20}(?:一个|一名|员工|成员|队员|人进去|人进来)/u,
  /(?:没把|没有把).{0,24}(?:拉进|加进|加入|添加)/u,
  /(?:还缺|少了|漏了).{0,20}(?:员工|成员|队员)/u,
];

export function isTeamMemberAdditionRequest(text: string): boolean {
  const normalized = text.trim();
  return TEAM_ADDITION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function resolveMentionedEmployees(text: string, employees: Employee[]): Employee[] {
  const normalized = text.replace(/\s+/g, '');
  return employees.filter((employee) => {
    const name = employee.name.trim().replace(/\s+/g, '');
    return name.length > 0 && (normalized.includes(name) || normalized.includes(`@${name}`));
  });
}

export function resolveTargetTeam(text: string, teams: Team[], recentMessages: string[] = []): Team | undefined {
  const activeTeams = teams.filter((team) => !team.archived);
  const normalized = text.replace(/\s+/g, '');
  const explicit = [...activeTeams].reverse().find((team) => normalized.includes(team.name.replace(/\s+/g, '')));
  if (explicit) return explicit;

  for (const message of [...recentMessages].reverse()) {
    const compact = message.replace(/\s+/g, '');
    const contextual = [...activeTeams].reverse().find((team) => compact.includes(team.name.replace(/\s+/g, '')));
    if (contextual) return contextual;
  }

  const refersToRecentTeam = /(?:这个|该|刚才|刚刚|刚拉的|你拉的|新建的|队员拉得|队员拉的|成员拉得|成员拉的).{0,12}(?:团队|小组|队员|成员)?/u.test(normalized);
  if (refersToRecentTeam || activeTeams.length === 1) return activeTeams.at(-1);
  return undefined;
}
