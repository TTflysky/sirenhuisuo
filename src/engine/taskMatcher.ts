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

function outputInstruction(deliverableType: TurnDeliverableType): string {
  if (deliverableType === 'file') return '交付真实文件，并验证文件能被读取、打开或运行。';
  if (deliverableType === 'connection') return '完成真实连接测试；只有测试通过才能报告可用。';
  if (deliverableType === 'operation') return '执行真实操作并保留运行结果，不要用文字计划替代操作。';
  if (deliverableType === 'mixed') return '按任务合同分别形成所需文件、操作或连接证据。';
  return '直接形成清楚、可核对的回答或决策；本步骤不强制生成文件。';
}

export function buildTaskPlan(team: Team, employees: Employee[], request: string, explicitIds: string[] = []): TaskPlanStep[] {
  const selectedIds = matchTeamMembers(team, employees, request, explicitIds);
  const selected = selectedIds.map((id) => employees.find((item) => item.id === id)).filter((item): item is Employee => !!item);
  const ordered = [...selected.filter((item) => !isReviewer(item)), ...selected.filter(isReviewer)];
  const deliverableType = taskDeliverableType(request);
  const stamp = Date.now();
  const steps: TaskPlanStep[] = [];
  for (const employee of ordered) {
    const review = isReviewer(employee) && requiresValidation(request);
    const previous = steps.at(-1);
    const covered = capabilityCoverage(employee, inferTaskCapabilities(request)).covered.map(capabilityLabel);
    const assignment = review
      ? '审查本任务已有真实产出和执行证据。逐项核对老板原始要求，最后使用 submit_review 提交 PASS 或 REJECT；退回时必须标明责任步骤和具体问题。'
      : `${previous ? `继承步骤“${previous.title}”已经验证的结果，在此基础上继续。` : '理解老板的完整要求并选择最直接的可用能力。'} 不得只回复收到或复述计划。${outputInstruction(deliverableType)} 你的责任能力：${covered.join('、') || employee.title}。`;
    steps.push({
      id: `step-${stamp}-${steps.length + 1}-${employee.id}`,
      employeeId: employee.id,
      order: steps.length + 1,
      kind: review ? 'review' : 'work',
      title: review ? `${employee.name} · 最终审查` : `${employee.name} · ${employee.title}`,
      assignment,
      deliverableType: review ? 'decision' : deliverableType,
      dependsOnStepIds: previous ? [previous.id] : [],
    });
  }
  return steps;
}
