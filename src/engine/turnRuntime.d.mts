export type TurnDeliverableType = 'answer' | 'file' | 'connection' | 'operation' | 'decision' | 'mixed';
export type TurnErrorType = 'authentication' | 'authorization' | 'billing' | 'rate_limit' | 'timeout' | 'network' | 'server' | 'context_overflow' | 'invalid_arguments' | 'missing_dependency' | 'result_mismatch' | 'verification_failed' | 'missing_user_input' | 'unknown';
export interface TurnRuntimeState { runtimeVersion: number; turnId: string; taskId: string; scope: string; goal: string; contract?: unknown; deliverableType: TurnDeliverableType; phase: string; round: number; decisions: any[]; evidence: any[]; unresolvedIssues: string[]; recoveryAttempts: Record<string, number>; seenCalls: Record<string, any>; pendingSteering: string[]; startedAt: number; updatedAt: number; finishedAt?: number }
export function classifyExecutionError(input: unknown): { type: TurnErrorType; retryable: boolean; needsUser: boolean; message: string };
export function normalizeToolCall(name: unknown, rawArguments: unknown): { ok: boolean; name: string; args: Record<string, unknown>; argumentsText?: string; fingerprint?: string; error?: string };
export function inferDeliverableType(contract: any, fallbackGoal?: string): TurnDeliverableType;
export function requiresFileEvidence(contract: any, step?: any): boolean;
export function createTurnRuntime(input?: Record<string, unknown>): TurnRuntimeState;
export function observeModelDecision(runtime: TurnRuntimeState, input?: Record<string, unknown>): { runtime: TurnRuntimeState; decision: any };
export function observeToolResult(runtime: TurnRuntimeState, input?: Record<string, unknown>): { runtime: TurnRuntimeState; evidence: any; error: ReturnType<typeof classifyExecutionError> | null };
export function decideRecovery(runtime: TurnRuntimeState, error: unknown, options?: { limit?: number }): { runtime: TurnRuntimeState; decision: any };
export function applySteering(runtime: TurnRuntimeState, messages: string | string[]): TurnRuntimeState;
export function buildTurnGuidance(runtime: TurnRuntimeState, options?: { additional?: string }): string;
export function compactRuntimeEvidence(runtime: TurnRuntimeState, options?: { keepRecent?: number }): Record<string, unknown>;
export function finalizeTurn(runtime: TurnRuntimeState, input?: Record<string, unknown>): { runtime: TurnRuntimeState; finalization: any };
export const TAIJI_TURN_RUNTIME_VERSION: number;
export const TAIJI_RECOVERY_LIMITS: Readonly<Record<TurnErrorType, number>>;
