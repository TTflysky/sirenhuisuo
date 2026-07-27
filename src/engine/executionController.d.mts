export type ExecutionFailureClass = 'none' | 'approval' | 'authentication' | 'authorization' | 'rate_limit' | 'timeout' | 'network' | 'server' | 'permission' | 'dependency' | 'not_found' | 'invalid_input' | 'conflict' | 'duplicate' | 'unsupported' | 'business' | 'off_target' | 'unknown';
export type ExecutionDecisionKind = 'act' | 'continue' | 'retry' | 'switch_route' | 'await_user' | 'verify' | 'complete' | 'stop';
export interface ExecutionDecision { kind: ExecutionDecisionKind; reason: string; at: number; failureClass?: ExecutionFailureClass; routeId?: string; requiresUser?: boolean }
export interface ExecutionControllerSnapshot {
  version: number; goal: string; acceptanceCriteria: string[]; acceptanceIssues: string[]; requiresEvidence: boolean;
  status: 'running' | 'awaiting_user' | 'blocked' | 'completed' | 'stopped';
  phase: 'observe' | 'act' | 'recover' | 'verify' | 'blocked' | 'complete';
  attemptCount: number; progressCount: number; consecutiveFailures: number; recoveryCycles: number; routeChanges: number;
  maxAttempts: number; maxSameRouteRetries: number; maxRouteChanges: number;
  routeHistory: Array<{ id: string; toolName: string; attempts: number; failures: number; successes: number; lastOutcome: string; updatedAt: number }>;
  forbiddenRouteIds: string[];
  observations: Array<{ ts: number; toolName: string; routeId: string; success: boolean }>;
  evidence: Array<{ ts: number; toolName: string; routeId: string; verified: boolean; kind: string }>;
  failures: Array<{ id: string; ts: number; toolName: string; routeId: string; classification: ExecutionFailureClass; label: string; retryable: boolean; needsUser: boolean; resolved: boolean }>;
  activeFailureId?: string; conclusionReviews: number; latestInstruction: string; decision: ExecutionDecision; createdAt: number; updatedAt: number;
}
export function classifyExecutionFailure(input?: { success?: boolean; result?: string; reason?: string }): { code: ExecutionFailureClass; retryable: boolean; needsUser: boolean; label: string };
export function createExecutionController(options?: { goal?: string; acceptanceCriteria?: string[]; requiresEvidence?: boolean; maxAttempts?: number; maxSameRouteRetries?: number; maxRouteChanges?: number }): ExecutionControllerSnapshot;
export function restoreExecutionController(snapshot: ExecutionControllerSnapshot | undefined, options?: Parameters<typeof createExecutionController>[0]): ExecutionControllerSnapshot;
export function canExecuteRoute(state: ExecutionControllerSnapshot, input?: { routeKey?: string; toolName?: string }): { allowed: boolean; routeId: string; reason?: string };
export function observeExecutionResult(state: ExecutionControllerSnapshot, input?: { routeKey?: string; toolName?: string; success?: boolean; result?: string; reason?: string; contributesEvidence?: boolean; verified?: boolean; evidenceKind?: string; retryLimit?: number }): ExecutionControllerSnapshot;
export function evaluateExecutionConclusion(state: ExecutionControllerSnapshot, input?: { content?: string; reviewed?: boolean; acceptancePassed?: boolean; acceptanceIssues?: string[] }): ExecutionControllerSnapshot;
export function applyExecutionSteering(state: ExecutionControllerSnapshot, instruction?: string): ExecutionControllerSnapshot;
export function markExecutionBudgetReached(state: ExecutionControllerSnapshot): ExecutionControllerSnapshot;
export function blockExecution(state: ExecutionControllerSnapshot, reason?: string, failureClass?: ExecutionFailureClass): ExecutionControllerSnapshot;
export function executionControllerGuidance(state: ExecutionControllerSnapshot): string;
export function executionControllerStatus(state: ExecutionControllerSnapshot): string;
