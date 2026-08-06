import { useState, useRef, useEffect, useMemo } from 'react';
import { ArrowLeftOutlined, EditOutlined, HistoryOutlined, PauseCircleOutlined, PlayCircleOutlined, PlusOutlined, RobotOutlined, SearchOutlined, StopOutlined, UserAddOutlined } from '@ant-design/icons';
import type { Team, Employee, TaskApprovalContract, TaskRun, ThoughtChainStep } from '../../types';
import { useStore } from '../../storeContext';
import { generatedImageAttachment, generateImage, getConversationModel, isImageGenerationModel, type Attachment } from '../../data/hermesClient';
import { getImageGenerationOptions } from '../../data/imageGenerationSettings';
import AgentAvatar from '../office/AgentAvatar';
import { loadOutputsByScope, type OutputRecord } from '../../data/outputs';
import ChatOutputsPanel from '../outputs/ChatOutputsPanel';
import ChatMessageText from './ChatMessageText';
import MessageSkillEvidence from './MessageSkillEvidence';
import RenameTeamModal from '../sidebar/RenameTeamModal';
import ManageTeamMembersModal from '../sidebar/ManageTeamMembersModal';
import { copyAndArchiveChatTranscript, copyToClipboard, downloadTextFile, messagesToMarkdown } from '../../utils/clipboard';
import ModelSelector from './ModelSelector';
import GeneratedImagePreview from './GeneratedImagePreview';
import ImageGenerationOptions from './ImageGenerationOptions';
import SkillMentionInput from '../skills/SkillMentionInput';
import { resolveSkillContext } from '../../engine/skillContext';
import SkillPickerButton from '../skills/SkillPickerButton';
import ExecutionPolicyControl from './ExecutionPolicyControl';
import type { SkillReference } from '../../types';
import { fileToAttachment, attachmentsFromClipboard, formatFileSize, persistAttachments } from '../../utils/attachments';
import { useFileDrop } from '../../hooks/useFileDrop';
import { buildTaskReplay, searchTaskRunHistory } from '../../engine/taskHistory.mjs';
import { getTaskLedgerEvents, getTaskLedgerIntegrity, readTaskLedger } from '../../data/taskRuns';
import type { TaskLedgerEvent, TaskLedgerIntegrity, TaskWorkerCommandRecord } from '../../electron';
import { cleanExecutionDisplay } from '../../engine/executionDisplay.mjs';
import { buildProjectBoard, projectBoardSections } from '../../engine/projectBoard.mjs';
import type { ProjectBoardProject } from '../../engine/projectBoard.mjs';
import ThoughtChainView from './ThoughtChainView';
import StageSummaryCard from './StageSummaryCard';
import ExecutionApprovalCard from './ExecutionApprovalCard';
import {
  activateChatSession,
  createChatSession,
  ensureActiveChatSession,
  legacyConversationId,
  listChatSessions,
  messageBelongsToConversation,
  titleFromMessages,
  touchChatSession,
  type ChatSessionScope,
} from '../../data/chatSessions';

interface Props {
  teamId: string;
}

type TaskAuditNode = { id: string; depth: number; title: string; status: string; blocked?: string; steps: { completed: number; total: number }; compensation: { completed: number; blocked: number; failed: number } };
function taskStatusLabel(status: string): string {
  return ({ running: '执行中', queued: '排队中', awaiting_user: '等待你确认', paused: '已暂停（不占用执行位）', stopped: '已停止', failed: '失败待恢复', completed: '已完成', blocked: '等待前置条件' } as Record<string, string>)[status] ?? status;
}
function stepStatusLabel(status: string): string {
  return ({ running: '执行中', queued: '等待前置步骤', waiting: '等待前置步骤', paused: '已暂停', completed: '已完成', failed: '失败', blocked: '被前置步骤阻塞', review: '审查中' } as Record<string, string>)[status] ?? status;
}
void stepStatusLabel;
const TASK_CONFIRMATION_RE = /(?:是否|请确认|需要你决定|需要决定的是).{0,24}(?:继续|开始|执行|进入|批准|同意)|(?:如果继续|点击确认|确认后).{0,24}(?:执行|开始|进入|恢复)/u;
type TaskAudit = { nodes: TaskAuditNode[]; plan?: { ready: boolean; nextAction: string; blockers: Array<{ taskId: string; title: string; reason: string }> } };
function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '未计时';
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

const supervisorMention: Employee = {
  id: 'assistant',
  name: '章北海助理',
  title: '常驻主助理',
  role: 'custom',
  avatar: 'a06',
  avatarKind: 'preset',
  statusColor: '#6366f1',
  stationIndex: -1,
  isOnline: true,
  isWorking: false,
};

function SupervisorAvatar({ size = 34 }: { size?: number }) {
  return (
    <span className="supervisor-avatar" style={{ width: size, height: size }} aria-label="章北海助理">
      <RobotOutlined style={{ fontSize: Math.round(size * 0.58) }} />
    </span>
  );
}

export default function TeamChatApp({ teamId }: Props) {
  const {
    state, dispatch, sendMessage,
    publishTask, claimTask, advanceTask, triggerDiscussion, pauseTaskRun, resumeTaskRun, stopTaskRun, closeTaskRun, clearTeamExecution, archiveProject, startProjectExecution,
  } = useStore();
  const team = state.teams.find((t: Team) => t.id === teamId);
  const sessionScope: ChatSessionScope = `team:${teamId}`;
  const [conversationId, setConversationId] = useState(() => ensureActiveChatSession(sessionScope));
  const [approvalBusyIds, setApprovalBusyIds] = useState<Set<string>>(() => new Set());
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [text, setText] = useState('');
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [showOutputs, setShowOutputs] = useState(false);
  const [selectedOutputFilename, setSelectedOutputFilename] = useState<string | null>(null);
  const [workspacePanelWidth, setWorkspacePanelWidth] = useState(320);
  const [showTaskList, setShowTaskList] = useState(false);
  const [showRenameTeam, setShowRenameTeam] = useState(false);
  const [showManageMembers, setShowManageMembers] = useState(false);
  const [taskHistoryQuery, setTaskHistoryQuery] = useState('');
  const [replayTaskId, setReplayTaskId] = useState<string | null>(null);
  const [replayLedgerEvents, setReplayLedgerEvents] = useState<TaskLedgerEvent[]>([]);
  const [replayWorkerCommands, setReplayWorkerCommands] = useState<TaskWorkerCommandRecord[]>([]);
  const [ledgerIntegrity, setLedgerIntegrity] = useState<TaskLedgerIntegrity | null>(() => getTaskLedgerIntegrity());
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [imageGenerating, setImageGenerating] = useState(false);
  const [skillRefs, setSkillRefs] = useState<SkillReference[]>([]);
  const [clarificationNotes, setClarificationNotes] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resizingPanelRef = useRef(false);

  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const atts = await persistAttachments(`team:${teamId}`, await Promise.all(arr.map(fileToAttachment)));
    setAttachments((prev) => [...prev, ...atts]);
  };
  const fileDrop = useFileDrop(addFiles);

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const atts = await persistAttachments(`team:${teamId}`, await attachmentsFromClipboard(e));
    if (atts.length > 0) {
      e.preventDefault();
      setAttachments((prev) => [...prev, ...atts]);
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  // @ 弹窗状态
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIdx, setMentionIdx] = useState(0);

  const progress = state.status.progress;
  const myProgress = progress && progress.teamId === teamId ? progress : null;
  const teamProject = state.projects.find((project) => project.teamId === teamId);
  const clarifyingProject = teamProject?.status === 'clarifying' ? teamProject : undefined;
  const visibleMessages = (team?.chatMessages ?? []).filter((message) => messageBelongsToConversation(message, conversationId, sessionScope));
  const taskRuns = state.taskRuns.filter((run) => run.teamId === teamId && (
    run.conversationId === conversationId || (!run.conversationId && conversationId === legacyConversationId(sessionScope))
  )).reverse();
  const projectBoard = useMemo(() => buildProjectBoard(taskRuns, state.projects), [taskRuns, state.projects]);
  const projectSections = useMemo(() => projectBoardSections(projectBoard), [projectBoard]);
  const availableOutputs = loadOutputsByScope(`team:${teamId}`);
  const jumpMessages = visibleMessages.filter((message) => message.kind !== 'execution').slice(-24);
  const chatSessions = listChatSessions(sessionScope).filter((session) => session.id !== conversationId);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(() => new Set());
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set());
  const [resumingRunIds, setResumingRunIds] = useState<Set<string>>(() => new Set());
  const [taskAudits, setTaskAudits] = useState<Record<string, TaskAudit>>({});
  const [progressNow, setProgressNow] = useState(Date.now());
  const [liveProgressCollapsed, setLiveProgressCollapsed] = useState(false);
  const currentRunningRun = taskRuns.find((run) => run.status === 'running');
  const queuedRun = !currentRunningRun ? taskRuns.find((run) => run.status === 'queued') : undefined;
  const currentLiveRun = currentRunningRun ?? queuedRun;
  const currentLiveStep = currentLiveRun?.steps.find((step) => step.status === 'running')
    ?? currentLiveRun?.steps.find((step) => step.status === 'queued');
  const currentLiveEmployee = currentLiveStep ? state.employees.find((employee) => employee.id === currentLiveStep.employeeId) : undefined;
  const currentLiveEvents = currentLiveStep?.events.slice(-4) ?? [];
  const executionIsLive = Boolean(myProgress) || Boolean(currentRunningRun);
  const waitingRun = !currentRunningRun && !queuedRun ? taskRuns.find((run) => run.status === 'awaiting_user' || run.status === 'paused' || run.status === 'failed') : undefined;
  const confirmationRun = waitingRun ?? queuedRun;
  const historyMatches = useMemo(() => taskHistoryQuery.trim()
    ? searchTaskRunHistory(state.taskRuns, taskHistoryQuery, {
      teams: state.teams,
      teamId,
      projectId: teamProject?.id ?? team?.projectId,
      limit: 12,
    })
    : [], [taskHistoryQuery, state.taskRuns, state.teams, teamId, teamProject?.id, team?.projectId]);
  const replayRun = replayTaskId ? state.taskRuns.find((run) => run.id === replayTaskId) : undefined;
  const loadTaskAudit = async (taskId: string) => {
    const api = window.electronAPI;
    if (!api?.taskServiceTree || !api.taskServiceRecoveryPlan) return;
    const [treeResult, planResult] = await Promise.all([api.taskServiceTree(taskId), api.taskServiceRecoveryPlan(taskId)]);
    if (!treeResult.ok || !treeResult.tree) return;
    setTaskAudits((previous) => ({ ...previous, [taskId]: {
      nodes: treeResult.tree!.nodes as TaskAuditNode[],
      plan: planResult.ok && planResult.plan ? planResult.plan as unknown as TaskAudit['plan'] : undefined,
    } }));
  };
  const exportTaskReplay = async (run: TaskRun) => {
    const ledger = getTaskLedgerEvents(run.id);
    const replay = buildTaskReplay(run, ledger);
    if (!replay) return;
    const lines = [
      `# 任务回放：${replay.title}`,
      '', `- 任务 ID：${replay.taskId}`, `- 团队：${team?.name ?? replay.teamId}`, `- 状态：${taskStatusLabel(replay.status)}`,
      `- 创建时间：${new Date(replay.createdAt).toLocaleString('zh-CN')}`, `- 更新时间：${new Date(replay.updatedAt).toLocaleString('zh-CN')}`,
      '', '## 任务目标', replay.goal || '未记录', '', '## 阶段与负责人',
      ...(run.steps ?? []).map((step) => `- ${step.order}. ${state.employees.find((employee) => employee.id === step.employeeId)?.name ?? step.title}：${step.assignment}｜${stepStatusLabel(step.status)}｜尝试 ${step.attempts} 次`),
      '', '## 附件证据', ...(replay.attachments.length
        ? replay.attachments.map((attachment) => `- ${attachment.name}（${attachment.kind}，${attachment.size ?? '大小未知'} bytes）${attachment.workspacePath ? ` -> ${attachment.workspacePath}` : ''}${attachment.persistenceError ? `；保存失败：${attachment.persistenceError}` : ''}`)
        : ['- 无']),
      '', '## Worker 状态', run.worker ? `- ${run.worker.state}：${run.worker.activity ?? '无活动说明'}` : '- 未记录 Worker 状态',
      '', '## 验收证据', ...(run.verification ?? []).map((item) => `- ${item.status}: ${item.label} - ${item.detail ?? ''}`),
      '', '## 自适应计划', run.adaptivePlanGraph ? `- 当前版本：第 ${run.adaptivePlanGraph.revision} 版\n- 最近修订：${run.adaptivePlanGraph.revisionHistory.at(-1)?.reason ?? '初始计划'}\n- 影响节点：${run.adaptivePlanGraph.revisionHistory.at(-1)?.affectedNodeIds?.join('、') || '无'}` : '- 尚未建立自适应计划',
      '', '## 交接与阻塞', run.handoff ? `- 阻塞：${run.handoff.blocked}\n- 下一步：${run.handoff.nextAction}\n- 已完成：${(run.handoff.completed ?? []).join('、')}` : '- 无交接记录',
      '', '## 执行事件', ...replay.events.map((event) => `- ${new Date(event.ts).toLocaleString('zh-CN')}：${event.summary}`),
      '', '## 原始证据（JSON）', '```json', JSON.stringify(replay, null, 2), '```',
    ];
    downloadTextFile(`taiji-task-replay-${run.id}.md`, lines.join('\n'));
  };
  const exportAllTaskReplays = () => {
    const exportedAt = new Date();
    const sections = taskRuns.map((run, index) => {
      const replay = buildTaskReplay(run, getTaskLedgerEvents(run.id));
      if (!replay) return '';
      return [
        `## ${index + 1}. ${replay.title}`,
        `- 任务 ID：${replay.taskId}`, `- 状态：${taskStatusLabel(replay.status)}`,
        `- 时间：${new Date(replay.createdAt).toLocaleString('zh-CN')} - ${new Date(replay.updatedAt).toLocaleString('zh-CN')}`,
        '', '### 目标', replay.goal || '未记录', '', '### 阶段与负责人',
        ...(run.steps ?? []).map((step) => `- ${step.order}. ${state.employees.find((employee) => employee.id === step.employeeId)?.name ?? step.title}｜${stepStatusLabel(step.status)}｜${step.assignment}｜尝试 ${step.attempts} 次`),
        '', '### 附件证据', ...(replay.attachments.length
          ? replay.attachments.map((attachment) => `- ${attachment.name}（${attachment.kind}，${attachment.size ?? '大小未知'} bytes）${attachment.workspacePath ? ` -> ${attachment.workspacePath}` : ''}${attachment.persistenceError ? `；保存失败：${attachment.persistenceError}` : ''}`)
          : ['- 无']),
        '', '### Worker', run.worker ? `- ${run.worker.state}：${run.worker.activity ?? '无活动说明'}` : '- 未记录',
        '', '### 验收证据', ...(run.verification ?? []).map((item) => `- ${item.status}｜${item.label}｜${item.detail ?? ''}`),
        '', '### 自适应计划', run.adaptivePlanGraph ? `- 第 ${run.adaptivePlanGraph.revision} 版｜${run.adaptivePlanGraph.revisionHistory.at(-1)?.reason ?? '初始计划'}\n- 影响：${run.adaptivePlanGraph.revisionHistory.at(-1)?.affectedNodeIds?.join('、') || '无'}\n- 保留完成项：${run.adaptivePlanGraph.revisionHistory.at(-1)?.preservedCompletedNodeIds?.join('、') || '无'}` : '- 尚未建立',
        '', '### 交接', run.handoff ? `- 阻塞：${run.handoff.blocked}\n- 下一步：${run.handoff.nextAction}\n- 已完成：${(run.handoff.completed ?? []).join('、')}` : '- 无交接记录',
        '', '### 时间线', ...replay.events.map((event) => `- ${new Date(event.ts).toLocaleString('zh-CN')}｜${event.summary}`),
        '', '<details><summary>原始结构化回放</summary>', '', '```json', JSON.stringify(replay, null, 2), '```', '', '</details>',
      ].join('\n');
    }).filter(Boolean);
    const content = ['# 太极团队全部任务回放', '', `- 团队：${team?.name ?? teamId}`, `- 会话：${conversationId}`, `- 导出时间：${exportedAt.toLocaleString('zh-CN')}`, `- 任务数量：${sections.length}`, '', ...sections].join('\n\n');
    downloadTextFile(`taiji-all-task-replays-${teamId}-${exportedAt.toISOString().slice(0, 10)}.md`, content);
  };
  const taskReplay = useMemo(() => buildTaskReplay(replayRun, replayLedgerEvents), [replayRun, replayLedgerEvents]);
  const replayTimeline = useMemo(() => {
    if (!taskReplay) return [];
    if (taskReplay.ledgerEvents.length) return taskReplay.ledgerEvents.map((event) => ({
      id: event.eventId,
      ts: event.occurredAt,
      type: event.type,
      detail: event.detail,
      source: event.source,
      verified: true,
      sequence: event.sequence,
      transition: event.previousStatus !== event.nextStatus ? [event.previousStatus, event.nextStatus].filter(Boolean).join(' -> ') : '',
      domains: event.domains,
    }));
    return [
      ...taskReplay.events.map((event) => ({ id: event.id, ts: event.ts, type: event.type, detail: event.summary, source: '上下文', verified: event.verified, sequence: 0, transition: '', domains: [] as string[] })),
      ...taskReplay.runnerEvents.map((event) => ({ id: `runner-${event.id}`, ts: event.ts, type: event.type, detail: event.detail, source: 'Runner', verified: /succeeded|passed|completed/u.test(event.type), sequence: 0, transition: '', domains: [] as string[] })),
    ].sort((a, b) => a.ts - b.ts);
  }, [taskReplay]);

  useEffect(() => {
    if (!replayTaskId) {
      setReplayLedgerEvents([]);
      setReplayWorkerCommands([]);
      return;
    }
    let active = true;
    const refresh = async () => {
      const cached = getTaskLedgerEvents(replayTaskId);
      if (active && cached.length) setReplayLedgerEvents(cached);
      const loaded = await readTaskLedger(replayTaskId, 800);
      if (active) {
        setReplayLedgerEvents(loaded);
        setLedgerIntegrity(getTaskLedgerIntegrity());
      }
      const commandResult = await window.electronAPI?.taskWorkerCommands?.({ taskId: replayTaskId, limit: 80 });
      if (active && commandResult?.ok) setReplayWorkerCommands(commandResult.records ?? []);
    };
    void refresh();
    const onUpdated = () => { void refresh(); };
    window.addEventListener('task-ledger:updated', onUpdated);
    return () => {
      active = false;
      window.removeEventListener('task-ledger:updated', onUpdated);
    };
  }, [replayTaskId]);

  const teamMembers = (team?.memberIds ?? [])
    .map((id) => state.employees.find((e) => e.id === id))
    .filter((e): e is Employee => !!e);

  const memberDisplayState = (employee: Employee): { kind: 'working' | 'waiting' | 'idle' | 'offline'; label: string } => {
    if (!employee.isOnline) return { kind: 'offline', label: '离线' };
    const relatedRuns = taskRuns.filter((run) => run.steps.some((step) => step.employeeId === employee.id && step.status !== 'completed' && step.status !== 'stopped'));
    const running = relatedRuns.find((run) => run.status === 'running'
      && run.steps.some((step) => step.employeeId === employee.id && step.status === 'running'));
    if (running) return { kind: 'working', label: running.status === 'queued' ? '排队中' : '工作中' };
    const queuedStep = relatedRuns
      .flatMap((run) => run.steps.map((step) => ({ run, step })))
      .find(({ step }) => step.employeeId === employee.id && step.status === 'queued');
    if (queuedStep) {
      const waitingFor = queuedStep.step.dependsOnStepIds
        .map((dependencyId) => queuedStep.run.steps.find((step) => step.id === dependencyId))
        .find((step) => step?.status !== 'completed');
      return { kind: 'waiting', label: waitingFor ? '等待前置步骤' : '等待执行' };
    }
    const waiting = relatedRuns.find((run) => run.status === 'awaiting_user' || run.status === 'paused' || run.status === 'failed');
    if (waiting) return { kind: 'waiting', label: waiting.status === 'awaiting_user' ? '等待你' : waiting.status === 'paused' ? '已暂停' : '待恢复' };
    if (employee.isWorking && !employee.currentTask?.startsWith('执行：')) return { kind: 'working', label: '工作中' };
    return { kind: 'idle', label: '在线' };
  };
  const assistantPresence = state.status.teamAssistantPresence?.teamId === teamId
    && state.status.teamAssistantPresence.conversationId === conversationId
    ? state.status.teamAssistantPresence
    : undefined;
  const assistantPresenceLabel = assistantPresence?.state === 'thinking'
    ? '思考中'
    : assistantPresence?.state === 'answering'
      ? '回答中'
      : assistantPresence?.state === 'queued'
        ? '排队中'
        : assistantPresence?.state === 'error'
          ? '回复出错'
          : '在线';

  const mentionCandidates = useMemo(() => {
    const allCandidates = [supervisorMention, ...teamMembers];
    if (!mentionQuery) return allCandidates;
    const q = mentionQuery.toLowerCase();
    return allCandidates.filter(
      (e) => e.name.toLowerCase().includes(q) || e.title.toLowerCase().includes(q)
    );
  }, [mentionQuery, teamMembers]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages.length, myProgress?.step]);

  useEffect(() => {
    if (!executionIsLive) return;
    const timer = window.setInterval(() => setProgressNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [executionIsLive]);

  useEffect(() => {
    setResumingRunIds((previous) => {
      const next = new Set([...previous].filter((runId) => {
        const run = state.taskRuns.find((item) => item.id === runId);
        return run?.status === 'paused' || run?.status === 'failed' || run?.status === 'awaiting_user';
      }));
      return next.size === previous.size ? previous : next;
    });
  }, [state.taskRuns]);

  useEffect(() => {
    if (!clarifyingProject || clarificationNotes.trim()) return;
    const latestReply = [...visibleMessages].reverse().find((message) => message.roleId === 'human' && message.content.trim());
    if (latestReply) setClarificationNotes(latestReply.content);
  }, [clarifyingProject, clarificationNotes, visibleMessages]);

  if (!team) return <div style={{ padding: 20 }}>团队不存在</div>;

  const handleSend = async () => {
    if (!text.trim() && attachments.length === 0) return;
    const content = text.trim();
    const refs = skillRefs;
    const conversationModel = getConversationModel('team');
    if (isImageGenerationModel(conversationModel)) {
      const display = [content, ...attachments.map((attachment) => `[image ${attachment.name}]`)].filter(Boolean).join('\n');
      const now = Date.now();
      touchChatSession(sessionScope, conversationIdRef.current, content || attachments[0]?.name || team.name);
      dispatch({
        type: 'APPEND_CHAT', teamId, conversationId: conversationIdRef.current,
        msgs: [{ id: `msg-image-${now}-me`, authorId: 'emp-me', roleId: 'human', content: display, mentions: [], timestamp: now, kind: 'text', attachments }],
      });
      setSkillRefs([]);
      setText('');
      setAttachments([]);
      setImageGenerating(true);
      try {
        const image = await generateImage(content, conversationModel, attachments, getImageGenerationOptions('team'));
        dispatch({
          type: 'APPEND_CHAT', teamId, conversationId: conversationIdRef.current,
          msgs: [{ id: `msg-image-${Date.now()}-assistant`, authorId: 'assistant', roleId: 'custom', content: `${attachments.some((attachment) => attachment.kind === 'image') ? 'Image edited' : 'Image generated'} with ${image.model}.`, mentions: [], timestamp: Date.now(), kind: 'text', attachments: [generatedImageAttachment(image)] }],
        });
      } catch (error) {
        dispatch({
          type: 'APPEND_CHAT', teamId, conversationId: conversationIdRef.current,
          msgs: [{ id: `msg-image-${Date.now()}-error`, authorId: 'assistant', roleId: 'custom', content: `Image generation failed: ${error instanceof Error ? error.message : String(error)}`, mentions: [], timestamp: Date.now(), kind: 'text' }],
        });
      } finally {
        setImageGenerating(false);
      }
      return;
    }
    await resolveSkillContext(refs);
    setSkillRefs([]);
    // 解析 @ 提及：找出消息里 @name 形式
    const mentions: string[] = [];
    const parts = content.split(/(@\S+)/g);
    for (const p of parts) {
      if (p.startsWith('@')) {
        const name = p.slice(1).replace(/[，。！？!?：:；;、]+$/u, '');
        const found = name === '助理' || name === supervisorMention.name || name === supervisorMention.title
          ? supervisorMention
          : teamMembers.find((e) => e.name === name);
        if (found) mentions.push(found.id);
      }
    }
    // The assistant display name contains a space, while the generic @ token
    // parser stops at whitespace. Preserve an explicit @Hermes 助理 mention.
    if (content.includes(`@${supervisorMention.name}`) && !mentions.includes(supervisorMention.id)) {
      mentions.push(supervisorMention.id);
    }
    // 展示：文本 + 附件名；图片也存到消息上用于展示
    const display = [content, ...attachments.map((a) => `[📎 ${a.name}]`)].filter(Boolean).join('\n');
    touchChatSession(sessionScope, conversationIdRef.current, content || attachments[0]?.name || team.name);
    sendMessage(teamId, 'emp-me', 'human', display, mentions, attachments, refs, conversationIdRef.current);
    if (clarifyingProject && content) setClarificationNotes(content);
    setText('');
    setAttachments([]);
  };

  const handleExecutionApproval = async (approval: TaskApprovalContract, decision: 'approved' | 'rejected') => {
    if (!window.electronAPI?.taskExecutionDecideApproval || approvalBusyIds.has(approval.id)) return;
    setApprovalBusyIds((previous) => new Set(previous).add(approval.id));
    try {
      const result = await window.electronAPI.taskExecutionDecideApproval({
        taskId: approval.taskId,
        approvalId: approval.id,
        decision,
      });
      if (!result.ok) {
        dispatch({
          type: 'APPEND_CHAT', teamId, conversationId: conversationIdRef.current,
          msgs: [{
            id: `approval-error-${Date.now()}`, authorId: 'assistant', roleId: 'custom', mentions: [], timestamp: Date.now(), kind: 'text',
            content: `授权决定没有写入任务：${result.error || '未知错误'}。原任务保持暂停，没有执行未获批准的动作。`,
          }],
        });
      }
    } finally {
      setApprovalBusyIds((previous) => {
        const next = new Set(previous);
        next.delete(approval.id);
        return next;
      });
    }
  };

  const handleStartNewChat = () => {
    const running = taskRuns.filter((run) => run.status === 'queued' || run.status === 'running');
    if (running.length && !confirm(`当前有 ${running.length} 个任务正在执行。新建聊天会安全停止这些任务并保留已完成内容，是否继续？`)) return;
    running.forEach((run) => stopTaskRun(run.id));
    if (visibleMessages.length) touchChatSession(sessionScope, conversationIdRef.current, titleFromMessages(visibleMessages, team.name));
    const session = createChatSession(sessionScope);
    setConversationId(session.id);
    setText('');
    setAttachments([]);
    setSkillRefs([]);
    setMentionOpen(false);
    setReplayTaskId(null);
    setShowTaskList(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleRestoreChat = (targetConversationId: string) => {
    if (!targetConversationId || !activateChatSession(sessionScope, targetConversationId)) return;
    if (visibleMessages.length) touchChatSession(sessionScope, conversationIdRef.current, titleFromMessages(visibleMessages, team.name));
    setConversationId(targetConversationId);
    setText('');
    setAttachments([]);
    setSkillRefs([]);
    setMentionOpen(false);
    setReplayTaskId(null);
    setShowTaskList(false);
  };

  const insertMention = (emp: Employee) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cur = text;
    const cursor = ta.selectionStart ?? cur.length;
    const before = cur.slice(0, cursor);
    const after = cur.slice(cursor);
    const match = before.match(/(^|\s)@([^@\s]*)$/u);
    const atIdx = match ? cursor - (match[2]?.length ?? 0) - 1 : -1;
    const next = atIdx >= 0
      ? cur.slice(0, atIdx) + `@${emp.name} ` + after
      : cur.slice(0, cursor) + `@${emp.name} ` + after;
    setText(next);
    setMentionOpen(false);
    setMentionQuery('');
    setTimeout(() => ta.focus(), 0);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setText(v);
    // 检测是否处于 @ 状态
    const cur = v.slice(0, e.target.selectionStart ?? v.length);
    const m = cur.match(/@([^@\s]*)$/);
    if (m) {
      setMentionOpen(true);
      setMentionQuery(m[1] ?? '');
      setMentionIdx(0);
    } else {
      setMentionOpen(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionOpen && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIdx((i) => (i + 1) % mentionCandidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIdx((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(mentionCandidates[mentionIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePublishTask = () => {
    if (!taskTitle.trim()) return;
    publishTask(teamId, taskTitle.trim(), taskDesc.trim() || undefined);
    setTaskTitle(''); setTaskDesc(''); setShowTaskForm(false);
  };

  const transcriptIdentity = (message: { authorId: string; roleId: string; authorName?: string }) => {
    if (message.authorId === 'assistant') return { author: '章北海助理', role: '常驻主助理' };
    const employee = state.employees.find((item) => item.id === message.authorId);
    return { author: employee?.name ?? message.authorName ?? message.authorId, role: employee?.title ?? message.roleId };
  };

  const handleCopyMsg = async (content: string) => { await copyToClipboard(content); };
  const handleCopyAll = async () => {
    await copyToClipboard(visibleMessages.map((m: any) => {
      const identity = transcriptIdentity(m);
      return `[${identity.author}] ${m.content}`;
    }).join('\n\n'));
    await copyAndArchiveChatTranscript({
      scope: `team-${team.id}`,
      title: `${team.name} Team Transcript`,
      messages: visibleMessages.map((message: any) => {
        const identity = transcriptIdentity(message);
        return {
          role: identity.role,
          author: identity.author,
          content: message.content,
          time: new Date(message.timestamp).toLocaleString('zh-CN'),
          attachments: message.attachments,
          kind: message.kind,
          stageSummary: message.stageSummary,
          approval: message.approval,
        };
      }),
    });
  };
  const handleExport = () => {
    const msgs = visibleMessages;
    const md = messagesToMarkdown(msgs.map((m: any) => {
      const identity = transcriptIdentity(m);
      return { role: identity.role, author: identity.author, content: m.content, time: new Date(m.timestamp).toLocaleString('zh-CN'), attachments: m.attachments, kind: m.kind, stageSummary: m.stageSummary, approval: m.approval };
    }), `${team.name} 讨论记录`);
    downloadTextFile(`${team.name}-对话-${new Date().toISOString().slice(0, 10)}.md`, md);
  };

  const openOutputFromMessage = (output: OutputRecord) => {
    setSelectedOutputFilename(output.filename);
    setShowTaskList(false);
    setShowOutputs(true);
  };

  const renderTextWithOutputLinks = (value: string, keySeed: string): React.ReactNode[] => {
    return [<ChatMessageText key={keySeed} content={value} scope={`team:${teamId}`} outputs={availableOutputs} onOpenOutput={openOutputFromMessage} />];
  };

  // 解析消息中的 @ 提及、链接和产出物引用
  const renderContent = (content: string) => {
    const parts = content.split(/(@\S+)/g);
    const result: React.ReactNode[] = [];
    let key = 0;
    for (const part of parts) {
      if (part.startsWith('@')) {
        const mentionName = part.slice(1);
        const mentionedEmp = state.employees.find(
          (e) => e.name === mentionName || e.title === mentionName
        ) ?? (mentionName === supervisorMention.name || mentionName === supervisorMention.title || mentionName === '助理'
          ? supervisorMention
          : undefined);
        result.push(
          <span key={key++} className="msg-mention" style={{ color: mentionedEmp?.statusColor ?? 'var(--color-planner)' }}>
            {part}
          </span>
        );
      } else {
        result.push(...renderTextWithOutputLinks(part, `${key++}`));
      }
    }
    return result;
  };

  const handleResumeTaskRun = async (runId: string) => {
    setResumingRunIds((previous) => new Set(previous).add(runId));
    try {
      await resumeTaskRun(runId);
    } finally {
      setResumingRunIds((previous) => {
      const next = new Set(previous);
      next.delete(runId);
      return next;
      });
    }
  };

  const renderAutonomousSummary = (run: TaskRun) => {
    const control = run.autonomousControl;
    if (!control) return null;
    const summary = control.publicSummary;
    return <section className={`autonomous-summary phase-${control.loopPhase}`} aria-label="自主控制判断">
      <div className="autonomous-summary-head"><strong>自主判断</strong><span>{control.mode === 'adaptive' ? `动态计划第 ${summary.planRevision} 版` : '影子模式'} · 第 {control.currentDecision.cycle} 轮</span></div>
      <div className="autonomous-summary-primary"><span>下一步</span><b>{summary.nextAction}</b></div>
      <p>{summary.rationale}</p>
      {summary.currentGap && <div className="autonomous-summary-gap"><span>当前阻塞</span><b>{summary.currentGap}</b></div>}
      <details>
        <summary>查看判断依据</summary>
        <div><strong>当前目标</strong><p>{summary.currentGoal}</p></div>
        {summary.planChange && <div><strong>最近计划修订</strong><p>{summary.planChange}</p>{summary.affectedNodes.length > 0 && <p>影响节点：{summary.affectedNodes.join('、')}</p>}{summary.preservedCompletedNodes.length > 0 && <p>保留完成项：{summary.preservedCompletedNodes.join('、')}</p>}</div>}
        <div><strong>执行预算判断</strong><p>{summary.budgetAction}：{summary.budgetReason}</p></div>
        {summary.confirmedFacts.length > 0 && <div><strong>已确认事实</strong>{summary.confirmedFacts.map((item, index) => <p key={`${index}-${item.slice(0, 30)}`}>{item}</p>)}</div>}
        {summary.attemptedRoutes.length > 0 && <div><strong>已尝试路线</strong>{summary.attemptedRoutes.map((item, index) => <p key={`${index}-${item.slice(0, 30)}`}>{item}</p>)}</div>}
        {summary.factLedger && <div><strong>事实账本</strong><p>{String(summary.factLedger.currentFacts ?? 0)} 条当前事实 · {String(summary.factLedger.factVersions ?? 0)} 个版本 · {String(summary.factLedger.openConflicts ?? 0)} 个未决冲突</p></div>}
        {summary.factConflicts?.length > 0 && <div className="autonomous-summary-conflicts"><strong>冲突证据</strong>{summary.factConflicts.map((item) => <p key={String(item.id)}>{String(item.factKey)}：{String(item.previousStatement)} ↔ {String(item.latestStatement)}{item.requiresUser ? ' · 等待确认' : ' · 需要补证据'}</p>)}</div>}
        {summary.expectedEvidence.length > 0 && <div><strong>预期证据</strong>{summary.expectedEvidence.map((item, index) => <p key={`${index}-${item.slice(0, 30)}`}>{item}</p>)}</div>}
      </details>
    </section>;
  };

  const renderTaskRunCard = (run: TaskRun) => {
    const expanded = expandedRunIds.has(run.id);
    const completed = run.steps.filter((step) => step.status === 'completed').length;
    const active = run.status === 'running' || run.status === 'queued';
    const connectorEvidence = (run.evidence ?? []).filter((item) => item.connectorProtocol).slice(-6);
    const artifactEvidence = (run.evidence ?? []).filter((item) => item.artifact).slice(-10);
    const planEvents = (run.runner?.events ?? []).filter((event) => ['plan_extended', 'review_passed', 'review_rejected'].includes(event.type)).slice(-8);
    return <section key={run.id} aria-label={taskStatusLabel(run.status)} className={`task-run-tray task-run-${run.status}`}>
      <div className="task-run-summary-row">
        <button type="button" className="task-run-summary" onClick={() => setExpandedRunIds((previous) => {
          const next = new Set(previous); if (next.has(run.id)) next.delete(run.id); else { next.add(run.id); void loadTaskAudit(run.id); } return next;
        })} onContextMenu={(event) => {
          event.preventDefault(); setExpandedRunIds((previous) => { const next = new Set(previous); if (next.has(run.id)) next.delete(run.id); else { next.add(run.id); void loadTaskAudit(run.id); } return next; });
        }}>
          <span className="task-run-state">{run.status === 'running' ? '执行中' : run.status === 'queued' ? '排队中' : run.status === 'awaiting_user' ? '等待你处理' : run.status === 'paused' ? '已暂停' : run.status === 'stopped' ? '已停止' : run.status === 'failed' ? '待恢复' : '已完成'}</span>
          <strong>{run.title}</strong><span>{completed}/{run.steps.length}</span><span className="task-run-toggle">{expanded ? '收起' : '详情'}</span>
        </button>
        <button type="button" className="task-run-close" title="关闭并从任务列表移除" onClick={() => closeTaskRun(run.id)}>×</button>
      </div>
      {run.sourceMessageId && <button type="button" className="task-run-jump" title="跳到原始需求" onClick={() => document.querySelector(`[data-message-id="${CSS.escape(run.sourceMessageId!)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>↗</button>}
      {expanded && <div className="task-run-details">
        {taskAudits[run.id] && <div className="task-run-recovery task-run-audit">
          <div><strong>任务树与恢复</strong><span>{taskAudits[run.id].plan?.ready ? '可以继续' : taskAudits[run.id].plan?.nextAction || '已读取账本状态'}</span></div>
          <details><summary>任务树 {taskAudits[run.id].nodes.length}</summary>{taskAudits[run.id].nodes.map((node) => <p key={node.id} style={{ paddingLeft: `${node.depth * 12}px` }}>#{node.depth} · {node.title} · {node.status} · 步骤 {node.steps.completed}/{node.steps.total}{node.compensation.completed || node.compensation.blocked || node.compensation.failed ? ` · 补偿 ${node.compensation.completed}完成/${node.compensation.blocked}受阻/${node.compensation.failed}失败` : ''}{node.blocked ? ` · ${node.blocked}` : ''}</p>)}</details>
          {taskAudits[run.id].plan?.blockers.length ? <details><summary>恢复阻塞 {taskAudits[run.id].plan!.blockers.length}</summary>{taskAudits[run.id].plan!.blockers.map((item) => <p key={item.taskId}>{item.title} · {item.reason}</p>)}</details> : null}
        </div>}
        <div className="task-run-goal"><strong>目标</strong><span>{run.goal ?? run.request}</span></div>
        {!!run.preflight?.length && <div className="task-run-preflight"><strong>前置检查</strong>{run.preflight.map((item) => <span key={item.label} className={`is-${item.status}`} title={item.detail}>{item.status === 'passed' ? '✓' : item.status === 'blocked' ? '!' : '·'} {item.label}</span>)}</div>}
        {renderAutonomousSummary(run)}
        {run.worker && <div className={`task-run-worker worker-${run.worker.state}`}>
          <strong>后台 Worker</strong>
          <span>{run.worker.state === 'running' ? (run.worker.activity || '已领取任务，等待真实动作') : run.worker.state === 'paused' ? (run.worker.activity || '已暂停并保留现场') : run.worker.state === 'expired' ? '进程心跳失效，已安全暂停' : run.worker.state === 'released' ? '执行租约已释放' : run.worker.state === 'stopped' ? '已停止' : '等待执行适配器领取'}</span>
          <small>{run.worker.progressAt ? `真实进展 ${new Date(run.worker.progressAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '尚无真实进展'}{run.worker.heartbeatAt ? ` · 进程心跳 ${new Date(run.worker.heartbeatAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</small>
          {run.worker.lastCheckpoint && <small className="task-run-worker-checkpoint">检查点 #{run.worker.lastCheckpoint.sequence} · {run.worker.lastCheckpoint.summary || run.worker.lastCheckpoint.kind}</small>}
        </div>}
        {!!run.skillRefs?.length && <div className="task-run-skills"><strong>Skills</strong>{run.skillRefs.map((skill) => <span key={skill.id}>{skill.name}</span>)}</div>}
        {!!run.skillEvidence?.length && <div className="task-run-skills task-run-skill-evidence"><strong>Skill 证据</strong>{run.skillEvidence.slice(-8).map((item, index) => <span key={`${item.ts}-${item.skillId ?? item.toolName}-${index}`} title={item.detail ?? item.reason}>{item.action === 'read-failed' ? '!' : item.action === 'read' || item.action === 'called' ? '✓' : '·'} {item.skillName ?? item.skillId ?? item.toolName ?? 'Skill'} · {item.action}</span>)}</div>}
        {connectorEvidence.length > 0 && <div className="task-run-connector-evidence"><strong>连接器证据</strong>{connectorEvidence.map((item, index) => {
          const protocol = item.connectorProtocol!;
          const title = protocol.events.map((event) => `${event.ok ? '✓' : '!'} ${event.stage} · ${event.detail}`).join('\n');
          return <span key={`${protocol.completedAt}-${protocol.connectorId}-${index}`} className={protocol.ok ? 'is-passed' : 'is-blocked'} title={title}>{protocol.ok ? '✓' : '!'} {protocol.connectorLabel} · {protocol.action} · {protocol.latencyMs}ms{protocol.idempotencyHit ? ' · 复用' : ''}</span>;
        })}</div>}
        {artifactEvidence.length > 0 && <div className="task-run-artifact-evidence"><strong>交付文件事件</strong>{artifactEvidence.map((item, index) => {
          const artifact = item.artifact!;
          return <span key={`${artifact.recordedAt}-${artifact.path}-${index}`} className={artifact.verified ? 'is-passed' : 'is-blocked'} title={artifact.diskPath ?? artifact.path}>{artifact.verified ? '✓' : '!'} {artifact.filename} · {artifact.category === 'final' ? '最终交付' : artifact.category === 'reference' ? '参考资料' : '过程文件'} · {artifact.bytes ?? 0} B</span>;
        })}</div>}
        {planEvents.length > 0 && <div className="task-run-plan-events"><strong>计划图事件</strong>{planEvents.map((event) => <span key={event.id} className={event.type === 'review_rejected' ? 'is-blocked' : 'is-passed'} title={event.detail}>{event.type === 'plan_extended' ? '+' : event.type === 'review_rejected' ? '↩' : '✓'} {event.detail}</span>)}</div>}
        {run.recoveryContext && <div className="task-run-recovery">
          <div><strong>恢复摘要</strong><span>{run.recoveryContext.summary}</span></div>
          <div><strong>预算快照</strong><span>工具 {run.recoveryContext.budget.toolAttempts} 次{run.recoveryContext.budget.promptTokens !== undefined ? ` · 上下文 ${run.recoveryContext.budget.promptTokens.toLocaleString()}${run.recoveryContext.budget.contextWindowTokens ? ` / ${run.recoveryContext.budget.contextWindowTokens.toLocaleString()} tokens` : ' tokens'}` : ''}</span></div>
          {run.recoveryContext.unresolvedIssues.length > 0 && <details><summary>未决问题 {run.recoveryContext.unresolvedIssues.length}</summary>{run.recoveryContext.unresolvedIssues.slice(-4).map((issue, index) => <p key={`${index}-${issue.slice(0, 20)}`}>{issue}</p>)}</details>}
          {run.recoveryContext.steeringMessages.length > 0 && <details><summary>运行中插话 {run.recoveryContext.steeringMessages.length}</summary>{run.recoveryContext.steeringMessages.slice(-4).map((message, index) => <p key={`${index}-${message.slice(0, 20)}`}>{message}</p>)}</details>}
        </div>}
        {!!run.delegations?.length && <div className="task-run-delegations">
          <strong>动态子任务</strong>
          {run.delegations.map((delegation) => <div key={delegation.id} className={`task-delegation-row status-${delegation.status}`}>
            <span>{delegation.employeeName}</span><b>{delegation.title}</b><small>{delegation.status === 'queued' ? '等待' : delegation.status === 'running' ? '进行中' : delegation.status === 'completed' ? '已完成' : delegation.status === 'failed' ? '失败' : '已取消'}</small>
          </div>)}
        </div>}
        {run.worktree && <div className="task-run-worktree">
          <strong>代码工作树</strong><span>{run.worktree.branch}</span><small title={run.worktree.path}>{run.worktree.state === 'active' ? '已隔离' : '已释放'} · {run.worktree.head.slice(0, 8)}</small>
        </div>}
        {!!run.verification?.length && <div className="task-run-verification"><strong>验收证据</strong>{run.verification.map((item) => <span key={item.kind} className={`is-${item.status}`} title={item.detail}>{item.status === 'passed' ? '✓' : '!'} {item.label}</span>)}</div>}
        {run.steps.map((step) => {
          const emp = state.employees.find((item) => item.id === step.employeeId);
          const model = run.memberSnapshot.find((item) => item.id === step.employeeId)?.model;
          return <div key={step.id} className="task-run-step"><div><span className="task-step-order">{step.order}</span><strong>{emp?.name ?? step.title}</strong><span className={`task-step-kind kind-${step.kind}`}>{step.kind === 'review' ? '审查' : step.kind === 'revision' ? '修订' : '执行'}</span><span className={`task-step-status status-${step.status}`}>{step.status}</span><small>{model || '默认模型'} · 尝试 {step.attempts} 次</small></div><p className="task-step-assignment">{step.assignment}</p>{step.revisionOfStepId && <p className="task-step-responsibility">↩ 修订责任步骤：{run.steps.find((item) => item.id === step.revisionOfStepId)?.title ?? step.revisionOfStepId}</p>}{step.reviewDecision && <p className={`task-review-decision ${step.reviewDecision}`}>{step.reviewDecision === 'pass' ? '审查通过' : `退回：${step.reviewReason ?? '需要修改'}`}</p>}{step.lastError && <p className="task-step-error">{step.lastError}</p>}{step.events.slice(-4).map((event, index) => <p key={`${event.ts}-${index}`} className="task-step-event">{new Date(event.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} {event.detail}</p>)}</div>;
        })}
        {run.handoff && <div className="task-run-handoff"><strong>当前交接</strong><p>{run.handoff.blocked}</p>{(run.handoff.completed ?? []).length > 0 && <p>已完成：{(run.handoff.completed ?? []).join('、')}</p>}<p>下一步：{run.handoff.nextAction}</p></div>}
        <div className="task-run-actions">
          <button className="btn btn-sm" onClick={() => void exportTaskReplay(run)} title="一键导出完整任务回放 Markdown">导出回放 MD</button>
          <button className="btn btn-sm" onClick={() => setReplayTaskId(run.id)} title="只读回放任务"><HistoryOutlined />回放</button>
          {active && <button className="btn btn-sm" onClick={() => pauseTaskRun(run.id)}><PauseCircleOutlined />暂停</button>}
          {(run.status === 'paused' || run.status === 'failed' || run.status === 'awaiting_user') && <button className="btn btn-sm btn-primary" disabled={resumingRunIds.has(run.id)} onClick={() => handleResumeTaskRun(run.id)}><PlayCircleOutlined />{resumingRunIds.has(run.id) ? '正在继续…' : '继续执行'}</button>}
          {(active || run.status === 'paused' || run.status === 'failed' || run.status === 'awaiting_user') && <button className="btn btn-sm btn-danger" onClick={() => stopTaskRun(run.id)}><StopOutlined />停止</button>}
        </div>
      </div>}
    </section>;
  };

  const renderProjectCard = (project: ProjectBoardProject) => {
    const expanded = expandedProjectIds.has(project.id);
    const controlRun = project.actionRun ?? project.root;
    const active = controlRun.status === 'running' || controlRun.status === 'queued';
    const owner = project.currentStage?.ownerId ? state.employees.find((employee) => employee.id === project.currentStage?.ownerId) : undefined;
    return <section key={project.id} className={`project-board-card status-${project.status}`}>
      <button type="button" className="project-board-summary" onClick={() => setExpandedProjectIds((previous) => {
        const next = new Set(previous); if (next.has(project.id)) next.delete(project.id); else next.add(project.id); return next;
      })}>
        <span className={`project-board-state state-${project.status}`}>{project.statusLabel}</span>
        <strong>{project.title}</strong>
        <span className="project-board-progress">{project.completed}/{project.total || 1}</span>
        <span className="project-board-toggle">{expanded ? '收起' : '详情'}</span>
      </button>
      <div className="project-board-current">
        <span>{project.currentStage ? `当前：${project.currentStage.label}` : '等待制定阶段'}</span>
        {owner && <span>{owner.name}</span>}
        <span>{formatDuration(project.elapsedMs)}</span>
        <span>证据 {project.verifiedEvidence}/{project.evidenceTotal}</span>
      </div>
      <p className="project-board-result" title={project.latestResult}>{project.latestResult}</p>
      {(project.waitingCondition || project.nextAction) && <div className="project-board-guidance">
        {project.waitingCondition && <span><strong>等待</strong>{project.waitingCondition}</span>}
        <span><strong>下一步</strong>{project.nextAction}</span>
      </div>}
      {expanded && <div className="project-board-details">
        <div className="project-board-goal"><strong>项目目标</strong><span>{project.goal}</span></div>
        {renderAutonomousSummary(controlRun)}
        <div className="project-board-stages">
          {project.stages.map((stage) => {
            const stageOwner = stage.ownerId ? state.employees.find((employee) => employee.id === stage.ownerId) : undefined;
            return <details key={stage.id} className={`project-board-stage stage-${stage.status}`} open={stage.status === 'running' || stage.status === 'awaiting_user' || stage.status === 'failed'}>
              <summary><span>{stage.label}</span><small>{stageOwner?.name ?? '待分配'} · {stage.completed}/{stage.total} · {formatDuration(stage.elapsedMs)} · 证据 {stage.verifiedEvidence}/{stage.evidenceTotal}</small><b>{stage.status === 'running' ? '执行中' : stage.status === 'awaiting_user' ? '等待你处理' : stage.status === 'failed' ? '需要恢复' : stage.status === 'completed' ? '已完成' : '等待'}</b></summary>
              {stage.entries.map((entry) => {
                const { run, step } = entry;
                const employee = state.employees.find((item) => item.id === step.employeeId);
                const detail = entry.waitingCondition || step.lastError || step.reviewReason || step.events.at(-1)?.detail || '尚未产生阶段结果。';
                return <div key={`${run.id}-${step.id}`} className="project-board-stage-entry">
                  <strong>{employee?.name ?? step.title}</strong><span>{step.title}</span>
                  <small>{detail}</small>
                  <div className="project-board-entry-metrics"><span>{formatDuration(entry.elapsedMs)}</span><span>证据 {entry.verifiedEvidence}/{entry.evidenceTotal}</span><span>下一步：{entry.nextAction}</span>{entry.responsibility && <span className="is-responsibility">{entry.responsibility}</span>}</div>
                  <button type="button" onClick={() => setReplayTaskId(run.id)} title="查看该任务的可审计回放"><HistoryOutlined /></button>
                </div>;
              })}
            </details>;
          })}
        </div>
        <div className="project-board-actions">
          {project.root.sourceMessageId && <button className="btn btn-sm" onClick={() => document.querySelector(`[data-message-id="${CSS.escape(project.root.sourceMessageId!)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>原始需求</button>}
          {active && <button className="btn btn-sm" onClick={() => pauseTaskRun(controlRun.id)}><PauseCircleOutlined />暂停</button>}
          {(controlRun.status === 'paused' || controlRun.status === 'failed' || controlRun.status === 'awaiting_user') && <button className="btn btn-sm btn-primary" disabled={resumingRunIds.has(controlRun.id)} onClick={() => handleResumeTaskRun(controlRun.id)}><PlayCircleOutlined />{resumingRunIds.has(controlRun.id) ? '正在继续…' : '继续执行'}</button>}
          {(active || controlRun.status === 'paused' || controlRun.status === 'failed' || controlRun.status === 'awaiting_user') && <button className="btn btn-sm btn-danger" onClick={() => stopTaskRun(controlRun.id)}><StopOutlined />停止</button>}
          {project.projectId && !project.archived && <button className="btn btn-sm" onClick={() => archiveProject(project.projectId!)} title="归档项目并保留任务记录">归档</button>}
          <button className="btn btn-sm" onClick={() => closeTaskRun(project.root.id)} title="关闭项目及其任务记录">关闭</button>
        </div>
        <details className="project-board-audit"><summary>完整执行证据与回放</summary>{project.runs.map(renderTaskRunCard)}</details>
      </div>}
    </section>;
  };

  const startPanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingPanelRef.current = true;
    const move = (moveEvent: PointerEvent) => {
      if (!resizingPanelRef.current) return;
      setWorkspacePanelWidth(Math.max(240, Math.min(520, window.innerWidth - moveEvent.clientX)));
    };
    const stop = () => {
      resizingPanelRef.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  return (
    <div className="chat-panel">
      <div className="chat-layout">
        <div className="chat-main">
          <div className="team-chat-body">
            <aside className="team-member-sidebar" aria-label="团队成员列表" tabIndex={0}>
              <div className="team-member-sidebar-head">
                <span>{team.icon ?? '👥'}</span>
                <strong title={team.name}>{team.name}</strong>
                <span className="team-member-sidebar-actions">
                  <button type="button" onClick={() => {
                    if (!window.electronAPI?.openTool) { setShowManageMembers(true); return; }
                    void window.electronAPI.openTool({ type: 'manage-team-members', refId: team.id }).then((result) => {
                      if (!result.ok) setShowManageMembers(true);
                    });
                  }} title="添加团队成员" aria-label="添加团队成员"><UserAddOutlined /></button>
                  <button type="button" onClick={() => {
                    if (!window.electronAPI?.openTool) { setShowRenameTeam(true); return; }
                    void window.electronAPI.openTool({ type: 'rename-team', refId: team.id }).then((result) => {
                      if (!result.ok) setShowRenameTeam(true);
                    });
                  }} title="重命名团队" aria-label="重命名团队"><EditOutlined /></button>
                </span>
              </div>
              {assistantPresence && <div className={`team-assistant-presence is-${assistantPresence.state}`} role="status" aria-live="polite"><span className="team-assistant-presence-dot" /><span><strong>{assistantPresenceLabel}</strong><small>{assistantPresence.message ?? '章北海助理已接入当前会话'}</small></span></div>}
              <button key={supervisorMention.id} className="team-member-item team-supervisor-item" onClick={() => insertMention(supervisorMention)} title={`@${supervisorMention.name}`}><span className="team-member-avatar supervisor-presence-avatar"><SupervisorAvatar size={34} />{assistantPresence && <span className={`team-member-status ${assistantPresence.state === 'error' ? 'offline' : assistantPresence.state === 'idle' ? 'idle' : 'working'}`} />}</span><span className="team-member-info"><strong>{supervisorMention.name}</strong><small>{supervisorMention.title}</small><small className={assistantPresence && assistantPresence.state !== 'idle' ? 'is-working' : ''}>{assistantPresenceLabel}</small></span></button>
              {teamMembers.map((emp) => {
                const displayState = memberDisplayState(emp);
                return <button key={emp.id} className="team-member-item" onClick={() => insertMention(emp)} title={`@${emp.name}`}><span className="team-member-avatar"><AgentAvatar employee={emp} size={34} /><span className={`team-member-status ${displayState.kind}`} /></span><span className="team-member-info"><strong>{emp.name}</strong><small style={{ color: emp.statusColor }}>{emp.title}</small><small className={displayState.kind === 'working' ? 'is-working' : displayState.kind === 'waiting' ? 'is-waiting' : ''}>{displayState.label}</small></span></button>;
              })}
            </aside>
            <div className="team-chat-content">
          {clarifyingProject && <section className="team-project-clarification" role="status">
            <div>
              <strong>等待你确认方向</strong>
              <span>团队名单已固定，尚未开始执行。请在聊天中回复目标边界、资料来源、部署方式、关键能力和界面风格。</span>
            </div>
            <button type="button" className="btn btn-sm btn-primary" disabled={!clarificationNotes.trim()} onClick={() => startProjectExecution(clarifyingProject.id, clarificationNotes)}>
              确认方向并开始执行
            </button>
          </section>}
          {/* 团队讨论和后台原生任务共用同一条实时进度。 */}
          {executionIsLive && (
            <div className={`chat-progress team-live-progress ${liveProgressCollapsed ? 'is-collapsed' : ''}`} role="status" aria-live="polite">
              <button type="button" className="team-live-collapse" onClick={() => setLiveProgressCollapsed((value) => !value)} title={liveProgressCollapsed ? '展开实时过程' : '折叠实时过程'} aria-expanded={!liveProgressCollapsed}>{liveProgressCollapsed ? '展开' : '收起'}</button>
              <div className="chat-progress-left">
                <div className="progress-spinner" />
                <div>
                  <div className="chat-progress-title">
                    {myProgress
                      ? myProgress.currentEmpName ? `${myProgress.currentEmpName} 正在思考…` : '团队正在准备…'
                      : currentLiveRun?.worker?.activity || (currentLiveEmployee ? `${currentLiveEmployee.name} · ${currentLiveStep?.title ?? '正在执行'}` : currentLiveRun?.status === 'queued' ? '任务已进入后台队列' : '团队正在执行')}
                  </div>
                  <div className="chat-progress-sub">
                    {myProgress
                      ? <>正在调用 <strong>{myProgress.model ?? '模型'}</strong> · 团队 {myProgress.teamName} · 已用 {Math.max(1, Math.floor((progressNow - myProgress.startedAt) / 1000))}s</>
                      : <>后台 Worker {currentLiveRun?.worker?.state === 'running' ? '进程在线' : '正在领取任务'} · 已用 {Math.max(1, Math.floor((progressNow - (currentLiveRun?.createdAt ?? progressNow)) / 1000))}s · 真实进展 {Math.max(0, Math.floor((progressNow - (currentLiveRun?.worker?.progressAt ?? currentLiveRun?.updatedAt ?? progressNow)) / 1000))}s 前{currentLiveRun?.worker?.heartbeatAt ? ` · 心跳 ${Math.max(0, Math.floor((progressNow - currentLiveRun.worker.heartbeatAt) / 1000))}s 前` : ''}</>}
                  </div>
                </div>
              </div>
              <div className="chat-progress-right">
                <div className="chat-progress-step">{myProgress ? `${myProgress.step}/${myProgress.totalSteps}` : `${currentLiveRun?.steps.filter((step) => step.status === 'completed').length ?? 0}/${currentLiveRun?.steps.length ?? 1}`}</div>
                <div className="progress-bar" style={{ width: 100 }}>
                  <div className="progress-bar-fill" style={{ width: `${myProgress
                    ? (myProgress.step / Math.max(1, myProgress.totalSteps)) * 100
                    : ((currentLiveRun?.steps.filter((step) => step.status === 'completed').length ?? 0) / Math.max(1, currentLiveRun?.steps.length ?? 1)) * 100}%` }} />
                </div>
              </div>
              {!myProgress && currentLiveRun && <div className="team-live-actions" aria-label="当前任务控制">
                <button type="button" className="btn btn-sm" onClick={() => pauseTaskRun(currentLiveRun.id)}><PauseCircleOutlined />暂停</button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => stopTaskRun(currentLiveRun.id)}><StopOutlined />停止</button>
              </div>}
              {!myProgress && currentLiveRun && <div className="team-live-event-stream">
                {(currentLiveEvents.length ? currentLiveEvents : [{ ts: currentLiveRun.updatedAt, type: 'status' as const, detail: currentLiveRun.status === 'queued' ? '任务已排队，等待后台执行器领取' : '后台执行器正在处理当前步骤' }]).map((event, index, events) => <div key={`${event.ts}-${index}`} className={index === events.length - 1 ? 'is-current' : ''}><i /> <span>{cleanExecutionDisplay(event.detail, 180)}</span><time>{new Date(event.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div>)}
              </div>}
            </div>
          )}
          {!executionIsLive && waitingRun && <div className="team-waiting-banner" role="status">
            <div><strong>{waitingRun.status === 'awaiting_user' ? '任务正在等你处理' : waitingRun.status === 'paused' ? '任务已暂停' : '任务需要恢复'}</strong><span>{waitingRun.handoff?.blocked || waitingRun.lastError || waitingRun.recoveryContext?.summary || '已完成内容和工作区都已保留。'}</span></div>
            <button type="button" className="btn btn-sm btn-primary" disabled={resumingRunIds.has(waitingRun.id)} onClick={() => handleResumeTaskRun(waitingRun.id)}><PlayCircleOutlined />{resumingRunIds.has(waitingRun.id) ? '正在继续…' : '继续执行'}</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => stopTaskRun(waitingRun.id)}><StopOutlined />停止</button>
          </div>}
          {!executionIsLive && queuedRun && <div className="team-waiting-banner team-queued-banner" role="status">
            <div><strong>任务正在排队</strong><span>{currentLiveStep?.dependsOnStepIds?.length ? '当前步骤正在等待前置步骤完成，不会把所有成员显示为同时工作。' : '后台执行器尚未领取该任务；领取后会显示具体负责人和工具动作。'}</span></div>
          </div>}

          {/* 消息流 */}
          <div className="chat-messages">
            {visibleMessages.length === 0 ? (
              /* 空状态：显示团队成员 */
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                height: '100%', color: 'var(--text-muted)', gap: 12, padding: 40,
              }}>
                <span style={{ fontSize: 40 }}>{team.icon ?? '👥'}</span>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{team.name}</div>
                <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 300 }}>
                  {teamMembers.length > 0
                    ? `团队有 ${teamMembers.length} 名成员`
                    : '暂无成员，先给团队添加员工或发一条消息吧'}
                </div>
                {teamMembers.length > 0 && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
                    {teamMembers.map((emp) => (
                      <div key={emp.id} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: 'var(--bg-deep)', borderRadius: 20, padding: '4px 12px', fontSize: 12,
                      }}>
                        <span>{emp.avatar ?? (emp.role === 'pm' ? '👔' : emp.role === 'planner' ? '📋' : emp.role === 'coder' ? '💻' : '🔍')}</span>
                        <span style={{ color: 'var(--text)' }}>{emp.name}</span>
                        <span style={{ color: emp.statusColor }}>{emp.title}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 11, marginTop: 8 }}>💬 在下方输入消息开始团队协作</div>
              </div>
            ) : visibleMessages.map((msg, messageIndex, allMessages) => {
              const author = state.employees.find((e: Employee) => e.id === msg.authorId)
                ?? (msg.authorId === supervisorMention.id ? supervisorMention : undefined);
              const isHuman = msg.roleId === 'human';
              const isExecution = msg.kind === 'execution';
              const isTaskConfirmation = !isHuman && !isExecution && Boolean(confirmationRun)
                && TASK_CONFIRMATION_RE.test(msg.content)
                && !allMessages.slice(messageIndex + 1).some((candidate) => candidate.roleId !== 'human' && TASK_CONFIRMATION_RE.test(candidate.content));
              const summarizedLater = isExecution && msg.stepId
                ? allMessages.slice(messageIndex + 1).some((candidate) => candidate.kind === 'stage_summary' && candidate.stageSummary?.stepId === msg.stepId)
                : false;
              if (summarizedLater) return null;
              if (isExecution && allMessages[messageIndex + 1]?.kind === 'execution') return null;
              let executionStart = messageIndex;
              while (executionStart > 0 && allMessages[executionStart - 1]?.kind === 'execution') executionStart -= 1;
              const executionMessages = isExecution ? allMessages.slice(executionStart, messageIndex + 1) : [];
              const isFailure = /^⚠️|无法响应|执行失败|已手动停止/u.test(msg.content);
              const teamExecutionSteps: ThoughtChainStep[] = executionMessages.map((event) => ({
                toolName: event.content.match(/`([^`]+)`/u)?.[1] ?? 'team_execution',
                args: '',
                result: cleanExecutionDisplay(event.content),
                success: !/^⚠️|无法响应|执行失败|已手动停止/u.test(event.content),
                timestamp: event.timestamp,
              }));

              return (
                <div key={msg.id} data-message-id={msg.id} className={`msg ${isHuman ? 'human' : ''}`}>
                  {!isHuman ? (
                    <div className="msg-meta">
                      <span className="msg-author" style={{ color: author?.statusColor ?? 'var(--text-secondary)' }}>
                        {author?.name ?? msg.authorId}
                      </span>
                      <span className="msg-time">{new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  ) : <div className="msg-meta msg-human-time"><span className="msg-time">{new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span></div>}
                  {msg.kind === 'stage_summary' && msg.stageSummary ? (
                    <StageSummaryCard summary={msg.stageSummary} />
                  ) : msg.kind === 'approval' && msg.approval ? (
                    <ExecutionApprovalCard
                      approval={msg.approval}
                      busy={approvalBusyIds.has(msg.approval.id)}
                      onDecision={(decision) => void handleExecutionApproval(msg.approval!, decision)}
                    />
                  ) : isExecution ? (
                    <ThoughtChainView steps={teamExecutionSteps} summary={`${author?.name ?? '成员'}的执行过程`} live={executionIsLive} />
                  ) : msg.kind === 'task' ? (
                    <div className="task-card-msg" style={isHuman ? { marginLeft: 'auto', maxWidth: '85%' } : {}}>
                      <div className="task-card-title">📋 {msg.content.replace('[新任务] ', '')}</div>
                      {(() => {
                        const task = team.tasks.find((t) => t.id === msg.taskRef);
                        if (!task) return null;
                        return (
                          <>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0' }}>
                              {task.description}
                            </div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                              <span className="task-card-lane" style={{
                                background:
                                  task.lane === 'PLANNING' ? '#dbeafe' :
                                  task.lane === 'CODING' ? '#d1fae5' :
                                  task.lane === 'REVIEW' ? '#fef3c7' : '#dcfce7',
                                color:
                                  task.lane === 'PLANNING' ? '#1e40af' :
                                  task.lane === 'CODING' ? '#065f46' :
                                  task.lane === 'REVIEW' ? '#92400e' : '#166534',
                              }}>
                                {task.lane}
                              </span>
                              {!task.claimedBy && (
                                <button
                                  className="btn btn-sm btn-primary"
                                  onClick={() => claimTask(teamId, task.id!, 'emp-me')}
                                  style={{ fontSize: 10 }}
                                >
                                  认领
                                </button>
                              )}
                              {task.lane !== 'DONE' && (
                                <button
                                  className="btn btn-sm"
                                  onClick={() => {
                                    const lanes = ['PLANNING', 'CODING', 'REVIEW', 'DONE'] as const;
                                    const idx = lanes.indexOf(task.lane as any);
                                    if (idx < 3) advanceTask(teamId, task.id!, lanes[idx + 1]);
                                  }}
                                  style={{ fontSize: 10 }}
                                >
                                  推进 ▸
                                </button>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : isTaskConfirmation && confirmationRun ? (
                    <button type="button" className="task-confirmation-message" onClick={() => void handleResumeTaskRun(confirmationRun.id)} disabled={resumingRunIds.has(confirmationRun.id)} title="点击即代表同意，并从当前任务步骤继续">
                      <span>需要你确认</span>
                      <div>{renderContent(msg.content)}</div>
                      <strong>{resumingRunIds.has(confirmationRun.id) ? '正在写入确认…' : '点击整段同意并继续任务'}</strong>
                    </button>
                  ) : (
                    <div className="msg-row">
                      <div className="msg-bubble">{renderContent(msg.content)}</div>
                      <button className="msg-copy-btn" onClick={() => handleCopyMsg(msg.content)} title="复制">📋</button>
                    </div>
                  )}
                  <GeneratedImagePreview attachments={msg.attachments} />
                  <MessageSkillEvidence refs={msg.skillRefs} evidence={msg.skillEvidence} />
                  {msg.tokens != null && (
                    <div className="msg-tokens">≈ {msg.tokens.toLocaleString()} tokens</div>
                  )}
                  {isFailure && !isExecution && !isHuman && (
                    <button
                      className="resume-execution-btn"
                      onClick={() => triggerDiscussion(teamId, {
                        userText: '继续执行上次未完成的任务。请读取已有产出和当前聊天上下文，从中断点继续，不要重复已完成部分。',
                        triggerMessageId: `resume-${msg.id}`,
                        discussionId: `resume-${msg.id}`,
                        forcedMemberIds: [msg.authorId],
                        maxRounds: 1,
                        conversationId,
                      })}
                    >
                      继续执行
                    </button>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* 工具栏 */}
          <div className="chat-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '6px 14px' }}>
            <button className="btn btn-sm chat-new-session-btn" onClick={handleStartNewChat} title="保存当前记录并开启不继承旧任务的新聊天"><PlusOutlined /><span>新建聊天</span></button>
            {chatSessions.length > 0 && <select className="assistant-chat-history-select" value="" onChange={(event) => handleRestoreChat(event.target.value)} aria-label="历史对话"><option value="">历史对话</option>{chatSessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}</select>}
            <button className="btn btn-sm" onClick={handleCopyAll} title="复制全部对话">📋</button>
            <button className="btn btn-sm" onClick={handleExport} title="导出为 markdown">📤</button>
            <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()} title="上传文件/图片">📎</button>
            <SkillPickerButton selected={skillRefs} onSelectedChange={setSkillRefs} />
            <button
              className="btn btn-sm"
              onClick={() => triggerDiscussion(teamId, { conversationId })}
              disabled={state.status.demoRunning}
              title="让团队 AI 成员就当前讨论话题展开协作"
            >
              💬 发起讨论
            </button>
            <button className="btn btn-sm" onClick={() => setShowTaskForm(!showTaskForm)}>
              📋 发布任务
            </button>
            <button className={`btn btn-sm ${showTaskList ? 'btn-primary' : ''}`} onClick={() => { setShowOutputs(false); setShowTaskList((visible) => !visible); }} title="显示或隐藏右侧任务列表">
              任务 {taskRuns.length}
            </button>
            <button
              className={`btn btn-sm ${showOutputs ? 'btn-primary' : ''}`}
              onClick={() => { setShowTaskList(false); setShowOutputs(!showOutputs); }}
              title="产出物"
            >
              📁{showOutputs ? ' ✕' : ''}
            </button>
            <div style={{ flex: 1 }} />
            <ModelSelector scene="team" messages={visibleMessages} />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {state.status.backendOnline ? '🟢 默认模型可用' : '🔴 默认模型不可用'}
            </span>
          </div>

          {/* 发布任务表单 */}
          {showTaskForm && (
            <div style={{ padding: '8px 14px', background: 'var(--bg-deep)', borderTop: '1px solid var(--border-light)' }}>
              <input
                className="form-input"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                placeholder="任务标题 *"
                style={{ marginBottom: 4 }}
              />
              <input
                className="form-input"
                value={taskDesc}
                onChange={(e) => setTaskDesc(e.target.value)}
                placeholder="任务描述（可选）"
                style={{ marginBottom: 4 }}
              />
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button className="btn btn-sm" onClick={() => setShowTaskForm(false)}>取消</button>
                <button className="btn btn-sm btn-primary" onClick={handlePublishTask} disabled={!taskTitle.trim()}>
                  发布
                </button>
              </div>
            </div>
          )}

          {/* 输入区 */}
          <div className={`chat-composer ${fileDrop.dragActive ? 'is-file-dragging' : ''}`} style={{ position: 'relative' }} {...fileDrop.dropProps}>
            {fileDrop.dragActive && <div className="chat-file-drop-overlay"><strong>松开添加文件</strong><span>文件将真实写入本次聊天工作区</span></div>}
            <div className="team-composer-policy"><ExecutionPolicyControl /></div>
            {/* 附件预览 */}
            {attachments.length > 0 && (
              <div className="attach-row">
                {attachments.map((a, i) => (
                  <div key={i} className="attach-chip" title={a.name}>
                    {a.kind === 'image' && a.dataUrl ? (
                      <img src={a.dataUrl} alt={a.name} className="attach-thumb" />
                    ) : (
                      <span className="attach-icon">{a.kind === 'image' ? '🖼' : a.kind === 'text' ? '📄' : '📦'}</span>
                    )}
                    <span className="attach-name">{a.name}</span>
                    <span className={`attach-size ${a.persistenceError ? 'error' : a.workspacePath ? 'saved' : ''}`} title={a.persistenceError ?? a.workspacePath}>
                      {formatFileSize(a.size)} · {a.persistenceError ? '保存失败' : a.workspacePath ? '已保存' : '待保存'}
                    </span>
                    <button className="attach-del" onClick={() => removeAttachment(i)} title="移除">✕</button>
                  </div>
                ))}
              </div>
            )}
            <ImageGenerationOptions scene="team" />
            <SkillMentionInput ref={textareaRef} value={text} onChange={setText} onChangeEvent={handleTextChange} selected={skillRefs} onSelectedChange={setSkillRefs} onKeyDown={handleKeyDown} onPaste={handlePaste} rows={2} placeholder="输入消息... 输入 @ 选择技能或提及员工" />
            {/* @ 弹窗 */}
            {mentionOpen && mentionCandidates.length > 0 && (
              <div className="mention-popup">
                <div className="mention-popup-head">
                  选择提及{mentionQuery ? `（筛选：${mentionQuery}）` : ''}
                </div>
                {mentionCandidates.map((e, i) => (
                  <button
                    key={e.id}
                    className={`mention-option ${i === mentionIdx ? 'active' : ''}`}
                    onClick={() => insertMention(e)}
                    onMouseEnter={() => setMentionIdx(i)}
                  >
                    <AgentAvatar employee={e} size={26} />
                    <div className="mention-option-info">
                      <div className="mention-option-name">{e.name}</div>
                      <div className="mention-option-title" style={{ color: e.statusColor }}>{e.title}</div>
                    </div>
                    {myProgress?.currentEmpId === e.id && <span className="mention-thinking">💭</span>}
                  </button>
                ))}
                <div className="mention-popup-tip">↑↓ 选择 · Enter 确认 · Esc 取消</div>
              </div>
            )}
            <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-end', marginTop: 4 }} onClick={handleSend} disabled={imageGenerating}>
              发送
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
            />
          </div>
            </div>
            <nav className="chat-jump-rail" aria-label="聊天快速跳转">
              <span className="chat-jump-rail-label">导航</span>
              <div className="chat-jump-markers">
                {jumpMessages.map((message) => {
                  const failed = /^⚠️|无法响应|执行失败|已手动停止/u.test(message.content);
                  const human = message.roleId === 'human';
                  const author = state.employees.find((employee) => employee.id === message.authorId)?.name ?? (human ? '老板' : message.authorId === 'assistant' ? '助理' : '成员');
                  return <button key={message.id} type="button" className={`chat-jump-marker${human ? ' human' : failed ? ' failed' : ''}`} data-tooltip={`${author}：${message.content.slice(0, 80)}`} title={`${author}：${message.content.slice(0, 80)}`} onClick={() => document.querySelector(`[data-message-id="${CSS.escape(message.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />;
                })}
              </div>
              <button type="button" className="chat-jump-bottom" title="跳到最新消息" onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}>↓</button>
            </nav>
            {showTaskList && <><div className="workspace-resize-handle" onPointerDown={startPanelResize} title="拖动调整任务面板宽度" /><aside className="team-task-sidebar" style={{ width: workspacePanelWidth, minWidth: workspacePanelWidth }} aria-label="项目面板">
              <div className="team-task-sidebar-head"><strong>{taskReplay ? '任务回放' : '项目面板'}</strong><span>{taskReplay ? '只读' : `${projectBoard.length} 个项目`}</span>{!taskReplay && <button type="button" className="team-task-clear" title="清理聊天中的旧执行过程" onClick={() => clearTeamExecution(teamId)}>清理过程</button>}<button type="button" className="task-run-close" title="收起项目面板" onClick={() => setShowTaskList(false)}>×</button></div>
              {!taskReplay && <label className="task-history-search"><SearchOutlined /><input value={taskHistoryQuery} onChange={(event) => setTaskHistoryQuery(event.target.value)} placeholder="历史任务检索" aria-label="历史任务检索" />{taskHistoryQuery && <button type="button" onClick={() => setTaskHistoryQuery('')} title="清空搜索">×</button>}</label>}
              {!taskReplay && <div className="team-task-export-all"><button type="button" className="btn btn-sm" disabled={taskRuns.length === 0} onClick={exportAllTaskReplays} title="将当前团队会话的全部任务合并导出为 Markdown">导出全部回放 MD</button></div>}
              <div className="team-task-sidebar-body">
                {taskReplay ? <div className="task-replay">
                  <button type="button" className="task-replay-back" onClick={() => setReplayTaskId(null)}><ArrowLeftOutlined />返回任务列表</button>
                  <div className="task-replay-heading"><span>{state.teams.find((item) => item.id === taskReplay.teamId)?.name ?? taskReplay.teamId}</span><strong>{taskReplay.title}</strong><small>{new Date(taskReplay.updatedAt).toLocaleString('zh-CN')} · {taskReplay.status}</small></div>
                  <div className="task-replay-goal"><strong>原目标</strong><p>{taskReplay.goal}</p></div>
                  <details className="task-replay-section"><summary>确定性压缩摘要</summary><p>{taskReplay.summary.narrative || '暂无摘要'}</p>{taskReplay.summary.modelNarrative && <p className="task-replay-model-summary">模型辅助：{taskReplay.summary.modelNarrative}</p>}</details>
                  <details className="task-replay-section"><summary>已验证事实 {taskReplay.summary.verifiedFacts.length}</summary>{taskReplay.summary.verifiedFacts.map((item, index) => <p key={`${index}-${item.slice(0, 24)}`}>{item}</p>)}</details>
                  <details className="task-replay-section"><summary>交付文件 {taskReplay.summary.artifactPaths.length}</summary>{taskReplay.summary.artifactPaths.map((item) => <p key={item}>{item}</p>)}</details>
                  {replayWorkerCommands.length > 0 && <details className="task-replay-section task-worker-command-log"><summary>Worker 命令记录 {replayWorkerCommands.length}</summary>{replayWorkerCommands.map((record) => <p key={record.recordId}><time>#{record.sequence} · {new Date(record.occurredAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>{record.commandType} · {record.type === 'command_submitted' ? '已入队' : record.result?.ok ? '已完成' : `失败：${record.result?.error ?? '未知原因'}`}</span></p>)}</details>}
                  <div className={`task-ledger-integrity${ledgerIntegrity?.recovered ? ' is-recovered' : ''}`}><strong>任务事件账本</strong><span>{ledgerIntegrity?.recovered ? '已恢复损坏尾部' : '账本完整'}</span><small>{taskReplay.ledgerEvents.length ? `${taskReplay.ledgerEvents.length} 条事件` : '兼容回放'}</small></div>
                  <div className="task-replay-timeline"><strong>任务回放</strong>{replayTimeline.map((event) => <div key={`${event.source}-${event.id}`} className={event.verified ? 'is-verified' : ''}><time>{new Date(event.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><span>{event.sequence ? `#${event.sequence} · ` : ''}{event.source} · {event.type}</span>{event.transition && <small>状态：{event.transition}</small>}{event.domains.length > 0 && <small>变化域：{event.domains.join('、')}</small>}<p>{event.detail}</p></div>)}</div>
                </div> : taskHistoryQuery.trim() ? <div className="task-history-results">
                  <div className="team-task-section-title">跨会话结果 · {historyMatches.length}</div>
                  {historyMatches.map((match) => <button type="button" key={match.taskId} className="task-history-result" onClick={() => setReplayTaskId(match.taskId)}><span>{match.teamName} · {match.status}</span><strong>{match.title}</strong><p>{match.summary || match.goal}</p><small>已验证 {match.verifiedFacts.length} · 文件 {match.artifactPaths.length} · {new Date(match.updatedAt).toLocaleDateString('zh-CN')}</small></button>)}
                  {historyMatches.length === 0 && <div className="team-task-empty">没有匹配的历史任务</div>}
                </div> : <>
                  {projectSections.current.length > 0 && <div className="team-task-section"><div className="team-task-section-title">当前与待处理</div>{projectSections.current.map((project) => renderProjectCard(project as ProjectBoardProject))}</div>}
                  {projectSections.completed.length > 0 && <div className="team-task-section completed"><div className="team-task-section-title">已完成</div>{projectSections.completed.map((project) => renderProjectCard(project as ProjectBoardProject))}</div>}
                  {projectSections.stopped.length > 0 && <div className="team-task-section completed"><div className="team-task-section-title">已停止与归档</div>{projectSections.stopped.map((project) => renderProjectCard(project as ProjectBoardProject))}</div>}
                  {projectBoard.length === 0 && <div className="team-task-empty">暂无项目</div>}
                </>}
              </div>
            </aside></>}
          </div>
        </div>

        {/* 右侧产出物面板 */}
        {showOutputs && (
          <><div className="workspace-resize-handle" onPointerDown={startPanelResize} title="拖动调整产出物面板宽度" /><div className="chat-outputs-wrap" style={{ width: workspacePanelWidth, minWidth: workspacePanelWidth }}>
            <ChatOutputsPanel scope={`team:${teamId}`} maxHeight={500} selectedFilename={selectedOutputFilename} onBack={() => { setShowOutputs(false); setSelectedOutputFilename(null); }} />
          </div></>
        )}
      </div>
      {showRenameTeam && <RenameTeamModal teamId={team.id} currentName={team.name} onClose={() => setShowRenameTeam(false)} />}
      {showManageMembers && <ManageTeamMembersModal teamId={team.id} onClose={() => setShowManageMembers(false)} />}
    </div>
  );
}
