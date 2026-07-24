import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  type ReactNode,
} from 'react';
import type {
  Employee,
  Team,
  ChatMessage,
  TeamTask,
  TaskLane,
  AgentStatus,
  OpcRoleId,
  AppState,
  RoleId,
  DiscussionProgress,
  DiscussionTriggerInput,
} from './types';
import { ROLE_SCARF } from './types';
import * as client from './data/hermesClient';
import { runScript, cancelDemo as cancelScript, type ScriptHandlers } from './engine/simulationEngine';
import { PROACTIVE_SCRIPT } from './engine/proactiveScript';
import { runTeamDiscussion } from './engine/teamDiscussion';
import { buildParticipantPlan, evaluateDiscussionTrigger } from './engine/discussionTrigger';
import { findFreeStation } from './data/hermesClient';
import { addOutput, buildDiscussionOutput, buildTaskOutput } from './data/outputs';
import { sendBus, onBus, BUS_CHANNELS } from './ipcBus';

// ===== Action =====
type Action =
  | { type: 'INIT'; state: AppState }
  | { type: 'ADD_EMPLOYEE'; emp: Employee }
  | { type: 'UPDATE_EMPLOYEE'; id: string; partial: Partial<Employee> }
  | { type: 'REMOVE_EMPLOYEE'; id: string }
  | { type: 'ADD_TEAM'; team: Team }
  | { type: 'UPDATE_TEAM'; id: string; partial: Partial<Team> }
  | { type: 'REMOVE_TEAM'; id: string }
  | { type: 'APPEND_CHAT'; teamId: string; msgs: ChatMessage[] }
  | { type: 'ADD_TASK'; teamId: string; task: TeamTask }
  | { type: 'ADVANCE_TASK'; teamId: string; taskId: string; lane: TaskLane }
  | { type: 'CLAIM_TASK'; teamId: string; taskId: string; claimerId: string }
  | { type: 'SET_STATUS'; partial: Partial<AgentStatus> }
  | { type: 'SET_PROGRESS'; progress: DiscussionProgress | null };

// ===== State =====
const initialState: AppState = {
  employees: [],
  teams: [],
  status: { backendOnline: false, demoRunning: false },
};

// ===== Reducer =====
function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'INIT':
      return a.state;

    case 'ADD_EMPLOYEE': {
      const next = client.upsertEmployee(a.emp, s.employees);
      return { ...s, employees: next };
    }

    case 'UPDATE_EMPLOYEE': {
      const next = s.employees.map((e) =>
        e.id === a.id ? { ...e, ...a.partial } : e
      );
      client.saveEmployees(next);
      return { ...s, employees: next };
    }

    case 'REMOVE_EMPLOYEE': {
      const next = client.removeEmployee(a.id, s.employees);
      return { ...s, employees: next };
    }

    case 'ADD_TEAM': {
      const next = [...s.teams, a.team];
      client.saveTeams(next);
      return { ...s, teams: next };
    }

    case 'UPDATE_TEAM': {
      const next = s.teams.map((t) =>
        t.id === a.id ? { ...t, ...a.partial } : t
      );
      client.saveTeams(next);
      return { ...s, teams: next };
    }

    case 'REMOVE_TEAM': {
      const next = s.teams.filter((t) => t.id !== a.id);
      client.saveTeams(next);
      return { ...s, teams: next };
    }

    case 'APPEND_CHAT': {
      client.appendChat(a.teamId, a.msgs);
      const next = s.teams.map((t) =>
        t.id === a.teamId ? { ...t, chatMessages: [...(t.chatMessages || []), ...a.msgs] } : t
      );
      return { ...s, teams: next };
    }

    case 'ADD_TASK': {
      const task = a.task;
      const next = s.teams.map((t) =>
        t.id === a.teamId ? { ...t, tasks: [...(t.tasks || []), task] } : t
      );
      client.saveTeams(next);
      // 同时插入任务卡消息
      const taskMsg: ChatMessage = {
        id: `msg-task-${Date.now()}`,
        authorId: 'emp-me',
        roleId: 'human',
        content: `[新任务] ${task.title}`,
        mentions: [],
        timestamp: Date.now(),
        kind: 'task',
        taskRef: task.id,
      };
      client.appendChat(a.teamId, [taskMsg]);
      const withMsg = next.map((t) =>
        t.id === a.teamId ? { ...t, chatMessages: [...(t.chatMessages || []), taskMsg] } : t
      );
      return { ...s, teams: withMsg };
    }

    case 'ADVANCE_TASK': {
      const next = s.teams.map((t) => {
        if (t.id !== a.teamId) return t;
        const tasks = (t.tasks || []).map((tk) =>
          tk.id === a.taskId ? { ...tk, lane: a.lane } : tk
        );
        const updated = { ...t, tasks };
        client.saveTeams([updated]);
        return updated;
      });
      return { ...s, teams: next };
    }

    case 'CLAIM_TASK': {
      const next = s.teams.map((t) => {
        if (t.id !== a.teamId) return t;
        const tasks = (t.tasks || []).map((tk) =>
          tk.id === a.taskId
            ? { ...tk, claimedBy: a.claimerId, assigneeId: a.claimerId, lane: (tk.lane as TaskLane) === 'PLANNING' ? 'CODING' as TaskLane : tk.lane }
            : tk
        );
        const updated = { ...t, tasks };
        client.saveTeams([updated]);
        return updated;
      });
      // 更新员工 currentTask
      const empNext = s.employees.map((e) => {
        if (e.id === a.claimerId) return { ...e, isWorking: true, currentTask: '' };
        return e;
      });
      client.saveEmployees(empNext);
      return { ...s, teams: next, employees: empNext };
    }

    case 'SET_STATUS':
      return { ...s, status: { ...s.status, ...a.partial } };

    case 'SET_PROGRESS':
      return { ...s, status: { ...s.status, progress: a.progress ?? undefined } };

    default:
      return s;
  }
}

// ===== Context =====
interface StoreCtx {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  // 便捷方法
  sendMessage: (teamId: string, authorId: string, roleId: RoleId, content: string, mentions?: string[], attachments?: import('./data/hermesClient').Attachment[], skillRefs?: import('./types').SkillReference[]) => void;
  startTeamDemo: (teamId: string) => void;
  resetDemo: () => void;
  addEmployee: (name: string, title: string, role: OpcRoleId, avatar: string, avatarKind: 'preset' | 'custom', statusColor?: string, prompt?: string) => void;
  createTeam: (name: string, icon: string, memberIds: string[]) => void;
  openTeamChat: (teamId: string) => void;
  openDmChat: (empId: string) => void;
  openAssistantChat: () => void;
  advanceTask: (teamId: string, taskId: string, lane: TaskLane) => void;
  claimTask: (teamId: string, taskId: string, claimerId: string) => void;
  publishTask: (teamId: string, title: string, description?: string, acceptance?: string) => void;
  triggerDiscussion: (teamId: string, opts?: { task?: TeamTask; userText?: string; extraSystemContext?: string; attachments?: import('./data/hermesClient').Attachment[]; participantPlan?: import('./types').DiscussionParticipantPlan[]; triggerMessageId?: string; discussionId?: string; forcedMemberIds?: string[]; maxRounds?: number }) => void;
}

const StoreContext = createContext<StoreCtx | null>(null);

// INIT 是各窗口自己的初始化加载，不应跨窗口广播。
const SKIP_BROADCAST = new Set<Action['type']>(['INIT']);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, initialState);

  // 标记当前是否正在应用「来自其他窗口」的广播，避免回环广播
  const applyingRemote = React.useRef(false);

  // 包装后的 dispatch：本地执行 + 向其他窗口广播
  const dispatch = React.useCallback((action: Action) => {
    rawDispatch(action);
    if (!SKIP_BROADCAST.has(action.type)) {
      sendBus(BUS_CHANNELS.STORE_ACTION, action);
    }
  }, []);

  // 接收其他窗口广播来的 action，直接走 rawDispatch（不二次广播）
  useEffect(() => {
    const off = onBus(BUS_CHANNELS.STORE_ACTION, (action) => {
      applyingRemote.current = true;
      try {
        rawDispatch(action as Action);
      } finally {
        applyingRemote.current = false;
      }
    });
    return off;
  }, []);

  // 初始化
  useEffect(() => {
    const appState = client.fetchInitial();
    dispatch({ type: 'INIT', state: appState });
    // 后端探测
    client.checkBackend().then((online) => {
      dispatch({ type: 'SET_STATUS', partial: { backendOnline: online } });
    });
  }, []);

  const sendMessage = (
    teamId: string,
    authorId: string,
    roleId: RoleId,
    content: string,
    mentions: string[] = [],
    attachments?: import('./data/hermesClient').Attachment[],
    skillRefs?: import('./types').SkillReference[]
  ) => {
    const msg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      authorId,
      roleId,
      content,
      mentions,
      timestamp: Date.now(),
      kind: 'text',
      attachments,
      skillRefs,
    };
    dispatch({ type: 'APPEND_CHAT', teamId, msgs: [msg] });
    if (roleId === 'human') {
      enqueueAutoDiscussion(teamId, msg.id, content, mentions, attachments);
    }
  };

  const startTeamDemo = (teamId: string) => {
    const team = state.teams.find((t) => t.id === teamId);
    if (!team) return;

    // 选定/新建一个演示任务，让推进联动可见
    let demoTaskId = (team.tasks ?? []).find((t) => t.lane !== 'DONE')?.id;
    if (!demoTaskId) {
      const t: TeamTask = { id: `task-demo-${Date.now()}`, title: '演示：协作完成一项新需求', lane: 'PLANNING' };
      dispatch({ type: 'ADD_TASK', teamId, task: t });
      demoTaskId = t.id;
    }

    dispatch({
      type: 'SET_STATUS',
      partial: { demoRunning: true, activeDemoTeamId: teamId },
    });

    // 把员工标记为工作中
    for (const mid of team.memberIds) {
      dispatch({
        type: 'UPDATE_EMPLOYEE',
        id: mid,
        partial: { isWorking: true },
      });
    }

    const handlers: ScriptHandlers = {
      onStart() {},
      onMessage(roleId, text, mentions) {
        const emp = state.employees.find(
          (e) => e.role === roleId && team.memberIds.includes(e.id)
        );
        const authorId = emp?.id ?? `emp-${roleId}`;
        const mentionIds = (mentions ?? [])
          .map((r) => {
            const m = state.employees.find(
              (e) => e.role === r && team.memberIds.includes(e.id)
            );
            return m?.id ?? '';
          })
          .filter(Boolean);
        const msg: ChatMessage = {
          id: `msg-demo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          authorId,
          roleId,
          content: text,
          mentions: mentionIds,
          timestamp: Date.now(),
          kind: 'text',
        };
        dispatch({ type: 'APPEND_CHAT', teamId, msgs: [msg] });
      },
      onTaskUpdate(taskId, lane) {
        dispatch({ type: 'ADVANCE_TASK', teamId, taskId, lane });
      },
      onDone() {
        dispatch({ type: 'SET_STATUS', partial: { demoRunning: false, activeDemoTeamId: undefined } });
        for (const mid of team.memberIds) {
          dispatch({
            type: 'UPDATE_EMPLOYEE',
            id: mid,
            partial: { isWorking: false },
          });
        }
      },
    };

    runScript(PROACTIVE_SCRIPT, handlers, demoTaskId).catch(() => {});
  };

  const resetDemo = () => {
    cancelScript();
    dispatch({ type: 'SET_STATUS', partial: { demoRunning: false, activeDemoTeamId: undefined } });
    for (const e of state.employees) {
      dispatch({ type: 'UPDATE_EMPLOYEE', id: e.id, partial: { isWorking: false, currentTask: undefined } });
    }
  };

  const addEmployee = (
    name: string,
    title: string,
    role: OpcRoleId,
    avatar: string,
    avatarKind: 'preset' | 'custom',
    statusColor?: string,
    prompt?: string
  ) => {
    const newEmp: Employee = {
      id: `emp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      title,
      role,
      avatar,
      avatarKind,
      statusColor: statusColor ?? (ROLE_SCARF[role] ?? '#64748b'),
      stationIndex: findFreeStation(state.employees),
      prompt,
      isOnline: true,
      isWorking: false,
    };
    console.log('[addEmployee] 新员工:', newEmp, '当前员工数:', state.employees.length);
    dispatch({ type: 'ADD_EMPLOYEE', emp: newEmp });
  };

  const createTeam = (name: string, icon: string, memberIds: string[]) => {
    const team: Team = {
      id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      icon,
      memberIds,
      chatMessages: [
        {
          id: `msg-welcome-${Date.now()}`,
          authorId: 'emp-me',
          roleId: 'human',
          content: `🎉 团队「${name}」已创建！共 ${memberIds.length} 名成员。`,
          mentions: [],
          timestamp: Date.now(),
          kind: 'text',
        },
      ],
      tasks: [],
    };
    dispatch({ type: 'ADD_TEAM', team });

    // 更新成员的 currentTeamId
    for (const mid of memberIds) {
      dispatch({ type: 'UPDATE_EMPLOYEE', id: mid, partial: { currentTeamId: team.id } });
    }
  };

  const openChatWindow = (type: 'team-chat' | 'dm-chat' | 'assistant-chat', refId = '') => {
    const openBrowserWindow = () => {
      const query = new URLSearchParams({ type });
      if (refId) query.set('id', refId);
      const url = `${location.origin}${location.pathname}#chat?${query.toString()}`;
      window.open(url, '_blank', 'width=560,height=700,resizable=yes,scrollbars=no');
    };

    if (!window.electronAPI?.openChat) {
      openBrowserWindow();
      return;
    }

    void window.electronAPI.openChat({ type, refId }).then((result) => {
      if (result.ok) return;
      console.error('[openChat] 打开聊天窗口失败:', result.error ?? type);
      openBrowserWindow();
    }).catch((error) => {
      console.error('[openChat] 打开聊天窗口失败:', error);
      openBrowserWindow();
    });
  };

  const openTeamChat = (teamId: string) => {
    if (!state.teams.some((team) => team.id === teamId)) return;
    openChatWindow('team-chat', teamId);
  };

  const openDmChat = (empId: string) => {
    if (!state.employees.some((employee) => employee.id === empId)) return;
    openChatWindow('dm-chat', empId);
  };

  const openAssistantChat = () => openChatWindow('assistant-chat');

  const advanceTask = (teamId: string, taskId: string, lane: TaskLane) =>
    dispatch({ type: 'ADVANCE_TASK', teamId, taskId, lane });

  const claimTask = (teamId: string, taskId: string, claimerId: string) =>
    dispatch({ type: 'CLAIM_TASK', teamId, taskId, claimerId });

  const publishTask = (teamId: string, title: string, description?: string, acceptance?: string) => {
    const task: TeamTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      lane: 'PLANNING',
      description,
      acceptance,
    };
    dispatch({ type: 'ADD_TASK', teamId, task });
    const settings = client.loadSettings();
    const autoDiscussEnabled = settings.autoDiscussMode === undefined
      ? !!settings.autoDiscuss
      : settings.autoDiscussMode !== 'off';
    if (autoDiscussEnabled) {
      enqueueDiscussion(teamId, { task, userText: `新任务：${title}${description ? `\n${description}` : ''}`, triggerMessageId: task.id, discussionId: `discussion-${task.id}`, maxRounds: settings.autoDiscussMaxRounds });
    }
  };

  // 团队 AI 讨论：成员依次用真模型发言，联动推进任务
  type DiscussionOpts = Parameters<typeof runTeamDiscussion>[2];
  const discussingRef = React.useRef<Set<string>>(new Set());
  const schedulerRef = React.useRef(new Map<string, {
    timer?: ReturnType<typeof setTimeout>;
    running: boolean;
    queued?: DiscussionOpts;
    scheduled?: DiscussionOpts;
    lastStartedAt?: number;
    keys: Set<string>;
  }>());
  const lastAutoTriggerRef = React.useRef<Map<string, { dedupeKey: string; triggeredAt: number }>>(new Map());
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const supervisorBusyRef = React.useRef(new Set<string>());

  const extractMentionedEmployeeIds = (text: string, team: Team, employees: Employee[]): string[] => {
    const names = new Map(
      team.memberIds
        .map((id) => employees.find((employee) => employee.id === id))
        .filter((employee): employee is Employee => !!employee)
        .map((employee) => [employee.name, employee.id]),
    );
    // Assistant replies commonly use "@姓名：任务". Punctuation must not become
    // part of the member name, otherwise the delegation cannot be scheduled.
    return [...text.matchAll(/@([^@\s，。！？,.!?：:；;、]+)/g)]
      .map((match) => names.get(match[1]))
      .filter((id): id is string => !!id);
  };

  const runDiscussion = (teamId: string, opts?: DiscussionOpts): boolean => {
    if (discussingRef.current.has(teamId)) return false;
    const team = stateRef.current.teams.find((t) => t.id === teamId);
    if (!team) return false;
    discussingRef.current.add(teamId);

    // 预计算总步数：实际参与讨论的角色数
    const roleCount = ['pm', 'planner', 'coder', 'checker'].filter(
      (r) => team.memberIds.some((id) => stateRef.current.employees.find((e) => e.id === id)?.role === r)
    ).length;
    const totalSteps = opts?.task ? roleCount + 1 : roleCount;
    const startedAt = Date.now();
    const estimatedMs = totalSteps * 4000; // 每步预估 4s（API 调用）

    const updateProgress = (step: number, empId?: string, empName?: string, role?: OpcRoleId, model?: string) => {
      const s = client.loadSettings();
      const progress: DiscussionProgress = {
        teamId,
        teamName: team.name,
        step,
        totalSteps,
        currentEmpId: empId,
        currentEmpName: empName,
        currentRole: role,
        model: model ?? s.model ?? undefined,
        scene: opts?.task ? 'task' : 'discussion',
        startedAt,
        estimatedMs,
        lastUpdate: Date.now(),
      };
      dispatch({ type: 'SET_PROGRESS', progress });
    };
    updateProgress(0, undefined, undefined, undefined, undefined);

    dispatch({ type: 'SET_STATUS', partial: { demoRunning: true, activeDemoTeamId: teamId } });

    let stepCounter = 0;
    Promise.resolve().then(() => runTeamDiscussion(
      team,
      stateRef.current.employees,
      opts ?? {},
      {
        onMessage(emp, content, mentions, tokens, discussionRound, inReplyToMessageId) {
          stepCounter += 1;
          const s = client.loadSettings();
          updateProgress(stepCounter, emp.id, emp.name, emp.role, s.model ?? undefined);
          const msg: ChatMessage = {
            id: `msg-ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            authorId: emp.id,
            roleId: emp.role,
            content,
            mentions,
            timestamp: Date.now(),
            kind: 'text',
            tokens,
            discussionId: opts?.discussionId,
            discussionRound,
            triggeredBy: opts?.task ? 'task' : 'message',
            inReplyToMessageId,
          };
          dispatch({ type: 'APPEND_CHAT', teamId, msgs: [msg] });
        },
        onTaskAdvance(taskId, lane) {
          dispatch({ type: 'ADVANCE_TASK', teamId, taskId, lane });
        },
        onToolCall(emp, toolName, toolArgs, result) {
          // ⚠️ onToolCall 在工具执行前回调 arg=调用参数，执行后回调 arg=执行中。工具执行由 agentLoop 异步完成，结果在后续 onMessage 中体现。
          const toolMsg = `🔧 **${emp.name}** 调用工具 **\`${toolName}\`**(${toolArgs || ''})\n⟳ ${result}`;
          dispatch({
            type: 'APPEND_CHAT', teamId,
            msgs: [{
              id: `msg-tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              authorId: emp.id, roleId: emp.role,
              content: toolMsg, mentions: [], timestamp: Date.now(),
              kind: 'text',
            }],
          });
        },
        onStatus() {},
        onDone() {
          // 清掉进度
          dispatch({ type: 'SET_PROGRESS', progress: null });
          dispatch({ type: 'SET_STATUS', partial: { demoRunning: false, activeDemoTeamId: undefined } });
          // 落盘产出物：取最新 state（讨论后消息已追加）
          try {
            const cur = stateRef.current;
            const liveTeam = cur.teams.find((t) => t.id === teamId);
            if (liveTeam) {
              const out = buildDiscussionOutput(
                liveTeam,
                cur.employees,
                opts?.task ? { kind: 'task', task: opts.task, userText: opts.userText } : { kind: 'user', userText: opts?.userText ?? '' }
              );
              addOutput(out);
              if (opts?.task) {
                const taskOut = buildTaskOutput(liveTeam, cur.employees, opts.task);
                addOutput(taskOut);
              }
            }
          } catch (e) {
            console.warn('[store] failed to save outputs:', e);
          }
        },
      }
    )).finally(() => {
      discussingRef.current.delete(teamId);
      const scheduler = schedulerRef.current.get(teamId);
      if (scheduler) {
        scheduler.running = false;
        const queued = scheduler.queued;
        scheduler.queued = undefined;
        if (queued) {
          scheduler.lastStartedAt = Date.now();
          scheduler.running = runDiscussion(teamId, queued);
        }
      }
      dispatch({ type: 'SET_PROGRESS', progress: null });
      dispatch({ type: 'SET_STATUS', partial: { demoRunning: false, activeDemoTeamId: undefined } });
    });
    return true;
  };

  const enqueueDiscussion = (teamId: string, opts: DiscussionOpts, delay = 0) => {
    const scheduler = schedulerRef.current.get(teamId) ?? { running: false, keys: new Set<string>() };
    schedulerRef.current.set(teamId, scheduler);
    const key = opts.discussionId ?? opts.triggerMessageId ?? opts.task?.id ?? String(Date.now());
    if (scheduler.keys.has(key)) return;
    scheduler.keys.add(key);
    if (scheduler.running || discussingRef.current.has(teamId)) {
      scheduler.queued = scheduler.queued ? {
        ...opts,
        userText: [scheduler.queued.userText, opts.userText].filter(Boolean).join('\n'),
        attachments: [...(scheduler.queued.attachments ?? []), ...(opts.attachments ?? [])],
        participantPlan: [...(scheduler.queued.participantPlan ?? []), ...(opts.participantPlan ?? [])].filter((plan, index, plans) => plans.findIndex((item) => item.memberId === plan.memberId) === index),
        forcedMemberIds: [...new Set([...(scheduler.queued.forcedMemberIds ?? []), ...(opts.forcedMemberIds ?? [])])],
      } : opts;
      return;
    }
    if (scheduler.timer) clearTimeout(scheduler.timer);
    scheduler.scheduled = scheduler.scheduled ? {
      ...opts,
      userText: [scheduler.scheduled.userText, opts.userText].filter(Boolean).join('\n'),
      participantPlan: [...(scheduler.scheduled.participantPlan ?? []), ...(opts.participantPlan ?? [])].filter((plan, index, plans) => plans.findIndex((item) => item.memberId === plan.memberId) === index),
      attachments: [...(scheduler.scheduled.attachments ?? []), ...(opts.attachments ?? [])],
      forcedMemberIds: [...new Set([...(scheduler.scheduled.forcedMemberIds ?? []), ...(opts.forcedMemberIds ?? [])])],
    } : opts;
    scheduler.timer = setTimeout(() => {
      scheduler.timer = undefined;
      const scheduled = scheduler.scheduled;
      scheduler.scheduled = undefined;
      if (!scheduled) return;
      scheduler.lastStartedAt = Date.now();
      scheduler.running = runDiscussion(teamId, scheduled);
    }, delay);
  };

  const enqueueAssistantSupervisor = async (team: Team, content: string): Promise<string | undefined> => {
    if (supervisorBusyRef.current.has(team.id)) return undefined;
    supervisorBusyRef.current.add(team.id);
    try {
      const assistantModel = client.getAssistantModel();
      const configuredPrompt = localStorage.getItem('hermes_office_assistant_system_prompt')?.trim();
      const userContext = client.buildUserContext();
      const turns: client.ChatTurn[] = [
        {
          role: 'system',
          content: `${configuredPrompt ? `## 助理配置\n${configuredPrompt}\n\n` : ''}${userContext ? `${userContext}\n` : ''}你是私人办公会所的监工助理，负责监督团队进度、调度成员和理解老板的工作习惯。你现在被老板@，必须先给出简短判断，再根据需求分发给团队成员。需要成员处理时，必须使用他们的准确姓名格式@姓名进行点名；不需要某成员时不要点名。团队成员：${team.memberIds.map((id) => stateRef.current.employees.find((employee) => employee.id === id)?.name).filter(Boolean).join('、')}。回复要简洁、直接，指出当前进展、风险和下一步行动；不要代替团队成员长篇讨论。`,
        },
        ...team.chatMessages.slice(-12).map((message) => ({
          role: message.roleId === 'human' ? 'user' as const : 'assistant' as const,
          content: `${stateRef.current.employees.find((employee) => employee.id === message.authorId)?.name ?? '团队成员'}: ${message.content}`,
        })),
        { role: 'user', content: `老板@你说：${content}` },
      ];
      if (!client.resolveApiBase(assistantModel)) return undefined;
      const result = await client.chatCompletion(turns, 'assistant-supervisor', `监工/${team.name}`, undefined, assistantModel);
      const reply = result.content?.trim();
      if (!reply) return undefined;
      dispatch({
        type: 'APPEND_CHAT',
        teamId: team.id,
        msgs: [{
          id: `msg-supervisor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          authorId: 'assistant',
          roleId: 'custom',
          content: reply,
          mentions: [],
          timestamp: Date.now(),
          kind: 'text',
          tokens: result.usage.totalTokens,
        }],
      });
      client.extractUserInsights(`老板：${content}\n监工回复：${reply}`, `团队监工-${team.name}`).catch(() => {});
      return reply;
    } catch (error) {
      console.warn('[supervisor] reply failed:', error);
      return undefined;
    } finally {
      supervisorBusyRef.current.delete(team.id);
    }
  };

  const enqueueAutoDiscussion = (teamId: string, messageId: string, content: string, mentions: string[], attachments?: import('./data/hermesClient').Attachment[]) => {
    const current = stateRef.current;
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return;
    void (async () => {
      const supervisorReply = await enqueueAssistantSupervisor(team, content);
      const mentionedBySupervisor = supervisorReply
        ? extractMentionedEmployeeIds(supervisorReply, team, current.employees)
        : [];
      const directMentions = mentions.filter((id) => team.memberIds.includes(id));
      const requestedMemberIds = [...new Set([...directMentions, ...mentionedBySupervisor])];
      const discussionText = [content, supervisorReply].filter(Boolean).join('\n\n');
      const settings = client.loadSettings();
      const input: DiscussionTriggerInput = {
        teamId, messageId, userText: discussionText, mentions: requestedMemberIds,
        hasAttachments: !!attachments?.length, recentMessages: team.chatMessages.slice(-12),
        activeTaskCount: (team.tasks ?? []).filter((task) => task.lane !== 'DONE').length,
        manual: false, now: Date.now(),
      };
      const decision = evaluateDiscussionTrigger(input, settings, team.memberIds, lastAutoTriggerRef.current.get(teamId));
      if (!decision.shouldStart) return;
      lastAutoTriggerRef.current.set(teamId, { dedupeKey: decision.dedupeKey, triggeredAt: Date.now() });
      enqueueDiscussion(teamId, {
        userText: discussionText,
        attachments,
        participantPlan: buildParticipantPlan(team.memberIds, current.employees, discussionText, team.tasks ?? [], decision.forcedMemberIds),
        triggerMessageId: messageId,
        discussionId: `discussion-${messageId}`,
        maxRounds: settings.autoDiscussMaxRounds,
        forcedMemberIds: decision.forcedMemberIds,
      }, 400);
    })();
  };

  const triggerDiscussion = (teamId: string, opts?: DiscussionOpts) => {
    const current = stateRef.current;
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return;
    const settings = client.loadSettings();
    const triggerText = opts?.userText?.trim() || '请团队协作讨论当前事项';
    const input: DiscussionTriggerInput = {
      teamId, messageId: opts?.triggerMessageId ?? `manual-${Date.now()}`, userText: triggerText,
      mentions: [], hasAttachments: !!opts?.attachments?.length, recentMessages: team.chatMessages.slice(-12),
      activeTaskCount: (team.tasks ?? []).filter((task) => task.lane !== 'DONE').length,
      manual: true, now: Date.now(),
    };
    const decision = evaluateDiscussionTrigger(input, settings, team.memberIds);
    if (!decision.shouldStart) return;
    const discussionId = opts?.discussionId ?? `discussion-${opts?.triggerMessageId ?? opts?.task?.id ?? Date.now()}`;
    enqueueDiscussion(teamId, {
      ...opts,
      discussionId,
      participantPlan: opts?.participantPlan ?? buildParticipantPlan(team.memberIds, current.employees, opts?.userText ?? '', team.tasks ?? [], decision.forcedMemberIds),
      forcedMemberIds: opts?.forcedMemberIds ?? decision.forcedMemberIds,
    });
  };

  return (
    <StoreContext.Provider
      value={{
        state,
        dispatch,
        sendMessage,
        startTeamDemo,
        resetDemo,
        addEmployee,
        createTeam,
        openTeamChat,
        openDmChat,
        openAssistantChat,
        advanceTask,
        claimTask,
        publishTask,
        triggerDiscussion,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): StoreCtx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
