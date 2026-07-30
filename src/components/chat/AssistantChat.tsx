import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage, ThoughtChainStep, SkillUsageEvidence } from '../../types';
import { compileTaskDecision, runAgentLoop, resolveApiBase, resolveChatSettings, extractUserInsights, fetchInitial, loadSettings, type ChatTurn, type Attachment } from '../../data/hermesClient';
import { getRegisteredTools } from '../../engine/toolCatalog';
import ChatOutputsPanel from '../outputs/ChatOutputsPanel';
import ProjectApprovalCard from './ProjectApprovalCard';
import MessageSkillEvidence from './MessageSkillEvidence';
import ChatMessageText from './ChatMessageText';
import ThoughtChainView from './ThoughtChainView';
import { copyAndArchiveChatTranscript, copyToClipboard, downloadTextFile, messagesToMarkdown } from '../../utils/clipboard';
import ModelSelector from './ModelSelector';
import SkillMentionInput from '../skills/SkillMentionInput';
import { resolveSkillContextWithEvidence } from '../../engine/skillContext';
import SkillPickerButton from '../skills/SkillPickerButton';
import ExecutionPolicyControl from './ExecutionPolicyControl';
import type { SkillReference } from '../../types';
import type { Employee } from '../../types';
import type { OutputRecord } from '../../data/outputs';
import {
  fileToAttachment, attachmentsFromClipboard, attachmentWorkspaceContext, formatFileSize, persistAttachments,
  copyAttachmentsToWorkspace, createTaskWorkspaceId, initializeTaskWorkspace,
} from '../../utils/attachments';
import { useFileDrop } from '../../hooks/useFileDrop';
import { formatExecutionDuration, useAgentExecutionControl } from '../../hooks/useAgentExecutionControl';
import AssistantSettingsModal, { DEFAULT_ASSISTANT_PROMPT, DEFAULT_PROMPT_VERSION, PERSONA_MIGRATION_APPENDIX } from '../settings/AssistantSettingsModal';
import { getAssistantPrompt } from '../../data/assistantPrompt';
import { useStore } from '../../storeContext';
import { BUS_CHANNELS, onBus, sendBus } from '../../ipcBus';
import { getDirectExecutionControl, isExplicitPauseSteering, isExplicitResumeSteering, shouldHoldTaskForFeedback } from '../../engine/agentGuardrails.mjs';
import { executionControllerStatus } from '../../engine/executionController.mjs';
import {
  applyProjectRosterMutation,
  isProjectApprovalIntent,
  isProjectRosterRematchRequest,
  isTeamMemberAdditionRequest,
  isTeamMemberRemovalRequest,
  isTeamMemberReplacementRequest,
  rematchProjectRoster,
  resolveMentionedEmployees,
  resolveTargetProject,
  resolveTargetTeam,
} from '../../engine/teamMembership';
import { matchProjectMembers } from '../../engine/taskMatcher';
import { employeePlanningPool } from '../../data/expertCatalog';
import { classifyLocalOfficeQuery, formatLocalOfficeAnswer } from '../../engine/officeDirectory';
import {
  BEGINNER_RESPONSE_GUIDE,
  getToolActivity,
  getToolReport,
  getToolStage,
  humanizeExecutionError,
  isToolResultSuccessful,
  simplifyLegacyAssistantContent,
} from '../../data/assistantPresentation';
import { buildLayeredMemoryContext } from '../../data/layeredMemory';
import { referenceClarification, referencesFromToolResult, resolveConversationReferences } from '../../engine/conversationReferences.mjs';
import { createChatTaskBridge } from '../../engine/taskServiceBridge';
import type { ConversationReferenceResolution } from '../../engine/conversationReferences.mjs';
import {
  activateChatSession,
  createChatSession,
  ensureActiveChatSession,
  listChatSessions,
  messageBelongsToConversation,
  normalizeConversationMessages,
  registerChatSession,
  syncChatSessionsFromMessages,
  titleFromMessages,
  touchChatSession,
  type ChatSessionScope,
} from '../../data/chatSessions';
import {
  CopyOutlined,
  DeleteOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  PaperClipOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RobotOutlined,
  SettingOutlined,
  StopOutlined,
} from '@ant-design/icons';

const LS_KEY = 'hermes_office_assistant_chat';
const LS_PENDING_REQUEST = 'hermes_office_assistant_pending_request';
const LS_CHAT_ARCHIVES = 'hermes_office_assistant_chat_archives';

interface PendingAssistantRequest {
  id: string;
  prompt: string;
  display?: string;
  createdAt: number;
  alreadyDisplayed?: boolean;
}

interface LegacyAssistantChatArchive {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

// 构建 API 上下文时排除的中间消息前缀（工具调用状态、错误提示等非实质对话）
const NON_DIALOG_PREFIXES = ['🔧 调用工具', '⚠️ 出错了'];

function isDialogMessage(m: ChatMessage): boolean {
  return !NON_DIALOG_PREFIXES.some((p) => m.content.startsWith(p));
}

function loadHistory(): ChatMessage[] {
  const scope: ChatSessionScope = 'assistant';
  const activeConversationId = ensureActiveChatSession(scope);
  let messages: ChatMessage[] = [];
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) messages = (JSON.parse(raw) as ChatMessage[]).filter(isDialogMessage).map((message) => (
      message.roleId === 'human' ? message : { ...message, content: simplifyLegacyAssistantContent(message.content) }
    ));
  } catch {}
  const normalized = normalizeConversationMessages(messages, scope);
  try {
    const legacyArchives = JSON.parse(localStorage.getItem(LS_CHAT_ARCHIVES) ?? '[]') as LegacyAssistantChatArchive[];
    for (const archive of legacyArchives) {
      if (!archive?.id || !Array.isArray(archive.messages)) continue;
      registerChatSession({ id: archive.id, scope, title: archive.title || '历史对话', createdAt: archive.updatedAt, updatedAt: archive.updatedAt });
      for (const message of archive.messages) {
        if (!normalized.some((item) => item.id === message.id)) normalized.push({ ...message, conversationId: archive.id });
      }
    }
    localStorage.removeItem(LS_CHAT_ARCHIVES);
  } catch {}
  if (!normalized.some((message) => message.conversationId === activeConversationId) && messages.length) {
    normalized.forEach((message) => { if (!message.conversationId) message.conversationId = activeConversationId; });
  }
  syncChatSessionsFromMessages(scope, normalized);
  saveHistory(normalized);
  return normalized;
}
function saveHistory(msgs: ChatMessage[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(msgs.slice(-2400)));
  } catch {}
}

const EXPLICIT_TEAM_DISPATCH_RE = /(?:拉(?:个|起|一个)?团队|拉群|组建团队|组队|召集.{0,12}(?:员工|成员|团队)|叫.{0,12}(?:员工|成员).{0,12}(?:来|去|做|负责)|安排.{0,12}(?:员工|成员|人|人手|专员|同事).{0,12}(?:帮|做|负责|开发|设计))/u;
const SPECIALIST_DOMAIN_RE = /前端|后端|全栈|网页|网站|UI|界面|视觉|代码|开发|编程|脚本|文案|视频|分镜|报告|方案/u;
const DELIVERABLE_ACTION_RE = /做|制作|开发|设计|编写|写|生成|实现|创建|完成|修复|优化|重写|起草|改造/u;

function shouldExplicitlyDispatchTeam(content: string): boolean {
  return EXPLICIT_TEAM_DISPATCH_RE.test(content);
}

function resolveDispatchRequest(current: string, recentUserMessages: string[]): string {
  const text = current.trim();
  const refersToPreviousGoal = /(?:这个|那个|刚才|刚刚|上面|前面|之前)(?:的)?(?:任务|需求|事情|项目)?|按(?:刚才|上面|之前)|继续(?:刚才|上面|之前)/u.test(text);
  const hasConcreteCurrentGoal = DELIVERABLE_ACTION_RE.test(text) && (SPECIALIST_DOMAIN_RE.test(text) || text.length >= 16);
  if (!refersToPreviousGoal || hasConcreteCurrentGoal) return text;
  const previous = [...recentUserMessages].reverse().find((message) => DELIVERABLE_ACTION_RE.test(message) && message.trim() !== text);
  return previous ? `${previous}\n\n老板最新调度要求：${text}` : text;
}

export default function AssistantChat() {
  const { state, createProjectDraft, approveProject, rejectProject, addTeamMembers, setTeamMembers, removeTeamMembers, setProjectMembers } = useStore();
  const sessionScope: ChatSessionScope = 'assistant';
  const [conversationId, setConversationId] = useState(() => ensureActiveChatSession(sessionScope));
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const [allMsgs, setAllMsgs] = useState<ChatMessage[]>(() => loadHistory());
  const msgs = allMsgs.filter((message) => messageBelongsToConversation(message, conversationId, sessionScope));
  const chatSessions = listChatSessions(sessionScope).filter((session) => session.id !== conversationId);
  const [pendingNewChat, setPendingNewChat] = useState(false);
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

  const push = useCallback((m: ChatMessage, targetConversationId?: string) => {
    const sessionId = targetConversationId ?? conversationIdRef.current;
    setAllMsgs((prev) => {
      const next = [...prev, { ...m, conversationId: sessionId }];
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
    touchChatSession(sessionScope, conversationIdRef.current, content || atts[0]?.name || '新对话');
    // A chat window can remain open while the office window adds or edits an
    // employee. Read the shared profile store at dispatch time, not only from
    // the last React render, before choosing project members.
    const liveState = fetchInitial();
    const liveEmployees = liveState.employees;
    const localOfficeQuery = atts.length === 0 ? classifyLocalOfficeQuery(content) : undefined;
    if (localOfficeQuery) {
      const display = displayOverride ?? content;
      if (!externalRequest) {
        setSkillRefs([]);
        setText('');
        setAttachments([]);
      }
      if (!alreadyDisplayed) {
        push({
          id: `h-${Date.now()}-me`, authorId: 'me', roleId: 'human',
          content: display, mentions: [], timestamp: Date.now(), kind: 'text',
        });
      }
      push({
        id: `h-${Date.now()}-office-fact`, authorId: 'assistant', roleId: 'custom',
        content: formatLocalOfficeAnswer(localOfficeQuery, liveEmployees, liveState.teams),
        mentions: [], timestamp: Date.now(), kind: 'text',
      });
      return;
    }
    const referenceResolution: ConversationReferenceResolution = externalRequest
      ? { status: 'none', references: [], skillRefs: [], context: '', action: 'refer' }
      : resolveConversationReferences({ input: content, history: msgs, selectedSkillRefs: skillRefs });
    const inheritedRefs = referenceResolution.status === 'resolved' ? referenceResolution.skillRefs : [];
    const refs = externalRequest ? [] : (skillRefs.length ? skillRefs : inheritedRefs);
    const usedSkillRefs = [...refs];
    const usedReferences = [
      ...referenceResolution.references,
      ...refs.map((ref) => ({ kind: 'skill' as const, id: ref.id, label: ref.name, state: 'local' as const })),
    ];
    const skillResolution = await resolveSkillContextWithEvidence(refs);
    const skillContext = skillResolution.context;
    const skillEvidence: SkillUsageEvidence[] = [...skillResolution.evidence];
    const selectedSkillGuide = refs.length
      ? `用户明确通过 @ 选择了以下 Skill：${refs.map((ref) => `${ref.name} (${ref.id})`).join('、')}。这些 Skill 规则优先于自动路由；先遵循已读取的 Skill 说明完成任务，需要查询时使用 Skill 指定的方式，不要无理由改用普通搜索。`
      : '';
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
        content: display, mentions: [], timestamp: Date.now(), kind: 'text', skillRefs: refs, skillEvidence,
        attachments: atts,
      });
    }

    if (referenceResolution.status === 'ambiguous') {
      push({
        id: `h-${Date.now()}-reference-unclear`, authorId: 'assistant', roleId: 'custom',
        content: referenceClarification(referenceResolution), mentions: [], timestamp: Date.now(), kind: 'text',
        references: referenceResolution.references,
      });
      return;
    }

    if (referenceResolution.status === 'resolved' && referenceResolution.action === 'share-link') {
      const reference = referenceResolution.references[0];
      const response = reference.sourceUrl
        ? `这是“${reference.label}”的真实来源链接：\n${reference.sourceUrl}\n\n当前状态：${reference.state === 'candidate' ? '已找到候选，尚未安装。' : '该对象已在本机记录中，可继续读取或使用。'}`
        : `“${reference.label}”是本机已有对象，没有记录可公开访问的来源链接。我不会重新搜索一个同名对象来替代它；可以继续读取、使用或根据已记录的来源重新安装。`;
      push({
        id: `h-${Date.now()}-reference-link`, authorId: 'assistant', roleId: 'custom',
        content: response, mentions: [], timestamp: Date.now(), kind: 'text', references: usedReferences,
      });
      return;
    }

    const contextualProject = resolveTargetProject(enriched, state.projects, conversationIdRef.current);
    if (isProjectApprovalIntent(enriched)) {
      if (contextualProject?.status === 'awaiting_approval') {
        approveProject(contextualProject.id);
        push({
          id: `h-${Date.now()}-project-approved`, authorId: 'assistant', roleId: 'custom',
          content: `已按刚才确认的名单建立「${contextualProject.title}」团队，成员没有重新匹配。团队会先向你确认方向和风格，确认前不会开始执行。`,
          mentions: contextualProject.members.map((member) => member.employeeId), timestamp: Date.now(), kind: 'text',
        });
        return;
      }
      if (contextualProject?.status === 'clarifying') {
        push({
          id: `h-${Date.now()}-project-needs-clarification`, authorId: 'assistant', roleId: 'custom',
          content: `「${contextualProject.title}」团队已经建立，正在等待你确认方向和风格。请在对应团队聊天里回复问题，再点“确认方向并开始执行”。`,
          mentions: contextualProject.members.map((member) => member.employeeId), timestamp: Date.now(), kind: 'text',
        });
        return;
      }
      push({
        id: `h-${Date.now()}-project-approval-missing`, authorId: 'assistant', roleId: 'custom',
        content: '当前聊天没有可批准的团队草案。我不会把“拉群”当成新项目重新猜成员；请先说明要做什么，或回到包含草案的聊天继续。',
        mentions: [], timestamp: Date.now(), kind: 'text',
      });
      return;
    }

    if (isProjectRosterRematchRequest(enriched)) {
      const planningEmployees = employeePlanningPool(liveEmployees);
      if (contextualProject?.status !== 'awaiting_approval') {
        push({
          id: `h-${Date.now()}-project-rematch-missing`, authorId: 'assistant', roleId: 'custom',
          content: '当前聊天没有正在等待批准的团队草案。我不会根据这句纠正重新猜一个新项目；请先说明完整项目目标。',
          mentions: [], timestamp: Date.now(), kind: 'text',
        });
        return;
      }
      const rematched = rematchProjectRoster(contextualProject, enriched, planningEmployees);
      setProjectMembers(contextualProject.id, rematched.map((member) => member.employeeId));
      const selectedEmployees = rematched
        .map((member) => planningEmployees.find((employee) => employee.id === member.employeeId))
        .filter((employee): employee is Employee => !!employee);
      push({
        id: `h-${Date.now()}-project-rematched`, authorId: 'assistant', roleId: 'custom',
        content: selectedEmployees.length
          ? `已按「${contextualProject.request}」的原始目标重新检查同一份团队草案，没有新建项目。当前成员是：${selectedEmployees.map((employee) => `${employee.name}（${employee.title}）`).join('、')}。你可以继续调整，确认后再批准。`
          : `我保留了「${contextualProject.request}」的原始目标，但当前员工目录仍不能覆盖所需职责。草案没有塞入无关员工，请先补充对应专业员工后再批准。`,
        mentions: rematched.map((member) => member.employeeId), timestamp: Date.now(), kind: 'text',
      });
      return;
    }

    if (isTeamMemberAdditionRequest(enriched)) {
      const planningEmployees = employeePlanningPool(liveEmployees);
      const mentionedEmployees = resolveMentionedEmployees(enriched, planningEmployees);
      const explicitlyNamedTeam = [...state.teams].reverse().find((team) => !team.archived && enriched.replace(/\s+/g, '').includes(team.name.replace(/\s+/g, '')));
      const targetProject = explicitlyNamedTeam ? undefined : contextualProject;
      if (contextualProject?.status === 'awaiting_approval') {
        const currentIds = contextualProject.members.map((member) => member.employeeId);
        const requestedIds = mentionedEmployees.map((employee) => employee.id);
        const intent = isTeamMemberRemovalRequest(enriched)
          ? 'remove'
          : isTeamMemberReplacementRequest(enriched)
            ? 'replace'
            : 'add';
        if (!requestedIds.length) {
          push({
            id: `h-${Date.now()}-employee-unclear`, authorId: 'assistant', roleId: 'custom',
            content: `我已经锁定正在等待批准的「${contextualProject.title}」，但还没有识别出可实际修改的员工。请说姓名或完整职位；我会只修改这份已确认名单，不会重新随机选人。`,
            mentions: [], timestamp: Date.now(), kind: 'text',
          });
          return;
        }
        const nextIds = applyProjectRosterMutation(currentIds, mentionedEmployees, planningEmployees, intent);
        setProjectMembers(contextualProject.id, nextIds);
        const selectedEmployees = nextIds
          .map((employeeId) => planningEmployees.find((employee) => employee.id === employeeId))
          .filter((employee): employee is Employee => !!employee);
        push({
          id: `h-${Date.now()}-project-members-updated`, authorId: 'assistant', roleId: 'custom',
          content: `已直接更新「${contextualProject.title}」的真实成员名单。${intent === 'replace' ? '同类职责的原成员已替换。' : intent === 'remove' ? '指定成员已移出。' : '新成员已加入，原名单保持不变。'}现在是：${selectedEmployees.map((employee) => `${employee.name}（${employee.title}）`).join('、')}。`,
          mentions: nextIds, timestamp: Date.now(), kind: 'text',
        });
        return;
      }
      const preferredTeamIds = [targetProject?.teamId].filter((teamId): teamId is string => !!teamId);
      const targetTeam = explicitlyNamedTeam ?? resolveTargetTeam(enriched, state.teams, msgs.slice(-12).map((message) => message.content), preferredTeamIds);
      if (!targetTeam) {
        push({
          id: `h-${Date.now()}-team-unclear`, authorId: 'assistant', roleId: 'custom',
          content: '我确认这是团队成员调整，但当前没有待批准项目或正在运行的团队可作为上下文，而且存在多个历史团队。请告诉我团队名称，我会直接处理。',
          mentions: [], timestamp: Date.now(), kind: 'text',
        });
        return;
      }
      if (!mentionedEmployees.length) {
        push({
          id: `h-${Date.now()}-employee-unclear`, authorId: 'assistant', roleId: 'custom',
          content: `我已确认要修改「${targetTeam.name}」，但这句话里没有匹配到办公室中的真实员工姓名或职位。请直接说姓名或职位，也可以在团队成员栏点“添加成员”选择。`,
          mentions: [], timestamp: Date.now(), kind: 'text',
        });
        return;
      }
      const removing = isTeamMemberRemovalRequest(enriched);
      const replacing = isTeamMemberReplacementRequest(enriched);
      const desiredMemberIds = replacing
        ? applyProjectRosterMutation(targetTeam.memberIds, mentionedEmployees, planningEmployees, 'replace')
        : targetTeam.memberIds;
      const rosterChange = replacing ? setTeamMembers(targetTeam.id, desiredMemberIds) : undefined;
      const removed = removing
        ? removeTeamMembers(targetTeam.id, mentionedEmployees.map((employee) => employee.id))
        : rosterChange?.removed ?? [];
      const added = removing
        ? []
        : rosterChange?.added ?? addTeamMembers(targetTeam.id, mentionedEmployees.map((employee) => employee.id)
          .filter((employeeId) => !targetTeam.memberIds.includes(employeeId)));
      const updated = [...removed, ...added];
      const alreadyPresent = mentionedEmployees.filter((employee) => targetTeam.memberIds.includes(employee.id));
      push({
        id: `h-${Date.now()}-members-updated`, authorId: 'assistant', roleId: 'custom',
        content: removing
          ? (updated.length ? `已将 ${updated.map((employee) => employee.name).join('、')} 从「${targetTeam.name}」移出，成员列表已同步。` : '没有找到可移出的对应成员，名单没有变化。')
          : replacing
            ? `已更新「${targetTeam.name}」的职责名单：${removed.length ? `移出 ${removed.map((employee) => employee.name).join('、')}；` : ''}${added.length ? `加入 ${added.map((employee) => employee.name).join('、')}。` : '指定成员已经在对应职责位置。'}`
          : (updated.length
            ? `已处理好：${updated.map((employee) => employee.name).join('、')} 已加入「${targetTeam.name}」，团队窗口和成员名单会立即同步。${alreadyPresent.length ? `${alreadyPresent.map((employee) => employee.name).join('、')} 原本就在团队中。` : ''}`
            : `${alreadyPresent.map((employee) => employee.name).join('、')} 已经在「${targetTeam.name}」中，名单没有重复添加。`),
        mentions: mentionedEmployees.map((employee) => employee.id), timestamp: Date.now(), kind: 'text',
      });
      if (busy && updated.length) {
        steeringMessagesRef.current.push(`团队名单已真实更新：${updated.map((employee) => `${employee.name}（${employee.title}）`).join('、')} 已${removing ? '移出' : '加入'}「${targetTeam.name}」。后续判断和分工必须使用更新后的名单。`);
        executionControl.interruptForSteering();
        setStatus('团队名单已更新，正在让当前任务采用新成员信息…');
      }
      return;
    }

    const explicitTeamDispatch = shouldExplicitlyDispatchTeam(enriched);
    let taskDecisionCompilation: Awaited<ReturnType<typeof compileTaskDecision>> | undefined;
    if (busy && explicitTeamDispatch) {
      executionControl.stop();
      steeringMessagesRef.current.splice(0);
    }
    if (!busy || explicitTeamDispatch) {
      setBusy(true);
      setStatus('正在理解当前需求…');
      const decisionTurns: ChatTurn[] = [
        ...msgs.filter(isDialogMessage).slice(-8).map((message) => ({
          role: message.roleId === 'human' ? 'user' as const : 'assistant' as const,
          content: message.content,
        })),
        { role: 'user', content: enriched },
      ];
      taskDecisionCompilation = await compileTaskDecision(decisionTurns, getRegisteredTools(), resolveChatSettings());
      setBusy(false);
      setStatus('');
    }
    const semanticTeamDispatch = taskDecisionCompilation?.decision.primaryRoute === 'team_dispatch'
      || taskDecisionCompilation?.decision.teamPolicy?.requiresTeam === true;

    // The model understands the request first; this control-plane executor then
    // builds a reviewable team proposal without granting the model direct access.
    if (explicitTeamDispatch || semanticTeamDispatch) {
      if (busy) setStatus('已停止当前路线，正在建立团队任务草案…');
      const recentUserMessages = msgs
        .filter((message) => message.roleId === 'human')
        .slice(-8)
        .map((message) => message.content);
      const dispatchRequest = resolveDispatchRequest(enriched, recentUserMessages);
      const decision = taskDecisionCompilation!.decision;
      const requiredCapabilities = decision.requiredCapabilities ?? [];
      const selectionRequest = [dispatchRequest, ...requiredCapabilities].filter(Boolean).join('\n所需能力：');
      const existing = state.projects.find((project) => project.status === 'awaiting_approval' && project.conversationId === conversationIdRef.current && project.request === dispatchRequest);
      if (!existing) createProjectDraft({
        title: content.slice(0, 40),
        request: dispatchRequest,
        conversationId: conversationIdRef.current,
        requiredCapabilities,
        decisionReason: decision.decisionReason,
      });
      const members = matchProjectMembers(employeePlanningPool(liveEmployees), selectionRequest)
        .map((member) => employeePlanningPool(liveEmployees).find((employee) => employee.id === member.employeeId))
        .filter((employee): employee is Employee => !!employee);
      const memberText = members.length
        ? `已识别候选成员：${members.map((employee) => `${employee.name}（${employee.title}）`).join('、')}。`
        : '当前没有匹配到在线专员，草案会标记为待补充成员。';
      push({
        id: `h-${Date.now()}-dispatch`, authorId: 'assistant', roleId: 'custom',
        content: explicitTeamDispatch || semanticTeamDispatch
          ? `模型已先理解任务，再由调度器建立待授权方案。判断依据：${decision.decisionReason}。${memberText}请直接在这条消息下方批准或驳回。`
          : `模型判断这个任务适合由专员完成，已建立待授权方案。判断依据：${decision.decisionReason}。${memberText}请直接在这条消息下方批准或驳回。`,
        mentions: members.map((employee) => employee.id), timestamp: Date.now(), kind: 'text',
      });
      return;
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
    const taskBridge = createChatTaskBridge({
      taskType: 'assistant',
      ownerId: 'assistant',
      title: content.slice(0, 120) || 'Assistant task',
      goal: enriched,
      workspaceId,
      idempotencyKey: `assistant-chat:${workspaceId}`,
      conversationId: conversationIdRef.current,
      references: usedReferences,
    });
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
      const allTools = getRegisteredTools();

      // 思维链采集
      const settings = loadSettings();
      showCoT = settings.showThoughtChain !== false; // 默认开启
      const employeeDirectory = liveEmployees.length > 0
        ? liveEmployees.map((employee) => {
          const teams = state.teams.filter((team) => team.memberIds.includes(employee.id)).map((team) => team.name);
          return `- ${employee.name}｜${employee.title}｜${employee.isOnline ? '在线' : '离线'}｜${teams.length ? `团队：${teams.join('、')}` : '暂未加入团队'}｜员工ID：${employee.id}`;
        }).join('\n')
        : '- 当前还没有员工';
      const organizationContext = `## 当前办公室实时员工目录
${employeeDirectory}

以上名单来自客户端当前状态，每次对话都会重新读取。用户提到某位员工时，先按姓名核对这里的真实名单；名单中存在就不得回答“没有这名员工”。需要调度多人任务时，先明确将由哪些现有员工承担。`;
      const layeredMemoryContext = await buildLayeredMemoryContext({ query: enriched, limit: 16 });

      const r = await runAgentLoop({
        turns: [
          { role: 'system', content: `${getAssistantPrompt(DEFAULT_ASSISTANT_PROMPT, DEFAULT_PROMPT_VERSION, PERSONA_MIGRATION_APPENDIX)}\n\n${selectedSkillGuide}\n\n${BEGINNER_RESPONSE_GUIDE}` },
          ...history,
          { role: 'user', content: enriched },
        ],
        tools: allTools,
        scene: 'assistant',
        label: '章北海助理',
        scope: 'assistant',
        workspaceId,
        skillRefs: refs,
        attachments: imageAtts,
        referenceContext: referenceResolution.context,
        referenceSourceUrl: referenceResolution.references[0]?.sourceUrl,
        extraSystemContext: [organizationContext, layeredMemoryContext, selectedSkillGuide, skillContext, referenceResolution.context].filter(Boolean).join('\n\n'),
        taskDecisionCompilation,
        shouldStop: executionControl.shouldStop,
        waitIfPaused: executionControl.waitIfPaused,
        consumeSteeringMessages: () => steeringMessagesRef.current.splice(0),
        getModelRequestSignal: executionControl.getModelRequestSignal,
        onTaskPrepared: (decision) => taskBridge.prepare(decision),
        onExecutionState(state) {
          taskBridge.heartbeat(state);
          setStatus(executionControllerStatus(state));
        },
        onTurnLifecycle(state) {
          taskBridge.lifecycle(state);
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
          taskBridge.toolStarted(name, args ?? '');
          lastStage = getToolStage(name);
          setStatus(getToolActivity(name, args));
          const matchKey = `${name}:${args}`;
          setLiveActivities([{ id: `${Date.now()}`, matchKey, label: getToolReport(name, args), args: args ?? '', state: 'active' }]);
        },
        onToolResult(name, args, result, success, _protocolEvidence, structuredEvidence) {
          const matchKey = `${name}:${args}`;
          const resultSuccess = isToolResultSuccessful(result, success);
          taskBridge.toolFinished(name, args ?? '', result, resultSuccess);
          taskBridge.artifacts(structuredEvidence);
          if (/^(search_skills|read_skill|install_skill)$/u.test(name)) {
            let skillId = '';
            try {
              const parsed = JSON.parse(args || '{}') as { id?: string; installedSkillId?: string };
              skillId = parsed.id ?? parsed.installedSkillId ?? '';
            } catch {}
            const selected = refs.find((ref) => ref.id === skillId);
            const readName = result.match(/(?:^|\n)#\s*([^\n]+)/u)?.[1]?.trim() || selected?.name || skillId;
            if (resultSuccess && skillId && (name === 'read_skill' || name === 'install_skill') && !usedSkillRefs.some((ref) => ref.id === skillId)) {
              usedSkillRefs.push({ id: skillId, name: readName });
            }
            skillEvidence.push({
              ts: Date.now(), skillId: skillId || selected?.id, skillName: readName || selected?.name,
              action: name === 'search_skills' ? 'searched' : name === 'read_skill' ? (resultSuccess ? 'read' : 'read-failed') : 'called',
              toolName: name, reason: resultSuccess ? '助理实际执行了技能工具' : '技能工具执行失败',
              detail: result.slice(0, 240), verified: resultSuccess, stage: 'execution', source: 'assistant',
            });
          }
          usedReferences.push(...referencesFromToolResult(name, args, result, resultSuccess));
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
      await taskBridge.finish({
        executionState: r.executionState,
        usage: r.usage,
        model: r.model,
        output: r.content,
        turnRuntime: r.turnRuntime,
        turnFinalization: r.turnFinalization,
        lifecycle: r.turnLifecycle,
      });
      setStatus('正在整理清楚的结果…');
      push({
        id: `h-${ts}-ai`, authorId: 'assistant', roleId: 'custom',
        content: simplifyLegacyAssistantContent(r.content), mentions: [], timestamp: ts, kind: 'text',
        skillRefs: usedSkillRefs.length ? usedSkillRefs : undefined,
        references: usedReferences.length ? usedReferences : undefined,
        skillEvidence: skillEvidence.length ? skillEvidence : undefined,
        tokens: r.usage.totalTokens,
        contextUsage: r.contextUsage,
        thoughtChain: showCoT && cotSteps.length > 0 ? cotSteps : undefined,
      });

      // 自动提炼用户洞察（每 2 次对话触发）
      const userMsgCount = msgs.filter(m => m.roleId === 'human' && isDialogMessage(m)).length;
      if (userMsgCount > 0 && userMsgCount % 2 === 0 && resolveApiBase(assistantSettings)) {
        const chatText = msgs.slice(-6).map(m => {
          const who = m.roleId === 'human' ? '用户' : '助手';
          return `${who}: ${m.content.slice(0, 200)}`;
        }).join('\n');
        extractUserInsights(chatText, '章北海助理对话').catch(() => {});
      }
    } catch (e: any) {
      await taskBridge.fail(e);
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
      const head = m.roleId === 'human' ? '你' : '章北海助理';
      return `[${head}] ${m.content}`;
    }).join('\n\n');
    await copyToClipboard(text);
    await copyAndArchiveChatTranscript({
      scope: 'assistant',
      title: 'Taiji Assistant Transcript',
      messages: msgs.map((message) => ({
        role: message.roleId === 'human' ? 'User' : 'Assistant',
        content: message.content,
        time: new Date(message.timestamp).toLocaleString('zh-CN'),
      })),
    });
  };

  const handleExport = () => {
    const md = messagesToMarkdown(
      msgs.map((m) => ({
        role: m.roleId === 'human' ? '你' : '章北海助理',
        content: m.content,
        time: new Date(m.timestamp).toLocaleString('zh-CN'),
      })),
      '章北海助理对话记录'
    );
    downloadTextFile(`章北海助理-对话-${new Date().toISOString().slice(0, 10)}.md`, md);
  };

  const handleClearHistory = () => {
    if (busy || !confirm('清空当前对话？历史中的其他对话不会删除。')) return;
    setAllMsgs((previous) => {
      const next = previous.filter((message) => !messageBelongsToConversation(message, conversationIdRef.current, sessionScope));
      saveHistory(next);
      return next;
    });
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const resetConversationRuntime = () => {
    setSkillRefs([]);
    setAttachments([]);
    setText('');
    setPendingRequest(null);
    setCompletedActionCount(0);
    setLiveActivities([]);
    setLiveExecutionSteps([]);
    steeringMessagesRef.current.splice(0);
    queuedFollowUpsRef.current.splice(0);
    activeWorkspaceIdRef.current = undefined;
    localStorage.removeItem(LS_PENDING_REQUEST);
    executionControl.reset();
  };

  const openFreshChat = () => {
    if (msgs.length) touchChatSession(sessionScope, conversationIdRef.current, titleFromMessages(msgs, '助理对话'));
    const session = createChatSession(sessionScope);
    setConversationId(session.id);
    resetConversationRuntime();
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleStartNewChat = () => {
    if (busy) {
      if (!confirm('当前任务还在运行。是否安全停止它，并在停止后自动新建聊天？')) return;
      setPendingNewChat(true);
      steeringMessagesRef.current.splice(0);
      queuedFollowUpsRef.current.splice(0);
      executionControl.stop();
      setStatus('正在停止旧任务，随后会自动开启新聊天…');
      return;
    }
    openFreshChat();
  };

  useEffect(() => {
    if (!pendingNewChat || busy) return;
    setPendingNewChat(false);
    openFreshChat();
    // openFreshChat intentionally consumes the latest visible conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, pendingNewChat]);

  const handleRestoreArchive = (archiveId: string) => {
    if (!archiveId || busy || !activateChatSession(sessionScope, archiveId)) return;
    touchChatSession(sessionScope, conversationIdRef.current, titleFromMessages(msgs, '助理对话'));
    setConversationId(archiveId);
    resetConversationRuntime();
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
                <h3>章北海助理</h3>
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
                        <RobotOutlined /> 章北海助理
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
                  <MessageSkillEvidence refs={msg.skillRefs} evidence={msg.skillEvidence} />
                  {msg.thoughtChain && msg.thoughtChain.length > 0 && (
                    <ThoughtChainView steps={msg.thoughtChain} />
                  )}
                  {msg.tokens != null && (
                    <div className="msg-tokens">≈ {msg.tokens.toLocaleString()} tokens</div>
                  )}
                </div>
              );
            })}
            {state.projects
              .filter((project) => project.status === 'awaiting_approval')
              .map((project) => (
                <ProjectApprovalCard
                  key={project.id}
                  project={project}
                  employees={state.employees}
                  onApprove={() => approveProject(project.id)}
                  onReject={() => rejectProject(project.id)}
                />
              ))}
            {busy && status && (
              <div className="msg assistant-live-report">
                <div className="msg-meta">
                  <span className="msg-author" style={{ color: 'var(--apple-accent)' }}><RobotOutlined /> 章北海助理</span>
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
              <button className="btn btn-sm chat-new-session-btn" onClick={handleStartNewChat} title={busy ? '安全停止当前任务并新建聊天' : '保存当前对话并开启空白上下文'} aria-label="新建聊天"><PlusOutlined /><span>{pendingNewChat ? '正在新建…' : '新建聊天'}</span></button>
              {chatSessions.length > 0 && (
                <select className="assistant-chat-history-select" value="" onChange={(event) => handleRestoreArchive(event.target.value)} disabled={busy || pendingNewChat} aria-label="历史对话">
                  <option value="">历史对话</option>
                  {chatSessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
                </select>
              )}
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
