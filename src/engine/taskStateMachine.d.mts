export type TaskRunState = 'queued' | 'running' | 'awaiting_user' | 'paused' | 'stopped' | 'failed' | 'completed';
export function isTerminalTaskRunStatus(status: string): boolean;
export function allowedTaskRunTransitions(status: string): string[];
export function canTransitionTaskRun(from: string, to: string): boolean;
export function assertTaskRunTransition(from: string, to: string, context?: { reason?: string }): { valid: true; from: string; to: string };
export function transitionTaskRunStatus<T extends { status: TaskRunState; updatedAt?: number }>(run: T, nextStatus: TaskRunState, context?: { phase?: string; error?: string; reason?: string; updatedAt?: number }): T;
export function validateTaskRunState(run: unknown): { valid: boolean; errors: string[] };
export const TASK_STATE_MACHINE_VERSION: number;
