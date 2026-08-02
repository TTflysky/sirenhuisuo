const CAPABILITY_GRAPH_VERSION = 3;

const CAPABILITIES = Object.freeze({
  ui_ux: { label: 'UI/UX 与交互设计', patterns: [/(?:^|[^a-z])ui\s*[/+·-]?\s*ux(?:[^a-z]|$)|(?:^|[^a-z])(?:ui|ux)(?:[^a-z]|$)|交互|界面|视觉设计|用户体验|产品设计|原型设计/iu] },
  frontend: { label: '前端与移动端实现', patterns: [/前端|网页开发|网站开发|安卓|android|移动端|移动应用|手机应用|flutter|react\s*native|kotlin|swift|web\s*(?:developer|frontend)|react|vue|svelte|html|css|桌面端开发/iu] },
  backend: { label: '后端、AI 与服务', patterns: [/后端|服务端|接口开发|数据库|人工智能|ai\s*工程|机器学习|模型接入|图像生成模型|图片生成模型|api\s*(?:developer|engineer)|node\.js|java|python|golang|全栈/iu] },
  architecture: { label: '软件与系统架构', patterns: [/软件架构|系统架构|技术架构|架构设计|系统设计|solution\s*architect|software\s*architect|system\s*architect/iu] },
  content: { label: '内容创作', patterns: [/文案|编剧|脚本|策划|写作|内容创作|故事|分镜/iu] },
  research: { label: '调研分析', patterns: [/调研|研究|数据分析|行业分析|资料分析|检索|信息搜集/iu] },
  office_document: { label: '办公文档交付', patterns: [/word|excel|powerpoint|ppt|pdf|办公文档|表格|报告排版/iu] },
  connector: { label: '连接器、模型与知识库', patterns: [/连接器|知识库|obsidian|ima|mcp|外部服务|模型接口|图片生成|图像生成|ai\s*接口|api\s*接入/iu] },
  skill: { label: 'Skill 选择与安装', patterns: [/skill|技能库|技能安装|插件/iu] },
  coding: { label: '软件工程', patterns: [/代码|开发|编程|程序|脚本|修复|构建|测试|重构|打包/iu] },
  review: { label: '审查与验收', patterns: [/审查|审核|验收|测试|质检|校对|质量/iu] },
  coordination: { label: '任务协调', patterns: [/项目管理|任务协调|拆解|调度|团队管理|进度管理/iu] },
});

const ALIASES = Object.freeze({
  ui: 'ui_ux', ux: 'ui_ux', ui_ux_design: 'ui_ux', design: 'ui_ux',
  web_frontend: 'frontend', frontend_implementation: 'frontend',
  server: 'backend', backend_development: 'backend',
  architect: 'architecture', software_architecture: 'architecture', system_architecture: 'architecture',
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

const CAPABILITY_ORDER = Object.freeze([
  'coordination', 'architecture', 'ui_ux', 'frontend', 'backend', 'coding', 'review',
  'research', 'content', 'office_document', 'connector', 'skill',
]);
const NEW_SOFTWARE_PRODUCT_RE = /(?:做|开发|创建|制作|搭建|构建|研发|实现).{0,32}(?:一个|一款|一套|个|款|套)?\s*(?:软件|应用程序|应用|app|客户端|桌面端|安卓端|android|移动端|手机应用|图片生成器|平台|系统|网站|网页|小程序|管理后台|控制台)|(?:软件|应用程序|应用|app|客户端|桌面端|安卓端|android|移动端|手机应用|图片生成器|平台|系统|网站|网页|小程序|管理后台|控制台).{0,32}(?:开发|创建|制作|搭建|构建|研发)/iu;
const USER_FACING_PRODUCT_RE = /客户端|桌面端|安卓|android|移动端|移动应用|手机应用|应用程序|应用|(?:^|[^a-z])app(?:[^a-z]|$)|网站|网页|小程序|管理后台|控制台|前端/iu;
const SERVICE_PRODUCT_RE = /平台|发布|账号|用户|登录|权限|存储|同步|内容管理|支付|数据|知识库|云端|协作|服务|接口|api|模型|图片生成|图像生成|ai/iu;
const SPECIALTY_PATTERNS = Object.freeze({
  coordination: /产品经理|项目经理|项目管理|交付经理|协调者/iu,
  architecture: /软件架构师|系统架构师|技术架构师|解决方案架构师|架构设计/iu,
  ui_ux: /ui\s*[/+·-]?\s*ux|ui\s*设计|ux\s*设计|交互设计|视觉设计|用户体验|产品设计|原型设计/iu,
  frontend: /前端开发|前端工程|客户端开发|桌面端开发|安卓开发|android开发|移动端开发|移动应用开发|手机应用开发|flutter|react\s*native|网页开发|网站开发|web\s*(?:developer|frontend)/iu,
  backend: /后端架构|后端开发|后端工程|服务端|ai工程|人工智能工程|模型接入|图像生成|api\s*(?:developer|engineer)|数据库架构/iu,
  coding: /软件工程师|开发工程师|实现工程师|程序员|编码者/iu,
  review: /qa|测试工程|质量工程|质量保证|审查者|验收/iu,
});
const IDENTITY_CRITICAL_CAPABILITIES = new Set([
  'coordination', 'architecture', 'ui_ux', 'frontend', 'backend', 'review',
]);

function orderedCapabilities(values) {
  const ids = unique(values);
  return ids.sort((left, right) => {
    const leftIndex = CAPABILITY_ORDER.indexOf(left);
    const rightIndex = CAPABILITY_ORDER.indexOf(right);
    return (leftIndex < 0 ? CAPABILITY_ORDER.length : leftIndex) - (rightIndex < 0 ? CAPABILITY_ORDER.length : rightIndex);
  });
}

function specializationScore(member, capabilityId) {
  const identity = `${member?.name ?? ''} ${member?.title ?? ''}`;
  if (capabilityId === 'review' && /(?:^|[^a-z])qa(?:[^a-z]|$)|审查者|质量保证|验收负责人/iu.test(identity)) return 150;
  if (SPECIALTY_PATTERNS[capabilityId]?.test(identity)) return 120;
  // Stable operating roles are stronger evidence than migrated capability
  // labels, which may describe adjacent skills rather than ownership.
  if (capabilityId === 'coordination' && member?.role === 'pm') return 90;
  if (capabilityId === 'review' && member?.role === 'checker') return 90;
  if (Array.isArray(member?.capabilities) && member.capabilities.map(normalizeCapabilityId).includes(capabilityId)) return 55;
  if (capabilityId === 'architecture' && member?.role === 'planner') return 35;
  if (capabilityId === 'coding' && member?.role === 'coder') return 35;
  return 0;
}

function hasSpecialistIdentity(member, capabilityId) {
  return specializationScore(member, capabilityId) >= 120;
}

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
  if (NEW_SOFTWARE_PRODUCT_RE.test(source)) {
    ids.push('coordination', 'architecture', 'coding', 'review');
    if (USER_FACING_PRODUCT_RE.test(source)) ids.push('ui_ux', 'frontend');
    if (SERVICE_PRODUCT_RE.test(source)) ids.push('backend');
  }
  return orderedCapabilities(ids);
}

export function employeeCapabilityProfile(member) {
  const source = profile(member);
  const identity = `${member?.name ?? ''} ${member?.title ?? ''} ${member?.role ?? ''}`.toLowerCase();
  const explicit = Array.isArray(member?.capabilities) ? member.capabilities.map(normalizeCapabilityId) : [];
  const inferred = [];
  for (const [id, capability] of Object.entries(CAPABILITIES)) {
    // Long role prompts often mention adjacent disciplines as dependencies.
    // Team composition therefore infers core delivery specialties from stable
    // identity fields; prompts remain useful only for broad supporting skills.
    const specialtySource = ['ui_ux', 'frontend', 'backend', 'architecture', 'review'].includes(id) ? identity : source;
    if (!capability.patterns.some((pattern) => pattern.test(specialtySource))) continue;
    if (id === 'ui_ux' && !/(?:^|[^a-z])ui\s*[/+·-]?\s*ux(?:[^a-z]|$)|(?:^|[^a-z])(?:ui|ux)(?:[^a-z]|$)|交互设计|视觉设计|用户体验|产品设计|原型设计|界面设计/iu.test(identity)) continue;
    if (id === 'frontend' && !/前端开发|网页开发|网站开发|客户端开发|桌面端开发|安卓|android|移动端|移动应用|手机应用|flutter|react\s*native|kotlin|swift|react|vue|svelte|web\s*(?:developer|frontend)/iu.test(identity)) continue;
    if (id === 'architecture' && !/软件架构|系统架构|技术架构|解决方案架构|架构设计|系统设计|software\s*architect|system\s*architect/iu.test(identity)) continue;
    if (id === 'review' && !/qa|测试工程|测试员|质量工程|质量保证|审查者|代码审查|验收/iu.test(identity)) continue;
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

export function selectCapabilityOwner(members, capability) {
  const capabilityId = normalizeCapabilityId(capability);
  if (!capabilityId) return undefined;
  const candidates = (Array.isArray(members) ? members : [])
    .filter((member) => member?.id && employeeCapabilityProfile(member).includes(capabilityId));
  const specialistAvailable = IDENTITY_CRITICAL_CAPABILITIES.has(capabilityId)
    && candidates.some((member) => hasSpecialistIdentity(member, capabilityId));
  return candidates
    .filter((member) => !specialistAvailable || hasSpecialistIdentity(member, capabilityId))
    .map((member) => ({
      member,
      specialization: specializationScore(member, capabilityId),
      load: Math.max(0, Number(member.currentLoad ?? member.activeTaskCount) || 0) + (member.isWorking === true ? 1 : 0),
    }))
    .sort((left, right) => right.specialization - left.specialization
      || left.load - right.load
      || String(left.member.name || '').localeCompare(String(right.member.name || ''), 'zh-CN'))[0]?.member;
}

export function selectCapabilityTeam(members, input = {}) {
  const allCandidates = (Array.isArray(members) ? members : []).filter((member) => member?.id);
  const candidates = allCandidates.filter((member) => member.isOnline !== false);
  const request = text(input.request ?? input.goal, 8000);
  const required = inferCapabilityIds(request, input.requiredCapabilities);
  const explicitIds = unique(Array.isArray(input.explicitMemberIds) ? input.explicitMemberIds : []);
  const selected = allCandidates.filter((member) => explicitIds.includes(member.id));
  const selectedIds = new Set(selected.map((member) => member.id));
  const specialistAvailable = new Map(required.map((capabilityId) => [
    capabilityId,
    IDENTITY_CRITICAL_CAPABILITIES.has(capabilityId)
      && candidates.some((member) => hasSpecialistIdentity(member, capabilityId)),
  ]));
  const canOwnCapability = (member, capabilityId) => employeeCapabilityProfile(member).includes(capabilityId)
    && (!specialistAvailable.get(capabilityId) || hasSpecialistIdentity(member, capabilityId));
  const effectiveCoverage = (member) => required.filter((capabilityId) => canOwnCapability(member, capabilityId));
  const uncovered = new Set(required.filter((id) => !selected.some((member) => canOwnCapability(member, id))));
  const ranked = candidates.filter((member) => !selectedIds.has(member.id)).map((member) => {
    const coverage = capabilityCoverage(member, required);
    const exactName = request.includes(member.name) ? 100 : 0;
    const availability = member.isWorking ? -5 : 5;
    return { member, coverage, score: exactName + coverage.covered.length * 30 + coverage.ratio * 20 + availability };
  }).sort((left, right) => right.score - left.score || left.member.stationIndex - right.member.stationIndex || left.member.name.localeCompare(right.member.name, 'zh-CN'));
  for (const capabilityId of required) {
    if (!uncovered.has(capabilityId)) continue;
    const next = ranked
      .filter((item) => !selectedIds.has(item.member.id) && canOwnCapability(item.member, capabilityId))
      .sort((left, right) => specializationScore(right.member, capabilityId) - specializationScore(left.member, capabilityId)
        || right.score - left.score
        || left.member.stationIndex - right.member.stationIndex
        || left.member.name.localeCompare(right.member.name, 'zh-CN'))[0];
    if (!next) continue;
    selected.push(next.member);
    selectedIds.add(next.member.id);
    effectiveCoverage(next.member).forEach((id) => uncovered.delete(id));
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
      covers: effectiveCoverage(member),
      reason: request.includes(member.name) ? '用户明确指定' : `能力覆盖：${effectiveCoverage(member).map((id) => CAPABILITIES[id]?.label || id).join('、') || '团队协调'}`,
    })),
    uncoveredCapabilities: [...uncovered],
    complete: uncovered.size === 0,
  };
}

export function capabilityLabel(id) { return CAPABILITIES[normalizeCapabilityId(id)]?.label || text(id, 120); }
export const TAIJI_CAPABILITY_GRAPH_VERSION = CAPABILITY_GRAPH_VERSION;
export const TAIJI_CAPABILITIES = CAPABILITIES;
