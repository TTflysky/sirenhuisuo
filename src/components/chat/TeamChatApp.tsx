import { useState, useRef, useEffect, useMemo } from 'react';
import type { Team, Employee } from '../../types';
import { useStore } from '../../store';
import { loadSettings, type Attachment } from '../../data/hermesClient';
import AgentAvatar from '../office/AgentAvatar';
import { addOutput } from '../../data/outputs';
import ChatOutputsPanel from '../outputs/ChatOutputsPanel';
import { copyToClipboard, messagesToMarkdown } from '../../utils/clipboard';
import ModelSelector from './ModelSelector';
import { linkify } from '../../utils/linkify';
import { fileToAttachment, attachmentsFromClipboard, formatFileSize } from '../../utils/attachments';

interface Props {
  teamId: string;
}

export default function TeamChatApp({ teamId }: Props) {
  const {
    state, sendMessage,
    publishTask, claimTask, advanceTask, triggerDiscussion,
  } = useStore();
  const team = state.teams.find((t: Team) => t.id === teamId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [text, setText] = useState('');
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [showOutputs, setShowOutputs] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // @ 弹窗状态
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIdx, setMentionIdx] = useState(0);

  const progress = state.status.progress;
  const myProgress = progress && progress.teamId === teamId ? progress : null;

  const teamMembers = (team?.memberIds ?? [])
    .map((id) => state.employees.find((e) => e.id === id))
    .filter((e): e is Employee => !!e);

  const mentionCandidates = useMemo(() => {
    if (!mentionQuery) return teamMembers;
    const q = mentionQuery.toLowerCase();
    return teamMembers.filter(
      (e) => e.name.toLowerCase().includes(q) || e.title.toLowerCase().includes(q)
    );
  }, [mentionQuery, teamMembers]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [team?.chatMessages.length, myProgress?.step]);

  if (!team) return <div style={{ padding: 20 }}>团队不存在</div>;

  const handleSend = () => {
    if (!text.trim() && attachments.length === 0) return;
    const content = text.trim();
    // 解析 @ 提及：找出消息里 @name 形式
    const mentions: string[] = [];
    const parts = content.split(/(@\S+)/g);
    for (const p of parts) {
      if (p.startsWith('@')) {
        const name = p.slice(1);
        const found = state.employees.find((e) => e.name === name);
        if (found) mentions.push(found.id);
      }
    }
    // 文本类附件：拼进消息文本
    let enriched = content;
    const textAtts = attachments.filter((a) => a.kind === 'text' && a.dataUrl);
    if (textAtts.length > 0) {
      enriched += '\n\n' + textAtts.map((a) => `【附件 ${a.name}】\n${a.dataUrl!.slice(0, 6000)}`).join('\n\n');
    }
    // 文件类附件：保存为产出物
    const fileAtts = attachments.filter((a) => a.kind === 'file');
    for (const f of fileAtts) {
      addOutput({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(),
        filename: f.name,
        kind: 'file',
        title: `附件：${f.name}`,
        scope: `team:${teamId}`,
        contentType: 'text',
        content: `已上传附件 ${f.name}（${formatFileSize(f.size)}）`,
      } as any);
    }
    const imageAtts = attachments.filter((a) => a.kind === 'image');
    // 展示：文本 + 附件名；图片也存到消息上用于展示
    const display = [enriched, ...attachments.map((a) => `[📎 ${a.name}]`)].filter(Boolean).join('\n');
    sendMessage(teamId, 'emp-me', 'human', display, mentions, attachments);
    setText('');
    setAttachments([]);
    if (loadSettings().autoDiscuss) {
      setTimeout(() => triggerDiscussion(teamId, { userText: enriched, attachments: imageAtts }), 400);
    }
  };

  const insertMention = (emp: Employee) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cur = text;
    // 找到最后一个 @ 的位置
    const atIdx = cur.lastIndexOf('@');
    let next: string;
    if (atIdx >= 0 && cur.slice(atIdx).indexOf(' ') === -1) {
      // 还没输入空格，@query 部分替换
      next = cur.slice(0, atIdx) + `@${emp.name} `;
    } else {
      next = cur + `@${emp.name} `;
    }
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

  const handleCopyMsg = async (content: string) => { await copyToClipboard(content); };
  const handleCopyAll = async () => {
    await copyToClipboard((team.chatMessages ?? []).map((m: any) => {
      const a = state.employees.find((e) => e.id === m.authorId);
      return `[${a?.name ?? m.roleId}] ${m.content}`;
    }).join('\n\n'));
  };
  const handleExport = () => {
    const msgs = team.chatMessages ?? [];
    const md = messagesToMarkdown(msgs.map((m: any) => {
      const a = state.employees.find((e) => e.id === m.authorId);
      return { role: a?.title ?? m.roleId, author: a?.name ?? m.roleId, content: m.content, time: new Date(m.timestamp).toLocaleString('zh-CN') };
    }), `${team.name} 讨论记录`);
    addOutput({ id: `exp-${Date.now()}`, ts: Date.now(), filename: `${team.name}-对话-${new Date().toISOString().slice(0, 10)}.md`, kind: 'export', title: `${team.name} 对话导出`, scope: `team:${teamId}`, contentType: 'markdown', content: md } as any);
  };

  // 解析消息中的 @ 提及和链接渲染
  const renderContent = (content: string) => {
    const parts = content.split(/(@\S+)/g);
    const result: React.ReactNode[] = [];
    let key = 0;
    for (const part of parts) {
      if (part.startsWith('@')) {
        const mentionName = part.slice(1);
        const mentionedEmp = state.employees.find(
          (e) => e.name === mentionName || e.title === mentionName
        );
        result.push(
          <span key={key++} className="msg-mention" style={{ color: mentionedEmp?.statusColor ?? 'var(--color-planner)' }}>
            {part}
          </span>
        );
      } else {
        result.push(...linkify(part).map((n, i) => <span key={`${key}-${i}`}>{n}</span>));
      }
    }
    return result;
  };

  return (
    <div className="chat-panel">
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          {/* 实时进度条（讨论中） */}
          {myProgress && (
            <div className="chat-progress">
              <div className="chat-progress-left">
                <div className="progress-spinner" />
                <div>
                  <div className="chat-progress-title">
                    {myProgress.currentEmpName ? `${myProgress.currentEmpName} 正在思考…` : '准备中…'}
                  </div>
                  <div className="chat-progress-sub">
                    正在调用 <strong>{myProgress.model ?? '模型'}</strong> · 团队 {myProgress.teamName}
                    · 预计 {Math.ceil(myProgress.estimatedMs / 1000)}s
                  </div>
                </div>
              </div>
              <div className="chat-progress-right">
                <div className="chat-progress-step">{myProgress.step}/{myProgress.totalSteps}</div>
                <div className="progress-bar" style={{ width: 100 }}>
                  <div className="progress-bar-fill" style={{ width: `${(myProgress.step / myProgress.totalSteps) * 100}%` }} />
                </div>
              </div>
            </div>
          )}

          {/* 消息流 */}
          <div className="chat-messages">
            {(team.chatMessages ?? []).length === 0 ? (
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
            ) : (team.chatMessages ?? []).map((msg) => {
              const author = state.employees.find((e: Employee) => e.id === msg.authorId);
              const isHuman = msg.roleId === 'human';

              return (
                <div key={msg.id} className={`msg ${isHuman ? 'human' : ''}`}>
                  {!isHuman && (
                    <div className="msg-meta">
                      <span className="msg-author" style={{ color: author?.statusColor ?? 'var(--text-secondary)' }}>
                        {author?.name ?? msg.authorId}
                      </span>
                      <span className="msg-time">{new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                  {msg.kind === 'task' ? (
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
                  ) : (
                    <div className="msg-row">
                      <div className="msg-bubble">{renderContent(msg.content)}</div>
                      <button className="msg-copy-btn" onClick={() => handleCopyMsg(msg.content)} title="复制">📋</button>
                    </div>
                  )}
                  {msg.tokens != null && (
                    <div className="msg-tokens">≈ {msg.tokens.toLocaleString()} tokens</div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* 工具栏 */}
          <div className="chat-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '6px 14px' }}>
            <button className="btn btn-sm" onClick={handleCopyAll} title="复制全部对话">📋</button>
            <button className="btn btn-sm" onClick={handleExport} title="导出为 markdown">📤</button>
            <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()} title="上传文件/图片">📎</button>
            <button
              className="btn btn-sm"
              onClick={() => triggerDiscussion(teamId)}
              disabled={state.status.demoRunning}
              title="让团队 AI 成员就当前讨论话题展开协作"
            >
              💬 发起讨论
            </button>
            <button className="btn btn-sm" onClick={() => setShowTaskForm(!showTaskForm)}>
              📋 发布任务
            </button>
            <button
              className={`btn btn-sm ${showOutputs ? 'btn-primary' : ''}`}
              onClick={() => setShowOutputs(!showOutputs)}
              title="产出物"
            >
              📁{showOutputs ? ' ✕' : ''}
            </button>
            <div style={{ flex: 1 }} />
            <ModelSelector />
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {state.status.backendOnline ? '🟢 模型在线' : '🔵 本地模式'}
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
          <div className="chat-composer" style={{ position: 'relative' }}>
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
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={2}
              placeholder="输入消息... 输入 @ 弹员工选择（可直接粘贴图片/文件）"
            />
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
            <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-end', marginTop: 4 }} onClick={handleSend}>
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
            <ChatOutputsPanel scope={`team:${teamId}`} maxHeight={500} />
          </div>
        )}
      </div>
    </div>
  );
}
