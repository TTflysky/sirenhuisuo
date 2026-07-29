const CAPABILITY_GRAPH_VERSION = 2;

const CAPABILITIES = Object.freeze({
  ui_ux: { label: 'UI/UX 与交互设计', patterns: [/(?:^|[^a-z])ui\s*[/+·-]?\s*ux(?:[^a-z]|$)|(?:^|[^a-z])(?:ui|ux)(?:[^a-z]|$)|交互|界面|视觉设计|用户体验|产品设计|原型设计/iu] },
  frontend: { label: '前端实现', patterns: [/前端|网页开发|网站开发|web\s*(?:developer|frontend)|react|vue|svelte|html|css|桌面端开发/iu] },
  backend: { label: '后端与服务', patterns: [/后端|服务端|接口开发|数据库|api\s*(?:developer|engineer)|node\.js|java|python|golang|全栈/iu] },
  content: { label: '内容创作', patterns: [/文案|编剧|脚本|策划|写作|内容创作|故事|分镜/iu] },
  research: { label: '调研分析', patterns: [/调研|研究|数据分析|行业分析|资料分析|检索|信息搜集/iu] },
  office_document: { label: '办公文档交付', patterns: [/word|excel|powerpoint|ppt|pdf|办公文档|表格|报告排版/iu] },
  connector: { label: '连接器与知识库', patterns: [/连接器|知识库|obsidian|ima|mcp|外部服务|api\s*接入/iu] },
  skill: { label: 'Skill 选择与安装', patterns: [/skill|技能库|技能安装|插件/iu] },
  coding: { label: '软件工程', patterns: [/代码|开发|编程|程序|脚本|修复|构建|测试|重构|打包/iu] },
  review: { label: '审查与验收', patterns: [/审查|审核|验收|测试|质检|校对|质量/iu] },
  coordination: { label: '任务协调', patterns: [/项目管理|任务协调|拆解|调度|团队管理|进度管理/iu] },
});

const ALIASES = Object.freeze({
  ui: 'ui_ux', ux: 'ui_ux', ui_ux_design: 'ui_ux', design: 'ui_ux',
  web_frontend: 'frontend', frontend_implementation: 'frontend',
  server: 'backend', backend_development: 'backend',
  web_research: 'research', data_analysis: 'research',
  file_output: 'office_document', document: 'office_document',
  connector_access: 'connector', knowledge_base: 'connector',
  skill_selection: 'skill', skill_installation: 'skill',
  command_execution: 'coding', software_engineering: 'coding',
  validation: 'review', quality_assurance: 'review',
  team_coordination: 'coordination', project_management: 'coordination',
});

function text(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function profile(member) { return `${member?.name ?? ''} ${member?.title ?? ''} ${member?.role ?? ''} ${member?.prompt ?? ''} ${member?.soul ?? ''}`.toLowerCase(); }

export function normalizeCapabilityId(value) {
  const raw = text(value, 120).toLowerCase().replace(/[\s/+.·-]+/gu, '_');
  if (CAPABILITIES[raw]) return raw;
  if (ALIASES[raw]) return ALIASES[raw];
  for (const [id, capability] of Object.entries(CAPABILITIES)) {
    if (capability.patterns.some((pattern) => pattern.test(String(value)))) return id;
  }
  return '';
}

export function inferCapabilityIds(input, provided = []) {
  const source = text(input, 8000);
  const ids = (Array.isArray(provided) ? provided : []).map(normalizeCapabilityId);
  for (const [id, capability] of Object.entries(CAPABILITIES)) {
    if (capability.patterns.some((pattern) => pattern.test(source))) ids.push(id);
  }
  const uiTask = ids.includes('ui_ux');
  if (uiTask && /改造|开发|实现|制作|重构|修改|优化|搭建|编写|落地|升级/u.test(source)) ids.push('frontend');
  return unique(ids);
}

export function employeeCapabilityProfile(member) {
  const source = profile(member);
  const explicit = Array.isArray(member?.capabilities) ? member.capabilities.map(normalizeCapabilityId) : [];
  const inferred = [];
  for (const [id, capability] of Object.entries(CAPABILITIES)) {
    if (!capability.patterns.some((pattern) => pattern.test(source))) continue;
    if (id === 'frontend' && !/前端开发|网页开发|网站开发|客户端开发|桌面端开发|工程师|react|vue|svelte|html|css|javascript|typescript|代码|编程|实现/iu.test(source)) continue;
    inferred.push(id);
  }
  if (member?.role === 'checker') inferred.push('review');
  if (member?.role === 'pm') inferred.push('coordination');
  if (member?.role === 'coder') inferred.push('coding');
  if (member?.role === 'planner') inferred.push('coordination');
  return unique([...explicit, ...inferred]);
}

export function capabilityCoverage(member, requiredCapabilities = []) {
  const profileIds = employeeCapabilityProfile(member);
  const required = unique(requiredCapabilities.map(normalizeCapabilityId));
  const covered = required.filter((id) => profileIds.includes(id));
  return { profile: profileIds, covered, missing: required.filter((id) => !covered.includes(id)), ratio: required.length ? covered.length / required.length : 0 };
}

export function selectCapabilityTeam(members, input = {}) {
  const allCandidates = (Array.isArray(members) ? members : []).filter((member) => member?.id);
  const candidates = allCandidates.filter((member) => member.isOnline !== false);
  const request = text(input.request ?? input.goal, 8000);
  const required = inferCapabilityIds(request, input.requiredCapabilities);
  const explicitIds = unique(Array.isArray(input.explicitMemberIds) ? input.explicitMemberIds : []);
  const selected = allCandidates.filter((member) => explicitIds.includes(member.id));
  const selectedIds = new Set(selected.map((member) => member.id));
  const uncovered = new Set(required.filter((id) => !selected.some((member) => employeeCapabilityProfile(member).includes(id))));
  const ranked = candidates.filter((member) => !selectedIds.has(member.id)).map((member) => {
    const coverage = capabilityCoverage(member, required);
    const exactName = request.includes(member.name) ? 100 : 0;
    const availability = member.isWorking ? -5 : 5;
    return { member, coverage, score: exactName + coverage.covered.length * 30 + coverage.ratio * 20 + availability };
  }).sort((left, right) => right.score - left.score || left.member.stationIndex - right.member.stationIndex || left.member.name.localeCompare(right.member.name, 'zh-CN'));
  while (uncovered.size) {
    const next = ranked.find((item) => !selectedIds.has(item.member.id) && item.coverage.covered.some((id) => uncovered.has(id)));
    if (!next) break;
    selected.push(next.member);
    selectedIds.add(next.member.id);
    next.coverage.covered.forEach((id) => uncovered.delete(id));
  }
  if (!selected.length && input.requiresTeam === true) {
    const coordinator = ranked.find((item) => item.coverage.profile.includes('coordination')) ?? ranked[0];
    if (coordinator) { selected.push(coordinator.member); selectedIds.add(coordinator.member.id); }
  }
  if (input.requiresReview === true && !selected.some((member) => employeeCapabilityProfile(member).includes('review'))) {
    const reviewer = ranked.find((item) => !selectedIds.has(item.member.id) && item.coverage.profile.includes('review'));
    if (reviewer) { selected.push(reviewer.member); selectedIds.add(reviewer.member.id); }
  }
  return {
    graphVersion: CAPABILITY_GRAPH_VERSION,
    requiredCapabilities: required,
    selected: selected.map((member) => ({
      employeeId: member.id,
      employeeName: member.name,
      capabilities: employeeCapabilityProfile(member),
      covers: capabilityCoverage(member, required).covered,
      reason: request.includes(member.name) ? '用户明确指定' : `能力覆盖：${capabilityCoverage(member, required).covered.map((id) => CAPABILITIES[id]?.label || id).join('、') || '团队协调'}`,
    })),
    uncoveredCapabilities: [...uncovered],
    complete: uncovered.size === 0,
  };
}

export function capabilityLabel(id) { return CAPABILITIES[normalizeCapabilityId(id)]?.label || text(id, 120); }
export const TAIJI_CAPABILITY_GRAPH_VERSION = CAPABILITY_GRAPH_VERSION;
export const TAIJI_CAPABILITIES = CAPABILITIES;
