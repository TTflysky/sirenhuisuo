import type { AutonomousAction } from './autonomousControl.mjs';

export interface AutonomousDecisionProposal {
  proposalVersion: number;
  proposalId: string;
  source: 'model' | 'runtime' | 'user' | 'system';
  goalId: string;
  planRevision: number;
  selectedAction: AutonomousAction & { employeeId?: string; toolName?: string; toolCallId?: string; requiredUserInput?: string };
  observedFactIds: string[];
  publicRationale: string;
  expectedEvidence: string[];
  riskLevel: 'low' | 'medium' | 'high';
  approvalRequired: boolean;
  createdAt: number;
}

export interface AutonomousDecisionAuthority {
  source: string;
  accepted: boolean;
  proposalId?: string;
  approvalRequired?: boolean;
  reason: string;
}

export function createAutonomousDecisionProposal(input?: Record<string, any>, run?: Record<string, any>): AutonomousDecisionProposal;
export function validateAutonomousDecisionProposal(run?: Record<string, any>, input?: Record<string, any>): { valid: boolean; errors: string[]; proposal: AutonomousDecisionProposal; requiresApproval: boolean };
export function selectAutonomousDecision(run?: Record<string, any>, fallbackAction?: AutonomousAction, input?: Record<string, any>, options?: { consumedProposalId?: string }): { action: AutonomousAction; authority: AutonomousDecisionAuthority; proposal?: AutonomousDecisionProposal };
export const AUTONOMOUS_DECISION_PROPOSAL_VERSION: number;
