export type TaskDecisionMode = 'conversation' | 'answer' | 'execute';
export type TaskPrimaryRoute = 'direct_answer' | 'web_search' | 'inspect_connectors' | 'read_file' | 'list_files' | 'search_skills' | 'install_skill' | 'write_file' | 'run_command' | 'team_dispatch' | 'general_tools';
export interface TaskDecision {
  mode: TaskDecisionMode;
  goal: string;
  primaryRoute: TaskPrimaryRoute;
  deliverableType: 'answer' | 'file' | 'connection' | 'operation' | 'decision' | 'mixed';
  acceptanceCriteria: string[];
  requiredConstraints: string[];
  deliverables?: Array<{ label: string; format?: string; category?: 'final' | 'working' | 'reference'; required?: boolean }>;
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
}
export interface TaskDecisionInput {
  latestMessage?: string;
  previousUserMessage?: string;
  recentHistory?: Array<{ role?: string; content?: string }>;
  availableTools?: string[];
  relevantUserContext?: string;
  relevantTaskExperience?: string;
}
export const TASK_DECISION_TOOL_NAME: 'compile_task_decision';
export const TASK_DECISION_TOOL: Record<string, unknown>;
export function createFallbackTaskDecision(input?: TaskDecisionInput): TaskDecision;
export function parseTaskDecisionToolCall(toolCalls?: Array<{ name?: string; arguments?: string }>): Record<string, unknown> | undefined;
export function normalizeTaskDecision(candidate: unknown, input?: TaskDecisionInput): TaskDecision;
export function buildTaskDecisionMessages(input?: TaskDecisionInput): Array<{ role: 'system' | 'user'; content: string }>;
export function buildTaskContract(decision: TaskDecision, taskExperience?: string): string;
