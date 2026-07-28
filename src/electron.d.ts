export {};

export interface ExecCommandResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  signal?: string;
  cwd: string;
}
export interface ExecCommandPolicy { sandboxEnabled?: boolean; env?: Record<string, string>; skillId?: string; }
export interface ConnectorPresetVerificationResult {
  ok: boolean;
  status: 'connected' | 'disconnected';
  adapter?: string;
  stage: 'configuration' | 'adapter' | 'network' | 'timeout' | 'http' | 'response' | 'business' | 'complete';
  attempts: number;
  latencyMs?: number;
  httpStatus?: number;
  code?: string | number;
  retryable?: boolean;
  message?: string;
  error?: string;
}

export interface FsEntry {
  name: string;
  type: 'file' | 'dir';
  size: number;
  modifiedAt?: number;
}
export interface FsWriteResult { ok: boolean; path?: string; size?: number; error?: string; }
export interface FsReadResult { ok: boolean; path?: string; content?: string; format?: string; size?: number; truncated?: boolean; warnings?: string[]; error?: string; }
export interface FsListResult { ok: boolean; path?: string; items?: FsEntry[]; error?: string; }
export interface FsZipResult { ok: boolean; path?: string; error?: string; }
export interface TaskLedgerChange {
  op: 'set' | 'remove';
  path: string[];
  value?: unknown;
}
export interface TaskLedgerEvent {
  eventVersion: number;
  eventId: string;
  sequence: number;
  occurredAt: number;
  type: 'task_created' | 'task_changed' | 'task_removed' | 'task_migrated';
  taskId: string;
  teamId: string;
  source: string;
  sessionId?: string;
  previousStatus?: string;
  nextStatus?: string;
  domains: string[];
  detail: string;
  payload: { snapshot?: import('./types').TaskRun; changes?: TaskLedgerChange[]; command?: { protocolVersion: number; commandId: string; type: TaskWorkerCommandType; requestedAt: number; requestedBy: string } };
  previousHash: string;
  hash: string;
}
export interface TaskLedgerIntegrity {
  ok: boolean;
  recovered: boolean;
  corruptPath?: string;
  lastSequence: number;
  lastHash: string;
  eventCount: number;
}
export type TaskWorkerCommandType = 'claim' | 'heartbeat' | 'checkpoint' | 'release' | 'pause' | 'resume' | 'stop' | 'close';
export interface TaskWorkerCommand {
  commandId?: string;
  taskId: string;
  type: TaskWorkerCommandType;
  requestedAt?: number;
  requestedBy?: string;
  sessionId?: string;
  payload?: Record<string, unknown>;
}
export interface TaskWorkerCommandResult {
  ok: boolean;
  taskId?: string;
  commandId?: string;
  type?: TaskWorkerCommandType;
  run?: import('./types').TaskRun;
  events?: TaskLedgerEvent[];
  removed?: boolean;
  idempotencyHit?: boolean;
  error?: string;
}
export interface TaskWorkerStatusResult {
  ok: boolean;
  protocolVersion?: number;
  sessionId?: string;
  pendingCommands?: number;
  activeRuns?: Array<{ taskId: string; status: string; worker: import('./types').TaskWorkerLease }>;
  integrity?: { ok: boolean; recovered: boolean; corruptPath?: string; lastSequence: number; lastHash: string; recordCount: number };
  error?: string;
}
export interface TaskWorkerCommandRecord {
  recordVersion: number;
  sequence: number;
  recordId: string;
  occurredAt: number;
  type: 'command_submitted' | 'command_completed' | 'command_failed';
  commandId: string;
  taskId: string;
  commandType: TaskWorkerCommandType;
  result?: { ok: boolean; status?: string; leaseId?: string; removed?: boolean; error?: string };
  previousHash: string;
  hash: string;
}
export type NativeExecutionJobState = 'queued' | 'running' | 'paused' | 'awaiting_user' | 'stopped' | 'failed' | 'completed';
export interface NativeExecutionJob {
  protocolVersion: number;
  jobId: string;
  taskId: string;
  state: NativeExecutionJobState;
  queuePosition?: number;
  waitingFor?: string;
  startedAt?: number;
  updatedAt: number;
  finishedAt?: number;
  currentStepId?: string;
  currentMember?: { id: string; name: string; title?: string; role?: string; model?: string };
  modelRounds: number;
  toolCalls: number;
  lastError?: string;
  eventSequence: number;
}
export interface NativeExecutionStartInput {
  taskId: string;
  run: import('./types').TaskRun;
  members: Array<import('./types').TaskRunMemberSnapshot & { modelConfig: import('./types').ModelConfig }>;
  attachments?: import('./data/hermesClient').Attachment[];
  extraSystemContext?: string;
  executionPolicy?: import('./data/hermesClient').ExecutionPolicy;
  connectors?: unknown[];
  connectorTools?: unknown[];
}
export interface NativeExecutionResult {
  ok: boolean;
  job?: NativeExecutionJob;
  jobs?: NativeExecutionJob[];
  queue?: { activeTaskId?: string; queuedTaskIds: string[]; total: number };
  idempotencyHit?: boolean;
  error?: string;
}
export interface NativeExecutionEvent {
  protocolVersion: number;
  sequence: number;
  eventId: string;
  occurredAt: number;
  taskId: string;
  jobId: string;
  type: string;
  job: NativeExecutionJob;
  [key: string]: unknown;
}
export interface TaskStoreReadResult {
  ok: boolean;
  exists?: boolean;
  schemaVersion?: number;
  ledgerVersion?: number;
  runs?: import('./types').TaskRun[];
  events?: TaskLedgerEvent[];
  integrity?: TaskLedgerIntegrity;
  error?: string;
}
export interface TaskStoreWriteResult {
  ok: boolean;
  schemaVersion?: number;
  ledgerVersion?: number;
  count?: number;
  eventsAppended?: number;
  events?: TaskLedgerEvent[];
  integrity?: TaskLedgerIntegrity;
  error?: string;
}

export type ChatWindowType = 'dm-chat' | 'team-chat' | 'assistant-chat';
export interface OpenChatOptions { type: ChatWindowType; refId: string; }
export interface OpenChatResult { ok: boolean; reused?: boolean; error?: string; }
export interface ChatLockOptions extends OpenChatOptions { locked?: boolean; }
export type ToolWindowType = 'add-employee' | 'edit-employee' | 'create-team' | 'rename-team' | 'manage-team-members' | 'connector-config' | 'assistant-settings';
export interface OpenToolOptions { type: ToolWindowType; refId?: string; payload?: unknown; }
export interface OpenToolResult { ok: boolean; reused?: boolean; error?: string; }

export interface SkillListResult { ok: boolean; skills?: import('./types').Skill[]; error?: string; }
export interface SkillReadResult { ok: boolean; skill?: { id: string; name: string; content: string; documents?: Array<{ path: string; content: string }> }; error?: string; }
export interface SkillDeleteResult { ok: boolean; error?: string; }
export interface SkillInstallResult { ok: boolean; skill?: import('./types').Skill; resolvedUrl?: string; error?: string; }
export interface SkillSourceInspection {
  name: string;
  description: string;
  installMode: 'single-file' | 'directory' | 'zip';
  resolvedUrl?: string;
  requirements: NonNullable<import('./types').Skill['requirements']>;
}
export interface SkillInspectResult { ok: boolean; inspection?: SkillSourceInspection; error?: string; }

export interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  bytesPerSecond?: number;
  total?: number;
  transferred?: number;
  message: string;
}

declare global {
  interface ElectronAPI {
    minimize: () => void;
    toggleMax: () => void;
    close: () => void;
    getAppSessionId: () => string;
    taskStoreRead: () => Promise<TaskStoreReadResult>;
    taskStoreWrite: (runs: import('./types').TaskRun[], metadata?: { source?: string; sessionId?: string }) => Promise<TaskStoreWriteResult>;
    taskLedgerRead: (options?: { taskId?: string; limit?: number }) => Promise<TaskStoreReadResult>;
    taskWorkerCommand: (command: TaskWorkerCommand) => Promise<TaskWorkerCommandResult>;
    taskWorkerStatus: () => Promise<TaskWorkerStatusResult>;
    taskWorkerCommands: (options?: { taskId?: string; limit?: number }) => Promise<{ ok: boolean; records?: TaskWorkerCommandRecord[]; integrity?: TaskWorkerStatusResult['integrity']; error?: string }>;
    taskExecutionStart: (input: NativeExecutionStartInput) => Promise<NativeExecutionResult>;
    taskExecutionStatus: (taskId?: string) => Promise<NativeExecutionResult>;
    taskExecutionEvents: (input: { taskId: string; afterSequence?: number }) => Promise<{ ok: boolean; events: NativeExecutionEvent[] }>;
    taskExecutionSteer: (input: { taskId: string; message: string }) => Promise<NativeExecutionResult>;
    onTaskWorkerChanged: (callback: (event: unknown) => void) => () => void;
    onTaskExecutionChanged: (callback: (event: NativeExecutionEvent) => void) => () => void;
    getAssistantLock: () => Promise<{ locked: boolean }>;
    setAssistantLock: (locked: boolean) => Promise<{ locked: boolean }>;
    getChatLock: (opts: OpenChatOptions) => Promise<{ locked: boolean }>;
    setChatLock: (opts: ChatLockOptions) => Promise<{ locked: boolean }>;
    setZoomFactor: (factor: number) => void;
    execCommand: (cmd: string, scope?: string, policy?: ExecCommandPolicy) => Promise<ExecCommandResult>;
    skillsList: () => Promise<SkillListResult>;
    skillsRead: (id: string) => Promise<SkillReadResult>;
    skillsDelete: (id: string) => Promise<SkillDeleteResult>;
    skillsInstall: (input: { sourceUrl: string; name?: string }) => Promise<SkillInstallResult>;
    skillsInspectSource: (sourceUrl: string) => Promise<SkillInspectResult>;
    skillsRepair: (id: string) => Promise<SkillInstallResult>;
    openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;

    // 自主代理工作区文件系统（沙箱到 userData/workspace）
    getWorkspace: () => Promise<string>;
    fsWrite: (filePath: string, content: string) => Promise<FsWriteResult>;
    fsWriteDocument: (filePath: string, content: string) => Promise<FsWriteResult & { validated?: boolean; extractedChars?: number }>;
    fsWriteData: (filePath: string, dataUrl: string) => Promise<FsWriteResult>;
    fsRead: (filePath: string) => Promise<FsReadResult>;
    fsMkdir: (dirPath: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
    fsInitWorkspace: (workspaceId: string, metadata: { kind: 'assistant' | 'dm' | 'team'; label: string; taskId?: string; workspaceId?: string; createdAt?: string }) => Promise<{ ok: boolean; path?: string; error?: string }>;
    fsCopyIntoWorkspace: (sourceScope: string, targetWorkspaceId: string, entries: Array<{ sourcePath: string; targetPath?: string }>) => Promise<{ ok: boolean; copied?: number; errors?: string[]; error?: string }>;
    fsList: (dirPath?: string, recursive?: boolean) => Promise<FsListResult>;
    fsExportZip: () => Promise<FsZipResult>;
    openPath: (p: string) => Promise<{ ok: boolean; error?: string }>;

    // 打开原生聊天窗口（真实桌面窗口，可自由拖动）
    openChat: (opts: OpenChatOptions) => Promise<OpenChatResult>;
    openSettings: () => Promise<{ ok: boolean; reused?: boolean; error?: string }>;
    openTool: (opts: OpenToolOptions) => Promise<OpenToolResult>;
    getToolPayload: (session: string) => Promise<unknown>;

    // 窗口间广播总线：broadcast 向其他窗口广播，onBroadcast 接收来自其他窗口的消息
    broadcast: (channel: string, payload: unknown) => void;
    onBroadcast: (callback: (data: { channel: string; payload: unknown }) => void) => () => void;

    // 自动更新
    checkUpdate: () => Promise<{ ok: boolean; error?: string }>;
    installUpdate: (snapshot?: unknown) => Promise<{ ok: boolean; error?: string }>;
    getUpgradeStatus: () => Promise<{ ok: boolean; currentVersion?: string; journal?: UpgradeJournal | null; error?: string }>;
    recordUpgradeValidation: (validation: { ok: boolean; employees: number; teams: number; models: number; taskRuns: number; workspaceReady: boolean }) => Promise<{ ok: boolean; recorded?: boolean; error?: string }>;
    readUpgradeBackup: () => Promise<{ ok: boolean; snapshot?: UpgradeSnapshot; fromVersion?: string; error?: string }>;
    prepareRollback: () => Promise<{ ok: boolean; installerPath?: string; fromVersion?: string; error?: string }>;
    rollbackUpgrade: () => Promise<{ ok: boolean; installerPath?: string; error?: string }>;
    onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;

    // 连接器 API 调用（主进程代理 HTTP 请求）
    connectorCall: (opts: ConnectorCallOpts) => Promise<ConnectorCallResult>;
    connectorVerifyPreset: (input: { adapter: string; credentials?: Record<string, string> }) => Promise<ConnectorPresetVerificationResult>;
    knowledgePickObsidian: () => Promise<KnowledgeVaultResult & { canceled?: boolean }>;
    knowledgeTestObsidian: (root: string) => Promise<KnowledgeVaultResult>;
    knowledgeSearchObsidian: (root: string, query: string) => Promise<{ ok: boolean; results?: Array<{ path: string; title: string; snippet: string }>; scanned?: number; error?: string }>;
    knowledgeReadObsidian: (root: string, path: string) => Promise<{ ok: boolean; path?: string; content?: string; size?: number; error?: string }>;
    knowledgeFetchUrl: (url: string) => Promise<{ ok: boolean; url?: string; title?: string; content?: string; error?: string }>;
    knowledgeSearchWeb: (query: string) => Promise<{ ok: boolean; results?: Array<{ title: string; url: string; snippet?: string }>; error?: string; provider?: string; attempts?: number; durationMs?: number }>;
  }
  interface Window {
    electronAPI?: ElectronAPI;
  }

  interface ConnectorCallOpts {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
  }
  interface ConnectorCallResult {
    ok: boolean;
    status: number;
    data: string;
    error?: string;
  }
  interface KnowledgeVaultResult {
    ok: boolean;
    path?: string;
    noteCount?: number;
    isObsidian?: boolean;
    error?: string;
  }

  interface UpgradeSnapshot { schema: number; appVersion: string; createdAt: string; localStorage: Record<string, string>; }
  interface UpgradeJournal {
    fromVersion: string; toVersion: string; backupCreatedAt: string; status: 'ready-to-install' | 'validated' | 'validation-failed' | 'rollback-prepared' | 'rolling-back';
    validation?: { ok: boolean; checkedAt?: string } | null;
    backupSummary?: { employees: number; teams: number; models: number; taskRuns: number };
  }
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
