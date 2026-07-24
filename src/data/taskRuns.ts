import type { Employee, TaskRun, TaskRunMemberSnapshot, TaskRunStatus, TaskRunStep, Team } from '../types';

const LS_TASK_RUNS = 'hermes_office_task_runs_v1';
const MAX_RUNS = 120;

export function loadTaskRuns(): TaskRun[] {
  try {
    const raw = localStorage.getItem(LS_TASK_RUNS);
    const runs = raw ? JSON.parse(raw) as TaskRun[] : [];
    return runs.map((run) => ({ ...run, steps: run.steps ?? [], memberSnapshot: run.memberSnapshot ?? [] }));
  } catch {
    return [];
  }
}

export function saveTaskRuns(runs: TaskRun[]): void {
  try { localStorage.setItem(LS_TASK_RUNS, JSON.stringify(runs.slice(-MAX_RUNS))); } catch {}
}

export function createTaskRun(team: Team, employees: Employee[], request: string, employeeIds: string[], sourceMessageId?: string): TaskRun {
  const now = Date.now();
  const teamMembers = team.memberIds
    .map((id) => employees.find((employee) => employee.id === id))
    .filter((employee): employee is Employee => !!employee);
  const selected = employeeIds.length
    ? teamMembers.filter((employee) => employeeIds.includes(employee.id))
    : teamMembers.filter((employee) => employee.isOnline);
  const memberSnapshot: TaskRunMemberSnapshot[] = teamMembers.map((employee) => ({
    id: employee.id, name: employee.name, title: employee.title, role: employee.role,
    prompt: employee.prompt, soul: employee.soul,
    model: employee.modelConfig?.model ?? employee.modelConfig?.refModelId,
  }));
  const steps: TaskRunStep[] = selected.map((employee) => ({
    id: `step-${now}-${employee.id}`,
    employeeId: employee.id,
    title: `${employee.name} · ${employee.title}`,
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
    sourceMessageId,
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
