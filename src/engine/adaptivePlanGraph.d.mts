export type AdaptivePlanNodeStatus = 'queued' | 'running' | 'paused' | 'awaiting_user' | 'failed' | 'completed' | 'stopped' | 'superseded';
export interface AdaptivePlanNode {
  id: string; title: string; objective: string; kind: string; ownerEmployeeId: string; ownerName: string;
  requiredCapabilities: string[]; dependsOn: string[]; acceptanceCriteria: string[]; expectedEvidence: string[];
  deliverableType: string; approvalRequired: boolean; riskLevel: 'low' | 'normal' | 'high';
  retryPolicy: { maxRetries: number; backoffMs: number; maxBackoffMs: number };
  strategy: { routeId: string; toolName: string; description: string; fingerprint: string };
  status: AdaptivePlanNodeStatus; attempts: number; evidenceIds: string[];
  lastFailure?: { category: string; summary: string; at: number }; revisionCreated: number; revisionUpdated: number;
  supersededBy: string[]; metadata: Record<string, unknown>;
}
export interface AdaptivePlanRevision {
  revision: number; revisionId: string; trigger: string; reason: string;
  operations: Array<{ type: string; nodeId?: string; summary?: string; nodeIds?: string[] }>;
  affectedNodeIds: string[]; preservedCompletedNodeIds: string[]; evidenceIds: string[]; at: number;
}
export interface AdaptivePlanRosterChange {
  employeeId: string; employeeName: string; reason: string; affectedNodeIds: string[];
  acceptanceCriteria: string[]; revision: number; at: number;
}
export interface AdaptivePlanGraph {
  graphVersion: number; graphId: string; goalId: string; projectId: string; sourcePlanId: string; revision: number;
  nodes: AdaptivePlanNode[]; revisionHistory: AdaptivePlanRevision[]; rosterChanges: AdaptivePlanRosterChange[];
  routeHistory: Array<Record<string, unknown>>;
  createdAt: number; updatedAt: number;
}
export interface AdaptivePlanProposal { reason: string; trigger?: string; evidenceIds?: string[]; operations: Array<Record<string, unknown>> }
export function createAdaptivePlanGraph(input?: Record<string, any>): AdaptivePlanGraph;
export function restoreAdaptivePlanGraph(snapshot: unknown, input?: Record<string, any>): AdaptivePlanGraph;
export function validateAdaptivePlanGraph(graph: unknown): { valid: boolean; errors: string[]; value?: AdaptivePlanGraph };
export function downstreamNodeIds(graph: AdaptivePlanGraph, nodeIds: string[]): string[];
export function readyAdaptiveNodes(graph: AdaptivePlanGraph): AdaptivePlanNode[];
export function applyAdaptivePlanRevision(snapshot: unknown, proposal: AdaptivePlanProposal, options?: Record<string, any>): AdaptivePlanGraph;
export function classifyAdaptiveFailure(error: unknown, hint?: string): { category: string; retryable: boolean; needsUser: boolean };
export function selectAdaptiveRecovery(graph: AdaptivePlanGraph, input?: Record<string, any>): Record<string, any>;
export function assessAdaptiveBudget(input?: Record<string, any>): { action: 'continue' | 'compact' | 'checkpoint' | 'replan' | 'await_user' | 'stop'; reason: string; dimension?: string };
export function projectGraphToTaskSteps(graph: AdaptivePlanGraph, existingSteps?: Array<Record<string, any>>): Array<Record<string, any>>;
export const ADAPTIVE_PLAN_GRAPH_VERSION: number;
