export interface AutonomousToolExecutionInput {
  proposalId?: string;
  goalId?: string;
  planRevision?: number;
  stepId?: string;
  employeeId?: string;
  toolName?: string;
  toolCallId?: string;
  summary?: string;
}

export function validateAutonomousToolExecution(run?: Record<string, any>, input?: AutonomousToolExecutionInput): {
  allowed: boolean;
  errors: string[];
  reason: string;
};
export function createAutonomousToolAction(input?: AutonomousToolExecutionInput): import('./autonomousControl.mjs').AutonomousAction;
