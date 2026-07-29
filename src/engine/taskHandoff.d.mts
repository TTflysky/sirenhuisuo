export type TaskHandoffBlockerCategory = 'environment' | 'dependency' | 'permission' | 'network' | 'authentication' | 'input' | 'plan' | 'validation' | 'unknown';
export interface TaskHandoffBlocker { category: TaskHandoffBlockerCategory; summary: string; retryable: boolean; ownerId?: string; stepId?: string; }
export interface TaskHandoff { handoffVersion?: number; taskId?: string; ts?: number; completed?: string[]; completedEvidence?: string[]; blockers?: TaskHandoffBlocker[]; blocked?: string; nextAction?: string; resumeCondition?: string; attemptedRoutes?: string[]; risks?: string[]; updatedAt?: number; }
export function createTaskHandoff(input?: Partial<TaskHandoff> & { blockers?: Array<Partial<TaskHandoffBlocker> | string> }): TaskHandoff;
export function normalizeTaskHandoff(input?: unknown, fallback?: Partial<TaskHandoff>): TaskHandoff | undefined;
export function validateTaskHandoff(input: unknown): { valid: boolean; errors: string[] };
export function mergeTaskHandoff(previous: unknown, update?: Partial<TaskHandoff> & { clearBlockers?: boolean }): TaskHandoff;
export const TASK_HANDOFF_VERSION: number;
