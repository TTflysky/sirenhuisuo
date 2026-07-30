import type { Employee, ExpertCatalogEntry, OpcRoleId } from '../types';
import { ROLE_SCARF } from '../types';
import { AGENCY_EXPERT_CATALOG } from './generatedExpertCatalog';
import { AVATAR_FRAME_PRESETS } from './avatarFrames';

export { AGENCY_EXPERT_CATALOG } from './generatedExpertCatalog';

const ROLE_BY_DOMAIN: Array<[RegExp, OpcRoleId]> = [
  [/工程|测试|安全|空间计算|游戏开发/u, 'coder'],
  [/项目管理|产品|销售|支持|人力资源/u, 'pm'],
  [/设计|营销|金融|法务|供应链|学术|专项|GIS/u, 'planner'],
];

function roleForExpert(expert: ExpertCatalogEntry): OpcRoleId {
  return ROLE_BY_DOMAIN.find(([pattern]) => pattern.test(expert.domain))?.[1] ?? 'custom';
}

function expertCapabilities(expert: ExpertCatalogEntry): string[] {
  const source = `${expert.name} ${expert.title} ${expert.summary}`.toLowerCase();
  const rules: Array<[string, RegExp]> = [
    ['ui_ux', /ui|ux|界面设计|视觉设计|交互设计|用户体验|产品设计|原型设计/u],
    ['frontend', /前端|react|vue|网页|网站|客户端/u],
    ['backend', /后端|服务端|数据库|api|云基础设施/u],
    ['architecture', /软件架构|系统架构|技术架构|解决方案架构|架构设计|系统设计/u],
    ['content', /内容|文案|写作|视频|叙事/u],
    ['research', /研究|调研|分析|数据/u],
    ['office_document', /报告|文档|ppt|pdf|表格/u],
    ['connector', /集成|连接器|知识库|mcp|开放平台/u],
    ['skill', /skill|技能|插件/u],
    ['coding', /工程|开发|代码|编程|构建|自动化/u],
    ['review', /测试|审查|审核|质量|验收|qa/u],
    ['coordination', /项目管理|协调|产品经理|交付/u],
  ];
  return rules.filter(([, pattern]) => pattern.test(source)).map(([capability]) => capability);
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const EXPERT_FRAME_IDS = AVATAR_FRAME_PRESETS
  .filter((frame) => !['slacking', 'vacation', 'intern', 'emeritus'].includes(frame.id))
  .map((frame) => frame.id);

export function expertToEmployee(expert: ExpertCatalogEntry, visualSeed = 0, stationIndex = -1): Employee {
  const role = roleForExpert(expert);
  const hash = stableHash(`${expert.id}:${visualSeed}`);
  return {
    id: expert.id,
    catalogId: expert.id,
    source: 'catalog',
    name: expert.name,
    title: expert.domain,
    role,
    avatar: `a${String((hash % 10) + 1).padStart(2, '0')}`,
    avatarKind: 'preset',
    statusColor: ROLE_SCARF[role],
    avatarFrame: { presetId: EXPERT_FRAME_IDS[hash % EXPERT_FRAME_IDS.length] },
    stationIndex,
    prompt: `${expert.summary}\n\n专业工作规则：\n${expert.instructions}`,
    isOnline: true,
    isWorking: false,
    capabilities: expertCapabilities(expert),
  };
}

/** Adds every built-in expert to the real office roster without touching user-created profiles. */
export function materializeCatalogEmployees(employees: Employee[]): { employees: Employee[]; added: Employee[] } {
  const existingIds = new Set(employees.map((employee) => employee.id));
  const usedStations = new Set(employees.map((employee) => employee.stationIndex).filter((index) => Number.isSafeInteger(index) && index >= 0));
  let nextStation = 0;
  const allocateStation = () => {
    while (usedStations.has(nextStation)) nextStation += 1;
    const station = nextStation;
    usedStations.add(station);
    nextStation += 1;
    return station;
  };
  const added = AGENCY_EXPERT_CATALOG
    .filter((expert) => !existingIds.has(expert.id))
    .map((expert, index) => expertToEmployee(expert, employees.length + index, allocateStation()));
  return { employees: added.length ? [...employees, ...added] : employees, added };
}

export function findExpertCatalogEntry(id: string): ExpertCatalogEntry | undefined {
  return AGENCY_EXPERT_CATALOG.find((expert) => expert.id === id || expert.agentId === id);
}

export function searchableExpertCatalog(query = ''): ExpertCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return AGENCY_EXPERT_CATALOG;
  return AGENCY_EXPERT_CATALOG.filter((expert) => `${expert.name} ${expert.title} ${expert.domain} ${expert.summary} ${expert.agentId}`.toLowerCase().includes(needle));
}

/** Combines mutable office employees with immutable catalog candidates for planning only. */
export function employeePlanningPool(employees: Employee[]): Employee[] {
  const knownIds = new Set(employees.map((employee) => employee.id));
  return [
    ...employees,
    ...AGENCY_EXPERT_CATALOG.filter((expert) => !knownIds.has(expert.id))
      .map((expert, index) => expertToEmployee(expert, employees.length + index)),
  ];
}
