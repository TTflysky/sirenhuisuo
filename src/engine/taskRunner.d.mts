import type { TaskPlan, TaskPlanStep } from './taskPlan.mjs';

export type TaskRunnerStepStatus = 'pending' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'cancelled';
export interface TaskRunnerStepRecord {
  stepId: string;
  status: TaskRunnerStepStatus;
  attempts: number;
  idempotencyKey?: string;
  startedAt?: number;
  completedAt?: number;
  retryAt?: number;
  output?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}
export interface TaskRunnerSnapshot {
  runnerVersion: number;
  traceId: string;
  planId: string;
  status: 'ready' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled' | 'paused';
  currentStepId?: string;
  steps: TaskRunnerStepRecord[];
  approvals: Array<{ stepId: string; decision: 'approved' | 'rejected'; reason: string; ts: number }>;
  reviews: Array<{ stepId: string; decision: 'pass' | 'reject'; reason: string; responsibleStepId?: string; responsibleEmployeeId?: string; checkedArtifacts: string[]; ts: number }>;
  idempotency: Record<string, { stepId: string; status: string; completedAt: number }>;
  events: Array<{ id: string; ts: number; type: string; stepId?: string; detail: string; attempt?: number; retryAt?: number }>;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
  plan: TaskPlan;
}
export function createTaskRunner(plan: TaskPlan, options?: { traceId?: string; createdAt?: number }): TaskRunnerSnapshot;
export function restoreTaskRunner(snapshot?: TaskRunnerSnapshot, options?: { plan?: TaskPlan; traceId?: string; createdAt?: number }): TaskRunnerSnapshot | null;
export function getRunnableTaskSteps(snapshot: TaskRunnerSnapshot): TaskPlanStep[];
export function beginTaskStep(snapshot: TaskRunnerSnapshot, stepId: string): TaskRunnerSnapshot;
export function recordTaskStepResult(snapshot: TaskRunnerSnapshot, input?: { stepId?: string; success?: boolean; retryable?: boolean; output?: unknown; error?: string; detail?: string }): TaskRunnerSnapshot;
export function appendTaskRunnerSteps(snapshot: TaskRunnerSnapshot, steps: TaskPlanStep[], detail?: string): TaskRunnerSnapshot;
export function recordTaskReviewDecision(snapshot: TaskRunnerSnapshot, input: { stepId: string; approved: boolean; reason?: string; responsibleStepId?: string; responsibleEmployeeId?: string; checkedArtifacts?: string[] }): TaskRunnerSnapshot;
export function approveTaskStep(snapshot: TaskRunnerSnapshot, stepId: string, decision: 'approved' | 'rejected', reason?: string): TaskRunnerSnapshot;
export function cancelTaskRunner(snapshot: TaskRunnerSnapshot, reason?: string): TaskRunnerSnapshot;
export function taskRunnerStatus(snapshot: TaskRunnerSnapshot): string;
export const TASK_RUNNER_VERSION: number;
