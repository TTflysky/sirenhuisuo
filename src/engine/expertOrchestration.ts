import { inferDeliverableType, type TurnDeliverableType } from './turnRuntime.mjs';
import type { ProjectBrief, ProjectMember } from '../types';

const IMPLEMENTATION_RE = /开发|实现|代码|客户端|网页|网站|系统|接口|集成|修复|优化/u;
const DESIGN_RE = /设计|ui|ux|交互|产品|原型|体验/u;
const RESEARCH_RE = /调研|研究|分析|方案|咨询|报告/u;

function compact(value: unknown, limit = 220): string {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function stage(id: string, title: string, objective: string, deliverables: string[], acceptance: string, memberIds: string[]) {
  return { id, title, objective, deliverables, acceptance, memberIds };
}

/** A stable planning artifact. Planning never substitutes for execution evidence. */
export function buildProfessionalProjectBrief(input: { request: string; members: ProjectMember[] }): ProjectBrief {
  const request = compact(input.request, 4000);
  const memberIds = input.members.map((member) => member.employeeId).filter(Boolean);
  const deliverableType: TurnDeliverableType = inferDeliverableType(undefined, request);
  const stages = [
    stage('scope', '需求与范围', '澄清目标、边界、约束与完成标准。', ['项目简报', '关键假设与待确认项'], '需求可被后续专业角色引用，未确认项被明确标记。', memberIds.slice(0, 2)),
  ];
  if (DESIGN_RE.test(request) || IMPLEMENTATION_RE.test(request)) {
    stages.push(stage('professional-plan', '专业方案', '由匹配专家形成产品、体验、技术或业务方案。', ['专业建议', '方案版本与取舍'], '建议与任务目标一致，能直接指导下一阶段。', memberIds));
  }
  if (IMPLEMENTATION_RE.test(request)) {
    stages.push(stage('implementation', '实现与集成', '把已批准方案落实为可运行的变更、文件或连接。', ['真实产物', '运行或连接记录'], '产物已落盘或操作已真实执行，并保留证据。', memberIds));
  } else if (RESEARCH_RE.test(request)) {
    stages.push(stage('research', '调研与归纳', '核实外部或本地资料，形成可追溯结论。', ['结论摘要', '来源或本地证据'], '结论区分事实、判断和仍待验证内容。', memberIds));
  }
  stages.push(stage('review', '验收与交付', '按任务语义核对产物和证据，形成明确交接结论。', ['验收结论', '交付摘要'], deliverableType === 'answer' || deliverableType === 'decision' ? '结论完整、可理解且回应原目标。' : '存在与目标匹配的真实执行或产出证据。', memberIds));
  return {
    version: 1,
    createdAt: Date.now(),
    goal: request,
    deliverableType,
    summary: `章北海将先组织 ${memberIds.length} 位匹配专家完成专业方案，经你批准后进入可验证执行。`,
    assumptions: [],
    openQuestions: /(?:是否|还是|吗|？|\?)/u.test(request) ? ['任务中包含待确认选择；需要时将以明确问题提交给你。'] : [],
    stages,
  };
}

export function briefExecutionContext(brief?: ProjectBrief): string {
  if (!brief?.stages.length) return '';
  return [
    '## 已批准的项目简报',
    `目标：${compact(brief.goal, 2000)}`,
    `交付类型：${brief.deliverableType || 'answer'}`,
    ...brief.stages.map((item, index) => `${index + 1}. ${item.title}：${item.objective}；交付 ${item.deliverables.join('、')}；验收 ${item.acceptance}`),
  ].join('\n');
}
