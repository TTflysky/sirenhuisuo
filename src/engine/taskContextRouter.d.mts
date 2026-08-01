import type { TaskRun } from '../types';

export type TaskInputKind = 'control_pause' | 'control_stop' | 'control_resume' | 'correction' | 'question' | 'new_task' | 'constraint';
export type TaskInputAction = 'pause' | 'stop' | 'resume' | 'preempt_and_replan' | 'reply_then_continue' | 'queue_separately' | 'merge_and_continue';
export interface TaskInputRoute { routerVersion: number; kind: TaskInputKind; action: TaskInputAction; priority: number; replyRequired: boolean; shouldPreempt: boolean; shouldMergeWithGoal: boolean; message: string }
export interface ContextBudgetSnapshot { budgetVersion: number; contextWindowTokens: number; reserveTokens: number; promptTokens: number; completionTokens: number; estimatedTokens: number; toolAttempts: number; modelRounds: number; noProgressRounds: number; stage: number; compactions: number; updatedAt: number }
export interface TaskRecoveryCapsule { recoveryVersion: number; taskId: string; teamId: string; immutableGoal: string; acceptanceCriteria: string[]; status: string; phase: string; workspaceId: string; contractVersion?: number; planId?: string; planFingerprint?: string; completedSteps: unknown[]; pendingSteps: unknown[]; verifiedFacts: string[]; artifacts: string[]; unresolvedIssues: string[]; steeringMessages: string[]; handoff?: unknown; nextStepId?: string; budget: ContextBudgetSnapshot; lastCheckpoint?: unknown; reason: string; createdAt: number; checksum: string }
export function estimateTokens(value: unknown): number;
export function classifyTaskInput(message: string, task?: Partial<TaskRun>): TaskInputRoute;
export function isTaskContinuationApproval(message: string, task?: Partial<TaskRun>): boolean;
export function findTaskContinuationTarget<T extends { id: string; parentTaskId?: string; status?: string; steps?: unknown[]; updatedAt?: number; createdAt?: number }>(message: string, runs: T[]): T | undefined;
export function createContextBudget(input?: Partial<ContextBudgetSnapshot>): ContextBudgetSnapshot;
export function recordContextUsage(snapshot: unknown, usage?: { promptTokens?: number; completionTokens?: number; estimatedTokens?: number; toolAttempts?: number; modelRounds?: number; progress?: boolean }): ContextBudgetSnapshot;
export function assessContextBudget(snapshot: unknown, options?: { currentPromptTokens?: number }): ContextBudgetSnapshot & { currentTokens: number; usableTokens: number; ratio: number; action: 'continue' | 'compact' | 'checkpoint' | 'replan'; reason: string };
export function compactMessageWindow(messages: unknown[], options?: { keepRecent?: number }): { messages: unknown[]; removed: number; summary: string };
export function groupAtomicMessages(messages: unknown[]): Array<{ start: number; end: number; messages: unknown[]; kind: string; complete: boolean; toolCallIds?: string[] }>;
export function validateToolMessageSequence(messages: unknown[]): { valid: boolean; orphanTools: number[]; incompleteGroups: Array<{ start: number; toolCallIds?: string[] }> };
export function createRecoveryCapsule(run: Partial<TaskRun>, input?: { reason?: string; createdAt?: number }): TaskRecoveryCapsule;
export function verifyRecoveryCapsule(capsule: unknown): boolean;
export function routeTaskInput(run: TaskRun, message: string, input?: { createdAt?: number }): { route: TaskInputRoute; run: TaskRun };
export function buildRecoveryPrompt(run: Partial<TaskRun>, maxLength?: number): string;
export const TASK_CONTEXT_ROUTER_VERSION: number;
export const TASK_RECOVERY_CAPSULE_VERSION: number;
