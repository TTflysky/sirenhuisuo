import { useState, useRef, useEffect } from 'react';
import { CloseOutlined, PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined, SettingOutlined, StopOutlined } from '@ant-design/icons';
import type { ChatMessage, ThoughtChainStep } from '../../types';
import { useStore } from '../../store';
import { loadDm, appendDm, runAgentLoop, resolveApiBase, extractUserInsights, getEmployeeModel, loadSettings, type ChatTurn, type Attachment, type ContextUsage } from '../../data/hermesClient';
import AgentAvatar from '../office/AgentAvatar';
import ChatOutputsPanel from '../outputs/ChatOutputsPanel';
import ChatMessageText from './ChatMessageText';
import ThoughtChainView from './ThoughtChainView';
import { copyToClipboard, downloadTextFile, messagesToMarkdown } from '../../utils/clipboard';
import ModelSelector from './ModelSelector';
import SkillMentionInput, { resolveSkillContext } from '../skills/SkillMentionInput';
import SkillPickerButton from '../skills/SkillPickerButton';
import ExecutionPolicyControl from './ExecutionPolicyControl';
import type { SkillReference } from '../../types';
import type { OutputRecord } from '../../data/outputs';
import {
  fileToAttachment, attachmentsFromClipboard, attachmentWorkspaceContext, formatFileSize, persistAttachments,
  copyAttachmentsToWorkspace, createTaskWorkspaceId, initializeTaskWorkspace,
} from '../../utils/attachments';
import { TOOLS } from '../../engine/tools';
import { getConnectorTools } from '../../engine/connectorTools';
import { useFileDrop } from '../../hooks/useFileDrop';
import { formatExecutionDuration, useAgentExecutionControl } from '../../hooks/useAgentExecutionControl';
import { getDirectExecutionControl, isExplicitPauseSteering, isExplicitResumeSteering, shouldHoldTaskForFeedback } from '../../engine/agentGuardrails.mjs';
import {
  BEGINNER_RESPONSE_GUIDE,
  getToolActivity,
  getToolReport,
  isToolResultSuccessful,
} from '../../data/assistantPresentation';

interface Props {
  empId: string;
}

interface DmRetrySettings { autoRetry: boolean; intervalSeconds: number; maxAttempts: number }
interface DmRetryJob {
  id: string;
  workspaceId: string;
  userText: string;
  attachments: Attachment[];
  skillContext: string;
  history: ChatTurn[];
  attempt: number;
  status: 'waiting' | 'failed';
  nextRetryAt?: number;
  lastError: string;
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
    const job = { ...parsed, workspaceId: parsed.workspaceId ?? createTaskWorkspaceId('dm', empId) } as DmRetryJob;
    return job.status === 'waiting' && !job.nextRetryAt ? { ...job, status: 'failed' } : job;
  } catch { return null; }
}
function saveRetryJob(empId: string, job: DmRetryJob | null) {
  try { if (job) localStorage.setItem(retryJobKey(empId), JSON.stringify(job)); else localStorage.removeItem(retryJobKey(empId)); } catch {}
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
  const [msgs, setMsgs] = useState<ChatMessage[]>(() => loadDm(empId));
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [status, setStatus] = useState('');
  const [completedActionCount, setCompletedActionCount] = useState(0);
  const [liveActivities, setLiveActivities] = useState<Array<{ id: string; matchKey: string; label: string; args: string; state: 'active' | 'error' }>>([]);
  const [liveExecutionSteps, setLiveExecutionSteps] = useState<ThoughtChainStep[]>([]);
  const [showOutputs, setShowOutputs] = useState(false);
  const [selectedOutputFilename, setSelectedOutputFilename] = useState<string | null>(null);
  const [outputsWidth, setOutputsWidth] = useState(320);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [skillRefs, setSkillRefs] = useState<SkillReference[]>([]);
  const [retrySettings, setRetrySettings] = useState<DmRetrySettings>(() => loadRetrySettings());
  const [showRetrySettings, setShowRetrySettings] = useState(false);
  const [retryJob, setRetryJob] = useState<DmRetryJob | null>(() => loadRetryJob(empId));
  const [retryNow, setRetryNow] = useState(Date.now());
  const runJobRef = useRef<(job: DmRetryJob) => Promise<void>>(async () => {});
  const steeringMessagesRef = useRef<string[]>([]);
  const activeWorkspaceIdRef = useRef<string | undefined>(undefined);
  const queuedFollowUpsRef = useRef<Array<{ userText: string; attachments: Attachment[]; skillContext: string }>>([]);
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

  const push = (m: ChatMessage) => {
    msgsRef.current = [...msgsRef.current, m];
    setMsgs(msgsRef.current);
    appendDm(empId, [m]);
  };

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
    const refs = skillRefs;
    const skillContext = await resolveSkillContext(refs);
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
      skillRefs: refs,
    });

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
        queuedFollowUpsRef.current.push({ userText: content, attachments: atts, skillContext });
        push({
          id: `dm-${Date.now()}-${empId}-ack`, authorId: empId, roleId: emp.role,
          content: '收到。这条要求已经排到当前任务之后，不会混进正在执行的步骤。',
          mentions: [], timestamp: Date.now(), kind: 'text',
        });
        setStatus('当前任务继续执行，新要求已排队…');
      }
      return;
    }

    const history: ChatTurn[] = msgs.slice(-8).map((m) => ({ role: m.roleId === 'human' ? 'user' : 'assistant', content: m.content }));
    void runDmJob({ id: `dm-retry-${Date.now()}`, workspaceId: createTaskWorkspaceId('dm', empId), userText: content, attachments: atts, skillContext, history, attempt: 0, status: 'waiting', lastError: '' });

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
    try {
      await initializeTaskWorkspace(job.workspaceId, { kind: 'dm', label: `${emp.name} / ${job.userText.slice(0, 50) || '私聊任务'}`, taskId: job.id });
      await copyAttachmentsToWorkspace(`dm:${empId}`, job.workspaceId, job.attachments);
      const { text: reply, usage, contextUsage, thoughtChain } = await generateReply(job.userText, job.attachments, job.skillContext, job.history, job.workspaceId);
      setStatus('正在整理清晰的结果…');
      push({ id: `dm-${Date.now()}-${empId}`, authorId: empId, roleId: emp.role, content: reply, mentions: [], timestamp: Date.now(), kind: 'text', tokens: usage, contextUsage, thoughtChain });
      setRetryJob(null);
      saveRetryJob(empId, null);
    } catch (error) {
      const attempt = job.attempt + 1;
      const lastError = error instanceof Error ? error.message : String(error);
      const canRetry = retrySettings.autoRetry && attempt < retrySettings.maxAttempts;
      const next: DmRetryJob = {
        ...job, attempt, lastError,
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
      dispatch({ type: 'UPDATE_EMPLOYEE', id: empId, partial: { isWorking: false, currentTask: undefined } });
      const queued = queuedFollowUpsRef.current.shift();
      if (queued) {
        const history = msgsRef.current.slice(-8).map((m): ChatTurn => ({ role: m.roleId === 'human' ? 'user' : 'assistant', content: m.content }));
        window.setTimeout(() => void runDmJob({
          id: `dm-queued-${Date.now()}`,
          workspaceId: createTaskWorkspaceId('dm', empId),
          userText: queued.userText,
          attachments: queued.attachments,
          skillContext: queued.skillContext,
          history,
          attempt: 0,
          status: 'waiting',
          lastError: '',
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
  const generateReply = async (userText: string, atts: Attachment[] = [], skillContext = '', historyOverride?: ChatTurn[], workspaceId?: string): Promise<{ text: string; usage?: number; contextUsage?: ContextUsage; thoughtChain?: ThoughtChainStep[] }> => {
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

    if (!resolveApiBase(getEmployeeModel(emp))) {
      // 未配置 API：本地剧本 + 短延迟模拟
      await new Promise((r) => setTimeout(r, 700 + Math.random() * 900));
      await executionControl.waitIfPaused();
      if (executionControl.shouldStop()) return { text: '还没有完成，任务已经停止。停止前的内容会保留。' };
      const t = emp.prompt
        ? `（按人设：${emp.prompt.slice(0, 30)}${emp.prompt.length > 30 ? '…' : ''}）${craftReply(emp.role, enriched)}`
        : craftReply(emp.role, enriched);
      return { text: t };
    }
    const personaPrompt = emp.prompt?.trim() || `你是「${emp.name}」，一名${emp.title}。用简洁、专业的中文回复，语气贴合你的角色。需要产出文件时直接调用工具完成。`;
    const systemPrompt = `${personaPrompt}\n\n${BEGINNER_RESPONSE_GUIDE}`;
    const history = historyOverride ?? msgs.slice(-8).map((m): ChatTurn => ({ role: m.roleId === 'human' ? 'user' : 'assistant', content: m.content }));
    const thoughtChain: ThoughtChainStep[] = [];
    const showThoughtChain = loadSettings().showThoughtChain !== false;
    const r = await runAgentLoop({
      turns: [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: enriched }],
      tools: [...TOOLS, ...getConnectorTools()], scene: 'dm', label: emp.name, modelConfig: getEmployeeModel(emp),
      extraSystemContext: [emp.soul, skillContext].filter(Boolean).join('\n\n'), scope: `dm:${empId}`, attachments: imageAtts,
      workspaceId,
      shouldStop: executionControl.shouldStop,
      waitIfPaused: executionControl.waitIfPaused,
      consumeSteeringMessages: () => steeringMessagesRef.current.splice(0),
      getModelRequestSignal: executionControl.getModelRequestSignal,
      onSteeringReply(content, usage, contextUsage) {
        push({
          id: `dm-${Date.now()}-${empId}-steering`, authorId: empId, roleId: emp.role,
          content, mentions: [], timestamp: Date.now(), kind: 'text',
          tokens: usage.totalTokens || undefined, contextUsage,
        });
        setStatus('已结合新要求重新判断…');
      },
      onToolCall(name, args) {
        setStatus(getToolActivity(name, args));
        const matchKey = `${name}:${args}`;
        const report = getToolReport(name, args);
        setLiveActivities([{ id: `${Date.now()}`, matchKey, label: report, args: args ?? '', state: 'active' }]);
        dispatch({ type: 'UPDATE_EMPLOYEE', id: empId, partial: { isWorking: true, currentTask: report } });
      },
      onToolResult(name, args, result, success) {
        const matchKey = `${name}:${args}`;
        const resultSuccess = isToolResultSuccessful(result, success);
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
    return { text: r.content ?? '（无回复）', usage: r.usage.totalTokens, contextUsage: r.contextUsage, thoughtChain: thoughtChain.length ? thoughtChain : undefined };
  };

  const openOutputFromMessage = (output: OutputRecord) => {
    setSelectedOutputFilename(output.filename);
    setShowOutputs(true);
  };

  const handleCopyMsg = async (content: string) => { await copyToClipboard(content); };
  const handleCopyAll = async () => {
    await copyToClipboard(msgs.map((m) => `[${m.roleId === 'human' ? '你' : emp.name}] ${m.content}`).join('\n\n'));
  };
  const handleExport = () => {
    const md = messagesToMarkdown(msgs.map((m) => ({
      role: m.roleId === 'human' ? '你' : emp.name,
      author: m.roleId === 'human' ? '你' : emp.name,
      content: m.content,
      time: new Date(m.timestamp).toLocaleString('zh-CN'),
    })), `与 ${emp.name} 私聊记录`);
    downloadTextFile(`私聊-${emp.name}-${new Date().toISOString().slice(0, 10)}.md`, md);
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
            <div style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
              <button className="btn btn-sm" onClick={handleCopyAll} disabled={msgs.length === 0}>📋 复制全部</button>
              <button className="btn btn-sm" onClick={handleExport} disabled={msgs.length === 0}>📤 导出</button>
              <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()} title="上传文件/图片">📎</button>
              <SkillPickerButton selected={skillRefs} onSelectedChange={setSkillRefs} disabled={!!retryJob} />
              <ExecutionPolicyControl />
              <button className={`btn btn-sm ${showRetrySettings ? 'btn-primary' : ''}`} onClick={() => setShowRetrySettings((value) => !value)} title="模型重试设置"><SettingOutlined />重试</button>
              <div style={{ flex: 1 }} />
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
