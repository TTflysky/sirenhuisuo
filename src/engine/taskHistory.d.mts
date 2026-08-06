import type { TaskContextEvent, TaskContextSummary } from './taskContext.mjs';
import type { TaskLedgerEvent } from '../electron';

export interface TaskHistoryMatch {
  taskId: string;
  teamId: string;
  projectId?: string;
  conversationId?: string;
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
  projectId?: string;
  conversationId?: string;
  title: string;
  goal: string;
  status: string;
  summary: TaskContextSummary;
  acceptanceCriteria: string[];
  relatedTaskIds: string[];
  events: TaskContextEvent[];
  runnerEvents: Array<{ id: string; ts: number; type: string; stepId?: string; detail: string }>;
  attachments: Array<{ name: string; mime?: string; size?: number; kind: string; workspacePath?: string; persistenceError?: string; available: boolean; inline: boolean }>;
  ledgerEvents: TaskLedgerEvent[];
  createdAt: number;
  updatedAt: number;
}

export function searchTaskRunHistory(runs: unknown[], query: string, options?: { excludeTaskId?: string; statuses?: string[]; teams?: Array<{ id: string; name: string }>; teamId?: string; projectId?: string; conversationId?: string; limit?: number }): TaskHistoryMatch[];
export function buildTaskHistoryPrompt(matches: TaskHistoryMatch[], maxLength?: number): string;
export function buildTaskReplay(run: unknown, ledgerEvents?: TaskLedgerEvent[]): TaskReplay | null;
