import type { Employee, ProjectMember, TaskPlanStep, Team } from '../types';

export type TaskCapability = 'ui_ux' | 'frontend' | 'backend' | 'content' | 'research';

const ROLE_TERMS: Record<string, string[]> = {
  pm: ['规划', '拆解', '协调', '管理', '需求', '方案', '安排', '项目'],
  planner: ['策划', '架构', '设计', '分镜', '选题', '创意', '流程', '方案'],
  coder: ['代码', '开发', '编程', '程序', '脚本', '修复', '实现', '打包', '部署'],
  checker: ['审核', '审查', '验收', '测试', '校对', '检查', '质量', '风险'],
  custom: [],
};

const DELIVERABLE_RE = /写|制作|生成|开发|实现|脚本|文案|方案|代码|视频|分镜|报告|文件|修复|优化|设计|改造|重构|升级/u;
const EVERYONE_RE = /各位|所有人|全员|大家|全部员工|报数/u;
const DOMAIN_RULES: Array<{ request: RegExp; profile: RegExp; score: number }> = [
  { request: /脚本|剧本|故事|文案|选题/u, profile: /编剧|脚本|文案|创作|策划|故事/u, score: 14 },
  { request: /镜头|分镜|拍摄|视频|抖音/u, profile: /镜头|分镜|摄影|导演|视频|剪辑|落地/u, score: 12 },
  { request: /代码|开发|程序|修复|打包/u, profile: /代码|开发|程序|工程|前端|后端|全栈/u, score: 14 },
  // “设计”本身太宽泛，幼师、活动策划等职位也可能包含这个词。
  // UI 任务必须命中 UI/UX、交互、界面或视觉等专业信号。
  { request: /视觉|海报|界面|UI|UX|交互/u, profile: /视觉设计|界面设计|UI|UX|交互|用户体验|原型|美术/u, score: 18 },
  { request: /分析|数据|调研|研究/u, profile: /分析|数据|研究|调研/u, score: 12 },
];

const IMPLEMENTATION_ACTION_RE = /改造|开发|实现|制作|重构|修改|优化|搭建|编写|落地|升级/u;
const CAPABILITY_PROFILE_RULES: Record<TaskCapability, RegExp> = {
  ui_ux: /(?:^|[^a-z])ui\s*[/+·-]?\s*ux(?:[^a-z]|$)|(?:^|[^a-z])ui(?:[^a-z]|$)|(?:^|[^a-z])ux(?:[^a-z]|$)|交互设计|界面设计|视觉设计|用户体验|产品设计|原型设计|美术/u,
  frontend: /前端|网页开发|网站开发|web\s*(?:developer|frontend)|react|vue|svelte|html|css|客户端开发|桌面端开发/iu,
  backend: /后端|服务端|接口开发|数据库|api\s*(?:developer|engineer)|node\.js|java|python|golang|全栈/iu,
  content: /文案|编剧|脚本|策划|写作|内容创作|故事|分镜/u,
  research: /调研|研究|数据分析|行业分析|资料分析|检索/u,
};

function normalizeProfile(employee: Employee): string {
  return `${employee.name} ${employee.title} ${employee.prompt ?? ''} ${employee.soul ?? ''}`.toLowerCase();
}

export function inferTaskCapabilities(request: string): TaskCapability[] {
  const result: TaskCapability[] = [];
  const uiTask = /(?:^|[^a-z])ui(?:[^a-z]|$)|(?:^|[^a-z])ux(?:[^a-z]|$)|界面|交互|视觉|用户体验|原型|前端设计/u.test(request);
  const explicitFrontend = /前端|网页|网站|web\s*(?:page|app|site|frontend)|客户端界面|桌面端界面|操作系统界面/iu.test(request);
  if (uiTask) result.push('ui_ux');
  if (explicitFrontend || (uiTask && IMPLEMENTATION_ACTION_RE.test(request))) result.push('frontend');
  if (/后端|服务端|接口|数据库|api|全栈/iu.test(request)) result.push('backend');
  if (/文案|脚本|剧本|故事|内容|分镜|选题/u.test(request)) result.push('content');
  if (/调研|研究|分析|数据|资料|检索/u.test(request)) result.push('research');
  return [...new Set(result)];
}

export function scoreEmployeeCapability(employee: Employee, capability: TaskCapability): number {
  const profile = normalizeProfile(employee);
  if (!CAPABILITY_PROFILE_RULES[capability].test(profile)) return 0;
  const title = employee.title.toLowerCase();
  let score = CAPABILITY_PROFILE_RULES[capability].test(title) ? 28 : 18;
  if (capability === 'ui_ux' && /ui\s*[/+·-]?\s*ux|交互设计|界面设计|用户体验/u.test(title)) score += 12;
  if (capability === 'frontend' && /前端|web\s*frontend/iu.test(title)) score += 10;
  if (capability === 'backend' && /后端|服务端|全栈/u.test(title)) score += 10;
  return score;
}

export function scoreEmployeeForTask(employee: Employee, request: string): number {
  const text = request.toLowerCase();
  const profile = normalizeProfile(employee);
  let score = 0;
  for (const rule of DOMAIN_RULES) if (rule.request.test(request) && rule.profile.test(profile)) score += rule.score;
  for (const capability of inferTaskCapabilities(request)) score += scoreEmployeeCapability(employee, capability);
  for (const term of ROLE_TERMS[employee.role] ?? []) if (text.includes(term)) score += 3;
  const meaningful = [...new Set(text.match(/[\p{Script=Han}]{2,6}|[a-z][a-z0-9_-]{2,}/gu) ?? [])].slice(0, 40);
  for (const term of meaningful) if (profile.includes(term)) score += term.length >= 4 ? 4 : 2;
  if (employee.role === 'custom' && meaningful.some((term) => profile.includes(term))) score += 2;
  return score;
}

function rankEmployees(employees: Employee[], request: string) {
  const capabilities = inferTaskCapabilities(request);
  return employees
    .map((employee) => ({
      employee,
      score: scoreEmployeeForTask(employee, request),
      coverage: capabilities.filter((capability) => scoreEmployeeCapability(employee, capability) > 0).length,
    }))
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.employee.stationIndex - b.employee.stationIndex || a.employee.name.localeCompare(b.employee.name, 'zh-CN'));
}

export function matchTeamMembers(team: Team, employees: Employee[], request: string, explicitIds: string[] = []): string[] {
  const members = team.memberIds.map((id) => employees.find((item) => item.id === id)).filter((item): item is Employee => !!item);
  const online = members.filter((item) => item.isOnline);
  const explicit = [...new Set(explicitIds)].filter((id) => members.some((item) => item.id === id));
  if (explicit.length) return explicit;
  if (EVERYONE_RE.test(request)) return online.map((item) => item.id);
  const ranked = rankEmployees(online, request);
  // A name in the user's request is an explicit assignment, even when the
  // employee's role metadata does not contain the task keywords.
  const named = members.filter((employee) => request.includes(employee.name));
  const best = [...new Set(named.map((employee) => employee.id))];
  if (!named.length) {
    // Satisfy required capabilities before adding generalists. One employee can
    // cover multiple capabilities, then the next ranked specialist supplements it.
    for (const capability of inferTaskCapabilities(request)) {
      const specialist = ranked.find((item) => scoreEmployeeCapability(item.employee, capability) > 0);
      if (specialist && !best.includes(specialist.employee.id)) best.push(specialist.employee.id);
    }
    for (const item of ranked) {
      if (best.length >= 2) break;
      if (item.score > 0 && !best.includes(item.employee.id)) best.push(item.employee.id);
    }
  }
  if (!best.length) {
    const lead = online.find((item) => item.role === 'pm') ?? online[0];
    if (lead) best.push(lead.id);
  }
  if (DELIVERABLE_RE.test(request)) {
    const reviewer = online.find((item) => (item.role === 'checker' || /审查|审核|验收|测试|质检|校对/u.test(`${item.title} ${item.prompt ?? ''}`)) && !best.includes(item.id));
    if (reviewer) best.push(reviewer.id);
  }
  return named.length > 0 ? best : best.slice(0, 3);
}

export function matchProjectMembers(employees: Employee[], request: string): ProjectMember[] {
  // Explicitly named employees remain selectable even when currently offline;
  // the project UI can show that state and the execution preflight can report it.
  const pool: Team = { id: 'project-match', name: '项目匹配', memberIds: employees.map((item) => item.id), chatMessages: [], tasks: [] };
  const selected = matchTeamMembers(pool, employees, request);
  const capabilities = inferTaskCapabilities(request);
  return selected.map((employeeId, index) => {
    const employee = employees.find((item) => item.id === employeeId);
    const covered = employee
      ? capabilities.filter((capability) => scoreEmployeeCapability(employee, capability) > 0)
      : [];
    const reason = employee?.role === 'checker'
      ? '负责最终审查与验收'
      : covered.length
        ? `覆盖任务必需能力：${covered.map((capability) => ({ ui_ux: 'UI/UX 与交互设计', frontend: '前端实现', backend: '后端实现', content: '内容创作', research: '调研分析' }[capability])).join('、')}`
      : index === 0
        ? `与「${request.slice(0, 24)}」的职责匹配度最高`
        : `补充 ${employee?.title ?? '专项'} 能力并承接前序产出`;
    return { employeeId, reason };
  });
}

export function requiresValidation(request: string): boolean {
  return DELIVERABLE_RE.test(request);
}

function isReviewer(employee: Employee): boolean {
  return employee.role === 'checker' || /审查|审核|验收|测试|质检|校对/u.test(`${employee.title} ${employee.prompt ?? ''}`);
}

function outputInstruction(request: string): string {
  if (/脚本|剧本|文案|故事/u.test(request)) return '使用 write_file 交付完整 Markdown 文稿，文件名清楚体现主题与版本。';
  if (/分镜|镜头|拍摄|视频/u.test(request)) return '使用 write_file 交付分镜或拍摄清单，逐项包含时长、画面、台词/音效和执行备注。';
  if (/代码|开发|程序|修复/u.test(request)) return '使用 write_file 交付可运行的代码或明确的修改文件，不得只在聊天中描述实现。';
  return '使用 write_file 交付可交接的文件，文件名清楚体现任务主题。';
}

export function buildTaskPlan(team: Team, employees: Employee[], request: string, explicitIds: string[] = []): TaskPlanStep[] {
  const selectedIds = matchTeamMembers(team, employees, request, explicitIds);
  const selected = selectedIds.map((id) => employees.find((item) => item.id === id)).filter((item): item is Employee => !!item);
  const ordered = [...selected.filter((item) => !isReviewer(item)), ...selected.filter(isReviewer)];
  const stamp = Date.now();
  const steps: TaskPlanStep[] = [];
  for (const employee of ordered) {
    const review = isReviewer(employee) && requiresValidation(request);
    const previous = steps.at(-1);
    const assignment = review
      ? `审查本任务所有已有产出，必须实际读取前序成员提交的文件或结果。逐项检查是否满足老板原始要求。最后严格输出 REVIEW_RESULT: PASS；若不通过则输出 REVIEW_RESULT: REJECT、RESPONSIBLE: 责任员工姓名、REASON: 具体问题。`
      : previous
        ? `读取并继承「${previous.title}」的真实产出，在此基础上完成你负责的部分。不得只回复“收到”或描述计划，必须调用合适工具形成可交接结果。${outputInstruction(request)} 你的职责：${employee.title}。`
        : `作为第一责任人理解老板的完整要求，先主动检索可用 Skill，再完成主要产出。不得只描述计划，必须调用合适工具形成可交接结果。${outputInstruction(request)} 你的职责：${employee.title}。`;
    steps.push({
      id: `step-${stamp}-${steps.length + 1}-${employee.id}`,
      employeeId: employee.id,
      order: steps.length + 1,
      kind: review ? 'review' : 'work',
      title: review ? `${employee.name} · 最终审查` : `${employee.name} · ${employee.title}`,
      assignment,
      dependsOnStepIds: previous ? [previous.id] : [],
    });
  }
  return steps;
}
