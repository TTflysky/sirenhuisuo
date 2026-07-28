export interface TaskContextEventInput {
  id?: string;
  ts?: number;
  type?: string;
  source?: string;
  stepId?: string;
  summary: string;
  verified?: boolean;
  data?: Record<string, unknown>;
}

export interface TaskContextEvent extends Required<Pick<TaskContextEventInput, 'summary'>> {
  id: string;
  ts: number;
  type: string;
  source: string;
  stepId?: string;
  verified: boolean;
  data?: Record<string, unknown>;
}

export interface TaskContextSummary {
  summaryVersion: number;
  narrative: string;
  verifiedFacts: string[];
  completedStepIds: string[];
  artifactPaths: string[];
  blockers: string[];
  sourceEventCount: number;
  modelNarrative: string;
  modelName: string;
  modelCoveredEventCount: number;
  compactedAt?: number;
}

export interface TaskContextSnapshot {
  contextVersion: number;
  taskId: string;
  goal: string;
  acceptanceCriteria: string[];
  decisions: string[];
  openIssues: string[];
  relatedTaskIds: string[];
  summary: TaskContextSummary;
  events: TaskContextEvent[];
  createdAt: number;
  updatedAt: number;
}

export interface TaskModelSummaryProposal {
  narrative: string;
  modelName?: string;
  sourceEventCount?: number;
}

export function createTaskContext(input?: Partial<TaskContextSnapshot> & { createdAt?: number }): TaskContextSnapshot;
export function restoreTaskContext(snapshot?: unknown, fallback?: Partial<TaskContextSnapshot>): TaskContextSnapshot;
export function appendTaskContextEvent(snapshot: unknown, input: TaskContextEventInput): TaskContextSnapshot;
export function compactTaskContext(snapshot: unknown): TaskContextSnapshot;
export function applyModelTaskSummary(snapshot: unknown, proposal: TaskModelSummaryProposal): TaskContextSnapshot;
export function shouldModelSummarizeTaskContext(snapshot: unknown): boolean;
export function buildTaskSummaryMaterial(snapshot: unknown, maxLength?: number): string;
export function searchTaskContext(snapshot: unknown, query: string, limit?: number): TaskContextEvent[];
export function buildTaskContextPrompt(snapshot: unknown, maxLength?: number): string;
export const TASK_CONTEXT_VERSION: number;
export const TASK_CONTEXT_SUMMARY_VERSION: number;
