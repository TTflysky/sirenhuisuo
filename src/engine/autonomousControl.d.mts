export type GoalStatus = 'active' | 'blocked' | 'completed' | 'stopped';
export type GoalSteeringRelation = 'new_goal' | 'correction' | 'constraint' | 'prohibition' | 'decision' | 'control' | 'question';
export interface GoalState {
  goalVersion: number; goalId: string; projectId: string; conversationId: string;
  originalGoal: string; currentGoal: string; successCriteria: string[]; constraints: string[]; prohibitions: string[];
  scopeChanges: Array<{ id: string; relation: string; instruction: string; previousGoal?: string; at: number }>;
  userDecisions: Array<{ id: string; relation: string; instruction: string; at: number }>;
  appliedSteeringEventIds: string[];
  status: GoalStatus; createdAt: number; updatedAt: number;
}
export interface SituationRecord { id: string; statement: string; source: string; sourceId?: string; factKey?: string; at: number; verified: boolean }
export interface FactLedger { ledgerVersion: number; factVersions: Array<Record<string, unknown>>; conflicts: Array<Record<string, unknown>>; updatedAt: number }
export interface SituationModel {
  situationVersion: number; goalId: string; confirmedFacts: SituationRecord[]; assumptions: SituationRecord[]; openQuestions: string[];
  availableCapabilities: string[]; activeMembers: Array<{ id: string; name: string; title: string }>;
  artifacts: Array<{ id: string; path: string; source: string; at: number; verified: boolean }>;
  evidence: SituationRecord[]; failures: Array<{ id: string; stepId?: string; summary: string; at: number }>;
  blockedBy: string[]; userSteering: Array<{ id: string; summary: string; at: number }>;
  routeHistory: Array<{ routeId: string; toolName: string; strategy: string; attempts: number; failures: number; successes: number; successRate: number; failureRate: number; lastSuccessAt: number; lastFailureAt: number; lastOutcome: string; updatedAt: number }>;
  factLedger: FactLedger; openFactConflicts: Array<Record<string, unknown>>;
  updatedAt: number;
}
export interface AutonomousAction { kind: string; summary: string; stepId?: string; employeeId?: string; routeId?: string; toolName?: string; toolCallId?: string; requiredUserInput?: string }
export interface DecisionRecord {
  decisionVersion: number; decisionId: string; goalId: string; cycle: number;
  phase: 'observe' | 'interpret' | 'propose' | 'validate' | 'act' | 'verify' | 'reflect';
  observedFacts: string[]; selectedAction: AutonomousAction; publicRationale: string; expectedEvidence: string[];
  riskLevel: 'low' | 'medium' | 'high'; approvalRequirement: 'required' | 'none'; result: string; nextDecision: string; createdAt: number;
}
export interface PublicDecisionSummary {
  currentGoal: string; confirmedFacts: string[]; currentGap: string; attemptedRoutes: string[]; nextAction: string; rationale: string;
  resources: string[]; expectedEvidence: string[]; needsUser: boolean; planRevision: number; planChange: string;
  affectedNodes: string[]; preservedCompletedNodes: string[]; budgetAction: string; budgetReason: string; factConflicts: Array<Record<string, unknown>>; factLedger: Record<string, unknown>;
}
export interface AutonomousControlSnapshot {
  controlVersion: number; mode: 'shadow' | 'adaptive'; protocol: 'observe-interpret-propose-validate-act-verify-reflect'; loopPhase: DecisionRecord['phase'];
  planRevision: number; currentDecision: DecisionRecord; decisionHistory: DecisionRecord[]; decisionBasis: Record<string, unknown>;
  decisionAuthority?: import('./autonomousDecisionAuthority.mjs').AutonomousDecisionAuthority;
  routeHistory: SituationModel['routeHistory']; repeatedRouteDetected: boolean; shouldAwaitUser: boolean; publicSummary: PublicDecisionSummary;
  budgetAssessment?: { action: string; reason: string; dimension?: string }; updatedAt: number;
}
export function createGoalState(input?: Record<string, unknown>): GoalState;
export function restoreGoalState(snapshot?: unknown, fallback?: Record<string, unknown>): GoalState;
export function applyGoalSteering(snapshot: unknown, steering?: { relation?: GoalSteeringRelation; instruction?: string; summary?: string; replacementGoal?: string; at?: number; goalId?: string; successCriteria?: string[] }): GoalState;
export function deriveSituationModel(run?: Record<string, any>, goalSnapshot?: unknown): SituationModel;
export function createDecisionRecord(input?: Record<string, any>): DecisionRecord;
export function buildPublicDecisionSummary(goal: GoalState, situation: SituationModel, decision: DecisionRecord): PublicDecisionSummary;
export function reconcileAutonomousControl<T extends Record<string, any>>(run: T, options?: { now?: number }): T & { projectId: string; goalState: GoalState; situationModel: SituationModel; adaptivePlanGraph: import('./adaptivePlanGraph.mjs').AdaptivePlanGraph; autonomousControl: AutonomousControlSnapshot };
export const AUTONOMOUS_CONTROL_VERSION: number;
export const AUTONOMOUS_GOAL_VERSION: number;
export const AUTONOMOUS_SITUATION_VERSION: number;
export const AUTONOMOUS_DECISION_VERSION: number;
