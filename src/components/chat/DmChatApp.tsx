import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '../../types';
import { useStore } from '../../store';
import { loadDm, appendDm, chatCompletion, resolveApiBase, extractUserInsights, type ChatTurn, type Attachment } from '../../data/hermesClient';
import AgentAvatar from '../office/AgentAvatar';
import { addOutput } from '../../data/outputs';
import ChatOutputsPanel from '../outputs/ChatOutputsPanel';
import { copyToClipboard, messagesToMarkdown } from '../../utils/clipboard';
import ModelSelector from './ModelSelector';
import SkillMentionInput, { resolveSkillContext } from '../skills/SkillMentionInput';
import type { SkillReference } from '../../types';
import { linkify } from '../../utils/linkify';
import {
  fileToAttachment, attachmentsFromClipboard, formatFileSize,
} from '../../utils/attachments';

interface Props {
  empId: string;
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
  const { state } = useStore();
  const emp = state.employees.find((e) => e.id === empId);
  const [msgs, setMsgs] = useState<ChatMessage[]>(() => loadDm(empId));
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [showOutputs, setShowOutputs] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [skillRefs, setSkillRefs] = useState<SkillReference[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

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
  }, [msgs.length, typing]);

  if (!emp) return <div style={{ padding: 20 }}>员工不存在</div>;

  const push = (m: ChatMessage) => {
    setMsgs((prev) => [...prev, m]);
    appendDm(empId, [m]);
  };

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

    setTyping(true);
    const { text: reply, usage } = await generateReply(content, atts, skillContext);
    setTyping(false);
    push({
      id: `dm-${Date.now()}-${empId}`,
      authorId: empId,
      roleId: emp.role,
      content: reply,
      mentions: [],
      timestamp: Date.now(),
      kind: 'text',
      tokens: usage,
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

  // 优先真调 OpenAI 兼容模型（带员工提示词），失败/未配置则回落本地剧本
  const generateReply = async (userText: string, atts: Attachment[] = [], skillContext = ''): Promise<{ text: string; usage?: number }> => {
    // 文本类附件：直接拼进用户文本作为上下文
    let enriched = userText;
    const textAtts = atts.filter((a) => a.kind === 'text' && a.dataUrl);
    if (textAtts.length > 0) {
      enriched += '\n\n' + textAtts
        .map((a) => `【附件 ${a.name}】\n${a.dataUrl!.slice(0, 6000)}`)
        .join('\n\n');
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
        scope: `dm:${empId}`,
        contentType: 'text',
        content: `已上传附件 ${f.name}（${formatFileSize(f.size)}）`,
      } as any);
    }
    // 图片类附件：走多模态视觉
    const imageAtts = atts.filter((a) => a.kind === 'image');

    if (!resolveApiBase()) {
      // 未配置 API：本地剧本 + 短延迟模拟
      await new Promise((r) => setTimeout(r, 700 + Math.random() * 900));
      const t = emp.prompt
        ? `（按人设：${emp.prompt.slice(0, 30)}${emp.prompt.length > 30 ? '…' : ''}）${craftReply(emp.role, enriched)}`
        : craftReply(emp.role, enriched);
      return { text: t };
    }
    try {
      // 组装对话：员工提示词当 system，最近几条历史当上下文，最后是用户消息
      const systemPrompt =
        emp.prompt?.trim() ||
        `你是「${emp.name}」，一名${emp.title}。用简洁、专业的中文回复，语气贴合你的角色。`;
      const history: ChatTurn[] = msgs
        .slice(-8)
        .map((m): ChatTurn => ({
          role: m.roleId === 'human' ? 'user' : 'assistant',
          content: m.content,
        }));
      const turns: ChatTurn[] = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: enriched },
      ];
      const r = await chatCompletion(turns, 'dm', emp.name, undefined, emp.modelConfig, [emp.soul, skillContext].filter(Boolean).join('\n\n'), imageAtts);
      return { text: r.content ?? '（无回复）', usage: r.usage.totalTokens };
    } catch (e: any) {
      return { text: `⚠️ 模型调用失败（${e?.message ?? '未知错误'}），已切换本地回复：\n\n${craftReply(emp.role, enriched)}` };
    }
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
    addOutput({ id: `exp-${Date.now()}`, ts: Date.now(), filename: `私聊-${emp.name}-${new Date().toISOString().slice(0, 10)}.md`, kind: 'export', title: `与 ${emp.name} 私聊导出`, scope: `dm:${empId}`, contentType: 'markdown', content: md } as any);
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
            <span className={`dm-peer-status ${emp.isWorking ? 'busy' : 'online'}`}>
              {emp.isWorking ? '● 工作中' : '● 在线'}
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
                    <div className="msg-bubble">{linkify(msg.content)}</div>
                    <button className="msg-copy-btn" onClick={() => handleCopyMsg(msg.content)} title="复制">📋</button>
                  </div>
                  {msg.tokens != null && (
                    <div className="msg-tokens">≈ {msg.tokens.toLocaleString()} tokens</div>
                  )}
                </div>
              );
            })}
            {typing && (
              <div className="msg">
                <div className="msg-meta">
                  <span className="msg-author" style={{ color: emp.statusColor }}>{emp.name}</span>
                </div>
                <div className="msg-bubble typing">
                  <span className="dot" /><span className="dot" /><span className="dot" />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* 输入区 */}
          <div className="chat-composer">
            <div style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
              <button className="btn btn-sm" onClick={handleCopyAll} disabled={msgs.length === 0}>📋 复制全部</button>
              <button className="btn btn-sm" onClick={handleExport} disabled={msgs.length === 0}>📤 导出</button>
              <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()} title="上传文件/图片">📎</button>
              <div style={{ flex: 1 }} />
              <ModelSelector />
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
            <SkillMentionInput value={text} onChange={setText} selected={skillRefs} onSelectedChange={setSkillRefs} onKeyDown={onKeyDown} onPaste={handlePaste} rows={2} placeholder={`发消息给 ${emp.name}...（输入 @ 选择技能）`} />
            <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-end' }} onClick={handleSend}>
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

        {/* 右侧产出物面板 */}
        {showOutputs && (
          <div className="chat-outputs-wrap">
            <ChatOutputsPanel scope={`dm:${empId}`} maxHeight={500} />
          </div>
        )}
      </div>
    </div>);
}
