import { useState, useRef, useEffect, useMemo } from 'react';
import { ArrowLeftOutlined, HistoryOutlined, PauseCircleOutlined, PlayCircleOutlined, RobotOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import type { Team, Employee, TaskRun } from '../../types';
import { useStore } from '../../store';
import { type Attachment } from '../../data/hermesClient';
import AgentAvatar from '../office/AgentAvatar';
import { loadOutputsByScope, type OutputRecord } from '../../data/outputs';
import ChatOutputsPanel from '../outputs/ChatOutputsPanel';
import ChatMessageText from './ChatMessageText';
import RenameTeamModal from '../sidebar/RenameTeamModal';
import { copyToClipboard, downloadTextFile, messagesToMarkdown } from '../../utils/clipboard';
import ModelSelector from './ModelSelector';
import SkillMentionInput, { resolveSkillContext } from '../skills/SkillMentionInput';
import SkillPickerButton from '../skills/SkillPickerButton';
import ExecutionPolicyControl from './ExecutionPolicyControl';
import type { SkillReference } from '../../types';
import { fileToAttachment, attachmentsFromClipboard, formatFileSize, persistAttachments } from '../../utils/attachments';
import { useFileDrop } from '../../hooks/useFileDrop';
import { buildTaskReplay, searchTaskRunHistory } from '../../engine/taskHistory.mjs';

interface Props {
  teamId: string;
}

const supervisorMention: Employee = {
  id: 'assistant',
  name: '驴狗蛋助手',
  title: '监工调度',
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
    <span className="supervisor-avatar" style={{ width: size, height: size }} aria-label="驴狗蛋助手">
      <RobotOutlined style={{ fontSize: Math.round(size * 0.58) }} />
    </span>
  );
}

export default function TeamChatApp({ teamId }: Props) {
  const {
    state, sendMessage,
    publishTask, claimTask, advanceTask, triggerDiscussion, pauseTaskRun, resumeTaskRun, stopTaskRun, closeTaskRun, clearTeamExecution,
  } = useStore();
  const team = state.teams.find((t: Team) => t.id === teamId);
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
  const [taskHistoryQuery, setTaskHistoryQuery] = useState('');
  const [replayTaskId, setReplayTaskId] = useState<string | null>(null);
  const [expandedExecutionIds, setExpandedExecutionIds] = useState<Set<string>>(() => new Set());
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [skillRefs, setSkillRefs] = useState<SkillReference[]>([]);
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
  const taskRuns = state.taskRuns.filter((run) => run.teamId === teamId).reverse();
  const activeTaskRuns = taskRuns.filter((run) => run.status !== 'completed' && run.status !== 'stopped');
  const completedTaskRuns = taskRuns.filter((run) => run.status === 'completed' || run.status === 'stopped');
  const availableOutputs = loadOutputsByScope(`team:${teamId}`);
  const jumpMessages = (team?.chatMessages ?? []).filter((message) => message.kind !== 'execution').slice(-24);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(() => new Set());
  const [progressNow, setProgressNow] = useState(Date.now());
  const historyMatches = useMemo(() => taskHistoryQuery.trim()
    ? searchTaskRunHistory(state.taskRuns, taskHistoryQuery, { teams: state.teams, limit: 12 })
    : [], [taskHistoryQuery, state.taskRuns, state.teams]);
  const replayRun = replayTaskId ? state.taskRuns.find((run) => run.id === replayTaskId) : undefined;
  const taskReplay = useMemo(() => buildTaskReplay(replayRun), [replayRun]);
  const replayTimeline = useMemo(() => {
    if (!taskReplay) return [];
    return [
      ...taskReplay.events.map((event) => ({ id: event.id, ts: event.ts, type: event.type, detail: event.summary, source: '上下文', verified: event.verified })),
      ...taskReplay.runnerEvents.map((event) => ({ id: `runner-${event.id}`, ts: event.ts, type: event.type, detail: event.detail, source: 'Runner', verified: /succeeded|passed|completed/u.test(event.type) })),
    ].sort((a, b) => a.ts - b.ts);
  }, [taskReplay]);

  const teamMembers = (team?.memberIds ?? [])
    .map((id) => state.employees.find((e) => e.id === id))
    .filter((e): e is Employee => !!e);

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
  }, [team?.chatMessages.length, myProgress?.step]);

  useEffect(() => {
    if (!myProgress) return;
    const timer = window.setInterval(() => setProgressNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [myProgress]);

  if (!team) return <div style={{ padding: 20 }}>团队不存在</div>;

  const handleSend = async () => {
    if (!text.trim() && attachments.length === 0) return;
    const content = text.trim();
    const refs = skillRefs;
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
    sendMessage(teamId, 'emp-me', 'human', display, mentions, attachments, refs);
    setText('');
    setAttachments([]);
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

  const renderTaskRunCard = (run: TaskRun) => {
    const expanded = expandedRunIds.has(run.id);
    const completed = run.steps.filter((step) => step.status === 'completed').length;
    const active = run.status === 'running' || run.status === 'queued';
    const connectorEvidence = (run.evidence ?? []).filter((item) => item.connectorProtocol).slice(-6);
    const artifactEvidence = (run.evidence ?? []).filter((item) => item.artifact).slice(-10);
    const planEvents = (run.runner?.events ?? []).filter((event) => ['plan_extended', 'review_passed', 'review_rejected'].includes(event.type)).slice(-8);
    return <section key={run.id} className={`task-run-tray task-run-${run.status}`}>
      <div className="task-run-summary-row">
        <button type="button" className="task-run-summary" onClick={() => setExpandedRunIds((previous) => {
          const next = new Set(previous); if (next.has(run.id)) next.delete(run.id); else next.add(run.id); return next;
        })} onContextMenu={(event) => {
          event.preventDefault(); setExpandedRunIds((previous) => { const next = new Set(previous); if (next.has(run.id)) next.delete(run.id); else next.add(run.id); return next; });
        }}>
          <span className="task-run-state">{run.status === 'running' ? '执行中' : run.status === 'queued' ? '排队中' : run.status === 'paused' ? '已暂停' : run.status === 'stopped' ? '已停止' : run.status === 'failed' ? '待恢复' : '已完成'}</span>
          <strong>{run.title}</strong><span>{completed}/{run.steps.length}</span><span className="task-run-toggle">{expanded ? '收起' : '详情'}</span>
        </button>
        <button type="button" className="task-run-close" title="关闭并从任务列表移除" onClick={() => closeTaskRun(run.id)}>×</button>
      </div>
      {run.sourceMessageId && <button type="button" className="task-run-jump" title="跳到原始需求" onClick={() => document.querySelector(`[data-message-id="${CSS.escape(run.sourceMessageId!)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>↗</button>}
      {expanded && <div className="task-run-details">
        <div className="task-run-goal"><strong>目标</strong><span>{run.goal ?? run.request}</span></div>
        {!!run.preflight?.length && <div className="task-run-preflight"><strong>前置检查</strong>{run.preflight.map((item) => <span key={item.label} className={`is-${item.status}`} title={item.detail}>{item.status === 'passed' ? '✓' : item.status === 'blocked' ? '!' : '·'} {item.label}</span>)}</div>}
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
        {!!run.verification?.length && <div className="task-run-verification"><strong>验收证据</strong>{run.verification.map((item) => <span key={item.kind} className={`is-${item.status}`} title={item.detail}>{item.status === 'passed' ? '✓' : '!'} {item.label}</span>)}</div>}
        {run.steps.map((step) => {
          const emp = state.employees.find((item) => item.id === step.employeeId);
          const model = run.memberSnapshot.find((item) => item.id === step.employeeId)?.model;
          return <div key={step.id} className="task-run-step"><div><span className="task-step-order">{step.order}</span><strong>{emp?.name ?? step.title}</strong><span className={`task-step-kind kind-${step.kind}`}>{step.kind === 'review' ? '审查' : step.kind === 'revision' ? '修订' : '执行'}</span><span className={`task-step-status status-${step.status}`}>{step.status}</span><small>{model || '默认模型'} · 尝试 {step.attempts} 次</small></div><p className="task-step-assignment">{step.assignment}</p>{step.revisionOfStepId && <p className="task-step-responsibility">↩ 修订责任步骤：{run.steps.find((item) => item.id === step.revisionOfStepId)?.title ?? step.revisionOfStepId}</p>}{step.reviewDecision && <p className={`task-review-decision ${step.reviewDecision}`}>{step.reviewDecision === 'pass' ? '审查通过' : `退回：${step.reviewReason ?? '需要修改'}`}</p>}{step.lastError && <p className="task-step-error">{step.lastError}</p>}{step.events.slice(-4).map((event, index) => <p key={`${event.ts}-${index}`} className="task-step-event">{new Date(event.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} {event.detail}</p>)}</div>;
        })}
        {run.handoff && <div className="task-run-handoff"><strong>当前交接</strong><p>{run.handoff.blocked}</p>{run.handoff.completed.length > 0 && <p>已完成：{run.handoff.completed.join('、')}</p>}<p>下一步：{run.handoff.nextAction}</p></div>}
        <div className="task-run-actions">
          <button className="btn btn-sm" onClick={() => setReplayTaskId(run.id)} title="只读回放任务"><HistoryOutlined />回放</button>
          {active && <button className="btn btn-sm" onClick={() => pauseTaskRun(run.id)}><PauseCircleOutlined />暂停</button>}
          {(run.status === 'paused' || run.status === 'failed') && <button className="btn btn-sm btn-primary" onClick={() => resumeTaskRun(run.id)}><PlayCircleOutlined />继续执行</button>}
          {(active || run.status === 'paused' || run.status === 'failed') && <button className="btn btn-sm btn-danger" onClick={() => stopTaskRun(run.id)}><StopOutlined />停止</button>}
        </div>
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
            <aside className="team-member-sidebar" aria-label="团队成员列表">
              <div className="team-member-sidebar-head">
                <span>{team.icon ?? '👥'}</span>
                <strong title={team.name}>{team.name}</strong>
                <button type="button" onClick={() => {
                  if (!window.electronAPI?.openTool) { setShowRenameTeam(true); return; }
                  void window.electronAPI.openTool({ type: 'rename-team', refId: team.id }).then((result) => {
                    if (!result.ok) setShowRenameTeam(true);
                  });
                }} title="重命名团队" aria-label="重命名团队">✎</button>
              </div>
              <button key={supervisorMention.id} className="team-member-item team-supervisor-item" onClick={() => insertMention(supervisorMention)} title={`@${supervisorMention.name}`}><SupervisorAvatar size={34} /><span className="team-member-info"><strong>{supervisorMention.name}</strong><small>{supervisorMention.title}</small><small className="is-working">随时可联系</small></span></button>
              {teamMembers.map((emp) => <button key={emp.id} className="team-member-item" onClick={() => insertMention(emp)} title={`@${emp.name}`}><span className="team-member-avatar"><AgentAvatar employee={emp} size={34} /><span className={`team-member-status ${!emp.isOnline ? 'offline' : emp.isWorking ? 'working' : 'idle'}`} /></span><span className="team-member-info"><strong>{emp.name}</strong><small style={{ color: emp.statusColor }}>{emp.title}</small><small className={emp.isWorking ? 'is-working' : ''}>{emp.isWorking ? '工作中' : emp.isOnline ? '在线' : '离线'}</small></span></button>)}
            </aside>
            <div className="team-chat-content">
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
                    · 已用 {Math.max(1, Math.floor((progressNow - myProgress.startedAt) / 1000))}s
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
            ) : (team.chatMessages ?? []).map((msg, messageIndex, allMessages) => {
              const author = state.employees.find((e: Employee) => e.id === msg.authorId)
                ?? (msg.authorId === supervisorMention.id ? supervisorMention : undefined);
              const isHuman = msg.roleId === 'human';
              const isExecution = msg.kind === 'execution';
              if (isExecution && allMessages[messageIndex + 1]?.kind === 'execution') return null;
              let executionStart = messageIndex;
              while (executionStart > 0 && allMessages[executionStart - 1]?.kind === 'execution') executionStart -= 1;
              const executionMessages = isExecution ? allMessages.slice(executionStart, messageIndex + 1) : [];
              const executionGroupId = executionMessages[0]?.id ?? msg.id;
              const isFailure = /^⚠️|无法响应|执行失败|已手动停止/u.test(msg.content);
              const toolName = isExecution ? msg.content.match(/`([^`]+)`/u)?.[1] : undefined;
              const toolSummary = toolName === 'search_skills' ? '正在检索技能库' : toolName === 'read_skill' ? '正在读取技能说明' : toolName ? `正在调用 ${toolName}` : '正在调用工具';

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
                  {isExecution ? (
                    <button
                      type="button"
                      className={`execution-event${expandedExecutionIds.has(executionGroupId) ? ' expanded' : ''}`}
                      onClick={() => setExpandedExecutionIds((previous) => {
                        const next = new Set(previous);
                        if (next.has(executionGroupId)) next.delete(executionGroupId); else next.add(executionGroupId);
                        return next;
                      })}
                      onContextMenu={(event) => {
                        event.preventDefault(); setExpandedExecutionIds((previous) => { const next = new Set(previous); if (next.has(executionGroupId)) next.delete(executionGroupId); else next.add(executionGroupId); return next; });
                      }}
                    >
                      <span className="execution-event-icon">...</span>
                      <span className="execution-event-summary">执行过程 · {executionMessages.length} 条 · {author?.name ?? '成员'} {toolSummary}</span>
                      <span className="execution-event-action">{expandedExecutionIds.has(executionGroupId) ? '收起' : '展开'}</span>
                      {expandedExecutionIds.has(executionGroupId) && <div className="execution-event-detail">{executionMessages.map((event) => <pre key={event.id}>{event.content}</pre>)}</div>}
                    </button>
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
                  ) : (
                    <div className="msg-row">
                      <div className="msg-bubble">{renderContent(msg.content)}</div>
                      <button className="msg-copy-btn" onClick={() => handleCopyMsg(msg.content)} title="复制">📋</button>
                    </div>
                  )}
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
            <button className="btn btn-sm" onClick={handleCopyAll} title="复制全部对话">📋</button>
            <button className="btn btn-sm" onClick={handleExport} title="导出为 markdown">📤</button>
            <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()} title="上传文件/图片">📎</button>
            <SkillPickerButton selected={skillRefs} onSelectedChange={setSkillRefs} />
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
            <ModelSelector scene="team" messages={team.chatMessages ?? []} />
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
            {showTaskList && <><div className="workspace-resize-handle" onPointerDown={startPanelResize} title="拖动调整任务面板宽度" /><aside className="team-task-sidebar" style={{ width: workspacePanelWidth, minWidth: workspacePanelWidth }} aria-label="任务列表">
              <div className="team-task-sidebar-head"><strong>{taskReplay ? '任务回放' : '快速导航'}</strong><span>{taskReplay ? '只读' : `${taskRuns.length} 个任务`}</span>{!taskReplay && <button type="button" className="team-task-clear" title="清理聊天中的旧执行过程" onClick={() => clearTeamExecution(teamId)}>清理过程</button>}<button type="button" className="task-run-close" title="收起任务列表" onClick={() => setShowTaskList(false)}>×</button></div>
              {!taskReplay && <label className="task-history-search"><SearchOutlined /><input value={taskHistoryQuery} onChange={(event) => setTaskHistoryQuery(event.target.value)} placeholder="历史任务检索" aria-label="历史任务检索" />{taskHistoryQuery && <button type="button" onClick={() => setTaskHistoryQuery('')} title="清空搜索">×</button>}</label>}
              <div className="team-task-sidebar-body">
                {taskReplay ? <div className="task-replay">
                  <button type="button" className="task-replay-back" onClick={() => setReplayTaskId(null)}><ArrowLeftOutlined />返回任务列表</button>
                  <div className="task-replay-heading"><span>{state.teams.find((item) => item.id === taskReplay.teamId)?.name ?? taskReplay.teamId}</span><strong>{taskReplay.title}</strong><small>{new Date(taskReplay.updatedAt).toLocaleString('zh-CN')} · {taskReplay.status}</small></div>
                  <div className="task-replay-goal"><strong>原目标</strong><p>{taskReplay.goal}</p></div>
                  <details className="task-replay-section"><summary>确定性压缩摘要</summary><p>{taskReplay.summary.narrative || '暂无摘要'}</p>{taskReplay.summary.modelNarrative && <p className="task-replay-model-summary">模型辅助：{taskReplay.summary.modelNarrative}</p>}</details>
                  <details className="task-replay-section"><summary>已验证事实 {taskReplay.summary.verifiedFacts.length}</summary>{taskReplay.summary.verifiedFacts.map((item, index) => <p key={`${index}-${item.slice(0, 24)}`}>{item}</p>)}</details>
                  <details className="task-replay-section"><summary>交付文件 {taskReplay.summary.artifactPaths.length}</summary>{taskReplay.summary.artifactPaths.map((item) => <p key={item}>{item}</p>)}</details>
                  <div className="task-replay-timeline"><strong>任务回放</strong>{replayTimeline.map((event) => <div key={`${event.source}-${event.id}`} className={event.verified ? 'is-verified' : ''}><time>{new Date(event.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><span>{event.source} · {event.type}</span><p>{event.detail}</p></div>)}</div>
                </div> : taskHistoryQuery.trim() ? <div className="task-history-results">
                  <div className="team-task-section-title">跨会话结果 · {historyMatches.length}</div>
                  {historyMatches.map((match) => <button type="button" key={match.taskId} className="task-history-result" onClick={() => setReplayTaskId(match.taskId)}><span>{match.teamName} · {match.status}</span><strong>{match.title}</strong><p>{match.summary || match.goal}</p><small>已验证 {match.verifiedFacts.length} · 文件 {match.artifactPaths.length} · {new Date(match.updatedAt).toLocaleDateString('zh-CN')}</small></button>)}
                  {historyMatches.length === 0 && <div className="team-task-empty">没有匹配的历史任务</div>}
                </div> : <>
                  {activeTaskRuns.length > 0 && <div className="team-task-section"><div className="team-task-section-title">进行中与待处理</div>{activeTaskRuns.map(renderTaskRunCard)}</div>}
                  {completedTaskRuns.length > 0 && <div className="team-task-section completed"><div className="team-task-section-title">已完成</div>{completedTaskRuns.map(renderTaskRunCard)}</div>}
                  {taskRuns.length === 0 && <div className="team-task-empty">暂无任务</div>}
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
    </div>
  );
}
