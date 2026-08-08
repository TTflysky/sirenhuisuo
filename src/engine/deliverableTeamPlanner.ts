import type { Employee, ProjectBrief, TaskPlanStep } from '../types';
import {
  capabilityCoverage,
  capabilityLabel,
  inferCapabilityIds,
  normalizeCapabilityId,
  selectCapabilityOwner,
} from './capabilityGraph.mjs';
import type { TaskDecision } from './taskDecisionKernel.mjs';
import { inferDeliverableType, type TurnDeliverableType } from './turnRuntime.mjs';

export interface DeliverablePlanInput {
  goal: string;
  employees: Employee[];
  memberIds: string[];
  decision?: TaskDecision;
  brief?: ProjectBrief;
}

export interface DeliverablePlanResult {
  version: number;
  steps: TaskPlanStep[];
  selectedMemberIds: string[];
  capabilityGaps: string[];
  deliverableIds: string[];
  parallelGroups: string[][];
}

type SourceDeliverable = {
  id: string;
  label: string;
  objective: string;
  type: TurnDeliverableType;
  acceptanceCriteria: string[];
  requiredCapabilities: string[];
  dependsOn: string[];
  outputPath?: string;
  verification: string[];
};

const PLAN_VERSION = 1;

function compact(value: unknown, limit = 1200): string {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function unique(values: Array<string | undefined>, limit = 24): string[] {
  return [...new Set(values.map((value) => compact(value, 500)).filter(Boolean))].slice(0, limit);
}

function stableId(value: unknown, index: number): string {
  const normalized = compact(value, 120).replace(/[^a-zA-Z0-9._:-]+/gu, '-').replace(/^-+|-+$/gu, '');
  return normalized || `deliverable-${index + 1}`;
}

function normalizedType(value: unknown, fallback: TurnDeliverableType): TurnDeliverableType {
  return ['answer', 'file', 'connection', 'operation', 'decision', 'mixed'].includes(String(value))
    ? value as TurnDeliverableType
    : fallback;
}

function defaultVerification(type: TurnDeliverableType): string[] {
  if (type === 'file') return ['回读输出文件并确认路径、内容和格式正确', '运行适用的语法、构建或打开检查'];
  if (type === 'connection') return ['执行真实连接测试并保存成功响应证据'];
  if (type === 'operation') return ['读取操作后的真实状态，确认动作已经生效'];
  return ['对照完成条件回读结果，确认结论直接回应目标'];
}

function sourceDeliverables(input: DeliverablePlanInput): SourceDeliverable[] {
  const fallbackType = input.decision?.deliverableType ?? inferDeliverableType(undefined, input.goal);
  const decisionItems = input.decision?.deliverables?.filter((item) => item.required !== false) ?? [];
  if (decisionItems.length) {
    return decisionItems.map((item, index) => {
      const id = stableId(item.id || item.label, index);
      const label = compact(item.label, 240) || `交付物 ${index + 1}`;
      const type = normalizedType(item.type, fallbackType);
      const itemCapabilities = unique((item.requiredCapabilities ?? []).map((capability) => normalizeCapabilityId(capability) || capability));
      return {
        id,
        label,
        objective: compact(item.objective, 1600) || `完成并验证“${label}”，使其能被最终交付直接使用。`,
        type,
        acceptanceCriteria: unique(item.acceptanceCriteria?.length ? item.acceptanceCriteria : input.decision?.acceptanceCriteria ?? []),
        requiredCapabilities: itemCapabilities.length ? itemCapabilities : inferCapabilityIds(`${label} ${item.objective ?? ''}`),
        dependsOn: unique(item.dependsOn ?? [], 16),
        outputPath: compact(item.outputPath, 500) || undefined,
        verification: unique(item.verification?.length ? item.verification : defaultVerification(type)),
      };
    });
  }

  const briefItems = input.brief?.stages?.filter((stage) => stage.id !== 'integration' && stage.id !== 'review') ?? [];
  if (briefItems.length) {
    return briefItems.map((stage, index) => ({
      id: stableId(stage.id || stage.title, index),
      label: compact(stage.title, 240),
      objective: compact(stage.objective, 1600),
      type: normalizedType(input.brief?.deliverableType, fallbackType),
      acceptanceCriteria: unique([stage.acceptance]),
      requiredCapabilities: unique(stage.requiredCapabilities ?? inferCapabilityIds(`${stage.title} ${stage.objective}`)),
      dependsOn: unique(stage.dependsOnStageIds ?? [], 16),
      outputPath: compact(stage.outputPath, 500) || undefined,
      verification: unique(stage.expectedEvidence?.length ? stage.expectedEvidence : defaultVerification(fallbackType)),
    }));
  }

  return [{
    id: 'primary-deliverable',
    label: compact(input.goal, 240) || '完成用户目标',
    objective: compact(input.goal, 1600),
    type: fallbackType,
    acceptanceCriteria: unique(input.decision?.acceptanceCriteria ?? ['完整满足用户目标', '留下与交付类型匹配的验证证据']),
    requiredCapabilities: unique(input.decision?.requiredCapabilities ?? inferCapabilityIds(input.goal)),
    dependsOn: [],
    verification: defaultVerification(fallbackType),
  }];
}

function chooseOwner(members: Employee[], capabilities: string[], load: Map<string, number>): Employee | undefined {
  const normalized = unique(capabilities.map((value) => normalizeCapabilityId(value) || value));
  const specialist = normalized.map((capability) => selectCapabilityOwner(members.map((member) => ({ ...member, currentLoad: load.get(member.id) ?? 0 })), capability)).find(Boolean);
  if (specialist) return specialist;
  return [...members].sort((left, right) => {
    const leftCoverage = capabilityCoverage(left, normalized).covered.length;
    const rightCoverage = capabilityCoverage(right, normalized).covered.length;
    return rightCoverage - leftCoverage || (load.get(left.id) ?? 0) - (load.get(right.id) ?? 0) || left.stationIndex - right.stationIndex;
  })[0];
}

function contractFor(deliverable: SourceDeliverable, inputRefs: string[], maxReworkAttempts = 2): NonNullable<TaskPlanStep['taskContract']> {
  return {
    contractVersion: 1,
    inputRefs,
    output: { type: deliverable.type, path: deliverable.outputPath, description: deliverable.label },
    completionConditions: deliverable.acceptanceCriteria,
    verification: deliverable.verification,
    budget: { maxModelRounds: 8, maxToolCalls: 24, maxReworkAttempts },
    escalationConditions: ['达到最大返工次数仍未通过验证', '发现跨责任边界冲突或需要改变项目目标', '需要外部发送、付费、删除、账号授权或敏感数据'],
  };
}

function topologicalGroups(steps: TaskPlanStep[]): string[][] {
  const pending = new Map(steps.map((step) => [step.id, step]));
  const completed = new Set<string>();
  const groups: string[][] = [];
  while (pending.size) {
    const ready = [...pending.values()].filter((step) => step.dependsOnStepIds.every((id) => completed.has(id)));
    if (!ready.length) break;
    groups.push(ready.map((step) => step.id));
    for (const step of ready) { pending.delete(step.id); completed.add(step.id); }
  }
  return groups;
}

export function compileDeliverableTeamPlan(input: DeliverablePlanInput): DeliverablePlanResult {
  const members = input.memberIds.map((id) => input.employees.find((employee) => employee.id === id)).filter((employee): employee is Employee => Boolean(employee));
  if (!members.length) return { version: PLAN_VERSION, steps: [], selectedMemberIds: [], capabilityGaps: unique(input.decision?.requiredCapabilities ?? []), deliverableIds: [], parallelGroups: [] };
  const deliverables = sourceDeliverables(input);
  const ids = new Set(deliverables.map((item) => item.id));
  for (const item of deliverables) item.dependsOn = item.dependsOn.filter((dependency) => ids.has(dependency) && dependency !== item.id);
  const load = new Map<string, number>();
  const gaps = new Set<string>();
  const steps: TaskPlanStep[] = deliverables.map((deliverable, index) => {
    const owner = chooseOwner(members, deliverable.requiredCapabilities, load) ?? members[0];
    load.set(owner.id, (load.get(owner.id) ?? 0) + 1);
    const coverage = capabilityCoverage(owner, deliverable.requiredCapabilities);
    coverage.missing.forEach((capability) => gaps.add(capability));
    const inputRefs = deliverable.dependsOn.map((dependency) => `verified:${dependency}`);
    return {
      id: deliverable.id,
      employeeId: owner.id,
      order: index + 1,
      kind: 'work',
      title: deliverable.label,
      assignment: [
        `责任交付物：${deliverable.label}`,
        `目标：${deliverable.objective}`,
        inputRefs.length ? `只在这些前置证据完成后开始：${inputRefs.join('、')}` : '当前交付物没有前置依赖，可以立即开始。',
        deliverable.outputPath ? `唯一输出路径：${deliverable.outputPath}` : '输出必须登记到当前项目产物索引；不得写入其他项目。',
        `完成条件：${deliverable.acceptanceCriteria.join('；')}`,
        `验证方式：${deliverable.verification.join('；')}`,
        '在责任边界内自行完成“实现 → 验证 → 修复”；达到返工上限或跨越安全边界时再升级。',
      ].join('\n'),
      deliverableType: deliverable.type,
      dependsOnStepIds: [...deliverable.dependsOn],
      acceptanceCriteria: [...deliverable.acceptanceCriteria],
      requiredCapabilities: [...deliverable.requiredCapabilities],
      expectedEvidence: [...deliverable.verification],
      outputPath: deliverable.outputPath,
      maxRetries: 2,
      taskContract: contractFor(deliverable, inputRefs),
    };
  });

  const coordinator = selectCapabilityOwner(members, 'coordination') ?? members[0];
  const integrationId = 'integration';
  const briefIntegrationAcceptance = input.brief?.stages?.find((stage) => stage.id === integrationId)?.acceptance;
  const integrationCriteria = unique(
    input.decision?.acceptanceCriteria?.length
      ? input.decision.acceptanceCriteria
      : briefIntegrationAcceptance
        ? [briefIntegrationAcceptance]
        : ['全部必需交付物已回读并通过验证', '最终结果直接满足原始目标'],
  );
  const integrationSource: SourceDeliverable = {
    id: integrationId,
    label: '主代理整合与完成检查',
    objective: `持续持有原目标“${compact(input.goal, 500)}”，回读所有成员产物并完成集成，不把成员提交直接当作项目完成。`,
    type: input.decision?.deliverableType ?? inferDeliverableType(undefined, input.goal),
    acceptanceCriteria: integrationCriteria,
    requiredCapabilities: ['coordination'],
    dependsOn: steps.map((step) => step.id),
    verification: ['逐项回读必需交付物和证据', '执行最终构建、运行或一致性检查', '确认没有未解决阻塞或失效审批'],
  };
  steps.push({
    id: integrationId, employeeId: coordinator.id, order: steps.length + 1, kind: 'work', title: integrationSource.label,
    assignment: `${integrationSource.objective}\n前置交付物：${integrationSource.dependsOn.join('、')}\n完成条件：${integrationCriteria.join('；')}\n不得只汇总成员回复；必须回读产物并运行最终验证。`,
    deliverableType: integrationSource.type, dependsOnStepIds: [...integrationSource.dependsOn], acceptanceCriteria: integrationCriteria,
    requiredCapabilities: ['coordination'], expectedEvidence: integrationSource.verification, maxRetries: 2,
    taskContract: contractFor(integrationSource, integrationSource.dependsOn.map((id) => `verified:${id}`)),
  });

  const reviewer = selectCapabilityOwner(members.filter((member) => member.id !== coordinator.id), 'review');
  if (reviewer) {
    const reviewSource: SourceDeliverable = {
      id: 'final-review', label: '独立最终验收', objective: '独立核对原始目标、交付物、核心操作和验证证据，明确 PASS 或退回责任节点。',
      type: 'decision', acceptanceCriteria: integrationCriteria, requiredCapabilities: ['review'], dependsOn: [integrationId],
      verification: ['核对全部完成条件', '退回时必须指出责任步骤、失败证据和需要返工的范围'],
    };
    steps.push({
      id: reviewSource.id, employeeId: reviewer.id, order: steps.length + 1, kind: 'review', title: reviewSource.label,
      assignment: `${reviewSource.objective}\n只有证据通过才能提交 PASS；REJECT 必须回到原责任成员，不得把失败转成新项目。`,
      deliverableType: 'decision', dependsOnStepIds: [integrationId], acceptanceCriteria: integrationCriteria,
      requiredCapabilities: ['review'], expectedEvidence: reviewSource.verification, maxRetries: 1,
      taskContract: contractFor(reviewSource, [`verified:${integrationId}`], 1),
    });
  }

  return {
    version: PLAN_VERSION,
    steps,
    selectedMemberIds: unique(steps.map((step) => step.employeeId)),
    capabilityGaps: [...gaps],
    deliverableIds: deliverables.map((item) => item.id),
    parallelGroups: topologicalGroups(steps),
  };
}

export function summarizeDeliverablePlan(plan: DeliverablePlanResult): string {
  const firstParallel = plan.parallelGroups[0]?.length ?? 0;
  return `交付物计划 v${plan.version}：${plan.deliverableIds.length} 个责任交付物，${plan.selectedMemberIds.length} 名实际负责人，首批可并行 ${firstParallel} 项${plan.capabilityGaps.length ? `；仍缺能力 ${plan.capabilityGaps.map(capabilityLabel).join('、')}` : ''}。`;
}
