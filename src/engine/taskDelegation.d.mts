import type { TaskRun, TaskRunMemberSnapshot, TaskRunStep } from '../types';
export type TaskDelegationStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface TaskDelegation { delegationVersion: number; id: string; parentTaskId: string; parentStepId?: string; delegatedStepId: string; employeeId: string; employeeName: string; title: string; assignment: string; acceptanceCriteria: string[]; dependsOnStepIds: string[]; status: TaskDelegationStatus; createdAt: number; updatedAt: number; completedAt?: number; output?: unknown; error?: string; evidence?: unknown[]; revisionOfDelegationId?: string }
export function selectDelegate(members: TaskRunMemberSnapshot[], assignment: string, options?: { employeeId?: string; title?: string }): TaskRunMemberSnapshot | null;
export function createDelegation(run: TaskRun, input: { assignment: string; title?: string; employeeId?: string; parentStepId?: string; acceptanceCriteria?: string[]; dependsOnStepIds?: string[] }): { delegation: TaskDelegation; step: TaskRunStep & { delegationId: string } };
export function appendDelegation(run: TaskRun, input: Parameters<typeof createDelegation>[1]): { run: TaskRun; delegation: TaskDelegation; step: TaskRunStep & { delegationId: string } };
export function transitionDelegation(run: TaskRun, delegationId: string, status: TaskDelegationStatus, input?: { output?: unknown; error?: string; evidence?: unknown[] }): { run: TaskRun; delegation: TaskDelegation };
export function createDelegationRevision(run: TaskRun, delegationId: string, review: { reviewStepId?: string; responsibleEmployeeId?: string; reason?: string }): ReturnType<typeof appendDelegation>;
export function delegationSummary(run: TaskRun): { total: number; counts: Record<TaskDelegationStatus, number>; active: TaskDelegation[] };
export const TASK_DELEGATION_VERSION: number;
