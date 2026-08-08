export type TaskDecisionMode = 'conversation' | 'answer' | 'execute';
export type TaskTurnRelation = 'new_task' | 'continuation' | 'correction' | 'control' | 'question';
export type TaskPrimaryRoute = 'direct_answer' | 'web_search' | 'inspect_connectors' | 'read_file' | 'list_files' | 'search_skills' | 'install_skill' | 'write_file' | 'run_command' | 'team_dispatch' | 'general_tools';
export interface TaskDecisionAuditReason {
  stage: 'understanding' | 'context' | 'governance' | 'plan';
  code: string;
  field?: string;
  detail: string;
}
export interface TaskDecisionAuditLayer {
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  rejectedReasons: TaskDecisionAuditReason[];
}
export interface TaskDecisionAudit {
  version: number;
  generatedAt: number;
  layers: {
    understanding: TaskDecisionAuditLayer;
    context: TaskDecisionAuditLayer;
    governance: TaskDecisionAuditLayer;
    plan: TaskDecisionAuditLayer;
  };
  model?: { attempted: boolean; failureClass?: string };
}
export interface TaskDecision {
  mode: TaskDecisionMode;
  turnRelation: TaskTurnRelation;
  goal: string;
  primaryRoute: TaskPrimaryRoute;
  deliverableType: 'answer' | 'file' | 'connection' | 'operation' | 'decision' | 'mixed';
  acceptanceCriteria: string[];
  requiredConstraints: string[];
  deliverables?: Array<{ id?: string; label: string; format?: string; type?: 'answer' | 'file' | 'connection' | 'operation' | 'decision' | 'mixed'; category?: 'final' | 'working' | 'reference'; required?: boolean; objective?: string; acceptanceCriteria?: string[]; requiredCapabilities?: string[]; dependsOn?: string[]; outputPath?: string; verification?: string[] }>;
  requiredCapabilities?: string[];
  riskLevel?: 'low' | 'normal' | 'high';
  teamPolicy?: { requiresTeam?: boolean; explicitMemberIds?: string[]; allowDynamicDelegation?: boolean };
  requiresEvidence: boolean;
  needsUser: boolean;
  missingUserCondition: string;
  searchQuery: string;
  decisionReason: string;
  confidence: number;
  source: 'rules' | 'model';
  decisionAudit?: TaskDecisionAudit;
}
export interface TaskDecisionInput {
  latestMessage?: string;
  previousUserMessage?: string;
  activeTaskGoal?: string;
  recentHistory?: Array<{ role?: string; content?: string }>;
  availableTools?: string[];
  relevantUserContext?: string;
  relevantTaskExperience?: string;
  attachments?: Array<{ name?: string; kind?: string; size?: number }>;
  userMessages?: string[];
}
export const TASK_DECISION_TOOL_NAME: 'compile_task_decision';
export const TASK_DECISION_TOOL: Record<string, unknown>;
export function createFallbackTaskDecision(input?: TaskDecisionInput): TaskDecision;
export function createDeterministicSkillInstallDecision(input?: TaskDecisionInput): TaskDecision | undefined;
export function parseTaskDecisionToolCall(toolCalls?: Array<{ name?: string; arguments?: string }>): Record<string, unknown> | undefined;
export function normalizeTaskDecision(candidate: unknown, input?: TaskDecisionInput): TaskDecision;
export function classifyTaskTurnIntent(message: string, activeTaskGoal?: string): 'conversation' | 'answer' | 'execute_request' | 'resume_control' | 'follow_up_question' | 'feedback_or_correction';
export function buildTaskDecisionMessages(input?: TaskDecisionInput): Array<{ role: 'system' | 'user'; content: string }>;
export function buildTaskContract(decision: TaskDecision, taskExperience?: string): string;
