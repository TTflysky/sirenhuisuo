import { inferDeliverableType, type TurnDeliverableType } from './turnRuntime.mjs';
import { inferCapabilityIds } from './capabilityGraph.mjs';
import type { ProjectBrief, ProjectMember } from '../types';

type BriefDeliverable = {
  id?: string;
  label: string;
  type?: string;
  objective?: string;
  acceptanceCriteria?: string[];
  requiredCapabilities?: string[];
  dependsOn?: string[];
  outputPath?: string;
  verification?: string[];
};

function compact(value: unknown, limit = 220): string {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

/** A stable planning artifact. Planning never substitutes for execution evidence. */
export function buildProfessionalProjectBrief(input: {
  request: string;
  members: ProjectMember[];
  deliverables?: BriefDeliverable[];
  expectedOutputs?: string[];
  acceptanceCriteria?: string[];
  requiredCapabilities?: string[];
}): ProjectBrief {
  const request = compact(input.request, 4000);
  const memberIds = input.members.map((member) => member.employeeId).filter(Boolean);
  const deliverableType: TurnDeliverableType = inferDeliverableType(undefined, request);
  const declared = input.deliverables?.filter((item) => item.label?.trim()) ?? [];
  const fallbackOutputs = input.expectedOutputs?.filter(Boolean).length ? input.expectedOutputs.filter(Boolean) : ['与原始目标一致的可验证结果'];
  const source: BriefDeliverable[] = declared.length
    ? declared
    : fallbackOutputs.map((label, index) => ({ id: `deliverable-${index + 1}`, label }));
  const stages = source.map((item, index) => {
    const id = compact(item.id || `deliverable-${index + 1}`, 120).replace(/[^a-zA-Z0-9._:-]+/gu, '-') || `deliverable-${index + 1}`;
    const capabilities = item.requiredCapabilities?.filter(Boolean).length
      ? item.requiredCapabilities.filter(Boolean)
      : inferCapabilityIds(`${item.label} ${item.objective ?? ''}`, source.length === 1 ? input.requiredCapabilities : []);
    return {
      id,
      title: compact(item.label, 220),
      objective: compact(item.objective, 1200) || `独立完成并验证“${compact(item.label, 220)}”。`,
      deliverables: [compact(item.label, 220)],
      acceptance: item.acceptanceCriteria?.filter(Boolean).join('；') || input.acceptanceCriteria?.filter(Boolean).join('；') || '产出真实存在，经过回读或运行验证，并能直接用于最终交付。',
      memberIds,
      dependsOnStageIds: item.dependsOn?.filter(Boolean) ?? [],
      requiredCapabilities: capabilities,
      expectedEvidence: item.verification?.filter(Boolean) ?? [],
      outputPath: compact(item.outputPath, 500) || undefined,
      maxReworkAttempts: 2,
      escalationConditions: ['连续返工仍未通过验证', '跨越外部发送、付费、删除或授权边界'],
    };
  });
  stages.push({
    id: 'integration',
    title: '主代理整合与完成检查',
    objective: '回读全部成员产物，完成集成和最终验证；成员提交不等于项目完成。',
    deliverables: ['最终交付与证据摘要'],
    acceptance: input.acceptanceCriteria?.filter(Boolean).join('；') || '全部必需交付物及核心验证证据通过，且最终结果回应原始目标。',
    memberIds,
    dependsOnStageIds: stages.map((item) => item.id),
    requiredCapabilities: ['coordination'],
    expectedEvidence: ['交付物回读记录', '最终构建、运行或一致性检查'],
    outputPath: undefined,
    maxReworkAttempts: 2,
    escalationConditions: ['发现目标冲突或需要用户业务选择'],
  });
  return {
    version: 2,
    createdAt: Date.now(),
    goal: request,
    deliverableType,
    summary: `章北海将围绕 ${source.length} 个真实交付物建立最小责任团队；无依赖项有限并行，最终由主代理整合验收。`,
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
    ...brief.stages.map((item, index) => `${index + 1}. ${item.title}：${item.objective}；交付 ${item.deliverables.join('、')}；验收 ${item.acceptance}${item.dependsOnStageIds?.length ? `；依赖 ${item.dependsOnStageIds.join('、')}` : '；无前置依赖'}`),
  ].join('\n');
}
