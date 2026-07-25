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
import type { SkillReference } from '../../types';
import type { OutputRecord } from '../../data/outputs';
import { fileToAttachment, attachmentsFromClipboard, attachmentWorkspaceContext, formatFileSize, persistAttachments } from '../../utils/attachments';
import { useFileDrop } from '../../hooks/useFileDrop';
import AssistantSettingsModal, { getAssistantPrompt } from '../settings/AssistantSettingsModal';
import { useStore } from '../../store';
import {
  CopyOutlined,
  DeleteOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  PaperClipOutlined,
  RobotOutlined,
  SettingOutlined,
} from '@ant-design/icons';

const LS_KEY = 'hermes_office_assistant_chat';

// 构建 API 上下文时排除的中间消息前缀（工具调用状态、错误提示等非实质对话）
const NON_DIALOG_PREFIXES = ['🔧 调用工具', '⚠️ 出错了'];

function isDialogMessage(m: ChatMessage): boolean {
  return !NON_DIALOG_PREFIXES.some((p) => m.content.startsWith(p));
}

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return (JSON.parse(raw) as ChatMessage[]).filter(isDialogMessage);
  } catch {}
  return [];
}
function saveHistory(msgs: ChatMessage[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(msgs.slice(-300)));
  } catch {}
}

export default function AssistantChat() {
  const { createProjectDraft } = useStore();
  const [msgs, setMsgs] = useState<ChatMessage[]>(() => loadHistory());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [activityStep, setActivityStep] = useState(0);
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

  const handleSend = async () => {
    const content = text.trim();
    if (!content && attachments.length === 0) return;
    const atts = attachments;
    const refs = skillRefs;
    const skillContext = await resolveSkillContext(refs);
    setSkillRefs([]);
    setText('');    setAttachments([]);

    // 文本类附件：拼进消息文本
    let enriched = content;
    const textAtts = atts.filter((a) => a.kind === 'text' && a.dataUrl);
    if (textAtts.length > 0) {
      enriched += '\n\n' + textAtts.map((a) => `【附件 ${a.name}】\n${a.dataUrl!.slice(0, 6000)}`).join('\n\n');
    }
    enriched += attachmentWorkspaceContext(atts);
    const imageAtts = atts.filter((a) => a.kind === 'image');

    const display = [content, ...atts.map((a) => `[📎 ${a.name}]`)].filter(Boolean).join('\n');
    push({
      id: `h-${Date.now()}-me`, authorId: 'me', roleId: 'human',
      content: display, mentions: [], timestamp: Date.now(), kind: 'text', skillRefs: refs,
      attachments: atts,
    });

    if (busy) {
      const mode = loadSettings().followUpMode ?? 'steer';
      steeringMessagesRef.current.push(mode === 'steer'
        ? enriched
        : `【排队跟进】先完成当前工作，再按顺序处理：${enriched}`);
      setStatus(mode === 'steer' ? '已收到新指令，等待当前模型返回后调整…' : '新消息已排队…');
      return;
    }

    setBusy(true);
    setStatus('思考中…');
    setActivityStep(1);

    // 无当前助理 API 时本地回复（支持助理独立模型配置）
    const assistantSettings = resolveChatSettings();
    if (!resolveApiBase(assistantSettings)) {
      push({
        id: `h-${Date.now()}-ai`, authorId: 'assistant', roleId: 'custom',
        content: '我是驴狗蛋助手。当前未配置 AI 接口，请在设置中填入模型服务地址和 API Key 后重试。',
        mentions: [], timestamp: Date.now(), kind: 'text',
      });
      setBusy(false);
      setStatus('');
      setActivityStep(0);
      return;
    }

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
      const showCoT = settings.showThoughtChain !== false; // 默认开启
      const cotSteps: ThoughtChainStep[] = [];

      const r = await runAgentLoop({
        turns: [
          { role: 'system', content: getAssistantPrompt() },
          ...history,
          { role: 'user', content: enriched },
        ],
        tools: allTools,
        scene: 'assistant',
        label: '驴狗蛋助手',
        scope: 'assistant',
        attachments: imageAtts,
        extraSystemContext: skillContext,
        consumeSteeringMessages: () => steeringMessagesRef.current.splice(0),
        onToolCall(name, args) {
          setActivityStep(2);
          const argsStr = args ? (args.length > 100 ? args.slice(0, 100) + '…' : args) : '';
          setStatus(`🔧 调用 ${name}${argsStr ? `(${argsStr})` : ''}`);
        },
        onToolResult(name, args, result) {
          if (showCoT) {
            cotSteps.push({
              toolName: name,
              args: args ?? '',
              result: result.slice(0, 2000),  // 限制单步结果
              success: !result.startsWith('工具执行错误') && !result.startsWith('未知工具'),
              timestamp: Date.now(),
            });
          }
        },
      });

      const ts = Date.now();
      setActivityStep(3);
      setStatus('整理回复…');
      push({
        id: `h-${ts}-ai`, authorId: 'assistant', roleId: 'custom',
        content: r.content, mentions: [], timestamp: ts, kind: 'text',
        tokens: r.usage.totalTokens,
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
        content: `⚠️ 出错了：${e?.message ?? '未知错误'}`,
        mentions: [], timestamp: Date.now(), kind: 'text',
      });
    }
    setBusy(false);
    setStatus('');
    setActivityStep(0);
  };

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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
                <strong>{status || '思考中…'}</strong>
                <span>驴狗蛋助手正在处理当前对话</span>
              </div>
              <span className="assistant-activity-step">{Math.max(1, activityStep)}/3</span>
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
              <div className="msg">
                <div className="msg-meta">
                  <span className="msg-author" style={{ color: 'var(--apple-accent)' }}><RobotOutlined /> 驴狗蛋助手</span>
                </div>
                <div className="msg-bubble typing">
                  {status === '思考中…' ? (
                    <><span className="dot" /><span className="dot" /><span className="dot" /></>
                  ) : (
                    <span style={{ fontSize: 12 }}>{status}</span>
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
              <div style={{ flex: 1 }} />
              <button className="btn btn-sm assistant-settings-btn composer-icon-btn" onClick={() => setShowAssistantSettings(true)} title="助理设置" aria-label="打开助理设置"><SettingOutlined /></button>
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
              <ModelSelector />
              <div style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={handleCopyAll} disabled={msgs.length === 0} title="复制全部对话">
                <CopyOutlined /> 复制全部
              </button>
              <button className="btn btn-sm" onClick={handleExport} disabled={msgs.length === 0} title="下载 Markdown 对话记录">
                <ExportOutlined /> 导出
              </button>
              <button
                className="btn btn-sm"
                onClick={() => { if (confirm('清空所有对话？')) { setMsgs([]); localStorage.removeItem(LS_KEY); } }}
              >
                <DeleteOutlined /> 清空
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSend} disabled={!text.trim() && attachments.length === 0}>
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
