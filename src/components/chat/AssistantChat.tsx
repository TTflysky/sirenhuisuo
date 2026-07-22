import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage } from '../../types';
import { runAgentLoop, resolveApiBase, extractUserInsights, type ChatTurn, type Attachment } from '../../data/hermesClient';
import { TOOLS } from '../../engine/tools';
import { addOutput } from '../../data/outputs';
import ChatOutputsPanel from '../outputs/ChatOutputsPanel';
import { copyToClipboard, messagesToMarkdown } from '../../utils/clipboard';
import ModelSelector from './ModelSelector';
import { linkify } from '../../utils/linkify';
import { fileToAttachment, attachmentsFromClipboard, formatFileSize } from '../../utils/attachments';

const LS_KEY = 'hermes_office_assistant_chat';

// 构建 API 上下文时排除的中间消息前缀（工具调用状态、错误提示等非实质对话）
const NON_DIALOG_PREFIXES = ['🔧 调用工具', '⚠️ 出错了'];

function isDialogMessage(m: ChatMessage): boolean {
  return !NON_DIALOG_PREFIXES.some((p) => m.content.startsWith(p));
}

const SYSTEM_PROMPT = `你是 Hermes 助手——一个全能 AI 助手，驻扎在私人办公会所应用中。
你可以做任何事情：回答日常问题、写代码、查资料、创建文件、搜索互联网、执行命令（桌面版）。

你的工具：
- write_file(文件名, 内容) —— 把文件真正写入工作区（代码/文档都落盘，可运行）
- read_file(文件名) —— 读取工作区文件
- list_files(过滤词) —— 列出工作区目录
- web_search(查询) —— 搜索互联网
- run_command(命令) —— 在工作区内执行终端命令（仅 Electron 桌面版可用）

当用户需要产出实际文件时，直接调 write_file，然后把文件路径和摘要告诉用户。
当用户问需要最新信息的事，调 web_search。
回复简洁、专业、友好，用中文。`;

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
  const [msgs, setMsgs] = useState<ChatMessage[]>(() => loadHistory());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [showOutputs, setShowOutputs] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const addFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const atts = await Promise.all(arr.map(fileToAttachment));
    setAttachments((prev) => [...prev, ...atts]);
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const atts = await attachmentsFromClipboard(e);
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

  const handleSend = async () => {
    const content = text.trim();
    if ((!content && attachments.length === 0) || busy) return;
    const atts = attachments;
    setText('');
    setAttachments([]);
    setBusy(true);
    setStatus('思考中…');

    // 文本类附件：拼进消息文本
    let enriched = content;
    const textAtts = atts.filter((a) => a.kind === 'text' && a.dataUrl);
    if (textAtts.length > 0) {
      enriched += '\n\n' + textAtts.map((a) => `【附件 ${a.name}】\n${a.dataUrl!.slice(0, 6000)}`).join('\n\n');
    }
    // 文件类附件：保存为产出物
    const fileAtts = atts.filter((a) => a.kind === 'file');
    for (const f of fileAtts) {
      addOutput({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(),
        filename: f.name,
        kind: 'file',
        title: `附件：${f.name}`,
        scope: 'assistant',
        contentType: 'text',
        content: `已上传附件 ${f.name}（${formatFileSize(f.size)}）`,
      } as any);
    }
    const imageAtts = atts.filter((a) => a.kind === 'image');

    const display = [content, ...atts.map((a) => `[📎 ${a.name}]`)].filter(Boolean).join('\n');
    push({
      id: `h-${Date.now()}-me`, authorId: 'me', roleId: 'human',
      content: display, mentions: [], timestamp: Date.now(), kind: 'text',
      attachments: atts,
    });

    // 无 API 时本地回复
    if (!resolveApiBase()) {
      push({
        id: `h-${Date.now()}-ai`, authorId: 'assistant', roleId: 'custom',
        content: '我是 Hermes 助手。当前未配置 AI 接口，请在 ⚙️ 设置中填入模型服务地址和 API Key 后重试。',
        mentions: [], timestamp: Date.now(), kind: 'text',
      });
      setBusy(false);
      setStatus('');
      return;
    }

    try {
      // 构建上下文（最近 20 条实质对话，过滤掉工具调用中间消息）
      const dialogMsgs = msgs.filter(isDialogMessage);
      const history: ChatTurn[] = dialogMsgs.slice(-20).map((m) => ({
        role: (m.roleId === 'human' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.roleId === 'human' ? m.content : `助手: ${m.content}`,
      }));

      const r = await runAgentLoop({
        turns: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history,
          { role: 'user', content: enriched },
        ],
        tools: TOOLS,
        scene: 'assistant',
        label: 'Hermes助手',
        scope: 'assistant',
        attachments: imageAtts,
        onToolCall(name, args) {
          const argsStr = args ? (args.length > 100 ? args.slice(0, 100) + '…' : args) : '';
          setStatus(`🔧 调用 ${name}${argsStr ? `(${argsStr})` : ''}`);
        },
      });

      push({
        id: `h-${Date.now()}-ai`, authorId: 'assistant', roleId: 'custom',
        content: r.content, mentions: [], timestamp: Date.now(), kind: 'text',
        tokens: r.usage.totalTokens,
      });

      // 自动提炼用户洞察（每 2 次对话触发）
      const userMsgCount = msgs.filter(m => m.roleId === 'human' && isDialogMessage(m)).length;
      if (userMsgCount > 0 && userMsgCount % 2 === 0 && resolveApiBase()) {
        const chatText = msgs.slice(-6).map(m => {
          const who = m.roleId === 'human' ? '用户' : '助手';
          return `${who}: ${m.content.slice(0, 200)}`;
        }).join('\n');
        extractUserInsights(chatText, 'Hermes助手对话').catch(() => {});
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
  };

  const handleCopyMsg = async (content: string) => {
    await copyToClipboard(content);
  };

  const handleCopyAll = async () => {
    const text = msgs.map((m) => {
      const head = m.roleId === 'human' ? '你' : '🤖 Hermes 助手';
      return `[${head}] ${m.content}`;
    }).join('\n\n');
    await copyToClipboard(text);
  };

  const handleExport = () => {
    const md = messagesToMarkdown(
      msgs.map((m) => ({
        role: m.roleId === 'human' ? '你' : 'Hermes 助手',
        content: m.content,
        time: new Date(m.timestamp).toLocaleString('zh-CN'),
      })),
      'Hermes 助手对话记录'
    );
    addOutput({
      id: `exp-${Date.now()}`,
      ts: Date.now(),
      filename: `Hermes助手-对话-${new Date().toISOString().slice(0, 10)}.md`,
      kind: 'export',
      title: `Hermes 助手对话导出`,
      scope: 'assistant' as any,
      contentType: 'markdown',
      content: md,
    } as any);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-panel">
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          {/* 消息流 */}
          <div className="chat-messages">
            {msgs.length === 0 && (
              <div className="assistant-welcome">
                <div className="assistant-welcome-icon">🤖</div>
                <h3>Hermes 助手</h3>
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
                        🤖 Hermes 助手
                      </span>
                      <span className="msg-time">
                        {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                  <div className="msg-row">
                    <div className="msg-bubble">{linkify(msg.content)}</div>
                    <button className="msg-copy-btn" onClick={() => handleCopyMsg(msg.content)} title="复制">
                      📋
                    </button>
                  </div>
                  {msg.tokens != null && (
                    <div className="msg-tokens">≈ {msg.tokens.toLocaleString()} tokens</div>
                  )}
                </div>
              );
            })}
            {busy && status && (
              <div className="msg">
                <div className="msg-meta">
                  <span className="msg-author" style={{ color: '#3b82f6' }}>🤖 Hermes 助手</span>
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
          <div className="chat-composer">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <button
                className={`btn btn-sm ${showOutputs ? 'btn-primary' : ''}`}
                onClick={() => setShowOutputs(!showOutputs)}
                title="产出物"
              >
                📁{showOutputs ? ' ✕' : ''}
              </button>
              <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()} title="上传文件/图片">📎</button>
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
                    <span className="attach-size">{formatFileSize(a.size)}</span>
                    <button className="attach-del" onClick={() => removeAttachment(i)} title="移除">✕</button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              className="chat-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              onPaste={handlePaste}
              rows={2}
              disabled={busy}
              placeholder={busy ? '助手正在思考…' : '输入任何问题或需求…（可直接粘贴图片/文件）'}
            />
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 }}>
              <ModelSelector />
              <div style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={handleCopyAll} disabled={msgs.length === 0} title="复制全部对话">
                📋 复制全部
              </button>
              <button className="btn btn-sm" onClick={handleExport} disabled={msgs.length === 0} title="导出为 markdown 到产出物">
                📤 导出
              </button>
              <button
                className="btn btn-sm"
                onClick={() => { if (confirm('清空所有对话？')) { setMsgs([]); localStorage.removeItem(LS_KEY); } }}
              >
                🗑 清空
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSend} disabled={busy || (!text.trim() && attachments.length === 0)}>
                发送
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
            <ChatOutputsPanel scope="assistant" maxHeight={500} />
          </div>
        )}
      </div>
    </div>
  );
}
