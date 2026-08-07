import type { ReactNode } from 'react';

type ElectronTypeModuleMarker = ReactNode | undefined;

export interface ExecCommandResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  signal?: string;
  cwd: string;
}
export interface ExecCommandPolicy { sandboxEnabled?: boolean; env?: Record<string, string>; skillId?: string; }
export interface WebArtifactViewportResult {
  width: number; height: number; label: string; horizontalOverflow: boolean;
  overflowingElements: Array<Record<string, unknown>>; clippedElements: Array<Record<string, unknown>>;
  unsafeFramedElements: Array<Record<string, unknown>>; smallControls: Array<Record<string, unknown>>;
  screenshot: string; screenshotPath: string; screenshotBytes: number;
  viewport: { innerWidth: number; innerHeight: number; clientWidth: number; visualWidth: number; usableWidth: number };
  semantic?: WebArtifactSemanticSummary;
}
export interface WebArtifactSemanticCheck {
  id?: string; label?: string; type: 'group' | 'order' | 'adjacent' | 'grid' | 'interaction' | 'visible' | 'count' | 'canvas_nonblank'; viewports?: string[];
  container?: string; members?: string[]; selectors?: string[]; axis?: 'dom' | 'horizontal' | 'vertical' | 'reading';
  first?: string; second?: string; direction?: 'left' | 'right' | 'above' | 'below'; maxGap?: number; tolerance?: number;
  selector?: string; minCount?: number; maxCount?: number; minPixels?: number; minCoverage?: number;
  cells?: Array<{ selector: string; row: number; column: number }>; rowTolerance?: number; columnTolerance?: number;
  steps?: Array<{ action: 'click' | 'input' | 'select' | 'check'; selector: string; value?: string; waitMs?: number }>;
  assertions?: Array<{ selector: string; property: 'text' | 'value' | 'visible' | 'hidden' | 'checked' | 'attribute'; equals?: string; includes?: string; attribute?: string }>;
}
export interface WebArtifactSemanticSummary {
  checked: number; passed: number; failed: number;
  results: Array<{ id: string; label: string; type: WebArtifactSemanticCheck['type']; ok: boolean; failures: string[]; evidence: Record<string, unknown> }>;
}
export interface WebArtifactVerificationResult {
  ok: boolean; error?: string; artifactPath?: string; workspaceId?: string; checked?: number; failed?: string[];
  runtimeErrors?: string[]; viewports: WebArtifactViewportResult[];
}
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
export interface ConnectorPresetActionResult extends ConnectorPresetVerificationResult {
  action?: string;
  data?: unknown;
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
  snapshotValid?: boolean;
  indexValid?: boolean;
  snapshotRebuilt?: boolean;
  indexRebuilt?: boolean;
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
  lastProgressAt?: number;
  currentActivity?: string;
  finishedAt?: number;
  currentStepId?: string;
  currentMember?: { id: string; name: string; title?: string; role?: string; model?: string };
  modelRounds: number;
  toolCalls: number;
  lastError?: string;
  eventSequence: number;
  semanticState?: { status: NativeExecutionJobState; phase: string; rawState: string; active: boolean; terminal: boolean; waiting: boolean };
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
  reviewModelConfig?: import('./types').ModelConfig;
  memoryWriteApproval?: boolean;
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
export interface TaskDelegationCreateInput {
  taskId: string;
  parentStepId?: string;
  employeeId?: string;
  title?: string;
  assignment: string;
  acceptanceCriteria?: string[];
}
export interface TaskDelegationResult {
  ok: boolean;
  delegation?: import('./engine/taskDelegation.mjs').TaskDelegation;
  delegations?: import('./engine/taskDelegation.mjs').TaskDelegation[];
  step?: import('./types').TaskRunStep;
  total?: number;
  counts?: Record<string, number>;
  active?: import('./engine/taskDelegation.mjs').TaskDelegation[];
  job?: NativeExecutionJob;
  error?: string;
}
export interface WorktreeRecord {
  protocolVersion: number;
  taskId: string;
  sourceRepo: string;
  path: string;
  workspaceId: string;
  branch: string;
  baseRef: string;
  head: string;
  state: 'active' | 'released';
  createdAt: number;
  updatedAt: number;
  lastCheckpointId?: string;
  clean?: boolean;
  changes?: string[] | number;
}
export interface WorktreeResult {
  ok: boolean;
  worktree?: WorktreeRecord;
  checkpoint?: { checkpointId: string; taskId: string; head: string; patchPath: string; patchSha256: string; untracked: Array<{ path: string; size: number; sha256: string }>; createdAt: number };
  idempotencyHit?: boolean;
  recovered?: boolean;
  released?: boolean;
  recoverable?: boolean;
  sourceRepo?: string;
  head?: string;
  branch?: string;
  clean?: boolean;
  changes?: number;
  version?: string;
  active?: number;
  worktreesRoot?: string;
  error?: string;
}
export interface EcosystemHealthCheck {
  id: 'identity' | 'task-store' | 'worker' | 'tools' | 'skills' | 'memory' | 'learning-review' | 'workspace' | 'worktree';
  title: string;
  status: 'ready' | 'warning' | 'blocked';
  summary: string;
  detail: string;
  critical: boolean;
}
export interface EcosystemHealthReport {
  ok: boolean;
  healthVersion: number;
  mode: 'runtime' | 'release';
  appVersion: string;
  checkedAt: number;
  status: 'ready' | 'warning' | 'blocked';
  canRelease: boolean;
  ready: number;
  warning: number;
  blocked: number;
  checks: EcosystemHealthCheck[];
}
export interface TaskStoreReadResult {
  ok: boolean;
  exists?: boolean;
  schemaVersion?: number;
  ledgerVersion?: number;
  runs?: import('./types').TaskRun[];
  page?: { cursor: number; nextCursor?: number; total: number };
  events?: TaskLedgerEvent[];
  integrity?: TaskLedgerIntegrity;
  error?: string;
}
export interface TaskStoreQueryOptions {
  taskId?: string;
  teamId?: string;
  projectId?: string;
  conversationId?: string;
  status?: string;
  statuses?: string[];
  query?: string;
  updatedAfter?: number;
  updatedBefore?: number;
  afterSequence?: number;
  beforeSequence?: number;
  cursor?: number;
  limit?: number;
}
export interface TaskRecoveryPointSummary {
  recoveryPointId: string;
  label: string;
  taskId?: string;
  createdAt: number;
  lastSequence: number;
  runCount: number;
  checksum: string;
}
export interface TaskRecoveryResult {
  ok: boolean;
  recoveryPoint?: TaskRecoveryPointSummary & { runs?: import('./types').TaskRun[] };
  recoveryPoints?: TaskRecoveryPointSummary[];
  recoveryPointId?: string;
  sequence?: number;
  headHash?: string;
  checksum?: string;
  runs?: import('./types').TaskRun[];
  eventsAppended?: number;
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

export interface OperationDiagnosticEntry {
  id: string;
  occurredAt: number;
  level: 'info' | 'warning' | 'error';
  scope: string;
  operation: string;
  taskId?: string;
  teamId?: string;
  errorCode?: string;
  failureClass: string;
  recoverable: boolean;
  message: string;
  context?: Record<string, unknown>;
}

export interface RuntimeTelemetryEvent {
  eventId: string;
  occurredAt: number;
  type: string;
  source: string;
  severity: 'info' | 'warning' | 'error';
  status?: string;
  taskId?: string;
  projectId?: string;
  stepId?: string;
  actorId?: string;
  modelId?: string;
  toolCallId?: string;
  durationMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  failureClass?: string;
  public?: { summary?: string; error?: string; metadata?: Record<string, unknown> };
}

export interface RuntimeDashboard {
  ok: boolean;
  generatedAt: number;
  project?: { projectId: string; rootTaskId?: string; title: string; phase: string; lastMeaningfulAction?: string };
  counts: { total: number; completed: number; running: number; queued: number; waitingUser: number; paused: number; failed: number; stopped: number; completedSteps: number; totalSteps: number; artifacts: number; verifiedArtifacts: number };
  approvals: Array<{ taskId: string; approvalId?: string; title: string; reason: string; requestedBy: string; scope: string; createdAt: number }>;
  waitingConditions: Array<{ taskId: string; title: string; reason: string }>;
  activeWork: Array<{ taskId: string; stepId: string; actorId?: string; actorName: string; title: string; activity: string; startedAt: number }>;
  meaningfulEvents: RuntimeTelemetryEvent[];
  technical: { telemetryEvents: number; errors: number; warnings: number; latest: RuntimeTelemetryEvent[] };
  error?: string;
}

export interface TaskServiceTask {
  id: string;
  taskServiceVersion?: number;
  taskType: 'assistant' | 'dm' | 'team' | 'child';
  teamId: string;
  ownerId: string;
  parentTaskId?: string;
  projectId?: string;
  conversationId?: string;
  workspaceId?: string;
  workspace?: { mode?: string; status?: string; workspaceId?: string; sourceRepo?: string };
  title: string;
  request: string;
  goal: string;
  status: string;
  phase?: string;
  acceptanceCriteria: string[];
  steps: Array<Record<string, unknown>>;
  toolAttempts: Array<Record<string, unknown>>;
  artifacts: Array<Record<string, unknown>>;
  references: Array<Record<string, unknown>>;
  createdAt: number;
  updatedAt: number;
  turnLifecycle?: import('./engine/turnLifecycle.mjs').TurnLifecycleState;
  lifecycleRecovery?: Record<string, unknown>;
}

export interface TaskServiceResult {
  ok: boolean;
  created?: boolean;
  idempotent?: boolean;
  task?: TaskServiceTask;
  run?: TaskServiceTask;
  runs?: TaskServiceTask[];
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
export interface SkillInstallResult {
  ok: boolean;
  skill?: import('./types').Skill;
  resolvedUrl?: string;
  requestedSourceUrl?: string;
  slug?: string;
  verification?: { verified: boolean; manifestReadable: boolean; skillId: string; health?: string; documentCount: number; sourceFileCount?: number; bundleHash?: string; checkedAt: string };
  error?: string;
}
export interface SkillMarketSearchResult {
  ok: boolean;
  query?: string;
  results?: Array<{ slug: string; name: string; description?: string; category?: string; downloads?: number; installs?: number; version?: string; homepage?: string }>;
  error?: string;
}
export interface SkillSourceInspection {
  name: string;
  description: string;
  installMode: 'single-file' | 'directory' | 'zip';
  resolvedUrl?: string;
  requirements: NonNullable<import('./types').Skill['requirements']>;
}
export interface SkillInspectResult { ok: boolean; inspection?: SkillSourceInspection; error?: string; }
export interface SkillDraft {
  id: string; status: 'pending' | 'approved' | 'rejected'; action: 'create' | 'replace' | 'patch'; name: string;
  description?: string; targetSkillName?: string; reason?: string; taskId?: string; candidateId?: string; projectId?: string;
  taskIds?: string[]; evidenceIds?: string[]; routeFingerprint?: string; route?: string[]; permissions?: string[]; risk?: 'low' | 'medium' | 'high';
  content?: string; previousContent?: string; diff?: string; bundlePaths?: string[];
  validation?: { passed: boolean; checkedAt: number; checks: Array<{ id: string; label: string; status: 'passed' | 'failed'; message: string }> };
  rollout?: { mode: 'canary'; targetInvocations: number; failureLimit: number };
  createdAt: number; updatedAt: number;
}

export interface AutonomyEvaluationMetric {
  numerator?: number;
  denominator?: number;
  percent?: number;
  total?: number;
  toolCalls?: number;
  perHundredCalls?: number;
  minutes?: number;
  maxWindows?: number;
  maxEmployees?: number;
}
export interface AutonomyEvaluationObservation {
  observationId: string;
  sessionId: string;
  scenarioId: string;
  status: 'passed' | 'failed' | 'blocked' | 'skipped';
  source: string;
  sourceRef?: string;
  taskId?: string;
  projectId?: string;
  note?: string;
  observedAt: number;
}
export interface AutonomyEvaluationSummary {
  ok: boolean;
  version?: string;
  error?: string;
  activeSession?: { sessionId: string; label: string; mode: 'live' | 'automated'; status: string; startedAt: number; targetMinutes: number; updatedAt?: number; lastCaptureAt?: number; lastObservationAt?: number };
  latestSession?: { sessionId: string; label: string; mode: 'live' | 'automated'; status: string; startedAt: number; completedAt?: number; targetMinutes: number; updatedAt?: number; lastCaptureAt?: number; lastObservationAt?: number };
  selectedSession?: { sessionId: string; label: string; mode: 'live' | 'automated'; status: string; startedAt: number; completedAt?: number; targetMinutes: number; updatedAt?: number; lastCaptureAt?: number; lastObservationAt?: number };
  coverage?: { total: number; observed: number; passed: number; failed: number; blocked: number; percent: number; scenarios: Array<{ id: string; category: string; title: string; observed: number; passed: number; failed: number; blocked: number; latest?: AutonomyEvaluationObservation }> };
  metrics?: Record<string, AutonomyEvaluationMetric>;
  latestObservations?: AutonomyEvaluationObservation[];
}
export interface SkillCandidate {
  candidateId: string; projectId?: string; name: string; description?: string; reason?: string;
  status: 'collecting' | 'eligible' | 'compiling' | 'validation_failed' | 'pending_approval' | 'canary' | 'active' | 'disabled' | 'rejected' | 'rolled_back';
  taskIds: string[]; evidenceIds: string[]; independentTaskCount: number; successes: number; failures: number;
  successRate: number; failureRate: number; route: string[]; routeFingerprint?: string; routeSimilarity: number;
  permissions: string[]; risk: 'low' | 'medium' | 'high'; failureModes: string[]; draftId?: string;
  eligibility?: { eligible: boolean; reasons: string[] }; validation?: SkillDraft['validation']; createdAt: number; updatedAt: number;
}
export interface SkillRollout {
  rolloutId: string; candidateId: string; draftId: string; skillName: string;
  status: 'canary' | 'active' | 'disabled' | 'rolled_back'; targetInvocations: number; failureLimit: number;
  successes: number; failures: number; successRate: number; failureTypes?: Record<string, number>; disableReason?: string;
  invocations: Array<{ invocationId: string; skillId?: string; taskId?: string; status: 'succeeded' | 'failed'; failureClass?: string; evidence?: string; occurredAt: number }>;
  createdAt: number; updatedAt: number;
}
export interface LayeredMemoryEntry {
  id: string; memoryId?: string; scope: 'organization' | 'project' | 'team' | 'employee' | 'user'; scopeId: string; projectId?: string;
  category: 'identity' | 'preference' | 'constraint' | 'workflow' | 'decision' | 'project' | 'lesson';
  memoryKind: 'episodic' | 'semantic' | 'procedural' | 'preference';
  content: string; source: string; sourceType: 'manual' | 'legacy' | 'task-review' | 'review-model' | 'rollback'; taskId?: string; sourceTaskId?: string; employeeId?: string;
  evidence: string[]; evidenceIds?: string[]; acceptanceVerified?: boolean; importance: number; confidence: number; status?: 'active' | 'superseded' | 'archived' | 'legacy'; supersedes?: string; reviewAfter?: number; createdAt: number; updatedAt: number;
}
export interface MemoryProposal {
  id: string; status: 'pending' | 'approved' | 'rejected'; taskId?: string; summary: string;
  update: Partial<LayeredMemoryEntry> & { replaceExact?: string }; source: string; createdAt: number; updatedAt: number; warnings?: string[];
}
export interface LayeredMemoryResult {
  ok: boolean; entries?: LayeredMemoryEntry[]; proposals?: MemoryProposal[]; context?: string;
  audit?: Array<Record<string, unknown>>; limits?: Record<string, number>;
  usage?: Record<string, { current: number; max: number; percent: number }>;
  references?: Array<{ memoryId: string; scope: LayeredMemoryEntry['scope']; scopeId: string; score: number; reason: string }>; retrievalId?: string;
  retrievals?: Array<Record<string, unknown>>;
  action?: string; error?: string;
}
export interface LearningReviewItem {
  id: string; taskId: string; teamId: string; status: 'queued' | 'processing' | 'waiting_model' | 'completed' | 'failed';
  attempts: number; lastError?: string; createdAt: number; updatedAt: number;
  result?: { verifiedMemories: number; memoryProposalIds: string[]; skillCandidateIds: string[]; skillDraftIds: string[] };
}

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
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
    taskStoreQuery: (options?: TaskStoreQueryOptions) => Promise<TaskStoreReadResult>;
    taskStoreWrite: (runs: import('./types').TaskRun[], metadata?: { source?: string; sessionId?: string }) => Promise<TaskStoreWriteResult>;
    taskServiceRead: (options?: TaskStoreQueryOptions) => Promise<TaskServiceResult>;
    taskServiceCreate: (input: Record<string, unknown>) => Promise<TaskServiceResult>;
    taskServiceUpdate: (input: { taskId: string; patch?: Record<string, unknown>; detail?: string }) => Promise<TaskServiceResult>;
    taskServiceToolAttempt: (input: Record<string, unknown> & { taskId: string; toolName: string }) => Promise<TaskServiceResult>;
    taskServiceArtifact: (input: Record<string, unknown> & { taskId: string; name: string; path: string }) => Promise<TaskServiceResult>;
    taskServiceReference: (input: Record<string, unknown> & { taskId: string; label: string }) => Promise<TaskServiceResult>;
    taskServiceCreateChild: (input: Record<string, unknown> & { parentTaskId: string }) => Promise<TaskServiceResult>;
    taskServiceContext: (input: { taskId: string; limit?: number }) => Promise<TaskServiceResult & { goal?: string; acceptanceCriteria?: string[]; references?: Array<Record<string, unknown>>; verifiedArtifacts?: Array<Record<string, unknown>> }>;
    taskServiceReadySteps: (taskId: string) => Promise<TaskServiceResult & { steps?: Array<Record<string, unknown>> }>;
    taskServiceCompleteStep: (input: Record<string, unknown> & { taskId: string; stepId: string }) => Promise<TaskServiceResult>;
    taskServiceReviewDecision: (input: Record<string, unknown> & { taskId: string; reviewStepId: string; approved: boolean; responsibleStepId?: string }) => Promise<TaskServiceResult>;
    taskServiceFailStep: (input: Record<string, unknown> & { taskId: string; stepId: string }) => Promise<TaskServiceResult>;
    taskServiceRequestApproval: (input: Record<string, unknown> & { taskId: string; reason: string }) => Promise<TaskServiceResult>;
    taskServiceDecideApproval: (input: Record<string, unknown> & { taskId: string; approvalId: string; decision: 'approved' | 'rejected' }) => Promise<TaskServiceResult>;
    taskServiceUsage: (input: Record<string, unknown> & { taskId: string }) => Promise<TaskServiceResult>;
    taskServiceMetrics: (taskId: string) => Promise<TaskServiceResult & { durationMs?: number; tools?: Record<string, unknown>; usage?: Record<string, unknown> }>;
    taskServiceTree: (taskId: string) => Promise<TaskServiceResult & { rootTaskId?: string; tree?: { nodes: Array<Record<string, unknown>>; totals: Record<string, number>; generatedAt: number } }>;
    taskServiceRecoveryPlan: (taskId: string) => Promise<TaskServiceResult & { plan?: { rootTaskId: string; rootStatus: string; ready: boolean; resumeOrder: Array<Record<string, unknown>>; blockers: Array<Record<string, unknown>>; compensationOrder: Array<Record<string, unknown>>; nextAction: string; generatedAt: number } }>;
    taskServiceHeartbeat: (input: { taskId: string; state?: string; detail?: string; activity?: string; workspaceId?: string; observedAt?: number; progressAt?: number }) => Promise<TaskServiceResult>;
    taskServiceLifecycle: (input: { taskId: string; lifecycle: import('./engine/turnLifecycle.mjs').TurnLifecycleState; recovery?: Record<string, unknown> }) => Promise<TaskServiceResult>;
    taskServiceCheckpoint: (input: Record<string, unknown> & { taskId: string; label?: string }) => Promise<TaskServiceResult>;
    taskServiceVerification: (input: Record<string, unknown> & { taskId: string; label: string; status: 'passed' | 'failed' | 'blocked' }) => Promise<TaskServiceResult>;
    taskServiceValidateCompletion: (taskId: string) => Promise<TaskServiceResult & { passed?: boolean; checks?: Array<Record<string, unknown>> }>;
    taskServiceStatus: (input: { taskId: string; status: string; detail?: string }) => Promise<TaskServiceResult>;
    taskServiceResolveFactConflict: (input: { taskId: string; conflictId: string; resolution: 'accept_latest' | 'keep_previous' | 'accept_both' | 'dismiss'; resolvedBy?: string }) => Promise<TaskServiceResult>;
    taskLedgerRead: (options?: { taskId?: string; limit?: number }) => Promise<TaskStoreReadResult>;
    taskLedgerAudit: (options?: TaskStoreQueryOptions) => Promise<TaskStoreReadResult>;
    taskRecoveryCreate: (options?: { taskId?: string; label?: string }) => Promise<TaskRecoveryResult>;
    taskRecoveryList: (options?: { taskId?: string; limit?: number }) => Promise<TaskRecoveryResult>;
    taskRecoveryRebuild: (options?: { taskId?: string; sequence?: number }) => Promise<TaskRecoveryResult>;
    taskRecoveryRestore: (input: { recoveryPointId: string; metadata?: { source?: string; sessionId?: string; replaceAll?: boolean } }) => Promise<TaskRecoveryResult>;
    taskWorkerCommand: (command: TaskWorkerCommand) => Promise<TaskWorkerCommandResult>;
    taskWorkerStatus: () => Promise<TaskWorkerStatusResult>;
    taskWorkerCommands: (options?: { taskId?: string; limit?: number }) => Promise<{ ok: boolean; records?: TaskWorkerCommandRecord[]; integrity?: TaskWorkerStatusResult['integrity']; error?: string }>;
    taskExecutionStart: (input: NativeExecutionStartInput) => Promise<NativeExecutionResult>;
    taskExecutionStatus: (taskId?: string) => Promise<NativeExecutionResult>;
    taskExecutionEvents: (input: { taskId: string; afterSequence?: number }) => Promise<{ ok: boolean; events: NativeExecutionEvent[] }>;
    taskExecutionObservability: (taskId?: string) => Promise<{ ok: boolean; task?: Record<string, unknown>; tasks?: Array<Record<string, unknown>>; queue?: NativeExecutionResult['queue'] }>;
    taskExecutionDecideApproval: (input: { taskId: string; approvalId: string; decision: 'approved' | 'rejected'; note?: string }) => Promise<NativeExecutionResult & { approval?: import('./types').TaskApprovalContract }>;
    diagnosticsRecord: (input: Partial<OperationDiagnosticEntry> & { message: string }) => Promise<{ ok: boolean; error?: string }>;
    diagnosticsQuery: (options?: { taskId?: string; teamId?: string; failureClass?: string; level?: OperationDiagnosticEntry['level']; limit?: number }) => Promise<{ ok: boolean; entries: OperationDiagnosticEntry[]; total: number; filePath?: string }>;
    diagnosticsSummary: (options?: { taskId?: string; teamId?: string }) => Promise<{ ok: boolean; total: number; errors: number; recoverable: number; byFailureClass: Record<string, number>; latest: OperationDiagnosticEntry[] }>;
    diagnosticsExport: (options?: { taskId?: string; teamId?: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; count?: number; error?: string }>;
    telemetryQuery: (options?: { taskId?: string; projectId?: string; type?: string; severity?: RuntimeTelemetryEvent['severity']; failureClass?: string; limit?: number }) => Promise<{ ok: boolean; entries: RuntimeTelemetryEvent[]; total: number; filePath?: string; error?: string }>;
    telemetrySummary: (options?: { taskId?: string; projectId?: string }) => Promise<{ ok: boolean; total: number; errors: number; warnings: number; totalTokens: number; byType: Record<string, number>; byFailureClass: Record<string, number>; latest: RuntimeTelemetryEvent[]; activeTask?: RuntimeTelemetryEvent; error?: string }>;
    telemetryDashboard: (options?: { taskId?: string; projectId?: string }) => Promise<RuntimeDashboard>;
    telemetryExport: (options?: { taskId?: string; projectId?: string }) => Promise<{ ok: boolean; canceled?: boolean; path?: string; count?: number; error?: string }>;
    autonomyEvaluationSummary: () => Promise<AutonomyEvaluationSummary>;
    autonomyEvaluationStart: (input?: { label?: string; mode?: 'live' | 'automated'; operator?: string; targetMinutes?: number }) => Promise<AutonomyEvaluationSummary & { reused?: boolean; session?: Record<string, unknown>; summary?: AutonomyEvaluationSummary }>;
    autonomyEvaluationRunBaseline: () => Promise<AutonomyEvaluationSummary & { session?: Record<string, unknown>; summary?: AutonomyEvaluationSummary }>;
    autonomyEvaluationComplete: (input?: { sessionId?: string }) => Promise<AutonomyEvaluationSummary & { session?: Record<string, unknown>; summary?: AutonomyEvaluationSummary }>;
    autonomyEvaluationExport: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; count?: number; error?: string }>;
    taskExecutionSteer: (input: { taskId: string; message: string }) => Promise<NativeExecutionResult>;
    taskExecutionSyncMembers: (input: {
      taskId: string;
      members: Array<import('./types').TaskRunMemberSnapshot & { modelConfig: import('./types').ModelConfig }>;
      reason?: string;
      affectedNodeIds?: string[];
      acceptanceCriteria?: string[];
    }) => Promise<NativeExecutionResult>;
    taskDelegationCreate: (input: TaskDelegationCreateInput) => Promise<TaskDelegationResult>;
    taskDelegationStatus: (taskId: string) => Promise<TaskDelegationResult>;
    worktreeInspect: (sourceRepo: string) => Promise<WorktreeResult>;
    worktreeCreate: (input: { taskId: string; sourceRepo: string; baseRef?: string }) => Promise<WorktreeResult>;
    worktreeStatus: (taskId: string) => Promise<WorktreeResult>;
    worktreeCheckpoint: (input: { taskId: string; label?: string }) => Promise<WorktreeResult>;
    worktreeRecover: (taskId: string) => Promise<WorktreeResult>;
    worktreeRelease: (taskId: string) => Promise<WorktreeResult>;
    worktreeHealth: () => Promise<WorktreeResult>;
    codingPrepare: (input: { taskId: string; sourceRepo?: string; baseRef?: string }) => Promise<Record<string, unknown>>;
    codingIndex: (input: { workspacePath: string }) => Promise<Record<string, unknown>>;
    codingSearch: (input: { workspacePath: string; query: string }) => Promise<Record<string, unknown>>;
    codingDependencies: (input: { workspacePath: string; path?: string; symbol?: string }) => Promise<Record<string, unknown>>;
    codingDiff: (input: { workspacePath: string; taskId?: string }) => Promise<Record<string, unknown>>;
    codingCheckpoint: (input: { workspacePath: string; taskId?: string; label?: string }) => Promise<Record<string, unknown>>;
    codingStartCommand: (input: { workspacePath: string; command: string; timeoutMs?: number }) => Promise<Record<string, unknown>>;
    codingCommandStatus: (input: { sessionId: string; after?: number }) => Promise<Record<string, unknown>>;
    ecosystemHealth: (input?: { mode?: 'runtime' | 'release' }) => Promise<EcosystemHealthReport>;
    onTaskWorkerChanged: (callback: (event: unknown) => void) => () => void;
    onTaskExecutionChanged: (callback: (event: NativeExecutionEvent) => void) => () => void;
    getAssistantLock: () => Promise<{ locked: boolean }>;
    setAssistantLock: (locked: boolean) => Promise<{ locked: boolean }>;
    getChatLock: (opts: OpenChatOptions) => Promise<{ locked: boolean }>;
    setChatLock: (opts: ChatLockOptions) => Promise<{ locked: boolean }>;
    setZoomFactor: (factor: number) => void;
    execCommand: (cmd: string, scope?: string, policy?: ExecCommandPolicy) => Promise<ExecCommandResult>;
    verifyWebArtifact: (input: { workspaceId?: string; path: string; viewports?: Array<{ width: number; height: number; label?: string }>; semanticChecks?: WebArtifactSemanticCheck[] }) => Promise<WebArtifactVerificationResult>;
    skillsList: () => Promise<SkillListResult>;
    skillsRead: (id: string) => Promise<SkillReadResult>;
    skillsDelete: (id: string) => Promise<SkillDeleteResult>;
    skillsInstall: (input: { sourceUrl?: string; slug?: string; name?: string; requestText?: string }) => Promise<SkillInstallResult>;
    skillsSearchMarket: (query: string) => Promise<SkillMarketSearchResult>;
    skillsInspectSource: (sourceUrl: string) => Promise<SkillInspectResult>;
    skillsRepair: (id: string) => Promise<SkillInstallResult>;
    skillsRuntime: () => Promise<{ ok: boolean; manifest?: unknown; error?: string }>;
    skillsRuntimeHealth: () => Promise<{ ok: boolean; total?: number; ready?: number; broken?: number; missing?: number; skills?: unknown[]; error?: string }>;
    skillsRuntimeInspect: (id: string) => Promise<{ ok: boolean; skill?: unknown; error?: string }>;
    skillsRuntimeInvocation: (input: { skillId: string; taskId?: string; ok?: boolean; evidence?: string }) => Promise<{ ok: boolean; evidence?: unknown; error?: string }>;
    skillsRuntimeInstall: (input: { sourceUrl?: string; slug?: string; name?: string; requestText?: string }) => Promise<SkillInstallResult & { runtime?: unknown }>;
    skillsRuntimeRepair: (id: string) => Promise<SkillInstallResult & { runtime?: unknown }>;
    skillDrafts: () => Promise<{ ok: boolean; drafts?: SkillDraft[]; error?: string }>;
    skillLifecycle: (input?: { projectId?: string; includeAudit?: boolean }) => Promise<{ ok: boolean; candidates?: SkillCandidate[]; rollouts?: SkillRollout[]; error?: string }>;
    rollbackAutoSkill: (input: { skillName?: string; skillId?: string }) => Promise<{ ok: boolean; skillName?: string; versionId?: string; error?: string }>;
    reviewSkillDraft: (input: { draftId: string; decision: 'approve' | 'reject'; note?: string }) => Promise<{ ok: boolean; action?: string; draft?: SkillDraft; error?: string }>;
    memoryList: (input?: { scope?: LayeredMemoryEntry['scope']; scopeId?: string; projectId?: string; memoryKind?: LayeredMemoryEntry['memoryKind']; memoryKinds?: LayeredMemoryEntry['memoryKind'][]; category?: LayeredMemoryEntry['category']; status?: LayeredMemoryEntry['status']; proposalStatus?: MemoryProposal['status']; includeAudit?: boolean; includeHistory?: boolean; includeRetrievals?: boolean }) => Promise<LayeredMemoryResult>;
    memoryContext: (input?: { query?: string; projectId?: string; taskId?: string; conversationId?: string; teamId?: string; employeeId?: string; memoryKind?: LayeredMemoryEntry['memoryKind']; memoryKinds?: LayeredMemoryEntry['memoryKind'][]; limit?: number }) => Promise<LayeredMemoryResult>;
    memoryUpsert: (input: Partial<LayeredMemoryEntry> & { content: string; replaceExact?: string }) => Promise<LayeredMemoryResult>;
    memoryPropose: (input: { taskId?: string; summary?: string; source?: string; warnings?: string[]; update: Partial<LayeredMemoryEntry> & { content: string; replaceExact?: string } }) => Promise<LayeredMemoryResult>;
    memoryRemove: (input: { entryId: string; reason?: string }) => Promise<LayeredMemoryResult>;
    memoryRollback: (input: { entryId: string; reason?: string }) => Promise<LayeredMemoryResult>;
    memoryReviewProposal: (input: { proposalId: string; decision: 'approve' | 'reject'; note?: string }) => Promise<LayeredMemoryResult>;
    memoryImportLegacy: (input: { importId?: string; userProfile?: string; userMemory?: unknown[]; taskLearnings?: unknown[]; layeredMemory?: LayeredMemoryEntry[] }) => Promise<{ ok: boolean; imported?: number; unchanged?: boolean; error?: string }>;
    learningReviewStatus: (input?: { taskId?: string }) => Promise<{ ok: boolean; processing?: boolean; items?: LearningReviewItem[]; counts?: Record<string, number>; error?: string }>;
    learningReviewProcess: (input?: { reviewModelConfig?: import('./types').ModelConfig; memoryWriteApproval?: boolean }) => Promise<{ ok: boolean; processed?: number; processing?: boolean; error?: string }>;
    learningReviewRetry: (input: { itemId: string; reviewModelConfig?: import('./types').ModelConfig; memoryWriteApproval?: boolean }) => Promise<{ ok: boolean; processed?: number; error?: string }>;
    openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;

    // 自主代理工作区文件系统（沙箱到 userData/workspace）
    getWorkspace: () => Promise<string>;
    fsWrite: (filePath: string, content: string) => Promise<FsWriteResult>;
    fsWriteDocument: (filePath: string, content: string) => Promise<FsWriteResult & { validated?: boolean; extractedChars?: number }>;
    fsWriteData: (filePath: string, dataUrl: string) => Promise<FsWriteResult>;
    fsRead: (filePath: string) => Promise<FsReadResult>;
    fsMkdir: (dirPath: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
    fsInitWorkspace: (workspaceId: string, metadata: { kind: 'assistant' | 'dm' | 'team' | 'project'; label: string; taskId?: string; projectId?: string; conversationId?: string; workspaceId?: string; createdAt?: string }) => Promise<{ ok: boolean; path?: string; error?: string }>;
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
    getUpdateStatus: () => Promise<UpdateStatus>;
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
    connectorInvokePreset: (input: { adapter: string; action: string; args?: Record<string, string>; credentials?: Record<string, string> }) => Promise<ConnectorPresetActionResult>;
    credentialSave: (input: { credentialRef: string; credentials: Record<string, string> }) => Promise<{ ok: boolean; credentialRef?: string; fields?: string[]; error?: string }>;
    credentialRead: (credentialRef: string) => Promise<{ ok: boolean; credentials?: Record<string, string>; error?: string }>;
    credentialStatus: (credentialRef: string) => Promise<{ ok: boolean; available?: boolean; configured?: boolean; credentialRef?: string; error?: string }>;
    credentialDelete: (credentialRef: string) => Promise<{ ok: boolean; error?: string }>;
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
