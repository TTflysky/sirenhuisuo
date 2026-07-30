import type { Employee, ProjectMember, TaskPlanStep, Team } from '../types';
import {
  capabilityCoverage,
  capabilityLabel,
  employeeCapabilityProfile,
  inferCapabilityIds,
  selectCapabilityTeam,
  type CapabilityId,
} from './capabilityGraph.mjs';
import { inferDeliverableType, type TurnDeliverableType } from './turnRuntime.mjs';

export type TaskCapability = CapabilityId;

const EVERYONE_RE = /各位|所有人|全员|大家|全部员工|报数/u;
const IMPLEMENTATION_RE = /改造|开发|实现|制作|重构|修改|优化|搭建|编写|落地|升级|修复/u;
const IMPLEMENTATION_OBJECT_RE = /前端|后端|网页|网站|客户端|桌面端|界面|代码|程序|脚本|文档|报告|word|excel|ppt|pdf/iu;

function taskDeliverableType(request: string): TurnDeliverableType {
  const inferred = inferDeliverableType(undefined, request);
  if (inferred !== 'answer') return inferred;
  if (IMPLEMENTATION_RE.test(request) && IMPLEMENTATION_OBJECT_RE.test(request)) return 'file';
  return inferred;
}

export function inferTaskCapabilities(request: string): TaskCapability[] {
  return inferCapabilityIds(request);
}

export function scoreEmployeeCapability(employee: Employee, capability: TaskCapability): number {
  const coverage = capabilityCoverage(employee, [capability]);
  return coverage.covered.length ? 40 : 0;
}

export function scoreEmployeeForTask(employee: Employee, request: string): number {
  const required = inferTaskCapabilities(request);
  const coverage = capabilityCoverage(employee, required);
  const named = request.includes(employee.name) ? 100 : 0;
  const availability = employee.isOnline === false ? -20 : employee.isWorking ? -2 : 5;
  return named + coverage.covered.length * 40 + Math.round(coverage.ratio * 20) + availability;
}

function explicitMemberIds(members: Employee[], request: string, requested: string[]): string[] {
  return [...new Set([
    ...requested,
    ...members.filter((employee) => request.includes(employee.name)).map((employee) => employee.id),
  ])].filter((id) => members.some((member) => member.id === id));
}

export function matchTeamMembers(team: Team, employees: Employee[], request: string, requestedIds: string[] = []): string[] {
  const members = team.memberIds.map((id) => employees.find((item) => item.id === id)).filter((item): item is Employee => !!item);
  if (EVERYONE_RE.test(request)) return members.filter((member) => member.isOnline).map((member) => member.id);
  const explicitIds = explicitMemberIds(members, request, requestedIds);
  const deliverableType = taskDeliverableType(request);
  const selection = selectCapabilityTeam(members, {
    request,
    requiredCapabilities: inferTaskCapabilities(request),
    explicitMemberIds: explicitIds,
    requiresTeam: true,
    requiresReview: ['file', 'connection', 'operation', 'mixed'].includes(deliverableType),
  });
  return selection.selected.map((member) => member.employeeId);
}

export function matchProjectMembers(employees: Employee[], request: string): ProjectMember[] {
  const explicitIds = explicitMemberIds(employees, request, []);
  const deliverableType = taskDeliverableType(request);
  const selection = selectCapabilityTeam(employees, {
    request,
    requiredCapabilities: inferTaskCapabilities(request),
    explicitMemberIds: explicitIds,
    requiresTeam: true,
    requiresReview: ['file', 'connection', 'operation', 'mixed'].includes(deliverableType),
  });
  return selection.selected.map((selected) => ({
    employeeId: selected.employeeId,
    reason: selected.reason,
  }));
}

export function requiresValidation(request: string): boolean {
  return ['file', 'connection', 'operation', 'mixed'].includes(taskDeliverableType(request));
}

function isReviewer(employee: Employee): boolean {
  return employeeCapabilityProfile(employee).includes('review');
}

type DeliveryStage = 'scope' | 'architecture' | 'design' | 'implementation';

const STAGE_ORDER: Record<DeliveryStage, number> = {
  scope: 1,
  architecture: 2,
  design: 3,
  implementation: 4,
};

function deliveryStageFor(employee: Employee): DeliveryStage {
  const profile = employeeCapabilityProfile(employee);
  const source = `${employee.name} ${employee.title} ${employee.role} ${employee.prompt ?? ''}`.toLowerCase();
  if (employee.role === 'pm' || employee.role === 'planner' || profile.includes('coordination') || /项目|规划|产品|需求|协调|architect|planner|manager/u.test(source)) return 'scope';
  if (profile.includes('backend') || profile.includes('connector') || /后端|架构|数据库|数据|ai|安全|服务端|backend|database|security/u.test(source)) return 'architecture';
  if (profile.includes('ui_ux') || /ui|ux|设计|交互|视觉|design/u.test(source)) return 'design';
  return 'implementation';
}

function stageLabel(stage: DeliveryStage): string {
  if (stage === 'scope') return '需求与范围';
  if (stage === 'architecture') return '技术与数据方案';
  if (stage === 'design') return '交互与界面方案';
  return '实现与交付';
}

function stableStageOrder(left: Employee, right: Employee): number {
  const stageDelta = STAGE_ORDER[deliveryStageFor(left)] - STAGE_ORDER[deliveryStageFor(right)];
  if (stageDelta) return stageDelta;
  return left.stationIndex - right.stationIndex || left.name.localeCompare(right.name, 'zh-CN');
}

function outputInstruction(deliverableType: TurnDeliverableType): string {
  if (deliverableType === 'file') return '交付真实文件，并验证文件能被读取、打开或运行。';
  if (deliverableType === 'connection') return '完成真实连接测试；只有测试通过才能报告可用。';
  if (deliverableType === 'operation') return '执行真实操作并保留运行结果，不要用文字计划替代操作。';
  if (deliverableType === 'mixed') return '按任务合同分别形成所需文件、操作或连接证据。';
  return '直接形成清楚、可核对的回答或决策；本步骤不强制生成文件。';
}

function stepDeliverableType(employee: Employee, review: boolean, taskType: TurnDeliverableType, selected: Employee[]): TurnDeliverableType {
  if (review) return 'decision';
  // A project may need both a design decision and implementation files. Do
  // not force the UX/planning member to manufacture a file when a real
  // implementation owner is already responsible for that final artifact.
  const hasImplementationOwner = selected.some((member) => member.role === 'coder' || /前端|后端|开发|工程|代码/u.test(`${member.title} ${member.prompt ?? ''}`));
  if (hasImplementationOwner && employee.role === 'planner' && ['file', 'mixed'].includes(taskType)) return 'decision';
  return taskType;
}

export function buildTaskPlan(team: Team, employees: Employee[], request: string, explicitIds: string[] = []): TaskPlanStep[] {
  const selectedIds = matchTeamMembers(team, employees, request, explicitIds);
  const selected = selectedIds.map((id) => employees.find((item) => item.id === id)).filter((item): item is Employee => !!item);
  const reviewers = selected.filter(isReviewer);
  const reviewer = reviewers[0];
  const ordered = selected.filter((item) => item.id !== reviewer?.id).sort(stableStageOrder);
  const deliverableType = taskDeliverableType(request);
  const stamp = Date.now();
  const steps: TaskPlanStep[] = [];
  let gate: string[] = [];
  for (const employee of ordered) {
    const stage = deliveryStageFor(employee);
    const currentDeliverableType = stepDeliverableType(employee, false, deliverableType, selected);
    const covered = capabilityCoverage(employee, inferTaskCapabilities(request)).covered.map(capabilityLabel);
    const workStep: TaskPlanStep = {
      id: `step-${stamp}-${steps.length + 1}-${employee.id}`,
      employeeId: employee.id,
      order: steps.length + 1,
      kind: 'work',
      title: `${stageLabel(stage)} · ${employee.name}`,
      assignment: `${gate.length ? '先读取并继承已经通过审查的前置结果，再继续当前责任。' : '先整理目标、边界、约束和验收标准，形成后续成员可引用的起点。'} 当前阶段：${stageLabel(stage)}。不得只回复收到或复述计划。${outputInstruction(currentDeliverableType)} 你的责任能力：${covered.join('、') || employee.title}。`,
      deliverableType: currentDeliverableType,
      dependsOnStepIds: gate,
    };
    steps.push(workStep);

    // A rejected result must be repaired before another stage can consume it.
    // The reviewer is therefore placed directly after every work delivery,
    // rather than being appended once after the whole team has spoken.
    if (reviewer) {
      const reviewStep: TaskPlanStep = {
        id: `review-${stamp}-${steps.length + 1}-${reviewer.id}-${workStep.id}`,
        employeeId: reviewer.id,
        order: steps.length + 1,
        kind: 'review',
        title: `${stageLabel(stage)} · ${reviewer.name} 审查`,
        assignment: `审查“${workStep.title}”的真实结果和验收证据。通过前不得允许后续阶段开始；使用 submit_review 提交 PASS 或 REJECT。退回时必须指定责任步骤“${workStep.id}”和责任员工“${employee.id}”，并说明是局部修订、需要重做，还是必须请老板决定。`,
        deliverableType: 'decision',
        dependsOnStepIds: [workStep.id],
      };
      steps.push(reviewStep);
      gate = [reviewStep.id];
    } else {
      gate = [workStep.id];
    }
  }
  return steps;
}
