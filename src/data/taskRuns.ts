import type { Employee, SkillReference, TaskPlanStep, TaskRun, TaskRunMemberSnapshot, TaskRunStatus, TaskRunStep, Team } from '../types';

const LS_TASK_RUNS = 'hermes_office_task_runs_v1';
const MAX_RUNS = 120;

export function loadTaskRuns(): TaskRun[] {
  try {
    const raw = localStorage.getItem(LS_TASK_RUNS);
    const runs = raw ? JSON.parse(raw) as TaskRun[] : [];
    return runs.map((run) => ({ ...run, phase: run.phase ?? (run.status === 'completed' ? 'completed' : run.status === 'failed' ? 'blocked' : run.status === 'running' ? 'executing' : 'preflight'), goal: run.goal ?? run.request, acceptanceCriteria: run.acceptanceCriteria ?? ['完成用户目标', '产出可观察结果', '完成必要验证'], preflight: run.preflight ?? [{ label: '确认任务目标', status: 'passed' }, { label: '检查成员与模型', status: 'pending' }, { label: '确认验收方式', status: 'pending' }], evidence: run.evidence ?? [], revisionCount: run.revisionCount ?? 0, maxRevisions: run.maxRevisions ?? 2, steps: (run.steps ?? []).map((step, index) => ({ ...step, evidence: step.evidence ?? [], order: step.order ?? index + 1, kind: step.kind ?? 'work', assignment: step.assignment ?? step.title, dependsOnStepIds: step.dependsOnStepIds ?? [] })), memberSnapshot: run.memberSnapshot ?? [] }));
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
    goal: request,
    phase: 'preflight',
    acceptanceCriteria: ['完成用户要求的工作', '留下可观察的结果或文件', '由执行者或审查步骤确认结果'],
    preflight: [
      { label: '确认任务目标', status: 'passed', detail: request.slice(0, 120) },
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
