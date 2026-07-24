import type { Employee, SkillReference, TaskPlanStep, TaskRun, TaskRunMemberSnapshot, TaskRunStatus, TaskRunStep, Team } from '../types';

const LS_TASK_RUNS = 'hermes_office_task_runs_v1';
const MAX_RUNS = 120;

export function loadTaskRuns(): TaskRun[] {
  try {
    const raw = localStorage.getItem(LS_TASK_RUNS);
    const runs = raw ? JSON.parse(raw) as TaskRun[] : [];
    return runs.map((run) => ({ ...run, revisionCount: run.revisionCount ?? 0, maxRevisions: run.maxRevisions ?? 2, steps: (run.steps ?? []).map((step, index) => ({ ...step, order: step.order ?? index + 1, kind: step.kind ?? 'work', assignment: step.assignment ?? step.title, dependsOnStepIds: step.dependsOnStepIds ?? [] })), memberSnapshot: run.memberSnapshot ?? [] }));
  } catch {
    return [];
  }
}

export function saveTaskRuns(runs: TaskRun[]): void {
  try { localStorage.setItem(LS_TASK_RUNS, JSON.stringify(runs.slice(-MAX_RUNS))); } catch {}
}

export function createTaskRun(team: Team, employees: Employee[], request: string, plan: TaskPlanStep[], sourceMessageId?: string, skillRefs?: SkillReference[]): TaskRun {
  const now = Date.now();
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
  return {
    id: `run-${now}-${Math.random().toString(36).slice(2, 7)}`,
    teamId: team.id,
    title: request.slice(0, 48) || '团队任务',
    request,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    memberSnapshot,
    steps,
    skillRefs,
    sourceMessageId,
    revisionCount: 0,
    maxRevisions: 2,
  };
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
