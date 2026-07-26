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
  Project,
  TaskRun,
} from './types';
import { ROLE_SCARF } from './types';
import * as client from './data/hermesClient';
import { runScript, cancelDemo as cancelScript, type ScriptHandlers } from './engine/simulationEngine';
import { PROACTIVE_SCRIPT } from './engine/proactiveScript';
import { runTeamDiscussion } from './engine/teamDiscussion';
import { evaluateDiscussionTrigger } from './engine/discussionTrigger';
import { findFreeStation } from './data/hermesClient';
import { sendBus, onBus, BUS_CHANNELS } from './ipcBus';
import { createTaskRun, saveTaskRuns, updateTaskRun } from './data/taskRuns';
import { buildTaskPlan, matchProjectMembers, matchTeamMembers } from './engine/taskMatcher';
import { buildSkillContext, listSkills, matchSkills } from './data/skills';
import { attachmentWorkspaceContext } from './utils/attachments';
import { BEGINNER_RESPONSE_GUIDE } from './data/assistantPresentation';

// ===== Action =====
type Action =
  | { type: 'INIT'; state: AppState }
  | { type: 'ADD_EMPLOYEE'; emp: Employee }
  | { type: 'UPDATE_EMPLOYEE'; id: string; partial: Partial<Employee> }
  | { type: 'REMOVE_EMPLOYEE'; id: string }
  | { type: 'ADD_TEAM'; team: Team }
  | { type: 'UPDATE_TEAM'; id: string; partial: Partial<Team> }
  | { type: 'REMOVE_TEAM'; id: string }
  | { type: 'CREATE_PROJECT'; project: Project }
  | { type: 'UPDATE_PROJECT'; id: string; partial: Partial<Project> }
  | { type: 'APPEND_CHAT'; teamId: string; msgs: ChatMessage[] }
  | { type: 'ADD_TASK'; teamId: string; task: TeamTask }
  | { type: 'ADVANCE_TASK'; teamId: string; taskId: string; lane: TaskLane }
  | { type: 'CLAIM_TASK'; teamId: string; taskId: string; claimerId: string }
  | { type: 'SET_STATUS'; partial: Partial<AgentStatus> }
  | { type: 'SET_PROGRESS'; progress: DiscussionProgress | null }
  | { type: 'CREATE_TASK_RUN'; run: TaskRun }
  | { type: 'UPDATE_TASK_RUN'; run: TaskRun }
  | { type: 'REMOVE_TASK_RUN'; runId: string }
  | { type: 'CLEAR_TEAM_EXECUTION'; teamId: string };

// ===== State =====
const initialState: AppState = {
  employees: [],
  teams: [],
  projects: [],
  taskRuns: [],
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
      const teams = s.teams.map((team) => ({
        ...team,
        memberIds: team.memberIds.filter((memberId) => memberId !== a.id),
      }));
      client.saveTeams(teams);
      return { ...s, employees: next, teams };
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

    case 'CREATE_PROJECT': {
      const projects = [...s.projects, a.project].slice(-80);
      client.saveProjects(projects);
      return { ...s, projects };
    }

    case 'UPDATE_PROJECT': {
      const projects = s.projects.map((project) => project.id === a.id
        ? { ...project, ...a.partial, updatedAt: Date.now() }
        : project);
      client.saveProjects(projects);
      return { ...s, projects };
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

    case 'CREATE_TASK_RUN': {
      const taskRuns = [...s.taskRuns, a.run].slice(-120);
      saveTaskRuns(taskRuns);
      return { ...s, taskRuns };
    }

    case 'UPDATE_TASK_RUN': {
      const taskRuns = s.taskRuns.map((run) => run.id === a.run.id ? a.run : run);
      saveTaskRuns(taskRuns);
      const project = a.run.projectId && (a.run.status === 'completed' || a.run.status === 'failed')
        ? s.projects.find((item) => item.id === a.run.projectId)
        : undefined;
      const projects = project
        ? s.projects.map((item) => item.id === project.id ? { ...item, status: (a.run.status === 'completed' ? 'completed' : 'failed') as Project['status'], updatedAt: Date.now() } : item)
        : s.projects;
      if (project) client.saveProjects(projects);
      return { ...s, taskRuns, projects };
    }

    case 'REMOVE_TASK_RUN': {
      const target = s.taskRuns.find((run) => run.id === a.runId);
      const taskRuns = s.taskRuns.filter((run) => run.id !== a.runId);
      const teams = target ? s.teams.map((team) => {
        if (team.id !== target.teamId) return team;
        const chatMessages = team.chatMessages.filter((message) => !(message.kind === 'execution' && message.discussionId === a.runId));
        client.replaceChat(team.id, chatMessages);
        return { ...team, chatMessages };
      }) : s.teams;
      saveTaskRuns(taskRuns);
      return { ...s, taskRuns, teams };
    }

    case 'CLEAR_TEAM_EXECUTION': {
      const teams = s.teams.map((team) => {
        if (team.id !== a.teamId) return team;
        const chatMessages = team.chatMessages.filter((message) => message.kind !== 'execution');
        client.replaceChat(team.id, chatMessages);
        return { ...team, chatMessages };
      });
      return { ...s, teams };
    }

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
  addEmployee: (name: string, title: string, role: OpcRoleId, avatar: string, avatarKind: 'preset' | 'custom', statusColor?: string, prompt?: string, avatarFrame?: import('./types').AvatarFrameConfig) => void;
  createTeam: (name: string, icon: string, memberIds: string[]) => void;
  createProjectDraft: (input: { title: string; request: string; steps?: string[]; expectedOutputs?: string[] }) => void;
  approveProject: (projectId: string) => void;
  archiveProject: (projectId: string) => void;
  openTeamChat: (teamId: string) => void;
  openDmChat: (empId: string) => void;
  openAssistantChat: () => void;
  advanceTask: (teamId: string, taskId: string, lane: TaskLane) => void;
  claimTask: (teamId: string, taskId: string, claimerId: string) => void;
  publishTask: (teamId: string, title: string, description?: string, acceptance?: string) => void;
  triggerDiscussion: (teamId: string, opts?: { task?: TeamTask; userText?: string; extraSystemContext?: string; attachments?: import('./data/hermesClient').Attachment[]; participantPlan?: import('./types').DiscussionParticipantPlan[]; triggerMessageId?: string; discussionId?: string; forcedMemberIds?: string[]; maxRounds?: number }) => void;
  pauseTaskRun: (runId: string) => void;
  resumeTaskRun: (runId: string) => void;
  closeTaskRun: (runId: string) => void;
  clearTeamExecution: (teamId: string) => void;
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
  }, [dispatch]);

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
      const executionContent = `${content}${attachmentWorkspaceContext(attachments ?? [])}`;
      enqueueAutoDiscussion(teamId, msg.id, executionContent, mentions, attachments, skillRefs);
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
    prompt?: string,
    avatarFrame?: import('./types').AvatarFrameConfig
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
      avatarFrame,
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

  const createProjectDraft = (input: { title: string; request: string; steps?: string[]; expectedOutputs?: string[] }) => {
    const now = Date.now();
    const project: Project = {
      id: `project-${now}-${Math.random().toString(36).slice(2, 7)}`,
      title: input.title.trim() || '未命名项目',
      request: input.request.trim(),
      steps: input.steps?.filter(Boolean) ?? [],
      expectedOutputs: input.expectedOutputs?.filter(Boolean) ?? [],
      members: matchProjectMembers(stateRef.current.employees, input.request),
      status: 'awaiting_approval', createdAt: now, updatedAt: now,
    };
    dispatch({ type: 'CREATE_PROJECT', project });
  };

  const approveProject = (projectId: string) => {
    const project = stateRef.current.projects.find((item) => item.id === projectId);
    if (!project || project.status !== 'awaiting_approval') return;
    const memberIds = project.members.map((member) => member.employeeId);
    if (!memberIds.length) return;
    const team: Team = {
      id: `team-project-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: project.title,
      icon: '📌', memberIds, projectId,
      chatMessages: [{ id: `msg-project-${Date.now()}`, authorId: 'assistant', roleId: 'custom',
        content: `项目已批准。驴狗蛋助手将按既定步骤调度成员，最终产出须经审查后交付。`, mentions: memberIds, timestamp: Date.now(), kind: 'text' }],
      tasks: [],
    };
    dispatch({ type: 'ADD_TEAM', team });
    dispatch({ type: 'UPDATE_PROJECT', id: projectId, partial: { status: 'running', teamId: team.id } });
    memberIds.forEach((id) => dispatch({ type: 'UPDATE_EMPLOYEE', id, partial: { currentTeamId: team.id } }));
    setTimeout(() => { void startTaskRun(team.id, project.request, memberIds); }, 0);
  };

  const archiveProject = (projectId: string) => {
    const project = stateRef.current.projects.find((item) => item.id === projectId);
    if (!project) return;
    dispatch({ type: 'UPDATE_PROJECT', id: projectId, partial: { status: 'archived' } });
    if (project.teamId) dispatch({ type: 'UPDATE_TEAM', id: project.teamId, partial: { archived: true } });
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
    steering?: string[];
    lastStartedAt?: number;
    keys: Set<string>;
  }>());
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const supervisorBusyRef = React.useRef(new Set<string>());
  const pausedRunIdsRef = React.useRef(new Set<string>());

  const isTeamControlRequest = (text: string): boolean => {
    const pause = /(?:暂停|停止|先停|停下|别做|不要继续).{0,12}(?:工作|任务|手上|当前|执行)|(?:工作|任务).{0,8}(?:暂停|停止)/u.test(text);
    const report = /(?:汇报|报告|报一下|说一下|告诉我).{0,12}(?:模型|配置|状态)|(?:模型|配置|状态).{0,12}(?:汇报|报告|报一下|说一下)|(?:你们|大家|各位|自己).{0,8}(?:用的|使用).{0,8}(?:什么|哪个).{0,4}模型/u.test(text);
    const rollCall = /报数|报个数|数数|在线情况/u.test(text);
    return pause || report || rollCall;
  };

  const employeeModelSummary = (employee: Employee): string => {
    const config = client.getEmployeeModel(employee);
    const source = client.usesCustomEmployeeModel(employee) ? '员工独立配置' : '继承全局默认';
    let host = config.apiHost?.trim() || '未配置';
    try { host = new URL(host).host; } catch {}
    return `${config.model || '未配置模型'}（${source}），服务商：${config.provider || '自定义'}，接口：${host}`;
  };

  const runDiscussion = (teamId: string, opts?: DiscussionOpts): boolean => {
    if (discussingRef.current.has(teamId)) return false;
    const team = stateRef.current.teams.find((t) => t.id === teamId);
    if (!team) return false;
    discussingRef.current.add(teamId);

    // Prefer the actual scheduled participants over generic role counts.
    const roleCount = ['pm', 'planner', 'coder', 'checker'].filter(
      (r) => team.memberIds.some((id) => stateRef.current.employees.find((e) => e.id === id)?.role === r)
    ).length;
    const scheduledMemberIds = [...new Set([
      ...(opts?.forcedMemberIds ?? []),
      ...(opts?.participantPlan ?? []).map((plan) => plan.memberId),
    ])];
    let totalSteps = Math.max(1, opts?.runSteps?.length || scheduledMemberIds.length || (opts?.task ? roleCount + 1 : roleCount));
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
    let liveRun = opts?.runId ? stateRef.current.taskRuns.find((item) => item.id === opts.runId) : undefined;
    const updateRun = (mutate: (run: TaskRun) => void) => {
      if (!liveRun) return;
      liveRun = updateTaskRun(liveRun, mutate);
      dispatch({ type: 'UPDATE_TASK_RUN', run: liveRun });
    };
    updateRun((run) => {
      run.status = 'running'; run.phase = 'executing'; run.lastError = undefined;
      run.preflight = (run.preflight ?? []).map((item) => item.label === '检查参与成员与模型'
        ? { ...item, status: 'passed', detail: '参与成员与模型配置已通过启动检查' }
        : item);
    });
    Promise.resolve().then(() => runTeamDiscussion(
      team,
      stateRef.current.employees,
      opts ?? {},
      {
        onMessage(emp, content, mentions, tokens, discussionRound, inReplyToMessageId, stepId) {
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
          dispatch({ type: 'UPDATE_EMPLOYEE', id: emp.id, partial: { isWorking: false } });
          updateRun((run) => {
            const step = run.steps.find((item) => item.id === stepId) ?? run.steps.find((item) => item.employeeId === emp.id && item.status === 'running');
            if (!step) return;
            step.status = /^⚠️|无法响应|执行失败/u.test(content) ? 'failed' : 'completed';
            step.completedAt = Date.now();
            if (step.status === 'failed') {
              step.lastError = content;
              run.phase = 'blocked';
              run.handoff = {
                ts: Date.now(),
                completed: run.steps.filter((item) => item.status === 'completed').map((item) => item.title),
                blocked: `${emp.name}：${content.slice(0, 240)}`,
                nextAction: '检查提示中的账号、模型或外部条件后点击继续执行。',
              };
            } else {
              const evidence = { ts: Date.now(), source: 'member' as const, summary: `${emp.name} 完成：${content.slice(0, 220)}`, verified: step.kind === 'review' };
              step.evidence = [...(step.evidence ?? []), evidence].slice(-12);
              run.evidence = [...(run.evidence ?? []), evidence].slice(-40);
            }
            step.events.push({ ts: Date.now(), type: step.status === 'failed' ? 'error' : 'result', detail: content.slice(0, 360) });
          });
        },
        onTaskAdvance(taskId, lane) {
          dispatch({ type: 'ADVANCE_TASK', teamId, taskId, lane });
        },
        onToolCall(emp, toolName, toolArgs, result, stepId) {
          // ⚠️ onToolCall 在工具执行前回调 arg=调用参数，执行后回调 arg=执行中。工具执行由 agentLoop 异步完成，结果在后续 onMessage 中体现。
          const toolMsg = `🔧 **${emp.name}** 调用工具 **\`${toolName}\`**(${toolArgs || ''})\n⟳ ${result}`;
          dispatch({
            type: 'APPEND_CHAT', teamId,
            msgs: [{
              id: `msg-tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              authorId: emp.id, roleId: emp.role,
              content: toolMsg, mentions: [], timestamp: Date.now(),
              kind: 'execution', discussionId: opts?.discussionId,
            }],
          });
          updateRun((run) => {
            const step = run.steps.find((item) => item.id === stepId) ?? run.steps.find((item) => item.employeeId === emp.id && item.status === 'running');
            if (step) {
              step.events.push({ ts: Date.now(), type: 'tool', detail: `${toolName} ${toolArgs}${result && result !== '🔄 执行中…' ? ` → ${result}` : ''}`.slice(0, 360) });
              if (result && result !== '🔄 执行中…') {
                const evidence = { ts: Date.now(), source: 'tool' as const, summary: `${toolName}：${result}`.slice(0, 260) };
                step.evidence = [...(step.evidence ?? []), evidence].slice(-12);
                run.evidence = [...(run.evidence ?? []), evidence].slice(-40);
              }
            }
          });
        },
        onStatus(statusText) {
          const emp = stateRef.current.employees.find((employee) => statusText.startsWith(employee.name));
          if (emp) {
            updateProgress(Math.min(totalSteps, stepCounter + 1), emp.id, emp.name, emp.role);
            dispatch({ type: 'UPDATE_EMPLOYEE', id: emp.id, partial: { isWorking: true } });
          }
        },
        onStepStart(stepId, emp) {
          updateProgress(Math.min(totalSteps, stepCounter + 1), emp.id, emp.name, emp.role, client.getEmployeeModel(emp).model);
          dispatch({ type: 'UPDATE_EMPLOYEE', id: emp.id, partial: { isWorking: true } });
          updateRun((run) => {
            const step = run.steps.find((item) => item.id === stepId);
            if (step) {
              step.status = 'running'; step.startedAt = Date.now(); step.attempts += 1;
              step.events.push({ ts: Date.now(), type: 'status', detail: `开始第 ${step.order} 步：${step.assignment}` });
            }
          });
        },
        onStepAdded(step) {
          totalSteps += 1;
          updateRun((run) => {
            if (run.steps.some((item) => item.id === step.id)) return;
            run.steps.push({ ...step, status: 'queued', attempts: 0, events: [{ ts: Date.now(), type: 'status', detail: '审查退回后新增步骤' }] });
            run.revisionCount = (run.revisionCount ?? 0) + (step.kind === 'revision' ? 1 : 0);
          });
        },
        onReviewDecision(stepId, approved, reason, responsibleEmployeeId) {
          updateRun((run) => {
            const step = run.steps.find((item) => item.id === stepId);
            if (!step) return;
            step.reviewDecision = approved ? 'pass' : 'reject';
            step.reviewReason = reason;
            step.responsibleEmployeeId = responsibleEmployeeId;
            step.events.push({ ts: Date.now(), type: approved ? 'result' : 'error', detail: approved ? '审查通过' : `审查退回：${reason ?? '未说明原因'}` });
          });
        },
        onRunFailed(error) {
          updateRun((run) => {
            run.status = 'failed'; run.phase = 'blocked'; run.lastError = error;
            run.handoff = {
              ts: Date.now(),
              completed: run.steps.filter((step) => step.status === 'completed').map((step) => step.title),
              blocked: error.slice(0, 320),
              nextAction: '处理阻塞提示后点击“继续执行”，太极会保留已经完成的步骤。',
            };
            const activeReview = [...run.steps].reverse().find((step) => step.kind === 'review' && step.reviewDecision === 'reject');
            if (activeReview) { activeReview.status = 'failed'; activeReview.lastError = error; }
          });
        },
        onDone() {
          // 清掉进度
          dispatch({ type: 'SET_PROGRESS', progress: null });
          dispatch({ type: 'SET_STATUS', partial: { demoRunning: false, activeDemoTeamId: undefined } });
          for (const memberId of team.memberIds) {
            dispatch({ type: 'UPDATE_EMPLOYEE', id: memberId, partial: { isWorking: false } });
          }
          updateRun((run) => {
            const paused = pausedRunIdsRef.current.has(run.id);
            const hasFailed = run.steps.some((step) => step.status === 'failed') || !!run.lastError;
            const hasUnfinished = run.steps.some((step) => step.status !== 'completed' && step.status !== 'failed');
            run.status = paused ? 'paused' : hasFailed || hasUnfinished ? 'failed' : 'completed';
            run.phase = paused ? 'blocked' : hasFailed || hasUnfinished ? 'blocked' : 'verifying';
            if (!paused && hasUnfinished) {
              run.lastError = '部分成员未完成执行，可点击继续执行重试。';
              run.steps.forEach((step) => {
                if (step.status === 'queued' || step.status === 'running') {
                  step.status = 'failed'; step.lastError = '执行未完成';
                  step.events.push({ ts: Date.now(), type: 'error', detail: '执行未完成，等待重试' });
                }
              });
            }
            if (paused) run.steps.forEach((step) => {
              if (step.status === 'running') { step.status = 'paused'; step.events.push({ ts: Date.now(), type: 'status', detail: '已暂停，等待继续' }); }
            });
            if (!paused && !hasFailed && !hasUnfinished) {
              run.phase = 'completed';
              run.preflight = (run.preflight ?? []).map((item) => item.label === '确认最终验收'
                ? { ...item, status: 'passed', detail: '所有任务步骤已完成并通过最终汇总' }
                : item);
            }
          });
        },
      }, {
        shouldStop: () => !!opts?.runId && pausedRunIdsRef.current.has(opts.runId),
        consumeSteeringMessages: () => {
          const scheduler = schedulerRef.current.get(teamId);
          return scheduler?.steering?.splice(0) ?? [];
        },
      }
    )).catch((error) => {
      updateRun((run) => { run.status = 'failed'; run.lastError = error instanceof Error ? error.message : String(error); });
    }).finally(() => {
      for (const memberId of team.memberIds) {
        dispatch({ type: 'UPDATE_EMPLOYEE', id: memberId, partial: { isWorking: false } });
      }
      discussingRef.current.delete(teamId);
      const scheduler = schedulerRef.current.get(teamId);
      if (scheduler) {
        const completedKey = opts?.discussionId ?? opts?.triggerMessageId ?? opts?.task?.id;
        if (completedKey) scheduler.keys.delete(completedKey);
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
      if ((client.loadSettings().followUpMode ?? 'steer') === 'steer' && opts.userText) {
        (scheduler.steering ??= []).push(opts.userText);
        scheduler.keys.delete(key);
        return;
      }
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

  const enqueueAssistantSupervisor = async (team: Team, content: string, mayDelegate: boolean): Promise<string | undefined> => {
    if (supervisorBusyRef.current.has(team.id)) return undefined;
    supervisorBusyRef.current.add(team.id);
    const sanitizeSupervisorReply = (reply: string) => {
      if (mayDelegate && /没有权限|未开放.*(?:接口|调度)|无法.*(?:分派|调用|调度)|切换到.*会话|开启.*调度/u.test(reply)) {
        return '我会按团队成员的职责分派执行，并在任务面板持续跟踪；产出完成后安排审查验收。';
      }
      return reply.replace(/^(?:收到|好的|明白)[，,。！!：:\s]*/u, '').trim() || reply.trim();
    };
    const appendSupervisorMessage = (reply: string, tokens?: number) => {
      const visibleReply = sanitizeSupervisorReply(reply);
      dispatch({
        type: 'APPEND_CHAT',
        teamId: team.id,
        msgs: [{
          id: `msg-supervisor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          authorId: 'assistant',
          roleId: 'custom',
          content: visibleReply,
          mentions: [],
          timestamp: Date.now(),
          kind: 'text',
          tokens,
        }],
      });
    };
    const teamRoster = team.memberIds
      .map((id) => stateRef.current.employees.find((employee) => employee.id === id))
      .filter((employee): employee is Employee => !!employee)
      .map((employee) => {
        return `- 姓名：${employee.name}\n  身份/职责：${employee.title} / ${employee.role}\n  在线：${employee.isOnline ? '是' : '否'}\n  专长与工作偏好：${(employee.prompt ?? '未填写').slice(0, 600)}\n  人设/补充信息：${(employee.soul ?? '未填写').slice(0, 900)}\n  模型：${employeeModelSummary(employee)}`;
      }).join('\n');
    try {
      const assistantModel = client.getAssistantModel();
      const configuredPrompt = localStorage.getItem('hermes_office_assistant_system_prompt')?.trim();
      const userContext = client.buildUserContext();
      const availableSkills = await listSkills().catch(() => []);
      const skillRoster = availableSkills.slice(0, 80).map((skill) => `${skill.name}${skill.description ? `：${skill.description.slice(0, 80)}` : ''}`).join('\n');
      const turns: client.ChatTurn[] = [
        {
          role: 'system',
          content: `${configuredPrompt ? `## 助理配置\n${configuredPrompt}\n\n` : ''}${userContext ? `${userContext}\n` : ''}你是私人办公会所的驴狗蛋助手，负责监督进度、调度成员和理解老板的工作习惯。\n\n## 系统能力声明\n团队调度器、任务运行器、成员资料和 Skill 库均已连接并可用。程序会在你回复后真正创建任务并调用成员。禁止声称“没有权限”“未开放接口”“需要切换会话”或要求老板再次确认已明确提出的工作。\n\n## 当前团队（唯一可调度范围）\n团队名称：${team.name}\n${teamRoster || '暂无成员'}\n\n## 可用 Skill\n${skillRoster || '暂无可用 Skill'}\n\n监工禁止输出脚本、代码、长文正文、分镜或最终产物，绝不能替成员完成工作。${mayDelegate ? '老板的工作请求已经授权执行。简短说明你将如何分派和验收，程序会自动选择真实成员并启动任务；不要虚构成员结果。回复最多 180 个汉字。' : '当前消息不需要启动团队，只做简短直接回应。'} 你自己不是团队成员，不能@自己。`,
        },
        { role: 'system', content: BEGINNER_RESPONSE_GUIDE },
        ...team.chatMessages.slice(-12).map((message) => ({
          role: message.roleId === 'human' ? 'user' as const : 'assistant' as const,
          content: `${stateRef.current.employees.find((employee) => employee.id === message.authorId)?.name ?? '团队成员'}: ${message.content}`,
        })),
        { role: 'user', content: `老板@你说：${content}` },
      ];
      if (!client.resolveApiBase(assistantModel)) {
        const reply = `⚠️ 驴狗蛋助手没有可用模型配置，无法进行真实对话或调度。请在设置中激活全局模型，或为助理选择模型后重试。`;
        appendSupervisorMessage(reply);
        return reply;
      }
      const result = await client.chatCompletion(turns, 'assistant-supervisor', `监工/${team.name}`, undefined, assistantModel);
      const reply = result.content?.trim().replace(/@Hermes(?:\s+助理)?|@章北海(?:\s+助理)?|@驴狗蛋(?:\s+助手)?/gu, '驴狗蛋助手');
      if (!reply) return undefined;
      appendSupervisorMessage(reply, result.usage.totalTokens);
      client.extractUserInsights(`老板：${content}\n监工回复：${reply}`, `团队监工-${team.name}`).catch(() => {});
      return reply;
    } catch (error) {
      console.warn('[supervisor] reply failed:', error);
      const reason = error instanceof Error ? error.message : String(error);
      const reply = `⚠️ 驴狗蛋助手本次模型调用失败：${reason.slice(0, 180)}。任务没有被伪装为已执行；请检查模型连接后重试。`;
      appendSupervisorMessage(reply);
      return reply;
    } finally {
      supervisorBusyRef.current.delete(team.id);
    }
  };

  const startTaskRun = async (teamId: string, request: string, employeeIds: string[], sourceMessageId?: string, attachments?: import('./data/hermesClient').Attachment[], explicitSkillRefs: import('./types').SkillReference[] = []) => {
    const current = stateRef.current;
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return;
    const plan = buildTaskPlan(team, current.employees, request, employeeIds);
    const skillRefs = explicitSkillRefs.length ? explicitSkillRefs : await matchSkills(request);
    const skillContext = await buildSkillContext(skillRefs);
    const run = createTaskRun(team, current.employees, request, plan, sourceMessageId, skillRefs);
    run.projectId = team.projectId;
    run.memberSnapshot.forEach((snapshot) => {
      const employee = current.employees.find((item) => item.id === snapshot.id);
      if (employee) snapshot.model = client.getEmployeeModel(employee).model;
    });
    if (!run.steps.length) return;
    const unavailableMembers = run.steps
      .map((step) => current.employees.find((employee) => employee.id === step.employeeId))
      .filter((employee): employee is Employee => !!employee && !client.resolveApiBase(client.getEmployeeModel(employee)));
    if (unavailableMembers.length > 0) {
      const names = [...new Set(unavailableMembers.map((employee) => employee.name))];
      run.status = 'failed';
      run.phase = 'blocked';
      run.lastError = `以下成员没有可用模型：${names.join('、')}`;
      run.preflight = (run.preflight ?? []).map((item) => item.label === '检查参与成员与模型'
        ? { ...item, status: 'blocked', detail: run.lastError }
        : item);
      run.handoff = {
        ts: Date.now(),
        completed: [],
        blocked: run.lastError,
        nextAction: '打开“设置 → 模型”，为这些成员启用全局模型或配置独立模型，然后点击“继续执行”。',
      };
      dispatch({ type: 'CREATE_TASK_RUN', run });
      return;
    }
    dispatch({ type: 'CREATE_TASK_RUN', run });
    enqueueDiscussion(teamId, {
      userText: request, attachments, triggerMessageId: sourceMessageId, discussionId: run.id,
      forcedMemberIds: run.steps.map((step) => step.employeeId), runSteps: run.steps, maxRounds: run.steps.length, runId: run.id, extraSystemContext: skillContext,
    }, 120);
  };

  const pauseTaskRun = (runId: string) => {
    pausedRunIdsRef.current.add(runId);
    const run = stateRef.current.taskRuns.find((item) => item.id === runId);
    if (run) dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(run, (next) => {
      next.status = 'paused'; next.steps.forEach((step) => { if (step.status === 'queued' || step.status === 'running') step.status = 'paused'; });
    }) });
  };

  const resumeTaskRun = (runId: string) => {
    pausedRunIdsRef.current.delete(runId);
    const run = stateRef.current.taskRuns.find((item) => item.id === runId);
    if (!run) return;
    const pendingSteps = run.steps.filter((step) => step.status === 'paused' || step.status === 'failed' || step.status === 'queued');
    const pending = pendingSteps.map((step) => step.employeeId);
    const pendingStepIds = new Set(pendingSteps.map((step) => step.id));
    if (!pendingSteps.length) return;
    dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(run, (next) => {
      next.status = 'queued'; next.phase = 'preflight'; next.lastError = undefined; next.handoff = undefined;
      next.steps.forEach((step) => { if (pendingStepIds.has(step.id)) step.status = 'queued'; });
    }) });
    void buildSkillContext(run.skillRefs ?? []).then((skillContext) => enqueueDiscussion(run.teamId, { userText: run.request, triggerMessageId: run.sourceMessageId, discussionId: run.id, forcedMemberIds: pending, runSteps: pendingSteps, maxRounds: pendingSteps.length, runId, extraSystemContext: skillContext }, 50));
  };

  const closeTaskRun = (runId: string) => {
    pausedRunIdsRef.current.add(runId);
    dispatch({ type: 'REMOVE_TASK_RUN', runId });
  };

  const clearTeamExecution = (targetTeamId: string) => dispatch({ type: 'CLEAR_TEAM_EXECUTION', teamId: targetTeamId });

  const enqueueAutoDiscussion = (teamId: string, messageId: string, content: string, mentions: string[], attachments?: import('./data/hermesClient').Attachment[], skillRefs: import('./types').SkillReference[] = []) => {
    const current = stateRef.current;
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return;
    void (async () => {
      const directMentions = mentions.filter((id) => team.memberIds.includes(id));
      const supervisorMentioned = mentions.includes('assistant');
      if (isTeamControlRequest(content)) {
        const pauseRequested = /(?:暂停|停止|先停|停下|别做|不要继续).{0,12}(?:工作|任务|手上|当前|执行)|(?:工作|任务).{0,8}(?:暂停|停止)/u.test(content);
        const reportRequested = /(?:模型|配置|状态|报数|报个数|数数|在线情况)/u.test(content);
        const targets = (directMentions.length ? directMentions : team.memberIds)
          .map((id) => current.employees.find((employee) => employee.id === id))
          .filter((employee): employee is Employee => !!employee);

        if (pauseRequested) {
          current.taskRuns
            .filter((run) => run.teamId === teamId && (run.status === 'queued' || run.status === 'running'))
            .forEach((run) => pauseTaskRun(run.id));
          targets.forEach((employee) => dispatch({ type: 'UPDATE_EMPLOYEE', id: employee.id, partial: { isWorking: false } }));
        }

        const now = Date.now();
        const messages: ChatMessage[] = [];
        if (pauseRequested) {
          messages.push({
            id: `msg-control-${now}`, authorId: 'assistant', roleId: 'custom',
            content: '当前团队任务已暂停。此指令不会创建新任务，也不会调用 Skill 或文件工具。',
            mentions: targets.map((employee) => employee.id), timestamp: now, kind: 'text',
          });
        }
        if (reportRequested) {
          targets.forEach((employee, index) => messages.push({
            id: `msg-model-report-${now}-${employee.id}`, authorId: employee.id, roleId: employee.role,
            content: `${/报数|报个数|数数/u.test(content) ? `${index + 1}。` : ''}模型汇报：${employeeModelSummary(employee)}。当前状态：${employee.isOnline ? (pauseRequested ? '已暂停' : employee.isWorking ? '工作中' : '空闲') : '掉线'}。`,
            mentions: [], timestamp: now + index + 1, kind: 'text',
          }));
        }
        if (messages.length) dispatch({ type: 'APPEND_CHAT', teamId, msgs: messages });
        return;
      }
      if (directMentions.length > 0 && !supervisorMentioned) {
        void startTaskRun(teamId, content, directMentions, messageId, attachments, skillRefs);
        return;
      }
      const recentSupervisorPlan = team.chatMessages.slice(-6).some((message) =>
        message.authorId === 'assistant' && /交给|分派|安排|负责|编剧|推进/.test(message.content),
      );
      const continuesSupervisorPlan = recentSupervisorPlan && /^(再|继续|按|那就|开始|出一)/.test(content.trim());
      // A roll-call/status request is harmless coordination and should be
      // actioned immediately by the supervisor without a second confirmation.
      const teamCheckRequested = /报数|报个数|数数|汇报.*(?:职责|职能|状态)|(?:职责|职能).*汇报|在线情况/u.test(content);
      const actionableRequest = /帮|请|安排|制作|起草|重写|改写|重新|写|生成|开发|设计|分析|优化|修复|检查|审核|测试|整理|调研|创建|完成|执行|做|出一份|产出|输出|脚本|剧本|文案|方案|报告|各位/u.test(content);
      const mayDelegate = supervisorMentioned || directMentions.length > 0 || teamCheckRequested || continuesSupervisorPlan || actionableRequest;
      const requestedMemberIds = mayDelegate ? matchTeamMembers(team, current.employees, content, directMentions) : [];
      await enqueueAssistantSupervisor(team, content, mayDelegate);
      if (!mayDelegate) return;
      if (requestedMemberIds.length > 0) {
        const planned = buildTaskPlan(team, current.employees, content, requestedMemberIds);
        const sequence = planned.map((step) => `${step.order}. ${step.title}`).join(' → ');
        dispatch({
          type: 'APPEND_CHAT',
          teamId,
          msgs: [{
            id: `msg-dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            authorId: 'assistant', roleId: 'custom',
            content: `执行计划已启动：${sequence}。每一步完成后自动交接；审查不通过时只退回责任步骤修改。`,
            mentions: requestedMemberIds, timestamp: Date.now(), kind: 'text',
          }],
        });
      }
      if (!requestedMemberIds.length) return;
      void startTaskRun(teamId, content, requestedMemberIds, messageId, attachments, skillRefs);
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
    void startTaskRun(teamId, triggerText, opts?.forcedMemberIds ?? decision.forcedMemberIds, opts?.triggerMessageId, opts?.attachments);
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
        createProjectDraft,
        approveProject,
        archiveProject,
        openTeamChat,
        openDmChat,
        openAssistantChat,
        advanceTask,
        claimTask,
        publishTask,
        triggerDiscussion,
        pauseTaskRun,
        resumeTaskRun,
        closeTaskRun,
        clearTeamExecution,
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
