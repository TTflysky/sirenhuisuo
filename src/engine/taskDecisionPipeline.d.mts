import type { TaskDecision, TaskDecisionAudit, TaskDecisionInput } from './taskDecisionKernel.mjs';

export const TASK_DECISION_PIPELINE_VERSION: number;
export function buildTaskDecisionAudit(
  input?: TaskDecisionInput,
  decision?: TaskDecision,
  options?: Record<string, unknown>,
): TaskDecisionAudit;
export function compileLayeredTaskDecision(
  input?: TaskDecisionInput,
  options?: { candidate?: unknown; fallback?: TaskDecision; modelFailureClass?: string; modelAttempted?: boolean },
): { decision: TaskDecision; audit: TaskDecisionAudit };
