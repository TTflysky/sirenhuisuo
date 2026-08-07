import type { Employee, Project, ProjectMember, Team } from '../types';
import { matchProjectMembers, scoreEmployeeForTask } from './taskMatcher';

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
const TEAM_MEMBER_REPLACEMENT_RE = /(?:换|替换|改用|改成|不要(?:再)?用).{0,20}(?:成员|队员|员工|设计师|开发|工程师|UI|UX|前端|后端)|(?:成员|队员|员工).{0,12}(?:换成|替换成|改用)/iu;
const TEAM_MEMBER_REMOVAL_RE = /(?:移除|删除|删掉|去掉|不(?:要|用)).{0,20}(?:成员|队员|员工|设计师|开发|工程师|UI|UX|前端|后端)|(?:团队|小组|群).{0,24}(?:移除|删除|删掉|去掉)/iu;
const PROJECT_ROSTER_REMATCH_RE = /(?:人员|成员|队员|团队|人选).{0,14}(?:不对|错了|不合理|不匹配)|重新.{0,12}(?:看|分析|理解).{0,12}(?:需求|目标)|重新(?:选人|挑人|挑选|匹配|安排)|(?:框架|架构|代码|UI|UX|前端|后端|审核|测试).{0,40}(?:全没有|都没有|没拉|没选|缺少|漏了)/iu;
const EXPLICIT_NEW_PROJECT_RE = /(?:建立|创建|开发|制作|搭建|构建|实现|做)(?:一个|一款|一套|个|款|套|全新(?:的)?)?.{0,80}(?:软件|应用|app|客户端|桌面端|移动端|手机应用|平台|系统|网站|网页|小程序|项目)/iu;
const ROSTER_CORRECTION_CUE_RE = /(?:人员|成员|队员|团队|人选).{0,14}(?:不对|错了|不合理|不匹配)|重新(?:选人|挑人|挑选|匹配|安排)|重新.{0,12}(?:看|分析|理解).{0,12}(?:需求|目标)|(?:全没有|都没有|没拉|没选|漏了|少了)/u;
const PROJECT_APPROVAL_RE = /^(?:(?:可以|好(?:的)?|同意|批准|确认|按(?:这个|刚才|上面|之前)(?:的)?(?:团队|方案)?)(?:[，。！!\s]*)|(?:(?:就|按)(?:这个|刚才|上面|之前)(?:的)?(?:团队|方案)?[，,，\s]*(?:你)?(?:拉群|组队|组建团队|建群)(?:吧)?[。！!\s]*)|(?:(?:拉群|组队|组建团队|建群)(?:吧)?[。！!\s]*))$/u;

function compact(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function isTeamMemberAdditionRequest(text: string): boolean {
  const normalized = text.trim();
  return TEAM_ADDITION_PATTERNS.some((pattern) => pattern.test(normalized))
    || isTeamMemberReplacementRequest(normalized)
    || isTeamMemberRemovalRequest(normalized);
}

export function isTeamMemberCorrectionRequest(text: string): boolean {
  return TEAM_MEMBER_CORRECTION_RE.test(text.trim());
}

export function isProjectRosterRematchRequest(text: string): boolean {
  const normalized = text.trim();
  if (EXPLICIT_NEW_PROJECT_RE.test(normalized) && !ROSTER_CORRECTION_CUE_RE.test(normalized)) return false;
  return PROJECT_ROSTER_REMATCH_RE.test(normalized)
    && !isTeamMemberReplacementRequest(text)
    && !isTeamMemberRemovalRequest(text);
}

export function rematchProjectRoster(
  project: Pick<Project, 'request' | 'requiredCapabilities'>,
  correction: string,
  employees: Employee[],
): ProjectMember[] {
  const selectionRequest = [
    project.request,
    ...(project.requiredCapabilities ?? []),
    `老板对同一项目的最新纠正：${correction}`,
  ].filter(Boolean).join('\n所需能力：');
  return matchProjectMembers(employees, selectionRequest);
}

export function isTeamMemberReplacementRequest(text: string): boolean {
  return TEAM_MEMBER_REPLACEMENT_RE.test(text.trim());
}

export function isTeamMemberRemovalRequest(text: string): boolean {
  return TEAM_MEMBER_REMOVAL_RE.test(text.trim());
}

export function isProjectApprovalIntent(text: string): boolean {
  return PROJECT_APPROVAL_RE.test(text.trim());
}

function specialistDomains(employee: Employee): string[] {
  const source = `${employee.name} ${employee.title} ${employee.role} ${(employee.capabilities ?? []).join(' ')}`.toLowerCase();
  if (/ui|ux|界面|交互|视觉|设计/u.test(source)) return ['design'];
  if (/前端|react|vue|网页|网站|客户端/u.test(source)) return ['frontend'];
  if (/后端|数据库|服务端|api|安全|ai|知识库|连接器/u.test(source)) return ['architecture'];
  if (/测试|审查|审核|验收|质量/u.test(source)) return ['review'];
  if (/项目|策划|产品|协调|规划/u.test(source)) return ['scope'];
  return [`role:${employee.role}`];
}

/**
 * Applies a roster mutation without re-running project matching. The confirmed
 * list remains the source of truth; a replacement only swaps the same specialty.
 */
export function applyProjectRosterMutation(
  currentMemberIds: string[],
  mentionedEmployees: Employee[],
  employees: Employee[],
  intent: 'add' | 'replace' | 'remove',
): string[] {
  const requestedIds = [...new Set(mentionedEmployees.map((employee) => employee.id))];
  if (!requestedIds.length) return [...new Set(currentMemberIds)];
  if (intent === 'remove') return currentMemberIds.filter((id) => !requestedIds.includes(id));
  if (intent === 'add') return [...new Set([...currentMemberIds, ...requestedIds])];

  const directory = new Map(employees.map((employee) => [employee.id, employee]));
  const replacementDomains = new Set(mentionedEmployees.flatMap(specialistDomains));
  const retained = currentMemberIds.filter((employeeId) => {
    if (requestedIds.includes(employeeId)) return true;
    const existing = directory.get(employeeId);
    return !existing || !specialistDomains(existing).some((domain) => replacementDomains.has(domain));
  });
  return [...new Set([...retained, ...requestedIds])];
}

export function resolveMentionedEmployees(text: string, employees: Employee[]): Employee[] {
  const normalized = compact(text);
  const named = employees.filter((employee) => {
    const name = compact(employee.name);
    return name.length > 0 && normalized.includes(name);
  });
  if (named.length) return named;

  // A title such as "UI 设计师" is a specialty request, not a request for the
  // first generic "设计师" in the office. When there are several specialists,
  // leave the choice explicit instead of silently selecting one.
  const wantsDesignSpecialist = /ui|ux|界面|交互|视觉/iu.test(text);
  if (wantsDesignSpecialist) {
    const specialists = employees.filter((employee) => /ui|ux|界面|交互|视觉/iu.test(`${employee.title} ${(employee.capabilities ?? []).join(' ')}`));
    if (specialists.length === 1) return specialists;
    if (specialists.length > 1) return [];
  }

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

export function projectBelongsToConversation(project: Pick<Project, 'conversationId'>, conversationId?: string): boolean {
  if (!conversationId) return true;
  if (project.conversationId) return project.conversationId === conversationId;
  return conversationId === 'conversation-legacy-assistant';
}

function refersToExistingProject(text: string): boolean {
  const normalized = text.trim();
  return isProjectApprovalIntent(normalized)
    || isProjectRosterRematchRequest(normalized)
    || isTeamMemberAdditionRequest(normalized)
    || /(?:\u7ee7\u7eed|\u521a\u624d|\u8fd9\u4e2a|\u90a3\u4e2a|\u4e0a\u9762|\u4e4b\u524d|\u539f\u9879\u76ee|\u5f53\u524d\u9879\u76ee|\u5df2\u7ecf\u5efa\u7acb\u7684\u56e2\u961f|\u5f85\u5ba1\u6279\u7684\u65b9\u6848)/u.test(normalized);
}

export function resolveTargetProject(text: string, projects: Project[], conversationId?: string): Project | undefined {
  const candidates = projects
    .filter((project) => project.status === 'awaiting_approval' || project.status === 'clarifying' || project.status === 'running')
    .filter((project) => projectBelongsToConversation(project, conversationId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const normalized = compact(text);
  const explicit = candidates.find((project) => normalized.includes(compact(project.title)));
  if (explicit) return explicit;
  // A new request must never silently attach to an earlier project merely
  // because it is the most recent record. Continuity is allowed only where
  // the user has actually referred to an existing proposal/project; if several
  // remain eligible, the assistant must ask which one is intended.
  if (!refersToExistingProject(text) || candidates.length !== 1) return undefined;
  return candidates[0];
}

export function resolveLatestRejectedProject(projects: Project[], conversationId?: string): Project | undefined {
  return projects
    .filter((project) => project.status === 'archived' && Boolean(project.rejectionReason))
    .filter((project) => projectBelongsToConversation(project, conversationId))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
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
