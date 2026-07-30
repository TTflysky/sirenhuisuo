import type { Employee, SkillReference, TaskPlanStep, TaskRun, TaskRunMemberSnapshot, TaskRunStatus, TaskRunStep, Team } from '../types';
import { createExecutionController } from '../engine/executionController.mjs';
import { createTaskContract, createPlan, TASK_CONTRACT_VERSION } from '../engine/taskPlan.mjs';
import type { TaskPlanStep as FormalTaskPlanStep } from '../engine/taskPlan.mjs';
import { createTaskRunner, restoreTaskRunner } from '../engine/taskRunner.mjs';
import { appendTaskContextEvent, buildTaskContextPrompt, createTaskContext, restoreTaskContext, type TaskContextEventInput } from '../engine/taskContext.mjs';
import { createContextBudget, createRecoveryCapsule, verifyRecoveryCapsule } from '../engine/taskContextRouter.mjs';
import { normalizeTaskHandoff } from '../engine/taskHandoff.mjs';
import { assertTaskRunTransition } from '../engine/taskStateMachine.mjs';
import { createTeamExecutionProtocol, restoreTeamExecutionProtocol } from '../engine/teamExecutionProtocol.mjs';
import { inferCapabilityIds } from '../engine/capabilityGraph.mjs';
import { inferDeliverableType } from '../engine/turnRuntime.mjs';
import type { TaskDecision } from '../engine/taskDecisionKernel.mjs';
import type { TaskLedgerEvent, TaskLedgerIntegrity, TaskWorkerCommand, TaskWorkerCommandResult, TaskWorkerStatusResult } from '../electron';

const LS_TASK_RUNS = 'hermes_office_task_runs_v1';
const MAX_RUNS = 120;
const MAX_CACHED_LEDGER_EVENTS = 2000;
let taskLedgerEvents: TaskLedgerEvent[] = [];
let taskLedgerIntegrity: TaskLedgerIntegrity | null = null;
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
    metadata: { legacyStepId: step.id, employeeId: step.employeeId, kind: step.kind, deliverableType: step.deliverableType, revisionOfStepId: step.revisionOfStepId },
  };
}

function formalPlanForRun(run: Pick<TaskRun, 'id' | 'request' | 'goal' | 'steps' | 'contract'>) {
  const contract = run.contract?.contractVersion === TASK_CONTRACT_VERSION ? run.contract : createTaskContract({
    contractId: `contract-${run.id}`,
    scope: `team-run:${run.id}`,
    decision: {
      mode: 'execute', goal: run.goal ?? run.request, primaryRoute: 'team_dispatch',
      deliverableType: run.steps.find((step) => step.kind !== 'review')?.deliverableType
        ?? inferDeliverableType(undefined, run.goal ?? run.request),
      acceptanceCriteria: DEFAULT_ACCEPTANCE,
      requiredConstraints: ['每一步必须留下真实结果', '后续步骤等待前置步骤完成'],
      requiresEvidence: true, source: 'rules', confidence: 1,
    },
    sourceRequest: run.request,
    expectedOutputs: run.steps.filter((step) => step.kind !== 'review').map((step) => step.title),
    teamPolicy: { requiresTeam: true, explicitMemberIds: run.steps.map((step) => step.employeeId), allowDynamicDelegation: true },
  });
  const plan = createPlan({
    planId: `plan-${run.id}`, contract,
    steps: run.steps.map((step) => formalPlanStepForRun(run.id, step)),
  });
  return { contract, plan };
}

function addFormalExecutionState(run: TaskRun): TaskRun {
  const hasCurrentContract = run.contract?.contractVersion === TASK_CONTRACT_VERSION;
  if (hasCurrentContract && run.plan && run.runner) return run;
  if (!run.steps?.length) return run;
  const { contract, plan } = formalPlanForRun(run);
  return {
    ...run,
    contract: hasCurrentContract ? run.contract : contract,
    plan: hasCurrentContract ? run.plan ?? plan : plan,
    runner: hasCurrentContract ? run.runner ?? createTaskRunner(plan, { traceId: run.id, createdAt: run.createdAt }) : createTaskRunner(plan, { traceId: run.id, createdAt: run.createdAt }),
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
    budget: createContextBudget({ toolAttempts: 0, updatedAt: run.updatedAt || Date.now() }),
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
        phase: run.phase ?? (run.status === 'completed' ? 'completed' : run.status === 'awaiting_user' ? 'awaiting_user' : run.status === 'failed' ? 'blocked' : run.status === 'running' ? 'executing' : 'preflight'),
        goal: run.goal ?? run.request,
        acceptanceCriteria: run.acceptanceCriteria ?? ['完成用户目标', '产出可观察结果', '完成必要验证'],
        preflight: run.preflight ?? [{ label: '确认任务目标', status: 'passed' }, { label: '检查成员与模型', status: 'pending' }, { label: '确认验收方式', status: 'pending' }],
        evidence: run.evidence ?? [], revisionCount: run.revisionCount ?? 0, maxRevisions: run.maxRevisions ?? 2,
        handoff: normalizeTaskHandoff(run.handoff, { taskId: run.id }),
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
      next.executionProtocol = restoreTeamExecutionProtocol(next.executionProtocol, {
        teamId: next.teamId,
        runId: next.id,
        goal: next.goal ?? next.request,
        members: next.memberSnapshot,
        steps: next.steps,
        createdAt: next.createdAt,
      });
      const staleExecution = (next.status === 'running' || next.status === 'queued')
        && sessionId !== 'browser-session'
        && next.executionSessionId !== sessionId;
      next.recoveryCapsule = verifyRecoveryCapsule(next.recoveryCapsule)
        ? next.recoveryCapsule
        : createRecoveryCapsule(next, { reason: '旧任务上下文迁移' });
      if (!staleExecution) return next;
      recovered = true;
      const now = Date.now();
      const restartableNativeRun = next.worker?.adapter === 'main-native-execution-adapter' || next.recoveryContext?.autoResume === true;
      if (restartableNativeRun) {
        next.status = 'queued';
        next.phase = 'preflight';
        next.updatedAt = now;
        if (next.runner) next.runner = restoreTaskRunner(next.runner) ?? next.runner;
        next.steps = next.steps.map((step) => step.status === 'running' || step.status === 'paused'
          ? { ...step, status: 'queued', events: [...step.events, { ts: now, type: 'status', detail: '客户端重新启动，已回到后台待执行队列' }] }
          : step);
        next.recoveryContext = {
          ...(next.recoveryContext ?? defaultRecoveryContext(next)),
          summary: '客户端已重新启动，任务会在本机模型配置可用后自动从未完成步骤继续。',
          interruptedAt: now,
          interruptionReason: '客户端进程已重新启动',
          autoResume: true,
          waitingFor: undefined,
        };
        next.handoff = {
          ts: now,
          completed: next.steps.filter((step) => step.status === 'completed').map((step) => step.title),
          blocked: '任务已恢复到后台队列，正在等待安全地重新注入本机模型配置。',
          nextAction: '无需重新布置任务；模型配置可用后会自动继续。',
        };
        return next;
      }
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
    if (writer) void writer(runs.slice(-MAX_RUNS), { source: 'renderer', sessionId: getExecutionSessionId() })
      .then((result) => {
        if (!result.ok) return;
        mergeTaskLedgerState(result.events, result.integrity, true);
      })
      .catch(() => {});
  } catch {}
}

function mergeTaskLedgerState(events?: TaskLedgerEvent[], integrity?: TaskLedgerIntegrity, notify = false): void {
  if (events?.length) {
    const merged = new Map(taskLedgerEvents.map((event) => [event.eventId, event]));
    for (const event of events) merged.set(event.eventId, event);
    taskLedgerEvents = [...merged.values()].sort((a, b) => a.sequence - b.sequence).slice(-MAX_CACHED_LEDGER_EVENTS);
  }
  if (integrity) taskLedgerIntegrity = integrity;
  if (notify && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('task-ledger:updated'));
}

export function getTaskLedgerEvents(taskId?: string): TaskLedgerEvent[] {
  return taskLedgerEvents.filter((event) => !taskId || event.taskId === taskId);
}

export function getTaskLedgerIntegrity(): TaskLedgerIntegrity | null {
  return taskLedgerIntegrity;
}

export async function readTaskLedger(taskId?: string, limit = 500): Promise<TaskLedgerEvent[]> {
  try {
    const reader = typeof window !== 'undefined' ? window.electronAPI?.taskLedgerRead : undefined;
    if (!reader) return getTaskLedgerEvents(taskId);
    const result = await reader({ taskId, limit });
    if (!result.ok) return getTaskLedgerEvents(taskId);
    mergeTaskLedgerState(result.events, result.integrity);
    return result.events ?? [];
  } catch {
    return getTaskLedgerEvents(taskId);
  }
}

export async function sendTaskWorkerCommand(command: TaskWorkerCommand): Promise<TaskWorkerCommandResult | null> {
  try {
    const sender = typeof window !== 'undefined' ? window.electronAPI?.taskWorkerCommand : undefined;
    if (!sender) return null;
    return await sender({ ...command, sessionId: command.sessionId ?? getExecutionSessionId(), requestedAt: command.requestedAt ?? Date.now() });
  } catch (error) {
    return { ok: false, taskId: command.taskId, type: command.type, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getTaskWorkerStatus(): Promise<TaskWorkerStatusResult | null> {
  try {
    const reader = typeof window !== 'undefined' ? window.electronAPI?.taskWorkerStatus : undefined;
    return reader ? await reader() : null;
  } catch {
    return null;
  }
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
    mergeTaskLedgerState(result.events, result.integrity);
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

/** Reads only one changed task projection for high-frequency native events. */
export async function hydrateTaskRunFromMainStore(taskId: string): Promise<TaskRun | null> {
  try {
    const reader = typeof window !== 'undefined' ? window.electronAPI?.taskStoreQuery : undefined;
    if (!reader || !taskId) return null;
    const result = await reader({ taskId, limit: 1 });
    if (!result.ok) return null;
    mergeTaskLedgerState(result.events, result.integrity);
    const run = result.runs?.find((item) => item.id === taskId);
    if (!run) return null;
    return normalizeTaskRuns([run])[0] ?? null;
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

export function createTaskRun(team: Team, employees: Employee[], request: string, plan: TaskPlanStep[], sourceMessageId?: string, skillRefs?: SkillReference[], workspaceId?: string, taskDecision?: TaskDecision, conversationId?: string): TaskRun {
  const now = Date.now();
  const id = `run-${now}-${Math.random().toString(36).slice(2, 7)}`;
  const teamMembers = team.memberIds
    .map((id) => employees.find((employee) => employee.id === id))
    .filter((employee): employee is Employee => !!employee);
  const memberSnapshot: TaskRunMemberSnapshot[] = teamMembers.map((employee) => ({
    id: employee.id, name: employee.name, title: employee.title, role: employee.role,
    prompt: employee.prompt, soul: employee.soul,
    model: employee.modelConfig?.model ?? employee.modelConfig?.refModelId,
    capabilities: employee.capabilities,
  }));
  const steps: TaskRunStep[] = plan.map((item) => ({
    ...item,
    deliverableType: item.kind === 'review'
      ? 'decision'
      : item.deliverableType ?? taskDecision?.deliverableType,
    status: 'queued',
    attempts: 0,
    events: [{ ts: now, type: 'status', detail: '等待执行' }],
  }));
  const deliverableType = taskDecision?.deliverableType
    ?? plan.find((step) => step.kind !== 'review')?.deliverableType
    ?? inferDeliverableType(undefined, request);
  const inferredAcceptanceCriteria = deliverableType === 'file'
    ? ['生成用户要求的真实文件', '文件已经落盘并通过读取、打开或运行验证', '审查真实产出后再宣布完成']
    : deliverableType === 'connection'
      ? ['完成目标连接配置', '通过真实连接测试后再宣布可用']
      : deliverableType === 'operation'
        ? ['执行用户要求的真实操作', '保留运行结果或状态证据']
        : ['直接完成用户要求', '结论与真实证据一致，不强制生成文件'];
  const acceptanceCriteria = taskDecision?.acceptanceCriteria?.filter(Boolean).length
    ? taskDecision.acceptanceCriteria.filter(Boolean)
    : inferredAcceptanceCriteria;
  const baseRun: TaskRun = {
    id,
    teamId: team.id,
    conversationId,
    workspaceId: workspaceId ?? `tasks/team/${team.id}/run-${id}`,
    executionSessionId: getExecutionSessionId(),
    title: request.slice(0, 48) || '团队任务',
    request,
    goal: request,
    phase: 'preflight',
    acceptanceCriteria,
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
    context: createTaskContext({ taskId: id, goal: request, acceptanceCriteria, createdAt: now }),
    sourceMessageId,
    revisionCount: 0,
    maxRevisions: 2,
    recoveryContext: {
      summary: '任务已创建，正在完成启动前检查。', completedEvidence: [], unresolvedIssues: [], steeringMessages: [],
      budget: createContextBudget({ toolAttempts: 0, updatedAt: now }),
      controller: createExecutionController({
        goal: request,
        acceptanceCriteria: ['完成用户要求的工作', '留下可观察的结果或文件', '由执行者或审查步骤确认结果'],
        requiresEvidence: true,
      }),
    },
  };
  const contract = createTaskContract({
    contractId: `contract-${id}`,
    sourceRequest: request,
    request,
    scope: `team-run:${id}`,
    expectedOutputs: plan.filter((step) => step.kind !== 'review').map((step) => step.title),
    requiredCapabilities: taskDecision?.requiredCapabilities?.filter(Boolean).length
      ? taskDecision.requiredCapabilities
      : inferCapabilityIds(request),
    teamPolicy: { requiresTeam: true, explicitMemberIds: steps.map((step) => step.employeeId), allowDynamicDelegation: true },
    decision: {
      mode: 'execute', goal: request, primaryRoute: 'team_dispatch',
      deliverableType,
      acceptanceCriteria: baseRun.acceptanceCriteria,
      deliverables: taskDecision?.deliverables,
      requiredConstraints: taskDecision?.requiredConstraints?.filter(Boolean).length
        ? taskDecision.requiredConstraints
        : ['每一步必须留下真实结果', '后续步骤必须等待前置步骤完成'],
      riskLevel: taskDecision?.riskLevel,
      requiresEvidence: taskDecision?.requiresEvidence !== false,
      source: taskDecision?.source ?? 'rules',
      confidence: taskDecision?.confidence ?? 1,
      decisionReason: taskDecision?.decisionReason,
    },
  });
  baseRun.contract = contract;
  baseRun.acceptanceCriteria = contract.constraints.acceptanceCriteria;
  baseRun.context = createTaskContext({ taskId: id, goal: request, acceptanceCriteria: contract.constraints.acceptanceCriteria, createdAt: now });
  baseRun.recoveryContext = {
    ...baseRun.recoveryContext!,
    controller: createExecutionController({ goal: request, acceptanceCriteria: contract.constraints.acceptanceCriteria, requiresEvidence: contract.constraints.requiresEvidence }),
  };
  const formalized = formalPlanForRun(baseRun);
  const run = {
    ...baseRun,
    contract: formalized.contract,
    plan: formalized.plan,
    runner: createTaskRunner(formalized.plan, { traceId: id, createdAt: now }),
    executionProtocol: createTeamExecutionProtocol({
      teamId: team.id,
      teamName: team.name,
      runId: id,
      goal: request,
      assistantId: 'assistant',
      members: memberSnapshot,
      steps,
      createdAt: now,
    }),
  };
  run.recoveryCapsule = createRecoveryCapsule(run, { reason: '任务创建' });
  return run;
}

export function updateTaskRun(run: TaskRun, mutate: (current: TaskRun) => void): TaskRun {
  const next = structuredClone(run) as TaskRun;
  mutate(next);
  if (next.status !== run.status) assertTaskRunTransition(run.status, next.status, { reason: next.lastError || '任务运行状态更新' });
  if (next.handoff) next.handoff = normalizeTaskHandoff(next.handoff, { taskId: next.id });
  next.updatedAt = Date.now();
  return next;
}

export function setRunStatus(run: TaskRun, status: TaskRunStatus, error?: string): TaskRun {
  return updateTaskRun(run, (next) => { next.status = status; next.lastError = error; });
}
