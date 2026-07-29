import type { Employee, Team } from '../types';

export type LocalOfficeQuery = 'employee_count' | 'employee_roster' | 'employee_online' | 'team_count' | 'team_roster';

export function classifyLocalOfficeQuery(text: string): LocalOfficeQuery | undefined {
  const input = text.trim();
  if (!input) return undefined;
  const asksCount = /多少(?:个|名|人)?|几(?:个|名|人)|人数|数量|总数|一共/u.test(input);
  const asksRoster = /有哪些|都有谁|有谁|谁在|名单|列出|人员构成|员工(?:都有谁|名单)|团队成员/u.test(input);
  const asksOnline = /谁在线|在线(?:的)?(?:有谁|员工|人数|名单)|哪些人在线|谁没在线|离线(?:的)?(?:有谁|员工|人数|名单)/u.test(input);
  const teamTarget = /团队|小组|项目组/u.test(input);
  const employeeTarget = /办公室|会所|员工|同事|工位|人手/u.test(input);

  if (asksOnline && employeeTarget) return 'employee_online';
  if (teamTarget && asksCount) return 'team_count';
  if (teamTarget && asksRoster) return 'team_roster';
  if (employeeTarget && asksCount) return 'employee_count';
  if (employeeTarget && asksRoster) return 'employee_roster';
  return undefined;
}

function orderedEmployees(employees: Employee[]): Employee[] {
  return [...employees].sort((a, b) => a.stationIndex - b.stationIndex || a.name.localeCompare(b.name, 'zh-CN'));
}

function employeeLine(employee: Employee): string {
  const workState = employee.isOnline ? (employee.isWorking ? '工作中' : '在线') : '离线';
  return `${employee.name}（${employee.title}，${workState}）`;
}

export function formatLocalOfficeAnswer(query: LocalOfficeQuery, employees: Employee[], teams: Team[]): string {
  const roster = orderedEmployees(employees);
  const activeTeams = teams.filter((team) => !team.archived);
  if (query === 'employee_count') {
    const online = roster.filter((employee) => employee.isOnline);
    const names = roster.length <= 20 ? `\n当前员工：${roster.map(employeeLine).join('、')}。` : '';
    return `我刚刚直接读取了当前客户端的办公室员工目录：共有 ${roster.length} 名员工，其中 ${online.length} 名在线、${roster.length - online.length} 名离线。助理本身不计入员工人数。${names}`;
  }
  if (query === 'employee_online') {
    const online = roster.filter((employee) => employee.isOnline);
    const offline = roster.filter((employee) => !employee.isOnline);
    return `当前在线 ${online.length} 名：${online.length ? online.map(employeeLine).join('、') : '暂无'}。${offline.length ? `\n离线 ${offline.length} 名：${offline.map(employeeLine).join('、')}。` : ''}`;
  }
  if (query === 'employee_roster') {
    return roster.length
      ? `办公室当前共有 ${roster.length} 名员工：\n${roster.map((employee, index) => `${index + 1}. ${employeeLine(employee)}`).join('\n')}`
      : '当前客户端的办公室员工目录还是空的。';
  }
  if (query === 'team_count') {
    return `当前共有 ${activeTeams.length} 个未归档团队：${activeTeams.length ? activeTeams.map((team) => `${team.name}（${team.memberIds.length} 人）`).join('、') : '暂无'}。`;
  }
  return activeTeams.length
    ? `当前未归档团队：\n${activeTeams.map((team, index) => `${index + 1}. ${team.name}（${team.memberIds.length} 人）`).join('\n')}`
    : '当前没有未归档团队。';
}
