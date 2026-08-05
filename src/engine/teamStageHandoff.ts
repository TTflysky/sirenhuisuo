import type { Employee, TaskRun, TaskRunStep, TaskStageSummary } from '../types';
import { cleanExecutionDisplay } from './executionDisplay.mjs';

function operationLog(step: TaskRunStep) {
  return (step.events ?? []).slice(-20).map((event) => ({
    ts: event.ts,
    type: event.type,
    detail: cleanExecutionDisplay(event.detail, 1000),
    success: event.type !== 'error',
  }));
}

function durationMs(run: TaskRun, step: TaskRunStep): number {
  return Math.max(0, Number(step.completedAt || Date.now()) - Number(step.startedAt || run.createdAt || Date.now()));
}

export function buildRunCompletionSummary(run: TaskRun): NonNullable<TaskRun['completionSummary']> {
  const completed = run.steps.filter((step) => step.status === 'completed').map((step) => step.title);
  const unfinished = run.steps.filter((step) => !['completed', 'stopped'].includes(step.status)).map((step) => step.title);
  const evidence = (run.evidence ?? []).filter((item) => item.verified).map((item) => item.summary).slice(-10);
  const blockers = [
    ...(run.lastError ? [run.lastError] : []),
    ...run.steps.filter((step) => step.lastError).map((step) => `${step.title}：${step.lastError}`),
    ...(run.recoveryContext?.unresolvedIssues ?? []),
  ].filter(Boolean).slice(-8);
  const nextAction = run.status === 'completed'
    ? '由章北海助理汇总最终交付并等待老板验收。'
    : run.status === 'paused'
      ? '等待老板点击继续；已完成内容和工作区保持不变。'
      : run.status === 'stopped'
        ? '任务已停止；如需继续，应由老板明确恢复或重新定义目标。'
        : '先处理阻塞原因，再由对应责任人从当前检查点继续。';
  return { status: run.status, completed, unfinished, evidence, blockers, nextAction, publishedAt: Date.now() };
}

export function buildWorkStageSummary(input: {
  run: TaskRun;
  step: TaskRunStep;
  owner: Employee;
  content: string;
  status: 'completed' | 'failed';
  employees: Employee[];
}): TaskStageSummary {
  const { run, step, owner, content, status, employees } = input;
  const remainingSteps = run.steps.filter((item) => item.id !== step.id && item.status !== 'completed' && item.compensationOnly !== true);
  const nextStep = status === 'failed' ? step : remainingSteps.find((candidate) => (candidate.dependsOnStepIds ?? []).every((dependencyId) => run.steps.find((item) => item.id === dependencyId)?.status === 'completed'));
  const nextOwner = nextStep ? employees.find((employee) => employee.id === nextStep.employeeId) : undefined;
  const evidence = (step.evidence ?? []).filter((item) => item.verified).map((item) => item.summary).slice(-8);
  return {
    summaryVersion: 1,
    id: `stage-summary-${run.id}-${step.id}-${Date.now()}`,
    taskId: run.id,
    stepId: step.id,
    stageTitle: step.title,
    ownerId: owner.id,
    ownerName: owner.name,
    status,
    problem: step.assignment || run.goal || run.request,
    rationale: status === 'failed'
      ? '这个阶段遇到真实阻塞，先保留已经取得的结果，再由责任人从当前检查点调整路线。'
      : (step.dependsOnStepIds ?? []).length
        ? `该阶段承接前置成果，并把可核对结果交给${nextOwner?.name ?? '下一位负责人'}。`
        : `这是当前依赖图中可先执行的阶段，用来为${nextOwner?.name ?? '后续工作'}建立依据。`,
    completed: status === 'completed' ? [content.slice(0, 1200)] : evidence,
    evidence,
    remaining: remainingSteps.map((item) => item.title).slice(0, 12),
    nextOwnerId: nextOwner?.id,
    nextOwnerName: nextOwner?.name,
    nextAction: status === 'failed'
      ? `仍由${owner.name}负责“${step.title}”，需要根据阻塞原因换路线后继续。`
      : nextStep
        ? `下一步由${nextOwner?.name ?? '下一位成员'}处理“${nextStep.title}”。`
        : '计划阶段已完成，接下来由章北海汇总交付并进行最终验收。',
    durationMs: durationMs(run, step),
    operations: operationLog(step),
    createdAt: Date.now(),
  };
}

export function buildReviewStageSummary(input: {
  run: TaskRun;
  step: TaskRunStep;
  approved: boolean;
  reason?: string;
  responsibleEmployeeId?: string;
  responsibleStepId?: string;
  checkedArtifacts?: string[];
  employees: Employee[];
}): TaskStageSummary {
  const { run, step, approved, reason, responsibleEmployeeId, responsibleStepId, checkedArtifacts, employees } = input;
  const reviewer = employees.find((employee) => employee.id === step.employeeId);
  const responsible = employees.find((employee) => employee.id === responsibleEmployeeId);
  const remainingSteps = run.steps.filter((item) => item.id !== step.id && item.status !== 'completed' && item.compensationOnly !== true);
  const nextOwnerId = approved ? remainingSteps[0]?.employeeId : responsible?.id;
  return {
    summaryVersion: 1,
    id: `stage-summary-${run.id}-${step.id}-${Date.now()}`,
    taskId: run.id,
    stepId: step.id,
    stageTitle: step.title,
    ownerId: reviewer?.id ?? step.employeeId,
    ownerName: reviewer?.name ?? step.employeeId,
    status: approved ? 'completed' : 'blocked',
    problem: step.assignment || '核对当前交付是否满足项目目标和验收要求。',
    rationale: '审查必须指出核对了什么证据、是否通过，以及不通过时只退回哪个责任步骤。',
    completed: [approved ? `审查通过：${reason ?? '符合当前验收要求'}` : `审查退回：${reason ?? '需要修改'}`],
    evidence: checkedArtifacts?.length ? checkedArtifacts : [reason ?? '已提交结构化审查结论'],
    remaining: remainingSteps.map((item) => item.title).slice(0, 12),
    nextOwnerId,
    nextOwnerName: employees.find((employee) => employee.id === nextOwnerId)?.name,
    nextAction: approved
      ? remainingSteps.length ? `审查已通过，下一步继续“${remainingSteps[0].title}”。` : '审查已通过，接下来由章北海汇总最终交付。'
      : `只退回${responsible?.name ?? '责任成员'}负责的“${responsibleStepId ?? '责任步骤'}”，修改后重新审查。`,
    durationMs: durationMs(run, step),
    operations: operationLog(step),
    createdAt: Date.now(),
  };
}
