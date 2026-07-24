import type { Employee, Team } from '../types';

const ROLE_TERMS: Record<string, string[]> = {
  pm: ['规划', '拆解', '协调', '管理', '需求', '方案', '安排', '项目'],
  planner: ['策划', '架构', '设计', '分镜', '选题', '创意', '流程', '方案'],
  coder: ['代码', '开发', '编程', '程序', '脚本', '修复', '实现', '打包', '部署'],
  checker: ['审核', '审查', '验收', '测试', '校对', '检查', '质量', '风险'],
  custom: [],
};

const DELIVERABLE_RE = /写|制作|生成|开发|实现|脚本|文案|方案|代码|视频|分镜|报告|文件|修复|优化|设计/u;
const EVERYONE_RE = /各位|所有人|全员|大家|全部员工|报数/u;
const DOMAIN_RULES: Array<{ request: RegExp; profile: RegExp; score: number }> = [
  { request: /脚本|剧本|故事|文案|选题/u, profile: /编剧|脚本|文案|创作|策划|故事/u, score: 14 },
  { request: /镜头|分镜|拍摄|视频|抖音/u, profile: /镜头|分镜|摄影|导演|视频|剪辑|落地/u, score: 12 },
  { request: /代码|开发|程序|修复|打包/u, profile: /代码|开发|程序|工程|前端|后端|全栈/u, score: 14 },
  { request: /视觉|海报|界面|UI|设计/u, profile: /视觉|设计|UI|美术|交互/u, score: 14 },
  { request: /分析|数据|调研|研究/u, profile: /分析|数据|研究|调研/u, score: 12 },
];

function scoreEmployee(employee: Employee, request: string): number {
  const text = request.toLowerCase();
  const profile = `${employee.name} ${employee.title} ${employee.prompt ?? ''} ${employee.soul ?? ''}`.toLowerCase();
  let score = 0;
  for (const rule of DOMAIN_RULES) if (rule.request.test(request) && rule.profile.test(profile)) score += rule.score;
  for (const term of ROLE_TERMS[employee.role] ?? []) if (text.includes(term)) score += 3;
  const meaningful = [...new Set(text.match(/[\p{Script=Han}]{2,6}|[a-z][a-z0-9_-]{2,}/gu) ?? [])].slice(0, 40);
  for (const term of meaningful) if (profile.includes(term)) score += term.length >= 4 ? 4 : 2;
  if (employee.role === 'custom' && meaningful.some((term) => profile.includes(term))) score += 2;
  return score;
}

export function matchTeamMembers(team: Team, employees: Employee[], request: string, explicitIds: string[] = []): string[] {
  const online = team.memberIds.map((id) => employees.find((item) => item.id === id)).filter((item): item is Employee => !!item && item.isOnline);
  const explicit = [...new Set(explicitIds)].filter((id) => online.some((item) => item.id === id));
  if (explicit.length) return explicit;
  if (EVERYONE_RE.test(request)) return online.map((item) => item.id);
  const ranked = online.map((employee) => ({ employee, score: scoreEmployee(employee, request) })).sort((a, b) => b.score - a.score);
  const best = ranked.filter((item) => item.score > 0).slice(0, 2).map((item) => item.employee.id);
  if (!best.length) {
    const lead = online.find((item) => item.role === 'pm') ?? online[0];
    if (lead) best.push(lead.id);
  }
  if (DELIVERABLE_RE.test(request)) {
    const reviewer = online.find((item) => (item.role === 'checker' || /审查|审核|验收|测试|质检|校对/u.test(`${item.title} ${item.prompt ?? ''}`)) && !best.includes(item.id));
    if (reviewer) best.push(reviewer.id);
  }
  return best.slice(0, 3);
}

export function requiresValidation(request: string): boolean {
  return DELIVERABLE_RE.test(request);
}
