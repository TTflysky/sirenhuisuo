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
} from './types';
import { ROLE_SCARF } from './types';
import * as client from './data/hermesClient';
import { runScript, cancelDemo as cancelScript, type ScriptHandlers } from './engine/simulationEngine';
import { PROACTIVE_SCRIPT } from './engine/proactiveScript';
import { runTeamDiscussion } from './engine/teamDiscussion';
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
  sendMessage: (teamId: string, authorId: string, roleId: RoleId, content: string, mentions?: string[], attachments?: import('./data/hermesClient').Attachment[]) => void;
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
  triggerDiscussion: (teamId: string, opts?: { task?: TeamTask; userText?: string; attachments?: import('./data/hermesClient').Attachment[] }) => void;
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
    attachments?: import('./data/hermesClient').Attachment[]
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
    };
    dispatch({ type: 'APPEND_CHAT', teamId, msgs: [msg] });
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
    // 发任务后，若开启自动讨论则触发团队 AI 讨论并推进该任务
    if (client.loadSettings().autoDiscuss) {
      setTimeout(() => triggerDiscussion(teamId, { task }), 400);
    }
  };

  // 团队 AI 讨论：成员依次用真模型发言，联动推进任务
  const discussingRef = React.useRef<Set<string>>(new Set());
  const stateRef = React.useRef(state);
  stateRef.current = state;

  const triggerDiscussion = (teamId: string, opts?: { task?: TeamTask; userText?: string }) => {
    if (discussingRef.current.has(teamId)) return; // 防止并发重复触发
    const team = state.teams.find((t) => t.id === teamId);
    if (!team) return;
    discussingRef.current.add(teamId);

    // 预计算总步数：实际参与讨论的角色数
    const roleCount = ['pm', 'planner', 'coder', 'checker'].filter(
      (r) => team.memberIds.some((id) => state.employees.find((e) => e.id === id)?.role === r)
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
    runTeamDiscussion(
      team,
      state.employees,
      opts ?? {},
      {
        onMessage(emp, content, mentions, tokens) {
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
          discussingRef.current.delete(teamId);
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
    ).catch(() => {
      discussingRef.current.delete(teamId);
      dispatch({ type: 'SET_PROGRESS', progress: null });
      dispatch({ type: 'SET_STATUS', partial: { demoRunning: false, activeDemoTeamId: undefined } });
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
