export interface TaskContextEventInput {
  id?: string;
  ts?: number;
  type?: string;
  source?: string;
  stepId?: string;
  summary: string;
  verified?: boolean;
}

export interface TaskContextEvent extends Required<Pick<TaskContextEventInput, 'summary'>> {
  id: string;
  ts: number;
  type: string;
  source: string;
  stepId?: string;
  verified: boolean;
}

export interface TaskContextSnapshot {
  contextVersion: number;
  taskId: string;
  goal: string;
  acceptanceCriteria: string[];
  decisions: string[];
  openIssues: string[];
  events: TaskContextEvent[];
  createdAt: number;
  updatedAt: number;
}

export function createTaskContext(input?: Partial<TaskContextSnapshot> & { createdAt?: number }): TaskContextSnapshot;
export function restoreTaskContext(snapshot?: unknown, fallback?: Partial<TaskContextSnapshot>): TaskContextSnapshot;
export function appendTaskContextEvent(snapshot: unknown, input: TaskContextEventInput): TaskContextSnapshot;
export function searchTaskContext(snapshot: unknown, query: string, limit?: number): TaskContextEvent[];
export function buildTaskContextPrompt(snapshot: unknown, maxLength?: number): string;
export const TASK_CONTEXT_VERSION: number;
