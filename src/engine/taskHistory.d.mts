import type { TaskContextEvent, TaskContextSummary } from './taskContext.mjs';

export interface TaskHistoryMatch {
  taskId: string;
  teamId: string;
  teamName: string;
  title: string;
  goal: string;
  status: string;
  score: number;
  updatedAt: number;
  summary: string;
  verifiedFacts: string[];
  artifactPaths: string[];
  blockers: string[];
  matchedEvents: TaskContextEvent[];
}

export interface TaskReplay {
  taskId: string;
  teamId: string;
  title: string;
  goal: string;
  status: string;
  summary: TaskContextSummary;
  acceptanceCriteria: string[];
  relatedTaskIds: string[];
  events: TaskContextEvent[];
  runnerEvents: Array<{ id: string; ts: number; type: string; stepId?: string; detail: string }>;
  createdAt: number;
  updatedAt: number;
}

export function searchTaskRunHistory(runs: unknown[], query: string, options?: { excludeTaskId?: string; statuses?: string[]; teams?: Array<{ id: string; name: string }>; limit?: number }): TaskHistoryMatch[];
export function buildTaskHistoryPrompt(matches: TaskHistoryMatch[], maxLength?: number): string;
export function buildTaskReplay(run: unknown): TaskReplay | null;
