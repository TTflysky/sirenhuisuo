import type { TaskRun } from '../types';

export interface TaskResidencyCheckpoint {
  residencyVersion: number;
  taskId: string;
  goalId: string;
  goalHash: string;
  planId: string;
  planRevision: number;
  planHash: string;
  completedStepIds: string[];
  verifiedEvidenceIds: string[];
  nextExecutableStepId?: string;
  contextSummaryHash: string;
  checkpointSequence: number;
  updatedAt: number;
  reason: string;
  checksum: string;
}

export function createTaskResidencyCheckpoint(run: Partial<TaskRun>, input?: { checkpointSequence?: number; updatedAt?: number; reason?: string }): TaskResidencyCheckpoint;
export function verifyTaskResidencyCheckpoint(run: Partial<TaskRun>, checkpoint: unknown): { valid: boolean; errors: string[]; current: TaskResidencyCheckpoint };
export function explainResidencyConflict(errors: unknown): string;
export const TASK_RESIDENCY_CHECKPOINT_VERSION: number;
