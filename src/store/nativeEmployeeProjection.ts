import type { TaskRun } from '../types';

/** Projects durable worker state into the small employee-presence view. */
export function projectNativeWorkingEmployees(runs: TaskRun[]): Map<string, string> {
  const active = new Map<string, string>();
  for (const run of runs) {
    if (!['queued', 'running'].includes(run.status)) continue;
    for (const step of run.steps) {
      if (step.status === 'running') active.set(step.employeeId, `执行：${step.title}`);
    }
  }
  return active;
}
