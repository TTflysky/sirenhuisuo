// ===== 角色标识：沿用 OPC 铁律 4 角色 + 真人 + 自定义 =====
export type OpcRoleId = 'pm' | 'planner' | 'coder' | 'checker' | 'custom';
export type RoleId = OpcRoleId | 'human';

// ===== 员工模型配置（可选，覆盖全局设置）=====
export interface ModelConfig {
  provider?: string;     // 服务商 key（对应 PROVIDER_PRESETS）
  apiHost?: string;      // 完整 base_url
  apiKey?: string;       // API Key
  model?: string;        // 模型名
  /** 模型官方标称的最大上下文长度；未填写时必须明确显示为未知。 */
  contextWindowTokens?: number;
  refModelId?: string;   // 引用模型库中的模型 ID（优先，不为空时忽略上面字段）
}

// ===== 员工（扩展自原 Role）=====
export interface Employee {
  id: string;
  name: string;
  title: string;
  role: OpcRoleId;
  avatar: string;        // 预设 key 或自定义 base64/dataURL
  avatarKind: 'preset' | 'custom';
  statusColor: string;   // 角色色
  avatarFrame?: AvatarFrameConfig;
  stationIndex: number;  // 0..MAX_STATIONS-1
  prompt?: string;       // 个性提示词（人设/说话风格），用于私聊回应
  soul?: string;         // 核心人格文件（soul.md），深度人设描述
  currentTeamId?: string;
  currentTask?: string;
  isOnline: boolean;
  isWorking: boolean;
  useCustomModel?: boolean; // 显式开启后才使用员工独立模型；旧数据缺省时兼容 modelConfig
  modelConfig?: ModelConfig;  // 独立模型配置（留空则用全局设置）
  showThoughtChain?: boolean; // 是否显示思维链（可视化推理过程）
}

// ===== 团队 =====
export interface Team {
  id: string;
  name: string;
  icon?: string;
  memberIds: string[];
  chatMessages: ChatMessage[];
  tasks: TeamTask[];
  archived?: boolean;     // 归档后不出现在活跃列表，可恢复
  projectId?: string;
}

export type ProjectStatus = 'awaiting_approval' | 'running' | 'completed' | 'failed' | 'archived';

export interface ProjectMember {
  employeeId: string;
  reason: string;
}

export interface Project {
  id: string;
  title: string;
  request: string;
  steps: string[];
  expectedOutputs: string[];
  members: ProjectMember[];
  status: ProjectStatus;
  teamId?: string;
  createdAt: number;
  updatedAt: number;
}

// ===== 群聊消息 =====
export interface Skill {
  id: string;
  name: string;
  description: string;
  source: string;
  scope?: 'built-in' | 'mine';
  version?: string;
  pathHash: string;
  health?: 'ready' | 'limited';
  healthMessage?: string;
}
export interface SkillReference { id: string; name: string; }

export type DiscussionUrgency = 'low' | 'normal' | 'high' | 'critical';
export type DiscussionTriggerSource = 'manual' | 'message' | 'task' | 'mention-followup';

export interface DiscussionTriggerInput {
  teamId: string;
  messageId: string;
  userText: string;
  mentions: string[];
  hasAttachments: boolean;
  recentMessages: ChatMessage[];
  activeTaskCount: number;
  manual: boolean;
  now: number;
}

export interface DiscussionTriggerDecision {
  shouldStart: boolean;
  score: number;
  urgency: DiscussionUrgency;
  needsCollaboration: boolean;
  reasonCodes: string[];
  forcedMemberIds: string[];
  dedupeKey: string;
  cooldownUntil: number;
}

export interface DiscussionParticipantPlan {
  memberId: string;
  priority: 'forced' | 'high' | 'normal';
  relevanceScore: number;
  reason: 'mentioned' | 'role-match' | 'keyword-match' | 'task-lane' | 'fallback';
  maxResponses: number;
}

export interface ChatMessage {
  id: string;
  authorId: string;
  roleId: RoleId;
  content: string;
  mentions: string[];
  timestamp: number;
  discussionId?: string;
  discussionRound?: number;
  triggeredBy?: DiscussionTriggerSource;
  inReplyToMessageId?: string;
  kind?: 'text' | 'task' | 'execution';
  taskRef?: string;
  tokens?: number;     // 本条 AI 回复消耗的 token 数（仅模型回复有）
  /** 最近一次实际模型请求的输入上下文；用于显示模型容量，不会伪造上限。 */
  contextUsage?: import('./data/hermesClient').ContextUsage;
  attachments?: import('./data/hermesClient').Attachment[]; // 用户上传/粘贴的附件
  skillRefs?: SkillReference[];
  thoughtChain?: ThoughtChainStep[]; // 思维链步骤（AI 推理过程记录）
}

/** 思维链单步——记录 AI 工具调用的完整推理过程 */
export interface ThoughtChainStep {
  toolName: string;
  args: string;
  result: string;
  success: boolean;
  timestamp: number;
}

// ===== 团队内任务卡 =====
export type TaskLane = 'PLANNING' | 'CODING' | 'REVIEW' | 'DONE';

export interface TeamTask {
  id: string;
  title: string;
  lane: TaskLane;
  assigneeId?: string;
  description?: string;
  acceptance?: string;
  claimedBy?: string;
}

export interface AvatarFrameConfig {
  presetId: string;
  primaryColor?: string;
  secondaryColor?: string;
  label?: string;
}

// ===== 可恢复任务运行（v0.4 调度内核） =====
export type TaskRunStatus = 'queued' | 'running' | 'paused' | 'stopped' | 'failed' | 'completed';
export type TaskStepStatus = 'queued' | 'running' | 'paused' | 'stopped' | 'failed' | 'completed';
export type TaskStepKind = 'work' | 'review' | 'revision';
export type TaskRunPhase = 'preflight' | 'executing' | 'verifying' | 'blocked' | 'completed';
export type TaskEvidence = { ts: number; source: 'tool' | 'member' | 'review' | 'system'; summary: string; verified?: boolean };

export interface TaskPlanStep {
  id: string;
  employeeId: string;
  order: number;
  kind: TaskStepKind;
  title: string;
  assignment: string;
  dependsOnStepIds: string[];
  revisionOfStepId?: string;
}

export interface TaskRunMemberSnapshot {
  id: string;
  name: string;
  title: string;
  role: OpcRoleId;
  prompt?: string;
  soul?: string;
  model?: string;
}

export interface TaskRunStep {
  id: string;
  employeeId: string;
  title: string;
  order: number;
  kind: TaskStepKind;
  assignment: string;
  dependsOnStepIds: string[];
  revisionOfStepId?: string;
  reviewDecision?: 'pass' | 'reject';
  reviewReason?: string;
  responsibleEmployeeId?: string;
  status: TaskStepStatus;
  attempts: number;
  startedAt?: number;
  completedAt?: number;
  lastError?: string;
  evidence?: TaskEvidence[];
  events: Array<{ ts: number; type: 'status' | 'tool' | 'result' | 'error'; detail: string }>;
}

export interface TaskRun {
  id: string;
  teamId: string;
  /** 任务专属真实工作区，相同任务的恢复执行会继续使用此目录。 */
  workspaceId?: string;
  projectId?: string;
  title: string;
  request: string;
  status: TaskRunStatus;
  createdAt: number;
  updatedAt: number;
  memberSnapshot: TaskRunMemberSnapshot[];
  steps: TaskRunStep[];
  skillRefs?: SkillReference[];
  sourceMessageId?: string;
  lastError?: string;
  revisionCount?: number;
  maxRevisions?: number;
  phase?: TaskRunPhase;
  goal?: string;
  acceptanceCriteria?: string[];
  preflight?: Array<{ label: string; status: 'pending' | 'passed' | 'blocked'; detail?: string }>;
  evidence?: TaskEvidence[];
  handoff?: { ts: number; completed: string[]; blocked: string; nextAction: string };
}

// ===== 应用状态 =====
export const MAX_STATIONS = 12;

export interface AgentStatus {
  backendOnline: boolean;
  demoRunning: boolean;
  activeDemoTeamId?: string;
  progress?: DiscussionProgress;  // 团队 AI 讨论实时进度
}

// ===== 团队讨论实时进度 =====
export interface DiscussionProgress {
  teamId: string;
  teamName: string;
  step: number;            // 当前是第几步（1-based）
  totalSteps: number;      // 总步数
  currentEmpId?: string;   // 当前发言员工
  currentEmpName?: string;
  currentRole?: OpcRoleId;
  model?: string;          // 调用的模型
  scene: 'discussion' | 'task';
  startedAt: number;       // Date.now() 起始时间
  estimatedMs: number;     // 预计总时长
  lastUpdate: number;      // 最近更新时间（用于心跳）
}

export interface AppState {
  employees: Employee[];
  teams: Team[];
  projects: Project[];
  taskRuns: TaskRun[];
  status: AgentStatus;
}

// ===== 角色→围巾色映射 =====
export const ROLE_SCARF: Record<OpcRoleId, string> = {
  pm: '#ef4444',
  planner: '#22d3ee',
  coder: '#22c55e',
  checker: '#a855f7',
  custom: '#64748b',
};

// ===== Lane 辅助 =====
export const LANES: TaskLane[] = ['PLANNING', 'CODING', 'REVIEW', 'DONE'];
