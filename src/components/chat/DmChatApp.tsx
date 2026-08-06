import { useState, useRef, useEffect } from 'react';
import { CloseOutlined, CopyOutlined, ExportOutlined, PaperClipOutlined, PauseCircleOutlined, PlayCircleOutlined, PlusOutlined, ReloadOutlined, SettingOutlined, StopOutlined } from '@ant-design/icons';
import type { ChatMessage, ConversationReference, SkillUsageEvidence, ThoughtChainStep } from '../../types';
import { useStore } from '../../storeContext';
import { generatedImageAttachment, generateImage, getConversationModel, isImageGenerationModel, loadDm, appendDm, replaceDm, runAgentLoop, resolveApiBase, extractUserInsights, getEmployeeModel, loadSettings, type ChatTurn, type Attachment, type ContextUsage } from '../../data/hermesClient';
import { getImageGenerationOptions } from '../../data/imageGenerationSettings';
import AgentAvatar from '../office/AgentAvatar';
import ChatOutputsPanel from '../outputs/ChatOutputsPanel';
import ChatMessageText from './ChatMessageText';
import MessageSkillEvidence from './MessageSkillEvidence';
import ThoughtChainView from './ThoughtChainView';
import { copyAndArchiveChatTranscript, copyToClipboard, downloadTextFile, messagesToMarkdown } from '../../utils/clipboard';
import ModelSelector from './ModelSelector';
import GeneratedImagePreview from './GeneratedImagePreview';
import ImageGenerationOptions from './ImageGenerationOptions';
import SkillMentionInput from '../skills/SkillMentionInput';
import { resolveSkillContextWithEvidence } from '../../engine/skillContext';
import SkillPickerButton from '../skills/SkillPickerButton';
import ExecutionPolicyControl from './ExecutionPolicyControl';
import type { SkillReference } from '../../types';
import type { OutputRecord } from '../../data/outputs';
import {
  fileToAttachment, attachmentsFromClipboard, attachmentWorkspaceContext, formatFileSize, persistAttachments,
  copyAttachmentsToWorkspace, createTaskWorkspaceId, initializeTaskWorkspace,
} from '../../utils/attachments';
import { getRegisteredTools } from '../../engine/toolCatalog';
import { useFileDrop } from '../../hooks/useFileDrop';
import { formatExecutionDuration, useAgentExecutionControl } from '../../hooks/useAgentExecutionControl';
import { getDirectExecutionControl, isExplicitPauseSteering, isExplicitResumeSteering, shouldHoldTaskForFeedback } from '../../engine/agentGuardrails.mjs';
import { executionControllerStatus, type ExecutionControllerSnapshot } from '../../engine/executionController.mjs';
import {
  BEGINNER_RESPONSE_GUIDE,
  getToolActivity,
  getToolReport,
  isToolResultSuccessful,
} from '../../data/assistantPresentation';
import { buildLayeredMemoryContext } from '../../data/layeredMemory';
import { referenceClarification, referencesFromToolResult, resolveConversationReferences } from '../../engine/conversationReferences.mjs';
import { createChatTaskBridge } from '../../engine/taskServiceBridge';
import { continuationExecutionPrompt, resolveChatTaskContinuation } from '../../engine/chatTaskContinuation';
import {
  activateChatSession,
  createChatSession,
  ensureActiveChatSession,
  listChatSessions,
  messageBelongsToConversation,
  normalizeConversationMessages,
  syncChatSessionsFromMessages,
  titleFromMessages,
  touchChatSession,
  type ChatSessionScope,
} from '../../data/chatSessions';

interface Props {
  empId: string;
}

interface DmRetrySettings { autoRetry: boolean; intervalSeconds: number; maxAttempts: number }
interface DmRetryJob {
  id: string;
  workspaceId: string;
  userText: string;
  goal?: string;
  request?: string;
  parentTaskId?: string;
  projectId?: string;
  attachments: Attachment[];
  skillContext: string;
  skillRefs: SkillReference[];
  skillEvidence: SkillUsageEvidence[];
  referenceContext?: string;
  referenceSourceUrl?: string;
  history: ChatTurn[];
  attempt: number;
  status: 'waiting' | 'failed';
  nextRetryAt?: number;
  lastError: string;
  controllerState?: ExecutionControllerSnapshot;
  conversationId: string;
}

const DM_RETRY_SETTINGS_KEY = 'hermes_office_dm_retry_settings_v1';
const retryJobKey = (empId: string) => `hermes_office_dm_retry_job_v1_${empId}`;
const defaultRetrySettings: DmRetrySettings = { autoRetry: true, intervalSeconds: 10, maxAttempts: 5 };
function loadRetrySettings(): DmRetrySettings {
  try { return { ...defaultRetrySettings, ...JSON.parse(localStorage.getItem(DM_RETRY_SETTINGS_KEY) ?? '{}') }; } catch { return defaultRetrySettings; }
}
function loadRetryJob(empId: string): DmRetryJob | null {
  try {
    const raw = localStorage.getItem(retryJobKey(empId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DmRetryJob>;
    const job = {
      ...parsed,
      workspaceId: parsed.workspaceId ?? createTaskWorkspaceId('dm', empId),
      skillRefs: parsed.skillRefs ?? [],
      skillEvidence: parsed.skillEvidence ?? [],
    } as DmRetryJob;
    return job.status === 'waiting' && !job.nextRetryAt ? { ...job, status: 'failed' } : job;
  } catch { return null; }
}
function saveRetryJob(empId: string, job: DmRetryJob | null) {
  try { if (job) localStorage.setItem(retryJobKey(empId), JSON.stringify(job)); else localStorage.removeItem(retryJobKey(empId)); } catch {}
}

function loadDmMessages(empId: string, scope: ChatSessionScope): ChatMessage[] {
  const messages = normalizeConversationMessages(loadDm(empId), scope);
  syncChatSessionsFromMessages(scope, messages);
  replaceDm(empId, messages);
  return messages;
}

// 本地剧本回落（无 API 或调用失败时用）
function craftReply(role: string, userText: string): string {
  const t = userText;
  const pools: Record<string, string[]> = {
    pm: [
      `收到，我来协调排期 🎯 「${t.slice(0, 12)}」我拉个短会同步一下。`,
      `了解。这事我先记进看板，稍后给你拆任务。`,
      `好的，我去对齐一下资源，@规划者 也会一起评估。`,
    ],
    planner: [
      `嗯，这个需求我先出个方案 📐 「${t.slice(0, 12)}」关键点我梳理下。`,
      `收到，我画个架构草图，稍后发你确认。`,
      `这个想法可行，我拆解成几个技术模块再说。`,
    ],
    coder: [
      `收到 💻 「${t.slice(0, 12)}」我开干了，写完喊你。`,
      `行，这块我来实现，预计很快出第一版。`,
      `OK，代码热好了，这就写。`,
    ],
    checker: [
      `明白 ✅ 「${t.slice(0, 12)}」我来把关，重点查正确性和安全。`,
      `收到，我会按验收标准逐项核对。`,
      `好，测试用例我来补，确保不漏。`,
    ],
    custom: [
      `收到～ 「${t.slice(0, 12)}」我看看哈。`,
      `好的，马上处理。`,
    ],
  };
  const list = pools[role] ?? pools.custom;
  return list[Math.floor(Math.random() * list.length)];
}

export default function DmChatApp({ empId }: Props) {
  const { state, dispatch } = useStore();
  const emp = state.employees.find((e) => e.id === empId);
  const sessionScope: ChatSessionScope = `dm:${empId}`;
  const [conversationId, setConversationId] = useState(() => ensureActiveChatSession(sessionScope));
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const [allMsgs, setAllMsgs] = useState<ChatMessage[]>(() => loadDmMessages(empId, sessionScope));
  const msgs = allMsgs.filter((message) => messageBelongsToConversation(message, conversationId, sessionScope));
  const chatSessions = listChatSessions(sessionScope).filter((session) => session.id !== conversationId);
  const [pendingNewChat, setPendingNewChat] = useState(false);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [status, setStatus] = useState('');
  const [completedActionCount, setCompletedActionCount] = useState(0);
  const [liveActivities, setLiveActivities] = useState<Array<{ id: string; matchKey: string; label: string; args: string; state: 'active' | 'error' }>>([]);
  const [liveExecutionSteps, setLiveExecutionSteps] = useState<ThoughtChainStep[]>([]);
  const [liveText, setLiveText] = useState('');
  const [showOutputs, setShowOutputs] = useState(false);
  const [selectedOutputFilename, setSelectedOutputFilename] = useState<string | null>(null);
  const [outputsWidth, setOutputsWidth] = useState(320);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [skillRefs, setSkillRefs] = useState<SkillReference[]>([]);
  const [retrySettings, setRetrySettings] = useState<DmRetrySettings>(() => loadRetrySettings());
  const [showRetrySettings, setShowRetrySettings] = useState(false);
  const [retryJob, setRetryJob] = useState<DmRetryJob | null>(() => {
    const job = loadRetryJob(empId);
    return job ? { ...job, conversationId: job.conversationId ?? ensureActiveChatSession(`dm:${empId}`) } : null;
  });
  const [retryNow, setRetryNow] = useState(Date.now());
  const runJobRef = useRef<(job: DmRetryJob) => Promise<void>>(async () => {});
  const steeringMessagesRef = useRef<string[]>([]);
  const activeWorkspaceIdRef = useRef<string | undefined>(undefined);
  const queuedFollowUpsRef = useRef<Array<{ userText: string; attachments: Attachment[]; skillContext: string; skillRefs: SkillReference[]; skillEvidence: SkillUsageEvidence[]; referenceContext?: string; referenceSourceUrl?: string; conversationId: string }>>([]);
  const msgsRef = useRef(msgs);
  const previousExecutionStateRef = useRef<'running' | 'paused' | 'stopping'>('running');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const executionControl = useAgentExecutionControl(typing);
  const resizeOutputs = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const move = (moveEvent: PointerEvent) => setOutputsWidth(Math.max(240, Math.min(520, window.innerWidth - moveEvent.clientX)));
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  };

  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const atts = await persistAttachments(`dm:${empId}`, await Promise.all(arr.map(fileToAttachment)));
    setAttachments((prev) => [...prev, ...atts]);
  };
  const fileDrop = useFileDrop(addFiles, !!retryJob);

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const atts = await persistAttachments(`dm:${empId}`, await attachmentsFromClipboard(e));
    if (atts.length > 0) {
      e.preventDefault();
      setAttachments((prev) => [...prev, ...atts]);
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs.length, typing, status]);

  useEffect(() => {
    if (!retryJob || retryJob.status !== 'waiting' || !retryJob.nextRetryAt) return;
    const delay = Math.max(0, retryJob.nextRetryAt - Date.now());
    const timer = window.setTimeout(() => void runJobRef.current({ ...retryJob, status: 'waiting', nextRetryAt: undefined }), delay);
    const ticker = window.setInterval(() => setRetryNow(Date.now()), 500);
    return () => { window.clearTimeout(timer); window.clearInterval(ticker); };
  }, [retryJob]);

  const push = (m: ChatMessage, targetConversationId = conversationIdRef.current) => {
    const message = { ...m, conversationId: targetConversationId };
    setAllMsgs((previous) => [...previous, message]);
    if (targetConversationId === conversationIdRef.current) msgsRef.current = [...msgsRef.current, message];
    appendDm(empId, [message]);
  };

  useEffect(() => {
    msgsRef.current = msgs;
  }, [msgs]);

  useEffect(() => {
    if (!pendingNewChat || typing) return;
    setPendingNewChat(false);
    if (msgs.length) touchChatSession(sessionScope, conversationIdRef.current, titleFromMessages(msgs, '员工私聊'));
    const session = createChatSession(sessionScope);
    setConversationId(session.id);
    setText('');
    setAttachments([]);
    setSkillRefs([]);
    setCompletedActionCount(0);
    setLiveActivities([]);
    setLiveExecutionSteps([]);
    setLiveText('');
    setStatus('');
    setRetryJob(null);
    saveRetryJob(empId, null);
    steeringMessagesRef.current.splice(0);
    queuedFollowUpsRef.current.splice(0);
    activeWorkspaceIdRef.current = undefined;
    executionControl.reset();
    // This effect intentionally performs a complete runtime reset after stop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNewChat, typing]);

  useEffect(() => {
    const previous = previousExecutionStateRef.current;
    const current = executionControl.executionState;
    previousExecutionStateRef.current = current;
    if (!typing || previous === current || !emp) return;
    if (current === 'paused') {
      push({
        id: `dm-${Date.now()}-${empId}-paused`, authorId: empId, roleId: emp.role,
        content: '任务已暂停，原来的步骤不会自行恢复。你仍可以继续发消息，我会先回答；只有点击“继续”或明确让我继续，原任务才会恢复。',
        mentions: [], timestamp: Date.now(), kind: 'text',
      });
    } else if (current === 'running' && previous === 'paused') {
      push({
        id: `dm-${Date.now()}-${empId}-resumed`, authorId: empId, roleId: emp.role,
        content: '任务已继续，我会从暂停时保留的进度接着处理。', mentions: [], timestamp: Date.now(), kind: 'text',
      });
    }
    // push is intentionally tied to this employee chat instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing, executionControl.executionState, empId, emp]);

  if (!emp) return <div style={{ padding: 20 }}>员工不存在</div>;

  const handleSend = async () => {
    const content = text.trim();
    if (!content && attachments.length === 0) return;
    const atts = attachments;
    const requestConversationId = conversationIdRef.current;
    touchChatSession(sessionScope, requestConversationId, content || atts[0]?.name || `与 ${emp.name} 的对话`);
    const referenceResolution = resolveConversationReferences({ input: content, history: msgs, selectedSkillRefs: skillRefs });
    const refs = skillRefs.length ? skillRefs : referenceResolution.skillRefs;
    const skillResolution = await resolveSkillContextWithEvidence(refs);
    const skillContext = skillResolution.context;
    const skillEvidence = skillResolution.evidence;
    setSkillRefs([]);
    setText('');
    setAttachments([]);
    // 展示内容：文本 + 附件名
    const display = [content, ...atts.map((a) => `[📎 ${a.name}]`)].filter(Boolean).join('\n');
    push({
      id: `dm-${Date.now()}-me`,
      authorId: 'emp-me',
      roleId: 'human',
      content: display,
      mentions: [],
      timestamp: Date.now(),
      kind: 'text',
      attachments: atts,
      skillRefs: refs,
      skillEvidence,
      references: referenceResolution.references,
    });

    if (referenceResolution.status === 'ambiguous') {
      push({ id: `dm-${Date.now()}-${empId}-reference-unclear`, authorId: empId, roleId: emp.role, content: referenceClarification(referenceResolution), mentions: [], timestamp: Date.now(), kind: 'text', references: referenceResolution.references });
      return;
    }
    if (referenceResolution.status === 'resolved' && referenceResolution.action === 'share-link') {
      const reference = referenceResolution.references[0];
      const reply = reference.sourceUrl
        ? `这是“${reference.label}”的真实来源链接：\n${reference.sourceUrl}`
        : `“${reference.label}”是本机已有对象，没有记录可公开访问的来源链接。我不会重新搜索同名对象来替代它。`;
      push({ id: `dm-${Date.now()}-${empId}-reference-link`, authorId: empId, roleId: emp.role, content: reply, mentions: [], timestamp: Date.now(), kind: 'text', references: referenceResolution.references });
      return;
    }

    if (typing) {
      const mode = loadSettings().followUpMode ?? 'steer';
      const followUp = [content, attachmentWorkspaceContext(atts), skillContext].filter(Boolean).join('\n\n');
      const controlIntent = getDirectExecutionControl(content);
      if (controlIntent === 'stop') {
        executionControl.stop();
        setStatus('正在安全停止，已经完成的内容会保留…');
        return;
      }
      if (controlIntent === 'pause') {
        executionControl.pause();
        setStatus('任务已暂停');
        return;
      }
      if (controlIntent === 'resume') {
        executionControl.resume();
        setStatus('正在从暂停位置继续…');
        return;
      }
      if (mode === 'steer') {
        if (activeWorkspaceIdRef.current && atts.length) {
          try {
            await copyAttachmentsToWorkspace(`dm:${empId}`, activeWorkspaceIdRef.current, atts);
          } catch (error) {
            push({
              id: `dm-${Date.now()}-${empId}-attachment-error`, authorId: empId, roleId: emp.role,
              content: `这次附件还没有交给当前任务：${error instanceof Error ? error.message : String(error)}。原任务保持当前状态。`,
              mentions: [], timestamp: Date.now(), kind: 'text',
            });
            return;
          }
        }
        const holdForFeedback = shouldHoldTaskForFeedback(followUp);
        if (isExplicitPauseSteering([followUp]) || holdForFeedback) executionControl.pause();
        if (isExplicitResumeSteering([followUp])) executionControl.resume();
        steeringMessagesRef.current.push(followUp);
        executionControl.interruptForSteering();
        setStatus(holdForFeedback ? '已挂起原任务，正在回答你的反馈…' : '正在优先处理你刚刚说的话…');
      } else {
        queuedFollowUpsRef.current.push({ userText: content, attachments: atts, skillContext, skillRefs: refs, skillEvidence, referenceContext: referenceResolution.context, referenceSourceUrl: referenceResolution.references[0]?.sourceUrl, conversationId: requestConversationId });
        push({
          id: `dm-${Date.now()}-${empId}-ack`, authorId: empId, roleId: emp.role,
          content: '收到。这条要求已经排到当前任务之后，不会混进正在执行的步骤。',
          mentions: [], timestamp: Date.now(), kind: 'text',
        });
        setStatus('当前任务继续执行，新要求已排队…');
      }
      return;
    }

    const history: ChatTurn[] = msgs.slice(-40).map((m) => ({ role: m.roleId === 'human' ? 'user' : 'assistant', content: m.content }));
    const continuation = await resolveChatTaskContinuation({
      conversationId: requestConversationId,
      taskType: 'dm',
      ownerId: empId,
      message: content,
    }).catch(() => undefined);
    void runDmJob({
      id: `dm-retry-${Date.now()}`,
      workspaceId: continuation?.workspaceId ?? createTaskWorkspaceId('dm', empId),
      userText: continuationExecutionPrompt(continuation, content),
      goal: continuation?.goal ?? content,
      request: content,
      parentTaskId: continuation?.taskId,
      projectId: continuation?.projectId,
      attachments: atts,
      skillContext,
      skillRefs: refs,
      skillEvidence,
      referenceContext: referenceResolution.context,
      referenceSourceUrl: referenceResolution.references[0]?.sourceUrl,
      history,
      attempt: 0,
      status: 'waiting',
      lastError: '',
      conversationId: requestConversationId,
    });

    // 自动提炼用户洞察（每 3 条用户消息触发一次）
    const userMsgCount = msgs.filter(m => m.roleId === 'human').length;
    if (userMsgCount > 0 && userMsgCount % 3 === 0 && resolveApiBase()) {
      const chatText = msgs.slice(-8).map(m => {
        const who = m.roleId === 'human' ? '用户' : emp.name;
        return `${who}: ${m.content.slice(0, 200)}`;
      }).join('\n');
      extractUserInsights(chatText, `私聊-${emp.name}`).catch(() => {});
    }
  };

  const runDmJob = async (job: DmRetryJob) => {
    setTyping(true);
    setStatus('思考中…');
    setCompletedActionCount(0);
    setLiveActivities([]);
    setLiveExecutionSteps([]);
    executionControl.reset();
    dispatch({ type: 'UPDATE_EMPLOYEE', id: empId, partial: { isWorking: true } });
    activeWorkspaceIdRef.current = job.workspaceId;
    let latestControllerState = job.controllerState;
    const taskBridge = createChatTaskBridge({
      taskType: 'dm',
      ownerId: empId,
      title: `${emp.name}: ${(job.goal || job.userText).slice(0, 100)}`,
      goal: job.goal || job.userText,
      request: job.request || job.userText,
      workspaceId: job.workspaceId,
      parentTaskId: job.parentTaskId,
      projectId: job.projectId,
      idempotencyKey: `dm-chat:${empId}:${job.id}`,
      conversationId: job.conversationId,
      references: job.skillRefs.map((skill) => ({ kind: 'skill', id: skill.id, label: skill.name, state: 'local' })),
    });
    try {
      await initializeTaskWorkspace(job.workspaceId, { kind: 'dm', label: `${emp.name} / ${job.userText.slice(0, 50) || '私聊任务'}`, taskId: job.id });
      await copyAttachmentsToWorkspace(`dm:${empId}`, job.workspaceId, job.attachments);
      const { text: reply, usage, contextUsage, thoughtChain, skillEvidence, references, attachments: generatedAttachments } = await generateReply(
        job.userText,
        job.attachments,
        job.skillContext,
        job.skillEvidence,
        job.history,
        job.workspaceId,
        job.controllerState,
        job.referenceContext,
        job.referenceSourceUrl,
        (controllerState) => {
          latestControllerState = controllerState;
          saveRetryJob(empId, { ...job, controllerState });
        },
        taskBridge,
        job.conversationId,
      );
      setStatus('正在整理清晰的结果…');
      setLiveText('');
      push({ id: `dm-${Date.now()}-${empId}`, authorId: empId, roleId: emp.role, content: reply, mentions: [], timestamp: Date.now(), kind: 'text', tokens: usage, contextUsage, thoughtChain, attachments: generatedAttachments, skillRefs: job.skillRefs.length ? job.skillRefs : undefined, skillEvidence: skillEvidence?.length ? skillEvidence : undefined, references: references?.length ? references : undefined }, job.conversationId);
      setRetryJob(null);
      saveRetryJob(empId, null);
    } catch (error) {
      await taskBridge.fail(error);
      const attempt = job.attempt + 1;
      const lastError = error instanceof Error ? error.message : String(error);
      const canRetry = retrySettings.autoRetry && !(error as any)?.executionRetryExhausted && attempt < retrySettings.maxAttempts;
      const next: DmRetryJob = {
        ...job, attempt, lastError, controllerState: latestControllerState,
        status: canRetry ? 'waiting' : 'failed',
        nextRetryAt: canRetry ? Date.now() + retrySettings.intervalSeconds * 1000 : undefined,
      };
      setRetryJob(next);
      saveRetryJob(empId, next);
    } finally {
      if (activeWorkspaceIdRef.current === job.workspaceId) activeWorkspaceIdRef.current = undefined;
      setTyping(false);
      setStatus('');
      setLiveActivities([]);
      setLiveExecutionSteps([]);
      setLiveText('');
      dispatch({ type: 'UPDATE_EMPLOYEE', id: empId, partial: { isWorking: false, currentTask: undefined } });
      const queued = queuedFollowUpsRef.current.shift();
      if (queued) {
        const history = msgsRef.current.slice(-40).map((m): ChatTurn => ({ role: m.roleId === 'human' ? 'user' : 'assistant', content: m.content }));
        window.setTimeout(() => void runDmJob({
          id: `dm-queued-${Date.now()}`,
          workspaceId: createTaskWorkspaceId('dm', empId),
          userText: queued.userText,
          attachments: queued.attachments,
          skillContext: queued.skillContext,
          skillRefs: queued.skillRefs,
          skillEvidence: queued.skillEvidence,
          referenceContext: queued.referenceContext,
          referenceSourceUrl: queued.referenceSourceUrl,
          history,
          attempt: 0,
          status: 'waiting',
          lastError: '',
          conversationId: queued.conversationId,
        }), 0);
      }
    }
  };
  runJobRef.current = runDmJob;

  const restartDmJob = () => {
    if (!retryJob) return;
    const restarted = { ...retryJob, attempt: 0, status: 'waiting' as const, nextRetryAt: undefined, lastError: '' };
    setRetryJob(restarted);
    saveRetryJob(empId, restarted);
    void runDmJob(restarted);
  };

  const updateRetrySettings = (partial: Partial<DmRetrySettings>) => {
    const next = { ...retrySettings, ...partial };
    setRetrySettings(next);
    localStorage.setItem(DM_RETRY_SETTINGS_KEY, JSON.stringify(next));
  };

  // 优先真调 OpenAI 兼容模型（带员工提示词），失败/未配置则回落本地剧本
  const generateReply = async (userText: string, atts: Attachment[] = [], skillContext = '', skillEvidence: SkillUsageEvidence[] = [], historyOverride?: ChatTurn[], workspaceId?: string, initialExecutionState?: ExecutionControllerSnapshot, referenceContext = '', referenceSourceUrl = '', onExecutionState?: (state: ExecutionControllerSnapshot) => void, taskBridge?: ReturnType<typeof createChatTaskBridge>, targetConversationId = conversationIdRef.current): Promise<{ text: string; usage?: number; contextUsage?: ContextUsage; thoughtChain?: ThoughtChainStep[]; skillEvidence?: SkillUsageEvidence[]; references?: ConversationReference[]; executionState?: ExecutionControllerSnapshot; attachments?: Attachment[] }> => {
    // 文本类附件：直接拼进用户文本作为上下文
    let enriched = userText;
    const textAtts = atts.filter((a) => a.kind === 'text' && a.dataUrl);
    if (textAtts.length > 0) {
      enriched += '\n\n' + textAtts
        .map((a) => `【附件 ${a.name}】\n${a.dataUrl!.slice(0, 6000)}`)
        .join('\n\n');
    }
    enriched += attachmentWorkspaceContext(atts);
    // 图片类附件：走多模态视觉
    const imageAtts = atts.filter((a) => a.kind === 'image');

    const conversationModel = getConversationModel('dm', emp);
    if (isImageGenerationModel(conversationModel)) {
      setStatus('Generating image...');
      const image = await generateImage(userText, conversationModel, imageAtts, getImageGenerationOptions('dm'));
      return {
        text: `${imageAtts.length > 0 ? 'Image edited' : 'Image generated'} with ${image.model}.`,
        attachments: [generatedImageAttachment(image)],
        skillEvidence,
      };
    }

    if (!resolveApiBase(getEmployeeModel(emp))) {
      // 未配置 API：本地剧本 + 短延迟模拟
      await new Promise((r) => setTimeout(r, 700 + Math.random() * 900));
      await executionControl.waitIfPaused();
      if (executionControl.shouldStop()) return { text: '还没有完成，任务已经停止。停止前的内容会保留。' };
      const t = emp.prompt
        ? `（按人设：${emp.prompt.slice(0, 30)}${emp.prompt.length > 30 ? '…' : ''}）${craftReply(emp.role, enriched)}`
        : craftReply(emp.role, enriched);
      return { text: t, skillEvidence };
    }
    const personaPrompt = emp.prompt?.trim() || `你是「${emp.name}」，一名${emp.title}。用简洁、专业的中文回复，语气贴合你的角色。需要产出文件时直接调用工具完成。`;
    const systemPrompt = `${personaPrompt}\n\n${BEGINNER_RESPONSE_GUIDE}`;
    const history = historyOverride ?? msgs.slice(-40).map((m): ChatTurn => ({ role: m.roleId === 'human' ? 'user' : 'assistant', content: m.content }));
    const thoughtChain: ThoughtChainStep[] = [];
    const showThoughtChain = loadSettings().showThoughtChain !== false;
    const executionSkillEvidence = [...skillEvidence];
    const executionReferences: ConversationReference[] = [];
    const layeredMemoryContext = await buildLayeredMemoryContext({ query: enriched, employeeId: empId, limit: 16 });
    const r = await runAgentLoop({
      turns: [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: enriched }],
      tools: getRegisteredTools(), scene: 'dm', label: emp.name, modelConfig: getEmployeeModel(emp),
      extraSystemContext: [emp.soul, layeredMemoryContext, skillContext, referenceContext].filter(Boolean).join('\n\n'), scope: `dm:${empId}`, attachments: imageAtts,
      skillRefs,
      referenceContext,
      referenceSourceUrl,
      workspaceId,
      shouldStop: executionControl.shouldStop,
      waitIfPaused: executionControl.waitIfPaused,
      consumeSteeringMessages: () => steeringMessagesRef.current.splice(0),
      getModelRequestSignal: executionControl.getModelRequestSignal,
      onTaskPrepared: (decision) => taskBridge?.prepare(decision),
      initialExecutionState,
      onExecutionState(state) {
        taskBridge?.heartbeat(state);
        setStatus(executionControllerStatus(state));
        onExecutionState?.(state);
      },
      onTurnLifecycle(state) {
        taskBridge?.lifecycle(state);
      },
      onSteeringReply(content, usage, contextUsage) {
        setLiveText('');
        push({
          id: `dm-${Date.now()}-${empId}-steering`, authorId: empId, roleId: emp.role,
          content, mentions: [], timestamp: Date.now(), kind: 'text',
          tokens: usage.totalTokens || undefined, contextUsage,
        }, targetConversationId);
        setStatus('已结合新要求重新判断…');
      },
      onTextDelta(_delta, accumulated) {
        setLiveText(accumulated);
        setStatus('正在生成回复…');
      },
      async onToolCall(name, args) {
        setLiveText('');
        await taskBridge?.toolStarted(name, args ?? '');
        setStatus(getToolActivity(name, args));
        const matchKey = `${name}:${args}`;
        const report = getToolReport(name, args);
        setLiveActivities([{ id: `${Date.now()}`, matchKey, label: report, args: args ?? '', state: 'active' }]);
        dispatch({ type: 'UPDATE_EMPLOYEE', id: empId, partial: { isWorking: true, currentTask: report } });
      },
      onToolResult(name, args, result, success, _protocolEvidence, structuredEvidence) {
        const matchKey = `${name}:${args}`;
        const resultSuccess = isToolResultSuccessful(result, success);
        taskBridge?.toolFinished(name, args ?? '', result, resultSuccess);
        taskBridge?.artifacts(structuredEvidence);
        executionReferences.push(...referencesFromToolResult(name, args, result, resultSuccess));
        if (/^(search_skills|read_skill|install_skill)$/u.test(name)) {
          let skillId = '';
          try {
            const parsed = JSON.parse(args || '{}') as { id?: string; installedSkillId?: string };
            skillId = parsed.id ?? parsed.installedSkillId ?? '';
          } catch {}
          if (!skillId && name === 'install_skill') skillId = result.match(/(?:^|\n)ID:\s*([^\n]+)/u)?.[1]?.trim() ?? '';
          const selected = skillEvidence.find((item) => item.skillId === skillId || item.skillName === skillId);
          executionSkillEvidence.push({
            ts: Date.now(), skillId: skillId || selected?.skillId, skillName: selected?.skillName,
            action: name === 'search_skills' ? 'searched' : name === 'read_skill' ? (resultSuccess ? 'read' : 'read-failed') : 'installed',
            toolName: name, reason: resultSuccess ? `员工实际执行了 ${name}` : `${name} 执行失败`,
            detail: result.slice(0, 240), verified: resultSuccess, stage: name === 'install_skill' ? 'installation' : 'rules', source: 'employee',
          });
        } else if (resultSuccess) {
          const activeSkills = [...new Map(executionSkillEvidence.filter((item) => item.action === 'read' && item.verified).map((item) => [item.skillId || item.skillName, item])).values()];
          for (const item of activeSkills) executionSkillEvidence.push({
            ts: Date.now(), skillId: item.skillId, skillName: item.skillName, action: 'called', toolName: name,
            reason: '已按当前 Skill 规则执行真实工具', detail: result.slice(0, 240), verified: true, stage: 'invocation', source: 'employee',
          });
        }
        setCompletedActionCount((count) => count + 1);
        setLiveActivities((current) => {
          let index = -1;
          for (let cursor = current.length - 1; cursor >= 0; cursor -= 1) {
            if (current[cursor].matchKey === matchKey && current[cursor].state === 'active') { index = cursor; break; }
          }
          if (index < 0) return current;
          if (resultSuccess) return current.filter((_, itemIndex) => itemIndex !== index);
          return current.map((item, itemIndex) => itemIndex === index ? { ...item, state: 'error' } : item);
        });
        if (!showThoughtChain) return;
        const step: ThoughtChainStep = { toolName: name, args: args ?? '', result: result.slice(0, name === 'web_search' ? 12000 : 2000), success: resultSuccess, timestamp: Date.now() };
        thoughtChain.push(step);
        setLiveExecutionSteps((current) => [...current, step].slice(-50));
      },
      onModelRetry(attempt, maxAttempts, error, nextDelayMs) {
        setStatus(nextDelayMs > 0
          ? `整理结果暂时失败，${Math.round(nextDelayMs / 1000)} 秒后进行第 ${attempt + 1}/${maxAttempts} 次尝试…`
          : '整理模型暂时不可用，正在直接生成可读结果…');
        if (!showThoughtChain) return;
        const step: ThoughtChainStep = { toolName: 'model_summary', args: '', result: error.slice(0, 2000), success: false, timestamp: Date.now() };
        thoughtChain.push(step);
        setLiveExecutionSteps((current) => [...current, step].slice(-50));
      },
    });
    await taskBridge?.finish({
      executionState: r.executionState,
      usage: r.usage,
      model: r.model,
      output: r.content ?? '',
      turnRuntime: r.turnRuntime,
      turnFinalization: r.turnFinalization,
      lifecycle: r.turnLifecycle,
    });
    const completed = r.turnFinalization?.status === 'completed';
    const invokedSkills = [...new Map(executionSkillEvidence.filter((item) => item.action === 'called' && item.verified).map((item) => [item.skillId || item.skillName, item])).values()];
    for (const item of invokedSkills) {
      executionSkillEvidence.push({ ts: Date.now(), skillId: item.skillId, skillName: item.skillName, action: 'produced', reason: 'Skill 调用后生成了本轮结果', detail: (r.content ?? '').slice(0, 240), verified: Boolean(r.content?.trim()), stage: 'output', source: 'employee' });
      executionSkillEvidence.push({ ts: Date.now(), skillId: item.skillId, skillName: item.skillName, action: completed ? 'accepted' : 'rejected', reason: completed ? '本轮结果通过任务完成门禁' : '本轮结果未通过任务完成门禁', verified: completed, stage: 'acceptance', source: 'employee' });
    }
    return { text: r.content ?? '（无回复）', usage: r.usage.totalTokens, contextUsage: r.contextUsage, thoughtChain: thoughtChain.length ? thoughtChain : undefined, skillEvidence: executionSkillEvidence, references: executionReferences, executionState: r.executionState };
  };

  const openOutputFromMessage = (output: OutputRecord) => {
    setSelectedOutputFilename(output.filename);
    setShowOutputs(true);
  };

  const handleCopyMsg = async (content: string) => { await copyToClipboard(content); };
  const handleCopyAll = async () => {
    await copyToClipboard(msgs.map((m) => `[${m.roleId === 'human' ? '你' : emp.name}] ${m.content}`).join('\n\n'));
    await copyAndArchiveChatTranscript({
      scope: `dm-${emp.id}`,
      title: `${emp.name} Direct Message Transcript`,
      messages: msgs.map((message) => ({
        role: message.roleId === 'human' ? 'User' : emp.title,
        author: message.roleId === 'human' ? 'User' : emp.name,
        content: message.content,
        time: new Date(message.timestamp).toLocaleString('zh-CN'),
        attachments: message.attachments,
      })),
    });
  };
  const handleExport = () => {
    const md = messagesToMarkdown(msgs.map((m) => ({
      role: m.roleId === 'human' ? '你' : emp.name,
      author: m.roleId === 'human' ? '你' : emp.name,
      content: m.content,
      time: new Date(m.timestamp).toLocaleString('zh-CN'),
      attachments: m.attachments,
    })), `与 ${emp.name} 私聊记录`);
    downloadTextFile(`私聊-${emp.name}-${new Date().toISOString().slice(0, 10)}.md`, md);
  };

  const resetConversationRuntime = () => {
    setText('');
    setAttachments([]);
    setSkillRefs([]);
    setCompletedActionCount(0);
    setLiveActivities([]);
    setLiveExecutionSteps([]);
    setStatus('');
    setRetryJob(null);
    saveRetryJob(empId, null);
    steeringMessagesRef.current.splice(0);
    queuedFollowUpsRef.current.splice(0);
    activeWorkspaceIdRef.current = undefined;
    executionControl.reset();
  };

  const openFreshChat = () => {
    if (msgs.length) touchChatSession(sessionScope, conversationIdRef.current, titleFromMessages(msgs, `与 ${emp.name} 的对话`));
    const session = createChatSession(sessionScope);
    setConversationId(session.id);
    resetConversationRuntime();
  };

  const handleStartNewChat = () => {
    if (typing) {
      if (!confirm(`当前任务还在运行。是否安全停止 ${emp.name} 的任务，并在停止后自动新建聊天？`)) return;
      setPendingNewChat(true);
      steeringMessagesRef.current.splice(0);
      queuedFollowUpsRef.current.splice(0);
      executionControl.stop();
      setStatus('正在停止旧任务，随后会自动开启新聊天…');
      return;
    }
    if (retryJob && !confirm('当前有一个待重试任务。新建聊天会取消这次重试，是否继续？')) return;
    openFreshChat();
  };

  const handleRestoreChat = (targetConversationId: string) => {
    if (!targetConversationId || typing || !activateChatSession(sessionScope, targetConversationId)) return;
    if (msgs.length) touchChatSession(sessionScope, conversationIdRef.current, titleFromMessages(msgs, `与 ${emp.name} 的对话`));
    setConversationId(targetConversationId);
    resetConversationRuntime();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-panel">
      {/* 聊天主体 + 右侧产出物 */}
      <div className="chat-layout">
        <div className="chat-main">
          {/* 对方信息条 */}
          <div className="dm-peer">
            <AgentAvatar employee={emp} size={30} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{emp.name}</div>
              <div style={{ fontSize: 11, color: emp.statusColor }}>{emp.title}</div>
            </div>
            <span className={`dm-peer-status ${!emp.isOnline ? 'offline' : emp.isWorking ? 'busy' : 'online'}`}>
              {!emp.isOnline ? '● 离线' : emp.isWorking ? '● 工作中' : '● 空闲'}
            </span>
            <button
              className={`btn btn-sm ${showOutputs ? 'btn-primary' : ''}`}
              onClick={() => setShowOutputs(!showOutputs)}
              style={{ marginLeft: 'auto' }}
              title="产出物"
            >
              📁{showOutputs ? ' ✕' : ''}
            </button>
          </div>

          {/* 消息流 */}
          {typing && (
            <div className="assistant-activity" role="status" aria-live="polite">
              <div className="assistant-activity-glow" />
              <span className="assistant-activity-icon"><AgentAvatar employee={emp} size={22} /></span>
              <div className="assistant-activity-copy">
                <strong>{executionControl.executionState === 'paused' ? '任务已暂停' : executionControl.executionState === 'stopping' ? '正在安全停止…' : status || '思考中…'}</strong>
                <span>已完成 {completedActionCount} 个动作 · 已运行 {formatExecutionDuration(executionControl.elapsedSeconds)}</span>
              </div>
              <div className="assistant-activity-controls">
                {executionControl.executionState === 'paused'
                  ? <button type="button" onClick={executionControl.resume} title="继续任务"><PlayCircleOutlined /><span>继续</span></button>
                  : <button type="button" onClick={executionControl.pause} disabled={executionControl.executionState === 'stopping'} title="完成当前动作后暂停"><PauseCircleOutlined /><span>暂停</span></button>}
                <button type="button" className="is-stop" onClick={executionControl.stop} disabled={executionControl.executionState === 'stopping'} title="完成当前动作后停止"><StopOutlined /><span>停止</span></button>
              </div>
            </div>
          )}

          <div className="chat-messages">
            {msgs.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, padding: '30px 0' }}>
                开始和 {emp.name} 对话吧 👋
              </div>
            )}
            {msgs.map((msg) => {
              const isHuman = msg.roleId === 'human';
              return (
                <div key={msg.id} className={`msg ${isHuman ? 'human' : ''}`}>
                  {!isHuman && (
                    <div className="msg-meta">
                      <span className="msg-author" style={{ color: emp.statusColor }}>{emp.name}</span>
                      <span className="msg-time">
                        {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                  <div className="msg-row">
                    <div className="msg-bubble"><ChatMessageText content={msg.content} scope={`dm:${empId}`} onOpenOutput={openOutputFromMessage} /></div>
                    <button className="msg-copy-btn" onClick={() => handleCopyMsg(msg.content)} title="复制">📋</button>
                  </div>
                  <GeneratedImagePreview attachments={msg.attachments} />
                  <MessageSkillEvidence refs={msg.skillRefs} evidence={msg.skillEvidence} />
                  {msg.tokens != null && (
                    <div className="msg-tokens">≈ {msg.tokens.toLocaleString()} tokens</div>
                  )}
                  {msg.thoughtChain && msg.thoughtChain.length > 0 && <ThoughtChainView steps={msg.thoughtChain} />}
                </div>
              );
            })}
            {typing && status && (
              <div className="msg assistant-live-report">
                <div className="msg-meta">
                  <span className="msg-author" style={{ color: emp.statusColor }}>{emp.name}</span>
                </div>
                <div className="msg-bubble typing assistant-live-step">
                  {status === '思考中…' ? (
                    <><span className="dot" /><span className="dot" /><span className="dot" /></>
                  ) : (
                    <div className="assistant-live-content">
                      <strong>{status}</strong>
                      {liveText && <p className="assistant-live-stream-text">{liveText}</p>}
                      {liveActivities.length > 0 && <div className="assistant-live-activities">
                        {liveActivities.map((item) => <details key={item.id} className={`assistant-live-activity is-${item.state}`}>
                          <summary>
                            <i>{item.state === 'error' ? '!' : '…'}</i>
                            <span>{item.label}</span>
                            <small>{item.state === 'error' ? '换方法处理中' : '进行中'}</small>
                          </summary>
                          <div className="assistant-live-detail">
                            <span>本步输入</span>
                            <pre>{item.args || '这一步没有额外参数。'}</pre>
                          </div>
                        </details>)}
                      </div>}
                      {liveExecutionSteps.length > 0 && <ThoughtChainView steps={liveExecutionSteps} />}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* 输入区 */}
          <div className={`chat-composer ${fileDrop.dragActive ? 'is-file-dragging' : ''}`} {...fileDrop.dropProps}>
            {fileDrop.dragActive && <div className="chat-file-drop-overlay"><strong>松开添加文件</strong><span>文件将真实写入本次聊天工作区</span></div>}
            {retryJob && <div className={`dm-retry-panel ${retryJob.status}`}>
              <ReloadOutlined spin={retryJob.status === 'waiting'} />
              <div className="dm-retry-copy">
                <strong>{retryJob.status === 'waiting' ? '模型调用失败，等待自动重试' : '自动重试已停止'}</strong>
                <small>
                  {retryJob.status === 'waiting'
                    ? `第 ${retryJob.attempt} 次失败，${Math.max(0, Math.ceil(((retryJob.nextRetryAt ?? retryNow) - retryNow) / 1000))} 秒后重试（最多 ${retrySettings.maxAttempts} 次）`
                    : `已尝试 ${retryJob.attempt}/${retrySettings.maxAttempts} 次：${retryJob.lastError}`}
                </small>
              </div>
              {retryJob.status === 'failed' && <button className="btn btn-sm btn-primary" onClick={restartDmJob}><ReloadOutlined />重新执行</button>}
              <button className="icon-btn" title="取消重试" onClick={() => { setRetryJob(null); saveRetryJob(empId, null); }}><CloseOutlined /></button>
            </div>}
            {showRetrySettings && <div className="dm-retry-settings">
              <label><input type="checkbox" checked={retrySettings.autoRetry} onChange={(event) => updateRetrySettings({ autoRetry: event.target.checked })} /> 自动重试</label>
              <label>间隔 <input type="number" min={3} max={60} value={retrySettings.intervalSeconds} onChange={(event) => updateRetrySettings({ intervalSeconds: Math.max(3, Math.min(60, Number(event.target.value) || 10)) })} /> 秒</label>
              <label>机会 <input type="number" min={1} max={10} value={retrySettings.maxAttempts} onChange={(event) => updateRetrySettings({ maxAttempts: Math.max(1, Math.min(10, Number(event.target.value) || 5)) })} /> 次</label>
            </div>}
            <div className="chat-composer-toolbar dm-composer-toolbar">
              <button className="btn btn-sm chat-new-session-btn" onClick={handleStartNewChat} title={typing ? '安全停止当前任务并新建聊天' : '新建独立聊天'}><PlusOutlined /><span>{pendingNewChat ? '正在新建…' : '新建聊天'}</span></button>
              {chatSessions.length > 0 && <select className="assistant-chat-history-select" value="" onChange={(event) => handleRestoreChat(event.target.value)} disabled={typing || pendingNewChat} aria-label="历史对话"><option value="">历史对话</option>{chatSessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}</select>}
              <button className="btn btn-sm composer-icon-btn" onClick={handleCopyAll} disabled={msgs.length === 0} title="复制全部对话" aria-label="复制全部对话"><CopyOutlined /></button>
              <button className="btn btn-sm composer-icon-btn" onClick={handleExport} disabled={msgs.length === 0} title="导出对话" aria-label="导出对话"><ExportOutlined /></button>
              <button className="btn btn-sm composer-icon-btn" onClick={() => fileInputRef.current?.click()} title="上传文件或图片" aria-label="上传文件或图片"><PaperClipOutlined /></button>
              <SkillPickerButton selected={skillRefs} onSelectedChange={setSkillRefs} disabled={!!retryJob} />
              <ExecutionPolicyControl />
              <button className={`btn btn-sm composer-icon-btn ${showRetrySettings ? 'btn-primary' : ''}`} onClick={() => setShowRetrySettings((value) => !value)} title="模型重试设置" aria-label="模型重试设置"><SettingOutlined /></button>
              <div className="chat-composer-toolbar-spacer" />
              <ModelSelector scene="dm" employeeId={empId} modelConfig={getEmployeeModel(emp)} messages={msgs} />
            </div>
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
            <ImageGenerationOptions scene="dm" modelConfig={getEmployeeModel(emp)} />
            <SkillMentionInput value={text} onChange={setText} selected={skillRefs} onSelectedChange={setSkillRefs} onKeyDown={onKeyDown} onPaste={handlePaste} rows={2} disabled={!!retryJob} placeholder={typing ? `正在处理，可继续引导 ${emp.name}…` : `发消息给 ${emp.name}...（输入 @ 选择技能）`} />
            <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-end' }} onClick={handleSend} disabled={!!retryJob || (!text.trim() && attachments.length === 0)}>
              {typing ? (loadSettings().followUpMode === 'queue' ? '排队' : '引导') : '发送'}
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

        {/* 右侧产出物面板 */}
        {showOutputs && (
          <><div className="workspace-resize-handle" onPointerDown={resizeOutputs} title="拖动调整产出物面板宽度" /><div className="chat-outputs-wrap" style={{ width: outputsWidth, minWidth: outputsWidth }}>
            <ChatOutputsPanel scope={`dm:${empId}`} maxHeight={500} selectedFilename={selectedOutputFilename} onBack={() => { setShowOutputs(false); setSelectedOutputFilename(null); }} />
          </div>
          </>
        )}
      </div>
    </div>);
}
