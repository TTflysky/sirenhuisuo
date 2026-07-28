import type { Employee, SkillReference, TaskPlanStep, TaskRun, TaskRunMemberSnapshot, TaskRunStatus, TaskRunStep, Team } from '../types';
import { createExecutionController } from '../engine/executionController.mjs';
import { createTaskContract, createPlan } from '../engine/taskPlan.mjs';
import type { TaskPlanStep as FormalTaskPlanStep } from '../engine/taskPlan.mjs';
import { createTaskRunner, restoreTaskRunner } from '../engine/taskRunner.mjs';
import { appendTaskContextEvent, buildTaskContextPrompt, createTaskContext, restoreTaskContext, type TaskContextEventInput } from '../engine/taskContext.mjs';

const LS_TASK_RUNS = 'hermes_office_task_runs_v1';
const MAX_RUNS = 120;
const DEFAULT_ACCEPTANCE = ['完成用户要求的工作', '留下可观察的结果或文件', '由执行者或审查步骤确认结果'];

export function formalPlanStepForRun(runId: string, step: TaskRunStep | TaskPlanStep): FormalTaskPlanStep {
  const type = step.kind === 'review' ? 'review' : 'tool';
  return {
    stepId: step.id,
    type,
    connector: `team-member:${step.employeeId}`,
    input: { assignment: step.assignment, employeeId: step.employeeId },
    expectedOutputSchema: type === 'review'
      ? { type: 'object', required: ['review'], properties: { review: { type: 'object' } } }
      : { type: 'object' },
    dependsOn: step.dependsOnStepIds,
    retryPolicy: { maxRetries: 3, backoffMs: 1000, maxBackoffMs: 30000 },
    idempotencyKey: type === 'review' ? '' : `run-${runId}-${step.id}`,
    sideEffect: type !== 'review',
    compensateStepId: '',
    approvalRequired: false,
    metadata: { legacyStepId: step.id, employeeId: step.employeeId, kind: step.kind, revisionOfStepId: step.revisionOfStepId },
  };
}

function formalPlanForRun(run: Pick<TaskRun, 'id' | 'request' | 'goal' | 'steps'>) {
  const contract = createTaskContract({
    contractId: `contract-${run.id}`,
    scope: `team-run:${run.id}`,
    decision: {
      mode: 'execute', goal: run.goal ?? run.request, primaryRoute: 'team_dispatch',
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      requiredConstraints: ['每一步必须留下真实结果', '后续步骤等待前置步骤完成'],
      requiresEvidence: true, source: 'rules', confidence: 1,
    },
  });
  const plan = createPlan({
    planId: `plan-${run.id}`, contract,
    steps: run.steps.map((step) => formalPlanStepForRun(run.id, step)),
  });
  return { contract, plan };
}

function addFormalExecutionState(run: TaskRun): TaskRun {
  if (run.contract && run.plan && run.runner) return run;
  if (!run.steps?.length) return run;
  const { contract, plan } = formalPlanForRun(run);
  return {
    ...run,
    contract: run.contract ?? contract,
    plan: run.plan ?? plan,
    runner: run.runner ?? createTaskRunner(plan, { traceId: run.id, createdAt: run.createdAt }),
  };
}

export function getExecutionSessionId(): string {
  try {
    const nativeId = window.electronAPI?.getAppSessionId?.();
    if (nativeId) return nativeId;
  } catch {}
  return 'browser-session';
}

function defaultRecoveryContext(run: TaskRun) {
  return {
    summary: run.handoff?.blocked || (run.status === 'completed' ? '任务已完成' : '任务尚未开始'),
    completedEvidence: (run.evidence ?? []).filter((item) => item.verified).map((item) => item.summary).slice(-12),
    unresolvedIssues: run.lastError ? [run.lastError.slice(0, 320)] : [],
    steeringMessages: [],
    budget: { toolAttempts: 0, updatedAt: run.updatedAt || Date.now() },
    controller: createExecutionController({
      goal: run.goal ?? run.request,
      acceptanceCriteria: run.acceptanceCriteria ?? ['完成用户目标', '产出可观察结果', '完成必要验证'],
      requiresEvidence: true,
    }),
  };
}

function normalizeTaskRuns(runs: TaskRun[]): TaskRun[] {
  try {
    const sessionId = getExecutionSessionId();
    let recovered = false;
    const normalized = runs.map((run) => {
      const recoveryDefaults = defaultRecoveryContext(run);
      const next: TaskRun = addFormalExecutionState({
        ...run,
        workspaceId: run.workspaceId ?? `legacy/team_${run.teamId}`,
        phase: run.phase ?? (run.status === 'completed' ? 'completed' : run.status === 'failed' ? 'blocked' : run.status === 'running' ? 'executing' : 'preflight'),
        goal: run.goal ?? run.request,
        acceptanceCriteria: run.acceptanceCriteria ?? ['完成用户目标', '产出可观察结果', '完成必要验证'],
        preflight: run.preflight ?? [{ label: '确认任务目标', status: 'passed' }, { label: '检查成员与模型', status: 'pending' }, { label: '确认验收方式', status: 'pending' }],
        evidence: run.evidence ?? [], revisionCount: run.revisionCount ?? 0, maxRevisions: run.maxRevisions ?? 2,
        steps: (run.steps ?? []).map((step, index) => ({ ...step, evidence: step.evidence ?? [], order: step.order ?? index + 1, kind: step.kind ?? 'work', assignment: step.assignment ?? step.title, dependsOnStepIds: step.dependsOnStepIds ?? [] })),
        memberSnapshot: run.memberSnapshot ?? [],
        context: restoreTaskContext(run.context, {
          taskId: run.id,
          goal: run.goal ?? run.request,
          acceptanceCriteria: run.acceptanceCriteria,
          createdAt: run.createdAt,
        }),
        recoveryContext: {
          ...recoveryDefaults,
          ...(run.recoveryContext ?? {}),
          budget: { ...recoveryDefaults.budget, ...(run.recoveryContext?.budget ?? {}) },
          controller: run.recoveryContext?.controller ?? recoveryDefaults.controller,
        },
      });
      const staleExecution = (next.status === 'running' || next.status === 'queued')
        && sessionId !== 'browser-session'
        && next.executionSessionId !== sessionId;
      if (!staleExecution) return next;
      recovered = true;
      const now = Date.now();
      next.status = 'paused';
      next.phase = 'blocked';
      next.updatedAt = now;
      if (next.runner) next.runner = restoreTaskRunner(next.runner) ?? next.runner;
      next.steps = next.steps.map((step) => step.status === 'running' || step.status === 'queued'
        ? { ...step, status: 'paused', events: [...step.events, { ts: now, type: 'status', detail: '客户端上次退出，步骤已保留并等待恢复' }] }
        : step);
      next.recoveryContext = {
        ...(next.recoveryContext ?? defaultRecoveryContext(next)),
        summary: '客户端上次退出时任务仍在执行，已保存为待恢复任务。',
        interruptedAt: now,
        interruptionReason: '客户端退出、重启或进程中断',
      };
      next.handoff = {
        ts: now,
        completed: next.steps.filter((step) => step.status === 'completed').map((step) => step.title),
        blocked: '检测到上次执行被客户端退出或重启中断。已完成内容和原工作区均已保留。',
        nextAction: '展开任务核对摘要和未决问题，然后点击“继续执行”。',
      };
      return next;
    });
    if (recovered) saveTaskRuns(normalized);
    return normalized;
  } catch {
    return [];
  }
}

function saveLocalTaskRuns(runs: TaskRun[]): TaskRun[] {
  const limited = runs.slice(-MAX_RUNS);
  try { localStorage.setItem(LS_TASK_RUNS, JSON.stringify(limited)); } catch {}
  return limited;
}

function writeMainTaskRuns(runs: TaskRun[]): void {
  try {
    const writer = typeof window !== 'undefined' ? window.electronAPI?.taskStoreWrite : undefined;
    if (writer) void writer(runs.slice(-MAX_RUNS)).catch(() => {});
  } catch {}
}

export function loadTaskRuns(): TaskRun[] {
  try {
    const raw = localStorage.getItem(LS_TASK_RUNS);
    return normalizeTaskRuns(raw ? JSON.parse(raw) as TaskRun[] : []);
  } catch {
    return [];
  }
}

/**
 * Main-process storage is authoritative when present. A missing snapshot is
 * treated as a first-run migration from the legacy renderer cache.
 */
export async function hydrateTaskRunsFromMainStore(): Promise<TaskRun[] | null> {
  try {
    const reader = typeof window !== 'undefined' ? window.electronAPI?.taskStoreRead : undefined;
    if (!reader) return null;
    const result = await reader();
    if (!result.ok) return null;
    if (result.exists) {
      const normalized = normalizeTaskRuns(result.runs ?? []);
      saveLocalTaskRuns(normalized);
      return normalized;
    }
    const migrated = loadTaskRuns();
    saveLocalTaskRuns(migrated);
    writeMainTaskRuns(migrated);
    return migrated;
  } catch {
    return null;
  }
}

export function saveTaskRuns(runs: TaskRun[]): void {
  const limited = saveLocalTaskRuns(runs);
  writeMainTaskRuns(limited);
}

export function appendTaskRunContext(run: TaskRun, event: TaskContextEventInput): void {
  run.context = appendTaskContextEvent(run.context, {
    ...event,
    stepId: event.stepId,
  });
}

export function taskRunContextPrompt(run: TaskRun): string {
  return buildTaskContextPrompt(run.context ?? createTaskContext({
    taskId: run.id,
    goal: run.goal ?? run.request,
    acceptanceCriteria: run.acceptanceCriteria,
    createdAt: run.createdAt,
  }));
}

export function createTaskRun(team: Team, employees: Employee[], request: string, plan: TaskPlanStep[], sourceMessageId?: string, skillRefs?: SkillReference[], workspaceId?: string): TaskRun {
  const now = Date.now();
  const id = `run-${now}-${Math.random().toString(36).slice(2, 7)}`;
  const teamMembers = team.memberIds
    .map((id) => employees.find((employee) => employee.id === id))
    .filter((employee): employee is Employee => !!employee);
  const memberSnapshot: TaskRunMemberSnapshot[] = teamMembers.map((employee) => ({
    id: employee.id, name: employee.name, title: employee.title, role: employee.role,
    prompt: employee.prompt, soul: employee.soul,
    model: employee.modelConfig?.model ?? employee.modelConfig?.refModelId,
  }));
  const steps: TaskRunStep[] = plan.map((item) => ({
    ...item,
    status: 'queued',
    attempts: 0,
    events: [{ ts: now, type: 'status', detail: '等待执行' }],
  }));
  const baseRun: TaskRun = {
    id,
    teamId: team.id,
    workspaceId: workspaceId ?? `tasks/team/${team.id}/run-${id}`,
    executionSessionId: getExecutionSessionId(),
    title: request.slice(0, 48) || '团队任务',
    request,
    goal: request,
    phase: 'preflight',
    acceptanceCriteria: ['完成用户要求的工作', '留下可观察的结果或文件', '由执行者或审查步骤确认结果'],
    preflight: [
      { label: '确认任务目标', status: 'passed', detail: request.slice(0, 120) },
      { label: '初始化独立工作区', status: 'pending', detail: '每个任务使用独立目录，恢复执行继续沿用此目录' },
      { label: '检查参与成员与模型', status: teamMembers.length ? 'pending' : 'blocked', detail: teamMembers.length ? undefined : '团队没有可用成员' },
      { label: '确认最终验收', status: 'pending', detail: '任务结束前需要核对最初目标' },
    ],
    evidence: [],
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    memberSnapshot,
    steps,
    skillRefs,
    skillEvidence: [],
    context: createTaskContext({ taskId: id, goal: request, acceptanceCriteria: ['完成用户要求的工作', '留下可观察的结果或文件', '由执行者或审查步骤确认结果'], createdAt: now }),
    sourceMessageId,
    revisionCount: 0,
    maxRevisions: 2,
    recoveryContext: {
      summary: '任务已创建，正在完成启动前检查。', completedEvidence: [], unresolvedIssues: [], steeringMessages: [],
      budget: { toolAttempts: 0, updatedAt: now },
      controller: createExecutionController({
        goal: request,
        acceptanceCriteria: ['完成用户要求的工作', '留下可观察的结果或文件', '由执行者或审查步骤确认结果'],
        requiresEvidence: true,
      }),
    },
  };
  const { contract, plan: formalPlan } = formalPlanForRun(baseRun);
  return { ...baseRun, contract, plan: formalPlan, runner: createTaskRunner(formalPlan, { traceId: id, createdAt: now }) };
}

export function updateTaskRun(run: TaskRun, mutate: (current: TaskRun) => void): TaskRun {
  const next = structuredClone(run) as TaskRun;
  mutate(next);
  next.updatedAt = Date.now();
  return next;
}

export function setRunStatus(run: TaskRun, status: TaskRunStatus, error?: string): TaskRun {
  return updateTaskRun(run, (next) => { next.status = status; next.lastError = error; });
}
