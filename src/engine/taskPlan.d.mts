export type TaskContractMode = 'conversation' | 'answer' | 'execute';
export type TaskPlanRoute = 'direct_answer' | 'web_search' | 'inspect_connectors' | 'read_file' | 'list_files' | 'search_skills' | 'write_file' | 'run_command' | 'team_dispatch' | 'general_tools';
export type TaskPlanStepType = 'tool' | 'connector' | 'review' | 'approval' | 'human' | 'composite';

export interface TaskContract {
  contractVersion: number;
  contractId: string;
  mode: TaskContractMode;
  goal: string;
  primaryRoute: TaskPlanRoute;
  constraints: {
    required: string[];
    acceptanceCriteria: string[];
    requiresEvidence: boolean;
    needsUser: boolean;
    missingUserCondition: string;
  };
  decision: { source: 'rules' | 'model'; reason: string; confidence: number };
  context: { scope: string; parentTaskId: string; experienceRefs: string[] };
  createdAt: number;
}

export interface TaskPlanStep {
  stepId: string;
  type: TaskPlanStepType;
  connector: string;
  input: Record<string, unknown>;
  expectedOutputSchema: Record<string, unknown>;
  dependsOn: string[];
  retryPolicy: { maxRetries: number; backoffMs: number; maxBackoffMs: number };
  idempotencyKey: string;
  sideEffect: boolean;
  compensateStepId: string;
  approvalRequired: boolean;
  metadata: Record<string, unknown>;
}

export interface TaskPlan {
  planVersion: number;
  planId: string;
  contractId: string;
  goal: string;
  steps: TaskPlanStep[];
  createdAt: number;
}

export function createTaskContract(input?: Record<string, unknown>): TaskContract;
export function validateTaskContract(contract: unknown): { valid: boolean; errors: string[]; value?: TaskContract };
export function assertValidTaskContract(contract: unknown): TaskContract;
export function createPlan(input?: Record<string, unknown>): TaskPlan;
export function validatePlan(plan: unknown, options?: { allowInlineApproval?: boolean }): { valid: boolean; errors: string[]; value?: TaskPlan };
export function assertValidPlan(plan: unknown, options?: { allowInlineApproval?: boolean }): TaskPlan;
export function serializePlan(plan: TaskPlan): string;
export function parsePlan(serialized: string, options?: { allowInlineApproval?: boolean }): TaskPlan;
export const TASK_CONTRACT_VERSION: number;
export const TASK_PLAN_VERSION: number;
