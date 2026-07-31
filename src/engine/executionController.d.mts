export type ExecutionFailureClass = 'none' | 'approval' | 'authentication' | 'authorization' | 'rate_limit' | 'timeout' | 'network' | 'server' | 'permission' | 'dependency' | 'not_found' | 'invalid_input' | 'conflict' | 'duplicate' | 'unsupported' | 'business' | 'off_target' | 'unknown';
export type NormalizedExecutionFailureClass = 'none' | 'network' | 'permission' | 'credential' | 'input' | 'resource_not_found' | 'protocol' | 'execution_environment' | 'timeout' | 'model_misjudgment' | 'evidence_insufficient' | 'user_decision';
export type ExecutionDecisionKind = 'act' | 'continue' | 'retry' | 'switch_route' | 'await_user' | 'verify' | 'complete' | 'stop';
export interface ExecutionDecision { kind: ExecutionDecisionKind; reason: string; at: number; failureClass?: ExecutionFailureClass; routeId?: string; requiresUser?: boolean }
export interface ExecutionBudgets { modelCalls: number; toolCalls: number; elapsedMs: number; retries: number; tokens: number }
export interface ExecutionUsage extends ExecutionBudgets { lastUpdatedAt: number }
export interface ExecutionEvidence { id?: string; ts: number; toolName: string; routeId: string; resultFingerprint?: string; verified: boolean; kind: string; summary?: string }
export interface ExecutionCheckpoint { id: string; ts: number; phase: string; goal: string; latestInstruction: string; routeId: string; evidenceIds: string[]; unresolvedQuestions: string[] }
export interface ExecutionControllerSnapshot {
  version: number; goal: string; acceptanceCriteria: string[]; acceptanceIssues: string[]; requiresEvidence: boolean;
  status: 'running' | 'awaiting_user' | 'blocked' | 'completed' | 'stopped';
  phase: 'observe' | 'act' | 'recover' | 'verify' | 'blocked' | 'complete';
  attemptCount: number; progressCount: number; consecutiveFailures: number; recoveryCycles: number; routeChanges: number;
  maxAttempts: number; maxSameRouteRetries: number; maxRouteChanges: number;
  budgets: ExecutionBudgets; usage: ExecutionUsage; budgetStopReason?: keyof ExecutionBudgets;
  routeHistory: Array<{ id: string; toolName: string; strategySignature: string; routeDifference: string; attempts: number; failures: number; successes: number; lastOutcome: string; resultFingerprints: string[]; updatedAt: number }>;
  forbiddenRouteIds: string[]; resultFingerprints: string[];
  observations: Array<{ ts: number; toolName: string; routeId: string; success: boolean; resultFingerprint?: string; duplicate?: boolean }>;
  evidence: ExecutionEvidence[];
  checkpoints: ExecutionCheckpoint[]; lastCheckpoint?: ExecutionCheckpoint; unresolvedQuestions: string[];
  failures: Array<{ id: string; ts: number; toolName: string; routeId: string; classification: ExecutionFailureClass; category?: NormalizedExecutionFailureClass; label: string; retryable: boolean; needsUser: boolean; resolved: boolean }>;
  activeFailureId?: string; conclusionReviews: number; latestInstruction: string; decision: ExecutionDecision; createdAt: number; updatedAt: number;
}
export interface ExecutionControllerOptions {
  goal?: string; acceptanceCriteria?: string[]; requiresEvidence?: boolean;
  maxAttempts?: number; maxSameRouteRetries?: number; maxRouteChanges?: number;
  maxModelCalls?: number; maxToolCalls?: number; maxElapsedMs?: number; maxRetries?: number; maxTokens?: number;
}
export function classifyExecutionFailure(input?: { success?: boolean; result?: string; reason?: string }): { code: ExecutionFailureClass; category: NormalizedExecutionFailureClass; retryable: boolean; needsUser: boolean; label: string };
export function createExecutionController(options?: ExecutionControllerOptions): ExecutionControllerSnapshot;
export function restoreExecutionController(snapshot: ExecutionControllerSnapshot | Record<string, unknown> | undefined, options?: ExecutionControllerOptions): ExecutionControllerSnapshot;
export function canExecuteRoute(state: ExecutionControllerSnapshot, input?: { routeKey?: string; toolName?: string; strategySignature?: string; routeDifference?: string }): { allowed: boolean; routeId: string; reason?: string };
export function observeExecutionResult(state: ExecutionControllerSnapshot, input?: { routeKey?: string; toolName?: string; success?: boolean; result?: string; reason?: string; contributesEvidence?: boolean; verified?: boolean; evidenceKind?: string; retryLimit?: number; strategySignature?: string; routeDifference?: string; tokenUsage?: number }): ExecutionControllerSnapshot;
export function recordExecutionUsage(state: ExecutionControllerSnapshot, delta?: Partial<ExecutionBudgets>): ExecutionControllerSnapshot;
export function evaluateExecutionConclusion(state: ExecutionControllerSnapshot, input?: { content?: string; reviewed?: boolean; acceptancePassed?: boolean; acceptanceIssues?: string[] }): ExecutionControllerSnapshot;
export function applyExecutionSteering(state: ExecutionControllerSnapshot, instruction?: string): ExecutionControllerSnapshot;
export function markExecutionBudgetReached(state: ExecutionControllerSnapshot, dimension?: keyof ExecutionBudgets): ExecutionControllerSnapshot;
export function blockExecution(state: ExecutionControllerSnapshot, reason?: string, failureClass?: ExecutionFailureClass): ExecutionControllerSnapshot;
export function executionControllerGuidance(state: ExecutionControllerSnapshot): string;
export function executionControllerStatus(state: ExecutionControllerSnapshot): string;
export function buildExecutionHandoff(state: ExecutionControllerSnapshot): string;
