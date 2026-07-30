import type { Employee } from '../types';
import { findExpertCatalogEntry } from './expertCatalog';

export type EmployeeCategoryId =
  | 'product'
  | 'design'
  | 'engineering'
  | 'data-ai'
  | 'content'
  | 'growth'
  | 'business'
  | 'finance-law'
  | 'people-education'
  | 'geo'
  | 'support';

export interface EmployeeCategory {
  id: EmployeeCategoryId;
  label: string;
  shortLabel: string;
}

export interface EmployeeBadgeProfile {
  categoryId: EmployeeCategoryId;
  summary: string;
  detail: string;
  abilities: string[];
}

export const EMPLOYEE_CATEGORIES: EmployeeCategory[] = [
  { id: 'product', label: '产品与项目', shortLabel: '产品项目' },
  { id: 'design', label: '设计与体验', shortLabel: '设计体验' },
  { id: 'engineering', label: '研发与技术', shortLabel: '研发技术' },
  { id: 'data-ai', label: '数据与 AI', shortLabel: '数据 AI' },
  { id: 'content', label: '内容与媒体', shortLabel: '内容媒体' },
  { id: 'growth', label: '营销与增长', shortLabel: '营销增长' },
  { id: 'business', label: '商业与客户', shortLabel: '商业客户' },
  { id: 'finance-law', label: '财务与法务', shortLabel: '财务法务' },
  { id: 'people-education', label: '人才与教育', shortLabel: '人才教育' },
  { id: 'geo', label: 'GIS 与空间', shortLabel: 'GIS 空间' },
  { id: 'support', label: '综合支持', shortLabel: '综合支持' },
];

const CAPABILITY_LABELS: Record<string, string> = {
  ui_ux: 'UI/UX 设计',
  frontend: '前端实现',
  backend: '后端架构',
  content: '内容创作',
  research: '研究分析',
  office_document: '办公文档',
  connector: '连接集成',
  skill: 'Skill 编排',
  coding: '代码开发',
  review: '质量审查',
  coordination: '项目协调',
  team_coordination: '团队调度',
};

const CATEGORY_RULES: Array<{ id: EmployeeCategoryId; pattern: RegExp }> = [
  { id: 'geo', pattern: /gis|地理|空间数据|遥感|地图|测绘|定位|地球/u },
  { id: 'finance-law', pattern: /财务|金融|会计|审计|税务|法务|法律|合规|风控|投资/u },
  { id: 'people-education', pattern: /人力|招聘|人才|组织|培训|教育|教师|学习|课程|教研/u },
  { id: 'design', pattern: /ui|ux|设计|视觉|交互|体验|品牌|插画|动效|创意总监/u },
  { id: 'data-ai', pattern: /人工智能|\bai\b|机器学习|算法|数据科学|数据分析|大模型|智能体|向量|知识图谱/u },
  { id: 'engineering', pattern: /工程|开发|前端|后端|全栈|架构|程序|代码|测试|运维|安全|云|数据库|游戏/u },
  { id: 'content', pattern: /内容|文案|写作|编辑|媒体|视频|播客|摄影|出版|叙事|社交媒体/u },
  { id: 'growth', pattern: /营销|增长|市场|广告|seo|投放|公关|活动|品牌传播/u },
  { id: 'business', pattern: /销售|商务|客户|电商|零售|供应链|采购|客服|支持|成功经理/u },
  { id: 'product', pattern: /产品|项目|规划|策划|协调|管理|运营|需求|战略/u },
];

function compactText(value: string | undefined, limit: number): string {
  const text = String(value ?? '')
    .replace(/^#+\s*/gmu, '')
    .replace(/\*\*/gu, '')
    .replace(/[`|]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit).trim()}...` : text;
}

function inferAbilities(employee: Employee, source: string): string[] {
  const explicit = (employee.capabilities ?? []).map((item) => CAPABILITY_LABELS[item] ?? item.replaceAll('_', ' '));
  if (explicit.length) return [...new Set(explicit)].slice(0, 5);
  const rules: Array<[string, RegExp]> = [
    ['项目协调', /项目|协调|计划|管理|运营/u],
    ['UI/UX 设计', /ui|ux|设计|视觉|交互/u],
    ['前端实现', /前端|react|vue|网页|界面/u],
    ['后端架构', /后端|服务端|数据库|接口|api/u],
    ['数据分析', /数据|分析|研究|洞察/u],
    ['AI 工程', /人工智能|\bai\b|模型|智能体|算法/u],
    ['内容创作', /内容|文案|写作|媒体|视频/u],
    ['质量审查', /测试|审查|审核|质量|验收|安全/u],
    ['连接集成', /连接|集成|知识库|mcp|平台/u],
  ];
  const inferred = rules.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
  if (inferred.length) return inferred.slice(0, 5);
  return [employee.title || '综合协作'];
}

export function employeeCategoryId(employee: Employee): EmployeeCategoryId {
  const expert = employee.catalogId ? findExpertCatalogEntry(employee.catalogId) : undefined;
  const source = `${expert?.domain ?? ''} ${expert?.title ?? ''} ${employee.title} ${(employee.capabilities ?? []).join(' ')}`.toLowerCase();
  return CATEGORY_RULES.find((rule) => rule.pattern.test(source))?.id ?? 'support';
}

export function employeeBadgeProfile(employee: Employee): EmployeeBadgeProfile {
  const expert = employee.catalogId ? findExpertCatalogEntry(employee.catalogId) : undefined;
  const source = `${expert?.domain ?? ''} ${expert?.title ?? ''} ${expert?.summary ?? ''} ${employee.title} ${employee.prompt ?? ''} ${(employee.capabilities ?? []).join(' ')}`.toLowerCase();
  const summary = compactText(expert?.summary || employee.prompt, 72)
    || `${employee.title || '综合员工'}，负责与岗位相关的专业执行和团队协作。`;
  const detail = compactText(expert?.summary || employee.soul || employee.prompt, 360)
    || `${employee.name} 当前没有补充详细能力说明，可在员工编辑页完善提示词或人格资料。`;
  return {
    categoryId: employeeCategoryId(employee),
    summary,
    detail,
    abilities: inferAbilities(employee, source),
  };
}

