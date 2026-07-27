import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage, ThoughtChainStep } from '../../types';
import { runAgentLoop, resolveApiBase, resolveChatSettings, extractUserInsights, loadSettings, type ChatTurn, type Attachment } from '../../data/hermesClient';
import { TOOLS } from '../../engine/tools';
import { getConnectorTools } from '../../engine/connectorTools';
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
import { useFileDrop } from '../../hooks/useFileDrop';
import { formatExecutionDuration, useAgentExecutionControl } from '../../hooks/useAgentExecutionControl';
import AssistantSettingsModal, { getAssistantPrompt } from '../settings/AssistantSettingsModal';
import { useStore } from '../../store';
import { BUS_CHANNELS, onBus, sendBus } from '../../ipcBus';
import { getDirectExecutionControl, isExplicitPauseSteering, isExplicitResumeSteering, shouldHoldTaskForFeedback } from '../../engine/agentGuardrails.mjs';
import { executionControllerStatus } from '../../engine/executionController.mjs';
import {
  BEGINNER_RESPONSE_GUIDE,
  getToolActivity,
  getToolReport,
  getToolStage,
  humanizeExecutionError,
  isToolResultSuccessful,
  simplifyLegacyAssistantContent,
} from '../../data/assistantPresentation';
import {
  CopyOutlined,
  DeleteOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  PaperClipOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  SettingOutlined,
  StopOutlined,
} from '@ant-design/icons';

const LS_KEY = 'hermes_office_assistant_chat';
const LS_PENDING_REQUEST = 'hermes_office_assistant_pending_request';

interface PendingAssistantRequest {
  id: string;
  prompt: string;
  display?: string;
  createdAt: number;
  alreadyDisplayed?: boolean;
}

// 构建 API 上下文时排除的中间消息前缀（工具调用状态、错误提示等非实质对话）
const NON_DIALOG_PREFIXES = ['🔧 调用工具', '⚠️ 出错了'];

function isDialogMessage(m: ChatMessage): boolean {
  return !NON_DIALOG_PREFIXES.some((p) => m.content.startsWith(p));
}

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return (JSON.parse(raw) as ChatMessage[]).filter(isDialogMessage).map((message) => (
      message.roleId === 'human' ? message : { ...message, content: simplifyLegacyAssistantContent(message.content) }
    ));
  } catch {}
  return [];
}
function saveHistory(msgs: ChatMessage[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(msgs.slice(-300)));
  } catch {}
}

export default function AssistantChat() {
  const { state, createProjectDraft } = useStore();
  const [msgs, setMsgs] = useState<ChatMessage[]>(() => loadHistory());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [completedActionCount, setCompletedActionCount] = useState(0);
  const [pendingRequest, setPendingRequest] = useState<PendingAssistantRequest | null>(null);
  const [liveActivities, setLiveActivities] = useState<Array<{ id: string; matchKey: string; label: string; args: string; state: 'active' | 'error' }>>([]);
  const [liveExecutionSteps, setLiveExecutionSteps] = useState<ThoughtChainStep[]>([]);
  const [showOutputs, setShowOutputs] = useState(false);
  const [selectedOutputFilename, setSelectedOutputFilename] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [skillRefs, setSkillRefs] = useState<SkillReference[]>([]);
  const [showAssistantSettings, setShowAssistantSettings] = useState(false);
  const [, refreshSettings] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const steeringMessagesRef = useRef<string[]>([]);
  const activeWorkspaceIdRef = useRef<string | undefined>(undefined);
  const queuedFollowUpsRef = useRef<Array<{ prompt: string; display: string }>>([]);
  const previousExecutionStateRef = useRef<'running' | 'paused' | 'stopping'>('running');
  const executionControl = useAgentExecutionControl(busy);
  const pauseExecution = executionControl.pause;
  const resumeExecution = executionControl.resume;
  const stopExecution = executionControl.stop;

  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const atts = await persistAttachments('assistant', await Promise.all(arr.map(fileToAttachment)));
    setAttachments((prev) => [...prev, ...atts]);
  };
  const fileDrop = useFileDrop(addFiles, false);

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const atts = await persistAttachments('assistant', await attachmentsFromClipboard(e));
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
  }, [msgs.length, status]);

  const push = useCallback((m: ChatMessage) => {
    setMsgs((prev) => {
      const next = [...prev, m];
      saveHistory(next);
      return next;
    });
  }, []);

  const openOutputFromMessage = (output: OutputRecord) => {
    setSelectedOutputFilename(output.filename);
    setShowOutputs(true);
  };

  const handleSend = async (contentOverride?: string, displayOverride?: string, alreadyDisplayed = false) => {
    const externalRequest = typeof contentOverride === 'string';
    const content = (contentOverride ?? text).trim();
    const atts = externalRequest ? [] : attachments;
    if (!content && atts.length === 0) return;
    const refs = externalRequest ? [] : skillRefs;
    const skillContext = await resolveSkillContext(refs);
    if (!externalRequest) {
      setSkillRefs([]);
      setText('');
      setAttachments([]);
    }

    // 文本类附件：拼进消息文本
    let enriched = content;
    const textAtts = atts.filter((a) => a.kind === 'text' && a.dataUrl);
    if (textAtts.length > 0) {
      enriched += '\n\n' + textAtts.map((a) => `【附件 ${a.name}】\n${a.dataUrl!.slice(0, 6000)}`).join('\n\n');
    }
    enriched += attachmentWorkspaceContext(atts);
    const imageAtts = atts.filter((a) => a.kind === 'image');

    const display = displayOverride ?? [content, ...atts.map((a) => `[📎 ${a.name}]`)].filter(Boolean).join('\n');
    if (!alreadyDisplayed) {
      push({
        id: `h-${Date.now()}-me`, authorId: 'me', roleId: 'human',
        content: display, mentions: [], timestamp: Date.now(), kind: 'text', skillRefs: refs,
        attachments: atts,
      });
    }

    if (busy) {
      const controlIntent = getDirectExecutionControl(enriched);
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
      const mode = loadSettings().followUpMode ?? 'steer';
      if (activeWorkspaceIdRef.current && atts.length) {
        try {
          await copyAttachmentsToWorkspace('assistant', activeWorkspaceIdRef.current, atts);
        } catch (error) {
          push({
            id: `h-${Date.now()}-attachment-error`, authorId: 'assistant', roleId: 'custom',
            content: `这次附件还没有交给当前任务：${error instanceof Error ? error.message : String(error)}。原任务保持当前状态。`,
            mentions: [], timestamp: Date.now(), kind: 'text',
          });
          return;
        }
      }
      if (mode === 'steer') {
        const holdForFeedback = shouldHoldTaskForFeedback(enriched);
        if (isExplicitPauseSteering([enriched]) || holdForFeedback) executionControl.pause();
        if (isExplicitResumeSteering([enriched])) executionControl.resume();
        steeringMessagesRef.current.push(enriched);
        executionControl.interruptForSteering();
        setStatus(holdForFeedback ? '已挂起原任务，正在回答你的反馈…' : '正在优先处理你刚刚说的话…');
      } else {
        queuedFollowUpsRef.current.push({ prompt: enriched, display });
        push({
          id: `h-${Date.now()}-ack`, authorId: 'assistant', roleId: 'custom',
          content: '收到。这条要求已经排到当前任务之后，不会混进正在执行的步骤。', mentions: [], timestamp: Date.now(), kind: 'text',
        });
        setStatus('当前任务继续执行，新要求已排队…');
      }
      return;
    }

    setBusy(true);
    setStatus('思考中…');
    setCompletedActionCount(0);
    setLiveActivities([]);
    setLiveExecutionSteps([]);
    executionControl.reset();

    const workspaceId = createTaskWorkspaceId('assistant');
    activeWorkspaceIdRef.current = workspaceId;
    try {
      await initializeTaskWorkspace(workspaceId, { kind: 'assistant', label: content.slice(0, 60) || '助理任务', taskId: workspaceId.split('/').pop() });
      await copyAttachmentsToWorkspace('assistant', workspaceId, atts);
    } catch (error) {
      push({
        id: `h-${Date.now()}-workspace-error`, authorId: 'assistant', roleId: 'custom',
        content: `还不能开始。本次独立工作区没有准备好：${error instanceof Error ? error.message : String(error)}。请到“设置 → 诊断中心”检查工作区。`,
        mentions: [], timestamp: Date.now(), kind: 'text',
      });
      activeWorkspaceIdRef.current = undefined;
      setBusy(false);
      setStatus('');
      return;
    }

    // 无当前助理 API 时本地回复（支持助理独立模型配置）
    const assistantSettings = resolveChatSettings();
    if (!resolveApiBase(assistantSettings)) {
      push({
        id: `h-${Date.now()}-ai`, authorId: 'assistant', roleId: 'custom',
        content: '还不能开始。你还没有设置可用的 AI 模型。请打开“设置 → 模型”，添加并启用一个模型后再试。',
        mentions: [], timestamp: Date.now(), kind: 'text',
      });
      setBusy(false);
      setStatus('');
      if (activeWorkspaceIdRef.current === workspaceId) activeWorkspaceIdRef.current = undefined;
      const queued = queuedFollowUpsRef.current.shift();
      if (queued) setPendingRequest({ id: `queued-${Date.now()}`, prompt: queued.prompt, display: queued.display, createdAt: Date.now(), alreadyDisplayed: true });
      return;
    }

    let lastStage = '连接 AI 模型';
    let showCoT = false;
    const cotSteps: ThoughtChainStep[] = [];
    try {
      // 构建上下文（最近 20 条实质对话，过滤掉工具调用中间消息）
      const dialogMsgs = msgs.filter(isDialogMessage);
      const history: ChatTurn[] = dialogMsgs.slice(-20).map((m) => ({
        role: (m.roleId === 'human' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.roleId === 'human' ? m.content : `助手: ${m.content}`,
      }));

      // 合并内置工具和连接器工具
      const connectorTools = getConnectorTools();
      const allTools = [...TOOLS, ...connectorTools];

      // 思维链采集
      const settings = loadSettings();
      showCoT = settings.showThoughtChain !== false; // 默认开启
      const employeeDirectory = state.employees.length > 0
        ? state.employees.map((employee) => {
          const teams = state.teams.filter((team) => team.memberIds.includes(employee.id)).map((team) => team.name);
          return `- ${employee.name}｜${employee.title}｜${employee.isOnline ? '在线' : '离线'}｜${teams.length ? `团队：${teams.join('、')}` : '暂未加入团队'}｜员工ID：${employee.id}`;
        }).join('\n')
        : '- 当前还没有员工';
      const organizationContext = `## 当前办公室实时员工目录
${employeeDirectory}

以上名单来自客户端当前状态，每次对话都会重新读取。用户提到某位员工时，先按姓名核对这里的真实名单；名单中存在就不得回答“没有这名员工”。需要调度多人任务时，先明确将由哪些现有员工承担。`;

      const r = await runAgentLoop({
        turns: [
          { role: 'system', content: `${getAssistantPrompt()}\n\n${BEGINNER_RESPONSE_GUIDE}` },
          ...history,
          { role: 'user', content: enriched },
        ],
        tools: allTools,
        scene: 'assistant',
        label: '驴狗蛋助手',
        scope: 'assistant',
        workspaceId,
        attachments: imageAtts,
        extraSystemContext: [organizationContext, skillContext].filter(Boolean).join('\n\n'),
        shouldStop: executionControl.shouldStop,
        waitIfPaused: executionControl.waitIfPaused,
        consumeSteeringMessages: () => steeringMessagesRef.current.splice(0),
        getModelRequestSignal: executionControl.getModelRequestSignal,
        onExecutionState(state) {
          setStatus(executionControllerStatus(state));
        },
        onSteeringReply(content, usage, contextUsage) {
          push({
            id: `h-${Date.now()}-steering`, authorId: 'assistant', roleId: 'custom',
            content: simplifyLegacyAssistantContent(content), mentions: [], timestamp: Date.now(), kind: 'text',
            tokens: usage.totalTokens || undefined, contextUsage,
          });
          setStatus('已结合新要求重新判断…');
        },
        onToolCall(name, args) {
          lastStage = getToolStage(name);
          setStatus(getToolActivity(name, args));
          const matchKey = `${name}:${args}`;
          setLiveActivities([{ id: `${Date.now()}`, matchKey, label: getToolReport(name, args), args: args ?? '', state: 'active' }]);
        },
        onToolResult(name, args, result, success) {
          const matchKey = `${name}:${args}`;
          const resultSuccess = isToolResultSuccessful(result, success);
          if (name === 'web_search' && resultSuccess) {
            lastStage = '整理搜索结果';
            setStatus('正在阅读并整理搜索结果…');
          }
          setCompletedActionCount((count) => count + 1);
          setLiveActivities((current) => {
            let index = -1;
            for (let cursor = current.length - 1; cursor >= 0; cursor -= 1) {
              if (current[cursor].matchKey === matchKey && current[cursor].state === 'active') { index = cursor; break; }
            }
            if (index < 0) return current;
            if (resultSuccess) return current.filter((_, itemIndex) => itemIndex !== index);
            return current.map((item, itemIndex) => itemIndex === index
              ? { ...item, state: 'error' }
              : item);
          });
          if (showCoT) {
            const step: ThoughtChainStep = {
              toolName: name,
              args: args ?? '',
              result: result.slice(0, name === 'web_search' ? 12000 : 2000),
              success: resultSuccess,
              timestamp: Date.now(),
            };
            cotSteps.push(step);
            setLiveExecutionSteps((current) => [...current, step].slice(-50));
          }
        },
        onModelRetry(attempt, maxAttempts, error, nextDelayMs) {
          lastStage = '整理搜索结果';
          setStatus(nextDelayMs > 0
            ? `整理结果暂时失败，${Math.round(nextDelayMs / 1000)} 秒后进行第 ${attempt + 1}/${maxAttempts} 次尝试…`
            : '整理模型暂时不可用，正在直接生成可读结果…');
          if (!showCoT) return;
          const step: ThoughtChainStep = {
            toolName: 'model_summary', args: '', result: error.slice(0, 2000), success: false, timestamp: Date.now(),
          };
          cotSteps.push(step);
          setLiveExecutionSteps((current) => [...current, step].slice(-50));
        },
      });

      const ts = Date.now();
      setStatus('正在整理清楚的结果…');
      push({
        id: `h-${ts}-ai`, authorId: 'assistant', roleId: 'custom',
        content: simplifyLegacyAssistantContent(r.content), mentions: [], timestamp: ts, kind: 'text',
        tokens: r.usage.totalTokens,
        contextUsage: r.contextUsage,
        thoughtChain: showCoT && cotSteps.length > 0 ? cotSteps : undefined,
      });

      // Explicit project-management requests create an approval-gated draft.
      // The assistant may advise freely, but it cannot silently start people or spend model tokens.
      if (/(?:安排|组建|拉|启动).{0,8}(?:团队|群|项目)|(?:项目|任务).{0,8}(?:组队|拉群|调度)/u.test(content)) {
        createProjectDraft({ title: content.slice(0, 40), request: content });
        push({
          id: `h-${Date.now()}-project`, authorId: 'assistant', roleId: 'custom',
          content: '我已根据你的需求生成待批准项目草案。请到“自主办公”查看成员选择、执行步骤和预期产出；批准后才会创建项目团队并开始调度。',
          mentions: [], timestamp: Date.now(), kind: 'text',
        });
      }

      // 自动提炼用户洞察（每 2 次对话触发）
      const userMsgCount = msgs.filter(m => m.roleId === 'human' && isDialogMessage(m)).length;
      if (userMsgCount > 0 && userMsgCount % 2 === 0 && resolveApiBase(assistantSettings)) {
        const chatText = msgs.slice(-6).map(m => {
          const who = m.roleId === 'human' ? '用户' : '助手';
          return `${who}: ${m.content.slice(0, 200)}`;
        }).join('\n');
        extractUserInsights(chatText, '驴狗蛋助手对话').catch(() => {});
      }
    } catch (e: any) {
      push({
        id: `h-${Date.now()}-err`, authorId: 'assistant', roleId: 'custom',
        content: `还没有处理好。卡在“${lastStage}”这一步。${humanizeExecutionError(e?.message ?? '')}`,
        mentions: [], timestamp: Date.now(), kind: 'text',
        thoughtChain: showCoT && cotSteps.length > 0 ? cotSteps : undefined,
      });
    }
    setBusy(false);
    if (activeWorkspaceIdRef.current === workspaceId) activeWorkspaceIdRef.current = undefined;
    setStatus('');
    const queued = queuedFollowUpsRef.current.shift();
    if (queued) setPendingRequest({ id: `queued-${Date.now()}`, prompt: queued.prompt, display: queued.display, createdAt: Date.now(), alreadyDisplayed: true });
  };

  useEffect(() => {
    const acceptRequest = (payload: unknown) => {
      const request = payload as Partial<PendingAssistantRequest>;
      if (!request || typeof request.id !== 'string' || typeof request.prompt !== 'string' || !request.prompt.trim()) return;
      setPendingRequest({ id: request.id, prompt: request.prompt, display: request.display, createdAt: Number(request.createdAt) || Date.now() });
    };
    const unsubscribe = onBus(BUS_CHANNELS.ASSISTANT_RUN_REQUEST, acceptRequest);
    try {
      const raw = localStorage.getItem(LS_PENDING_REQUEST);
      if (raw) acceptRequest(JSON.parse(raw));
    } catch {}
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (busy || !pendingRequest) return;
    if (Date.now() - pendingRequest.createdAt > 10 * 60 * 1000) {
      setPendingRequest(null);
      localStorage.removeItem(LS_PENDING_REQUEST);
      return;
    }
    const request = pendingRequest;
    setPendingRequest(null);
    localStorage.removeItem(LS_PENDING_REQUEST);
    void handleSend(request.prompt, request.display, request.alreadyDisplayed);
    // handleSend intentionally consumes the latest component state when the request becomes runnable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, pendingRequest]);

  useEffect(() => {
    const previous = previousExecutionStateRef.current;
    const current = executionControl.executionState;
    previousExecutionStateRef.current = current;
    if (!busy || previous === current) return;
    if (current === 'paused') {
      push({
        id: `h-${Date.now()}-paused`, authorId: 'assistant', roleId: 'custom',
        content: '任务已暂停，原来的步骤不会自行恢复。你仍可以继续发消息，我会先结合当前进度回答；只有点击“继续”或明确让我继续，原任务才会恢复。',
        mentions: [], timestamp: Date.now(), kind: 'text',
      });
    } else if (current === 'running' && previous === 'paused') {
      push({
        id: `h-${Date.now()}-resumed`, authorId: 'assistant', roleId: 'custom',
        content: '任务已继续，我会从暂停时保留的进度接着处理。', mentions: [], timestamp: Date.now(), kind: 'text',
      });
    }
  }, [busy, executionControl.executionState, push]);

  useEffect(() => {
    const activity = {
      state: busy ? executionControl.executionState : 'idle',
      status: busy
        ? executionControl.executionState === 'paused' ? '已暂停' : executionControl.executionState === 'stopping' ? '正在停止…' : status || '思考中…'
        : '',
      completedActions: completedActionCount,
      elapsedSeconds: executionControl.elapsedSeconds,
      updatedAt: Date.now(),
    };
    try { localStorage.setItem('hermes_office_assistant_activity', JSON.stringify(activity)); } catch {}
    sendBus(BUS_CHANNELS.ASSISTANT_ACTIVITY_CHANGED, activity);
  }, [busy, completedActionCount, executionControl.elapsedSeconds, executionControl.executionState, status]);

  useEffect(() => onBus(BUS_CHANNELS.ASSISTANT_EXECUTION_COMMAND, (payload) => {
    if (!busy || !payload || typeof payload !== 'object') return;
    const command = (payload as { command?: unknown }).command;
    if (command === 'pause') pauseExecution();
    if (command === 'resume') resumeExecution();
    if (command === 'stop') stopExecution();
  }), [busy, pauseExecution, resumeExecution, stopExecution]);

  const handleCopyMsg = async (content: string) => {
    await copyToClipboard(content);
  };

  const handleCopyAll = async () => {
    const text = msgs.map((m) => {
      const head = m.roleId === 'human' ? '你' : '驴狗蛋助手';
      return `[${head}] ${m.content}`;
    }).join('\n\n');
    await copyToClipboard(text);
  };

  const handleExport = () => {
    const md = messagesToMarkdown(
      msgs.map((m) => ({
        role: m.roleId === 'human' ? '你' : '驴狗蛋助手',
        content: m.content,
        time: new Date(m.timestamp).toLocaleString('zh-CN'),
      })),
      '驴狗蛋助手对话记录'
    );
    downloadTextFile(`驴狗蛋助手-对话-${new Date().toISOString().slice(0, 10)}.md`, md);
  };

  const handleClearHistory = () => {
    if (!confirm('清空所有对话？')) return;
    setMsgs([]);
    localStorage.removeItem(LS_KEY);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-layout">
        <div className="chat-main">
          {busy && (
            <div className="assistant-activity" role="status" aria-live="polite">
              <div className="assistant-activity-glow" />
              <span className="assistant-activity-icon"><RobotOutlined /></span>
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
          {/* 消息流 */}
          <div className="chat-messages">
            {msgs.length === 0 && (
              <div className="assistant-welcome">
                <div className="assistant-welcome-icon"><RobotOutlined /></div>
                <h3>驴狗蛋助手</h3>
                <p>全能 AI 助手，可查资料、写代码、创建文件、搜索互联网、执行命令。</p>
                <div className="assistant-welcome-tips">
                  <span>试试：</span>
                  <button className="btn btn-sm" onClick={() => { setText('帮我搜索最新的 React 19 新特性'); textareaRef.current?.focus(); }}>搜索最新技术</button>
                  <button className="btn btn-sm" onClick={() => { setText('给我做一个待办事项网页，要支持增删改'); textareaRef.current?.focus(); }}>做一个网页</button>
                  <button className="btn btn-sm" onClick={() => { setText('帮我安装一个skill：邮件自动回复'); textareaRef.current?.focus(); }}>安装 skill</button>
                </div>
              </div>
            )}
            {msgs.map((msg) => {
              const isMe = msg.roleId === 'human';
              return (
                <div key={msg.id} className={`msg ${isMe ? 'human' : ''}`}>
                  {!isMe && (
                    <div className="msg-meta">
                      <span className="msg-author" style={{ color: '#3b82f6' }}>
                        <RobotOutlined /> 驴狗蛋助手
                      </span>
                      <span className="msg-time">
                        {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                  <div className="msg-row">
                    <div className="msg-bubble"><ChatMessageText content={msg.content} scope="assistant" onOpenOutput={openOutputFromMessage} /></div>
                    <button className="msg-copy-btn" onClick={() => handleCopyMsg(msg.content)} title="复制">
                      <CopyOutlined />
                    </button>
                  </div>
                  {/* 思维链展示 */}
                  {msg.thoughtChain && msg.thoughtChain.length > 0 && (
                    <ThoughtChainView steps={msg.thoughtChain} />
                  )}
                  {msg.tokens != null && (
                    <div className="msg-tokens">≈ {msg.tokens.toLocaleString()} tokens</div>
                  )}
                </div>
              );
            })}
            {busy && status && (
              <div className="msg assistant-live-report">
                <div className="msg-meta">
                  <span className="msg-author" style={{ color: 'var(--apple-accent)' }}><RobotOutlined /> 驴狗蛋助手</span>
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
                            <i>{item.state === 'error' ? '!' : '•'}</i>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <button
                className={`btn btn-sm ${showOutputs ? 'btn-primary' : ''}`}
                onClick={() => setShowOutputs(!showOutputs)}
                title="产出物"
              >
                <FolderOpenOutlined />
              </button>
              <button className="btn btn-sm composer-icon-btn" onClick={() => fileInputRef.current?.click()} title="上传文件或图片" aria-label="上传文件或图片"><PaperClipOutlined /></button>
              <SkillPickerButton selected={skillRefs} onSelectedChange={setSkillRefs} />
              <ExecutionPolicyControl />
              <div style={{ flex: 1 }} />
              <button className="btn btn-sm assistant-settings-btn composer-icon-btn" onClick={() => {
                if (!window.electronAPI?.openTool) { setShowAssistantSettings(true); return; }
                void window.electronAPI.openTool({ type: 'assistant-settings' }).then((result) => {
                  if (!result.ok) setShowAssistantSettings(true);
                });
              }} title="助理设置" aria-label="打开助理设置"><SettingOutlined /></button>
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
            <SkillMentionInput ref={textareaRef} value={text} onChange={setText} selected={skillRefs} onSelectedChange={setSkillRefs} onKeyDown={onKeyDown} onPaste={handlePaste} rows={2} placeholder={busy ? '助手正在处理，可继续输入以引导当前运行…' : '输入任何问题或需求…（输入 @ 选择技能）'} />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 }}>
              <ModelSelector messages={msgs} />
              <div style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={handleCopyAll} disabled={msgs.length === 0} title="复制全部对话">
                <CopyOutlined /> 复制全部
              </button>
              <button className="btn btn-sm" onClick={handleExport} disabled={msgs.length === 0} title="下载 Markdown 对话记录">
                <ExportOutlined /> 导出
              </button>
              <button className="btn btn-sm" onClick={handleClearHistory}>
                <DeleteOutlined /> 清空
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => void handleSend()} disabled={!text.trim() && attachments.length === 0}>
                {busy ? (loadSettings().followUpMode === 'queue' ? '排队' : '引导') : '发送'}
              </button>
            </div>
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
          <div className="chat-outputs-wrap">
            <ChatOutputsPanel scope="assistant" maxHeight={500} selectedFilename={selectedOutputFilename} onBack={() => { setShowOutputs(false); setSelectedOutputFilename(null); }} />
          </div>
        )}
      </div>

      {/* 助理设置模态框 */}
      {showAssistantSettings && (
        <AssistantSettingsModal
          onClose={() => setShowAssistantSettings(false)}
          onSaved={() => {
            refreshSettings((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
