export interface TeamExecutionProtocol {
  protocolVersion: number;
  teamId: string;
  teamName?: string;
  runId: string;
  goal: string;
  assistantId: string;
  members: Array<{ id: string; name: string; title: string; role: string; model?: string; status: string; stepIds: string[] }>;
  steps: Array<{ id: string; employeeId: string; title: string; kind: string; dependsOnStepIds: string[]; status: string; attempts: number; lastError?: string; startedAt?: number; completedAt?: number }>;
  kickoff: { id: string; authorId: string; content: string; mentions: string[]; createdAt: number };
  status: string;
  currentStepId?: string;
  currentEmployeeId?: string;
  employeeStates: Record<string, { employeeId: string; status: string; currentStepId?: string; currentTool?: string; startedAt?: number; updatedAt: number }>;
  routeHistory: unknown[];
  recovery: { available: boolean; reason?: string; nextStepId?: string };
  artifacts: unknown[];
  review: { status: string; lastDecision?: string; responsibleStepId?: string };
  sequence: number;
  events: unknown[];
  createdAt: number;
  updatedAt: number;
}

export function createTeamExecutionProtocol(input?: Record<string, unknown>): TeamExecutionProtocol;
export function restoreTeamExecutionProtocol(snapshot?: TeamExecutionProtocol, input?: Record<string, unknown>): TeamExecutionProtocol;
export function reconcileTeamExecutionProtocol(snapshot: TeamExecutionProtocol, input?: Record<string, unknown>): TeamExecutionProtocol;
export function projectTeamExecutionEvent(snapshot: TeamExecutionProtocol, input?: Record<string, unknown>): TeamExecutionProtocol;
export function classifyTeamRetry(input?: Record<string, unknown>): Record<string, unknown>;
export function createRecoveryPlan(protocol: TeamExecutionProtocol, input?: Record<string, unknown>): Record<string, unknown>;
export function createArtifactIndex(artifacts?: unknown[], options?: Record<string, unknown>): unknown[];
export function summarizeTeamExecution(protocol: TeamExecutionProtocol, at?: number): Record<string, unknown>;
export function decideCapabilityUse(input?: Record<string, unknown>): Record<string, unknown>;
export function createReviewRevision(input?: Record<string, unknown>): Record<string, unknown>;
export function createExecutionSyncEnvelope(input?: Record<string, unknown>): Record<string, unknown>;
export function shouldApplyExecutionSync(current: Record<string, unknown>, envelope: Record<string, unknown>): boolean;
export function validateTeamExecutionProtocol(protocol: TeamExecutionProtocol): { valid: boolean; errors: string[] };
export const TEAM_EXECUTION_PROTOCOL_VERSION: number;
