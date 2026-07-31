import React, {
  useReducer,
  useEffect,
  type ReactNode,
} from 'react';
import { StoreContext } from './storeContext';
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
  ProjectMember,
  TaskRun,
  SkillUsageEvidence,
} from './types';
import { ROLE_SCARF } from './types';
import * as client from './data/hermesClient';
import { runScript, cancelDemo as cancelScript, type ScriptHandlers } from './engine/simulationEngine';
import { PROACTIVE_SCRIPT } from './engine/proactiveScript';
import { runTeamDiscussion, runTeamMentionReply } from './engine/teamDiscussion';
import { evaluateDiscussionTrigger } from './engine/discussionTrigger';
import { findFreeStation } from './data/hermesClient';
import { isTeamMemberAdditionRequest, resolveMentionedEmployees } from './engine/teamMembership';
import { sendBus, onBus, BUS_CHANNELS } from './ipcBus';
import { appendTaskRunContext, createTaskRun, formalPlanStepForRun, getExecutionSessionId, hydrateTaskRunFromMainStore, hydrateTaskRunsFromMainStore, saveTaskRuns, sendTaskWorkerCommand, taskRunContextPrompt, updateTaskRun } from './data/taskRuns';
import { buildTaskPlan, matchProjectMembers, matchTeamMembers } from './engine/taskMatcher';
import { employeePlanningPool, expertToEmployee, findExpertCatalogEntry } from './data/expertCatalog';
import { briefExecutionContext, buildProfessionalProjectBrief } from './engine/expertOrchestration';
import { codingProjectToTaskSteps, compileCodingProject } from './engine/codingProject.mjs';
import { buildSkillContextWithEvidence, listSkills, matchSkills } from './data/skills';
import { attachmentWorkspaceContext, copyAttachmentsToWorkspace, initializeTaskWorkspace } from './utils/attachments';
import { syncNativeArtifacts, syncNativeRunArtifacts } from './data/outputs';
import { BEGINNER_RESPONSE_GUIDE } from './data/assistantPresentation';
import { isToolResultSuccessful } from './data/assistantPresentation';
import { getDirectExecutionControl, isConversationOnlyMessage, shouldHoldTaskForFeedback } from './engine/agentGuardrails.mjs';
import { APP_PRODUCT_NAME } from './brand';
import { applyExecutionSteering, executionControllerStatus, type ExecutionControllerSnapshot } from './engine/executionController.mjs';
import { appendTaskRunnerSteps, beginTaskStep, recordTaskReviewDecision, recordTaskStepResult } from './engine/taskRunner.mjs';
import { applyModelTaskSummary, shouldModelSummarizeTaskContext } from './engine/taskContext.mjs';
import { buildTaskHistoryPrompt, searchTaskRunHistory } from './engine/taskHistory.mjs';
import { CONNECTOR_PRESETS, loadConnectors } from './data/connectors';
import { getConnectorTools } from './engine/connectorTools';
import { buildLayeredMemoryContext } from './data/layeredMemory';
import { classifyTeamMention } from './engine/teamMentionRouting.mjs';
import { cleanExecutionDisplay } from './engine/executionDisplay.mjs';
import { classifyLocalOfficeQuery, formatLocalOfficeAnswer } from './engine/officeDirectory';
import { getRegisteredTools } from './engine/toolCatalog';
import { ensureActiveChatSession, legacyConversationId, messageBelongsToConversation } from './data/chatSessions';

// ===== Action =====
type Action =
  | { type: 'INIT'; state: AppState }
  | { type: 'HYDRATE_TASK_RUNS'; runs: TaskRun[] }
  | { type: 'PATCH_TASK_RUN'; run: TaskRun }
  | { type: 'ADD_EMPLOYEE'; emp: Employee }
  | { type: 'UPDATE_EMPLOYEE'; id: string; partial: Partial<Employee> }
  | { type: 'REMOVE_EMPLOYEE'; id: string }
  | { type: 'ADD_TEAM'; team: Team }
  | { type: 'UPDATE_TEAM'; id: string; partial: Partial<Team> }
  | { type: 'REMOVE_TEAM'; id: string }
  | { type: 'CREATE_PROJECT'; project: Project }
  | { type: 'UPDATE_PROJECT'; id: string; partial: Partial<Project> }
  | { type: 'APPEND_CHAT'; teamId: string; msgs: ChatMessage[]; conversationId?: string }
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
function mergeTaskExecutionMessages(s: AppState, runs: TaskRun[]): AppState {
  const byTeam = new Map<string, ChatMessage[]>();
  for (const run of runs) {
    if (!run.executionMessages?.length) continue;
    const current = byTeam.get(run.teamId) ?? [];
    current.push(...run.executionMessages.map((message) => message.conversationId || !run.conversationId
      ? message
      : { ...message, conversationId: run.conversationId }));
    byTeam.set(run.teamId, current);
  }
  if (!byTeam.size) return { ...s, taskRuns: runs };
  const teams = s.teams.map((team) => {
    const incoming = byTeam.get(team.id);
    if (!incoming?.length) return team;
    const seen = new Set(team.chatMessages.map((message) => message.id));
    const appended = incoming.filter((message) => !seen.has(message.id));
    if (!appended.length) return team;
    return { ...team, chatMessages: [...team.chatMessages, ...appended].sort((a, b) => a.timestamp - b.timestamp).slice(-1200) };
  });
  return { ...s, teams, taskRuns: runs };
}

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'INIT':
      return a.state;

    case 'HYDRATE_TASK_RUNS':
      return mergeTaskExecutionMessages(s, a.runs);

    case 'PATCH_TASK_RUN': {
      const taskRuns = s.taskRuns.some((run) => run.id === a.run.id)
        ? s.taskRuns.map((run) => run.id === a.run.id ? a.run : run)
        : [...s.taskRuns, a.run].slice(-120);
      return mergeTaskExecutionMessages(s, taskRuns);
    }

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
      // Team metadata and its first messages use separate storage keys. Persist
      // the welcome message here as well so a newly opened child window can
      // render the same team immediately.
      if (a.team.chatMessages?.length) client.appendChat(a.team.id, a.team.chatMessages);
      return { ...s, teams: next };
    }

    case 'UPDATE_TEAM': {
      const next = s.teams.map((t) =>
        t.id === a.id ? { ...t, ...a.partial } : t
      );
      client.saveTeams(next);
      const renamed = a.partial.name?.trim();
      const target = s.teams.find((team) => team.id === a.id);
      const projects = renamed && target?.projectId
        ? s.projects.map((project) => project.id === target.projectId
          ? { ...project, title: renamed, updatedAt: Date.now() }
          : project)
        : s.projects;
      if (projects !== s.projects) client.saveProjects(projects);
      return { ...s, teams: next, projects };
    }

    case 'REMOVE_TEAM': {
      const next = s.teams.filter((t) => t.id !== a.id);
      client.saveTeams(next);
      const employees = s.employees.map((employee) =>
        employee.currentTeamId === a.id ? { ...employee, currentTeamId: undefined } : employee,
      );
      client.saveEmployees(employees);
      const projects = s.projects.map((project) =>
        project.teamId === a.id ? { ...project, teamId: undefined, updatedAt: Date.now() } : project,
      );
      client.saveProjects(projects);
      return { ...s, teams: next, employees, projects };
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
      const sessionId = a.conversationId ?? ensureActiveChatSession(`team:${a.teamId}`);
      const messages = a.msgs.map((message) => message.conversationId ? message : { ...message, conversationId: sessionId });
      client.appendChat(a.teamId, messages);
      const next = s.teams.map((t) =>
        t.id === a.teamId ? { ...t, chatMessages: [...(t.chatMessages || []), ...messages] } : t
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
        conversationId: ensureActiveChatSession(`team:${a.teamId}`),
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
export interface StoreCtx {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  // 便捷方法
  sendMessage: (teamId: string, authorId: string, roleId: RoleId, content: string, mentions?: string[], attachments?: import('./data/hermesClient').Attachment[], skillRefs?: import('./types').SkillReference[], conversationId?: string) => void;
  startTeamDemo: (teamId: string) => void;
  resetDemo: () => void;
  addEmployee: (name: string, title: string, role: OpcRoleId, avatar: string, avatarKind: 'preset' | 'custom', statusColor?: string, prompt?: string, avatarFrame?: import('./types').AvatarFrameConfig) => void;
  createTeam: (name: string, icon: string, memberIds: string[], description?: string) => void;
  addTeamMembers: (teamId: string, memberIds: string[]) => Employee[];
  setTeamMembers: (teamId: string, memberIds: string[]) => { added: Employee[]; removed: Employee[] };
  removeTeamMembers: (teamId: string, memberIds: string[]) => Employee[];
  addCatalogExperts: (expertIds: string[]) => Employee[];
  setProjectMembers: (projectId: string, memberIds: string[]) => ProjectMember[];
  createProjectDraft: (input: { title: string; request: string; conversationId?: string; steps?: string[]; expectedOutputs?: string[]; requiredCapabilities?: string[]; decisionReason?: string }) => void;
  approveProject: (projectId: string) => void;
  startProjectExecution: (projectId: string, clarificationResponse: string) => void;
  rejectProject: (projectId: string, reason?: string) => void;
  archiveProject: (projectId: string) => void;
  openTeamChat: (teamId: string) => void;
  openDmChat: (empId: string) => void;
  openAssistantChat: () => void;
  advanceTask: (teamId: string, taskId: string, lane: TaskLane) => void;
  claimTask: (teamId: string, taskId: string, claimerId: string) => void;
  publishTask: (teamId: string, title: string, description?: string, acceptance?: string) => void;
  triggerDiscussion: (teamId: string, opts?: { task?: TeamTask; userText?: string; extraSystemContext?: string; attachments?: import('./data/hermesClient').Attachment[]; participantPlan?: import('./types').DiscussionParticipantPlan[]; triggerMessageId?: string; discussionId?: string; conversationId?: string; forcedMemberIds?: string[]; maxRounds?: number }) => void;
  pauseTaskRun: (runId: string) => void;
  resumeTaskRun: (runId: string) => Promise<void>;
  stopTaskRun: (runId: string) => void;
  closeTaskRun: (runId: string) => void;
  clearTeamExecution: (teamId: string) => void;
}

// INIT 是各窗口自己的初始化加载，不应跨窗口广播。
const SKIP_BROADCAST = new Set<Action['type']>(['INIT', 'HYDRATE_TASK_RUNS', 'PATCH_TASK_RUN']);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, initialState);
  const nativeWorkingEmployeesRef = React.useRef<Set<string>>(new Set());

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
    const projectNativeEmployeeStatus = (runs: TaskRun[]) => {
      const active = new Map<string, string>();
      for (const run of runs) {
        if (!['queued', 'running'].includes(run.status)) continue;
        for (const step of run.steps) {
          // Queued is not working. Showing every waiting employee as active
          // made a single-file queue look like uncontrolled parallel work.
          if (step.status === 'running') {
            active.set(step.employeeId, `执行：${step.title}`);
          }
        }
      }
      for (const [employeeId, task] of active) {
        const current = stateRef.current.employees.find((employee) => employee.id === employeeId);
        if (!current || current.isWorking !== true || current.currentTask !== task) {
          dispatch({ type: 'UPDATE_EMPLOYEE', id: employeeId, partial: { isWorking: true, currentTask: task } });
        }
      }
      for (const employeeId of nativeWorkingEmployeesRef.current) {
        if (active.has(employeeId)) continue;
        const current = stateRef.current.employees.find((employee) => employee.id === employeeId);
        if (current?.isWorking || current?.currentTask) {
          dispatch({ type: 'UPDATE_EMPLOYEE', id: employeeId, partial: { isWorking: false, currentTask: undefined } });
        }
      }
      nativeWorkingEmployeesRef.current = new Set(active.keys());
    };

    let disposed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshInFlight = false;
    let refreshQueued = false;
    const taskRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const taskRefreshInFlight = new Set<string>();
    const taskRefreshQueued = new Set<string>();
    let needsArtifactReconciliation = true;
    const refreshNativeState = async () => {
      if (disposed) return;
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      refreshInFlight = true;
      try {
        const runs = await hydrateTaskRunsFromMainStore();
        if (!runs || disposed) return;
        if (needsArtifactReconciliation) {
          needsArtifactReconciliation = false;
          await syncNativeRunArtifacts(runs);
        }
        if (disposed) return;
        dispatch({ type: 'HYDRATE_TASK_RUNS', runs });
        projectNativeEmployeeStatus(runs);
      } finally {
        refreshInFlight = false;
        if (refreshQueued && !disposed) {
          refreshQueued = false;
          scheduleNativeRefresh();
        }
      }
    };
    const scheduleNativeRefresh = (delay = 180) => {
      if (disposed) return;
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void refreshNativeState();
      }, delay);
    };
    const refreshNativeTask = async (taskId: string) => {
      if (disposed || !taskId) return;
      if (taskRefreshInFlight.has(taskId)) {
        taskRefreshQueued.add(taskId);
        return;
      }
      taskRefreshInFlight.add(taskId);
      try {
        const run = await hydrateTaskRunFromMainStore(taskId);
        if (!run || disposed) return;
        const currentRuns = stateRef.current.taskRuns;
        const nextRuns = currentRuns.some((item) => item.id === run.id)
          ? currentRuns.map((item) => item.id === run.id ? run : item)
          : [...currentRuns, run].slice(-120);
        dispatch({ type: 'PATCH_TASK_RUN', run });
        projectNativeEmployeeStatus(nextRuns);
      } finally {
        taskRefreshInFlight.delete(taskId);
        if (taskRefreshQueued.delete(taskId) && !disposed) scheduleNativeTaskRefresh(taskId, 0);
      }
    };
    const scheduleNativeTaskRefresh = (taskId: string, delay = 180) => {
      if (disposed || !taskId || taskRefreshTimers.has(taskId)) return;
      const timer = setTimeout(() => {
        taskRefreshTimers.delete(taskId);
        void refreshNativeTask(taskId);
      }, delay);
      taskRefreshTimers.set(taskId, timer);
    };

    // The first read reconciles old artifacts. Native execution then refreshes
    // only the changed task, avoiding a full task/artifact scan per heartbeat.
    void refreshNativeState();
    const unsubscribeWorker = window.electronAPI?.onTaskWorkerChanged?.(() => {
      scheduleNativeRefresh(80);
    });
    const unsubscribeExecution = window.electronAPI?.onTaskExecutionChanged?.((event) => {
      const nativeEvent = event as { type?: string; teamId?: string; taskId?: string; workspaceId?: string; artifacts?: import('./data/outputs').NativeArtifactInput[] };
      if (nativeEvent.type === 'tool_result' && nativeEvent.artifacts?.length) {
        void syncNativeArtifacts(nativeEvent.artifacts, {
          teamId: nativeEvent.teamId,
          taskId: nativeEvent.taskId,
          workspaceId: nativeEvent.workspaceId,
        });
      }
      if (nativeEvent.taskId) {
        scheduleNativeTaskRefresh(nativeEvent.taskId, nativeEvent.type === 'step_completed' || nativeEvent.type === 'step_failed' ? 40 : 180);
      } else {
        scheduleNativeRefresh(180);
      }
    });
    // 后端探测
    client.checkBackend().then((online) => {
      dispatch({ type: 'SET_STATUS', partial: { backendOnline: online } });
    });
    return () => {
      disposed = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      taskRefreshTimers.forEach((timer) => clearTimeout(timer));
      unsubscribeWorker?.();
      unsubscribeExecution?.();
    };
  }, [dispatch]);

  const sendMessage = (
    teamId: string,
    authorId: string,
    roleId: RoleId,
    content: string,
    mentions: string[] = [],
    attachments?: import('./data/hermesClient').Attachment[],
    skillRefs?: import('./types').SkillReference[],
    conversationId = ensureActiveChatSession(`team:${teamId}`),
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
      conversationId,
    };
    dispatch({ type: 'APPEND_CHAT', teamId, msgs: [msg], conversationId });
    if (roleId === 'human') {
      const project = stateRef.current.projects.find((item) => item.teamId === teamId);
      // A newly approved team must collect the owner's direction before any
      // executor sees a task. This message is preserved in the group chat but
      // is not eligible for automatic discussion or native task dispatch.
      if (project?.status === 'clarifying') return;
      const executionContent = `${content}${attachmentWorkspaceContext(attachments ?? [])}`;
      enqueueAutoDiscussion(teamId, msg.id, executionContent, mentions, attachments, skillRefs, conversationId);
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

  const addCatalogExperts = (expertIds: string[]): Employee[] => {
    const current = stateRef.current;
    const existing = new Map(current.employees.map((employee) => [employee.id, employee]));
    const added: Employee[] = [];
    for (const expertId of [...new Set(expertIds)]) {
      const present = existing.get(expertId);
      if (present) {
        added.push(present);
        continue;
      }
      const expert = findExpertCatalogEntry(expertId);
      if (!expert) continue;
      const employee = expertToEmployee(expert, current.employees.length + added.length);
      existing.set(employee.id, employee);
      added.push(employee);
      dispatch({ type: 'ADD_EMPLOYEE', emp: employee });
    }
    return added;
  };

  const createTeam = (name: string, icon: string, memberIds: string[], description = '') => {
    const now = Date.now();
    const team: Team = {
      id: `team-${now}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      icon,
      memberIds,
      description: description.trim(),
      createdAt: now,
      updatedAt: now,
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

  const addTeamMembers = (teamId: string, memberIds: string[]): Employee[] => {
    const current = stateRef.current;
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return [];
    const existingIds = new Set(team.memberIds);
    const knownEmployees = new Map(current.employees.map((employee) => [employee.id, employee]));
    const added = [...new Set(memberIds)].map((id, index) => {
      const present = knownEmployees.get(id);
      if (present) return present;
      const expert = findExpertCatalogEntry(id);
      return expert ? expertToEmployee(expert, current.employees.length + index) : undefined;
    }).filter((employee): employee is Employee => !!employee && !existingIds.has(employee.id));
    if (!added.length) return [];

    for (const employee of added) {
      if (!knownEmployees.has(employee.id)) dispatch({ type: 'ADD_EMPLOYEE', emp: employee });
    }

    const nextMemberIds = [...new Set([...team.memberIds, ...added.map((employee) => employee.id)])];
    dispatch({ type: 'UPDATE_TEAM', id: teamId, partial: { memberIds: nextMemberIds } });
    added.forEach((employee) => dispatch({ type: 'UPDATE_EMPLOYEE', id: employee.id, partial: { currentTeamId: teamId } }));
    if (team.projectId) {
      const project = current.projects.find((item) => item.id === team.projectId);
      if (project) {
        const knownProjectMembers = new Set(project.members.map((member) => member.employeeId));
        dispatch({ type: 'UPDATE_PROJECT', id: project.id, partial: {
          members: [...project.members, ...added.filter((employee) => !knownProjectMembers.has(employee.id)).map((employee) => ({ employeeId: employee.id, reason: '按老板最新要求加入项目团队' }))],
          rosterRevision: (project.rosterRevision ?? 1) + 1,
        } });
      }
    }
    const roster = new Map([...current.employees, ...added].map((employee) => [employee.id, employee]));
    const activeRuns = current.taskRuns.filter((run) => run.teamId === teamId && ['queued', 'running', 'paused'].includes(run.status));
    for (const run of activeRuns) {
      const members = nextMemberIds.map((id) => roster.get(id)).filter((employee): employee is Employee => !!employee)
        .map((employee) => ({ ...employee, modelConfig: client.getEmployeeModel(employee) }));
      void window.electronAPI?.taskExecutionSyncMembers?.({ taskId: run.id, members });
    }
    dispatch({
      type: 'APPEND_CHAT',
      teamId,
      msgs: [{
        id: `msg-members-added-${Date.now()}`,
        authorId: 'assistant',
        roleId: 'custom',
        content: `已将 ${added.map((employee) => employee.name).join('、')} 加入「${team.name}」。成员列表已同步，后续可以直接 @姓名 分配工作。`,
        mentions: added.map((employee) => employee.id),
        timestamp: Date.now(),
        kind: 'text',
      }],
    });
    return added;
  };

  const setTeamMembers = (teamId: string, memberIds: string[]): { added: Employee[]; removed: Employee[] } => {
    const current = stateRef.current;
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return { added: [], removed: [] };
    const directory = new Map(current.employees.map((employee) => [employee.id, employee]));
    const added: Employee[] = [];
    const nextMemberIds = [...new Set(memberIds)].filter((employeeId) => {
      if (directory.has(employeeId)) return true;
      const expert = findExpertCatalogEntry(employeeId);
      if (!expert) return false;
      const employee = expertToEmployee(expert, current.employees.length + added.length);
      directory.set(employeeId, employee);
      added.push(employee);
      return true;
    });
    const previousIds = new Set(team.memberIds);
    const nextIds = new Set(nextMemberIds);
    const removed = team.memberIds
      .filter((employeeId) => !nextIds.has(employeeId))
      .map((employeeId) => directory.get(employeeId))
      .filter((employee): employee is Employee => !!employee);
    const newlyAssigned = nextMemberIds
      .filter((employeeId) => !previousIds.has(employeeId))
      .map((employeeId) => directory.get(employeeId))
      .filter((employee): employee is Employee => !!employee);
    if (!added.length && !removed.length && newlyAssigned.length === 0) return { added: [], removed: [] };
    added.forEach((employee) => dispatch({ type: 'ADD_EMPLOYEE', emp: employee }));
    dispatch({ type: 'UPDATE_TEAM', id: teamId, partial: { memberIds: nextMemberIds } });
    newlyAssigned.forEach((employee) => dispatch({ type: 'UPDATE_EMPLOYEE', id: employee.id, partial: { currentTeamId: teamId } }));
    removed.forEach((employee) => {
      if (employee.currentTeamId === teamId) dispatch({ type: 'UPDATE_EMPLOYEE', id: employee.id, partial: { currentTeamId: undefined, isWorking: false, currentTask: undefined } });
    });
    if (team.projectId) {
      const project = current.projects.find((item) => item.id === team.projectId);
      if (project) {
        const previousProjectMembers = new Map(project.members.map((member) => [member.employeeId, member]));
        dispatch({ type: 'UPDATE_PROJECT', id: project.id, partial: {
          members: nextMemberIds.map((employeeId) => previousProjectMembers.get(employeeId) ?? { employeeId, reason: '按老板最新要求调整项目团队' }),
          rosterRevision: (project.rosterRevision ?? 1) + 1,
        } });
      }
    }
    const roster = nextMemberIds.map((employeeId) => directory.get(employeeId)).filter((employee): employee is Employee => !!employee)
      .map((employee) => ({ ...employee, modelConfig: client.getEmployeeModel(employee) }));
    for (const run of current.taskRuns.filter((run) => run.teamId === teamId && ['queued', 'running', 'paused'].includes(run.status))) {
      void window.electronAPI?.taskExecutionSyncMembers?.({ taskId: run.id, members: roster });
    }
    return { added: newlyAssigned, removed };
  };

  const removeTeamMembers = (teamId: string, memberIds: string[]): Employee[] => {
    const current = stateRef.current;
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return [];
    const removedIds = new Set(memberIds.filter((id) => team.memberIds.includes(id)));
    if (!removedIds.size) return [];
    const removed = team.memberIds
      .filter((id) => removedIds.has(id))
      .map((id) => current.employees.find((employee) => employee.id === id))
      .filter((employee): employee is Employee => !!employee);
    const nextMemberIds = team.memberIds.filter((id) => !removedIds.has(id));
    dispatch({ type: 'UPDATE_TEAM', id: teamId, partial: { memberIds: nextMemberIds } });
    removed.forEach((employee) => {
      if (employee.currentTeamId === teamId) dispatch({ type: 'UPDATE_EMPLOYEE', id: employee.id, partial: { currentTeamId: undefined, isWorking: false, currentTask: undefined } });
    });
    if (team.projectId) {
      const project = current.projects.find((item) => item.id === team.projectId);
      if (project) dispatch({ type: 'UPDATE_PROJECT', id: project.id, partial: {
        members: project.members.filter((member) => !removedIds.has(member.employeeId)),
        rosterRevision: (project.rosterRevision ?? 1) + 1,
      } });
    }
    dispatch({ type: 'APPEND_CHAT', teamId, msgs: [{
      id: `msg-members-removed-${Date.now()}`,
      authorId: 'assistant', roleId: 'custom',
      content: `已将 ${removed.map((employee) => employee.name).join('、')} 从「${team.name}」移出。未开始的任务会按最新名单重新分配；已开始的任务保留原有执行记录。`,
      mentions: removed.map((employee) => employee.id), timestamp: Date.now(), kind: 'text',
    }] });
    return removed;
  };

  const setProjectMembers = (projectId: string, memberIds: string[]): ProjectMember[] => {
    const current = stateRef.current;
    const project = current.projects.find((item) => item.id === projectId);
    if (!project || project.status !== 'awaiting_approval') return [];
    const employees = employeePlanningPool(client.fetchInitial().employees);
    const selectionRequest = [project.request, ...(project.requiredCapabilities ?? [])].filter(Boolean).join('\n所需能力：');
    const recommended = new Map(matchProjectMembers(employees, selectionRequest).map((member) => [member.employeeId, member.reason]));
    const members = [...new Set(memberIds)]
      .filter((employeeId) => employees.some((employee) => employee.id === employeeId))
      .map((employeeId) => ({ employeeId, reason: recommended.get(employeeId) ?? '按老板最新的成员调整加入' }));
    dispatch({ type: 'UPDATE_PROJECT', id: projectId, partial: { members, rosterRevision: (project.rosterRevision ?? 1) + 1 } });
    return members;
  };

  const createProjectDraft = (input: { title: string; request: string; conversationId?: string; steps?: string[]; expectedOutputs?: string[]; requiredCapabilities?: string[]; decisionReason?: string }) => {
    const now = Date.now();
    const latestEmployees = employeePlanningPool(client.fetchInitial().employees);
    const selectionRequest = [input.request, ...(input.requiredCapabilities ?? [])].filter(Boolean).join('\n所需能力：');
    const members = matchProjectMembers(latestEmployees, selectionRequest);
    const project: Project = {
      id: `project-${now}-${Math.random().toString(36).slice(2, 7)}`,
      title: input.title.trim() || '未命名项目',
      request: input.request.trim(),
      conversationId: input.conversationId,
      steps: input.steps?.filter(Boolean) ?? [],
      expectedOutputs: input.expectedOutputs?.filter(Boolean) ?? [],
      members,
      brief: buildProfessionalProjectBrief({ request: input.request, members }),
      requiredCapabilities: input.requiredCapabilities?.filter(Boolean),
      decisionReason: input.decisionReason?.trim(),
      status: 'awaiting_approval', rosterRevision: 1, createdAt: now, updatedAt: now,
    };
    dispatch({ type: 'CREATE_PROJECT', project });
  };

  const approveProject = (projectId: string) => {
    const project = stateRef.current.projects.find((item) => item.id === projectId);
    if (!project || project.status !== 'awaiting_approval') return;
    const memberIds = project.members.map((member) => member.employeeId);
    if (!memberIds.length) return;
    const memberDirectory = new Map(stateRef.current.employees.map((employee) => [employee.id, employee]));
    for (const employee of addCatalogExperts(memberIds)) memberDirectory.set(employee.id, employee);
    const team: Team = {
      id: `team-project-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: project.title,
      description: project.request.slice(0, 240),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      icon: '📌', memberIds, projectId,
      chatMessages: [{ id: `msg-project-${Date.now()}`, authorId: 'assistant', roleId: 'custom',
        content: `团队已建立。成员名单已按批准方案固定：${memberIds.map((id) => `@${memberDirectory.get(id)?.name ?? id}`).join('、')}。\n\n现在还不会开工。请先一次性确认：\n1. 要解决的核心问题和第一版边界；\n2. 使用哪些资料或知识来源、部署到哪里；\n3. 必须具备的检索/权限/连接能力；\n4. 界面风格与最优先的使用场景。\n\n你回复后，点击“确认方向并开始执行”，团队才会生成分阶段计划。`, mentions: memberIds, timestamp: Date.now(), kind: 'text' }],
      tasks: [],
    };
    dispatch({ type: 'ADD_TEAM', team });
    dispatch({ type: 'UPDATE_PROJECT', id: projectId, partial: { status: 'clarifying', teamId: team.id } });
    memberIds.forEach((id) => dispatch({ type: 'UPDATE_EMPLOYEE', id, partial: { currentTeamId: team.id } }));
  };

  const startProjectExecution = (projectId: string, clarificationResponse: string) => {
    const project = stateRef.current.projects.find((item) => item.id === projectId);
    if (!project || project.status !== 'clarifying' || !project.teamId || !clarificationResponse.trim()) return;
    const team = stateRef.current.teams.find((item) => item.id === project.teamId);
    if (!team) return;
    const memberIds = project.members.map((member) => member.employeeId).filter((id) => team.memberIds.includes(id));
    if (!memberIds.length) return;
    const effectiveRequest = `${project.request}\n\n老板确认的方向与风格：\n${clarificationResponse.trim()}`;
    const brief = buildProfessionalProjectBrief({ request: effectiveRequest, members: project.members });
    dispatch({ type: 'UPDATE_PROJECT', id: project.id, partial: {
      status: 'running',
      clarificationResponse: clarificationResponse.trim(),
      brief,
    } });
    dispatch({ type: 'APPEND_CHAT', teamId: team.id, msgs: [{
      id: `msg-project-start-${Date.now()}`,
      authorId: 'assistant', roleId: 'custom',
      content: '方向已确认，团队现在开始执行。会按“需求/架构 -> 设计/数据 -> 实现 -> 审查”的依赖顺序推进；没有轮到的成员会显示为等待前置步骤，不会假装同时开工。',
      mentions: memberIds, timestamp: Date.now(), kind: 'text',
    }] });
    setTimeout(() => { void startTaskRun(team.id, effectiveRequest, memberIds, undefined, undefined, [], undefined, undefined, brief); }, 0);
  };

  const archiveProject = (projectId: string) => {
    const project = stateRef.current.projects.find((item) => item.id === projectId);
    if (!project) return;
    dispatch({ type: 'UPDATE_PROJECT', id: projectId, partial: { status: 'archived' } });
    if (project.teamId) dispatch({ type: 'UPDATE_TEAM', id: project.teamId, partial: { archived: true } });
  };

  const rejectProject = (projectId: string, reason = '用户驳回团队方案') => {
    const project = stateRef.current.projects.find((item) => item.id === projectId);
    if (!project || project.status !== 'awaiting_approval') return;
    dispatch({ type: 'UPDATE_PROJECT', id: projectId, partial: { status: 'archived', rejectionReason: reason } });
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
    const localTeam = state.teams.find((team) => team.id === teamId);
    if (!localTeam) {
      // A project approval can be broadcast to another renderer before its
      // local store has received ADD_TEAM. Refresh the durable snapshot before
      // deciding that the requested team is invalid.
      const persisted = client.fetchInitial();
      const persistedTeam = persisted.teams.find((team) => team.id === teamId);
      if (!persistedTeam) return;
      dispatch({
        type: 'INIT',
        state: { ...state, employees: persisted.employees, teams: persisted.teams, projects: persisted.projects, taskRuns: persisted.taskRuns },
      });
    }
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
      enqueueDiscussion(teamId, { task, userText: `新任务：${title}${description ? `\n${description}` : ''}`, triggerMessageId: task.id, discussionId: `discussion-${task.id}`, conversationId: ensureActiveChatSession(`team:${teamId}`), maxRounds: settings.autoDiscussMaxRounds });
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
    modelRequestController?: AbortController;
    lastStartedAt?: number;
    keys: Set<string>;
  }>());
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const supervisorBusyRef = React.useRef(new Set<string>());
  const pausedRunIdsRef = React.useRef(new Set<string>());
  const stoppedRunIdsRef = React.useRef(new Set<string>());
  const taskSummaryAttemptsRef = React.useRef(new Set<string>());
  const autoResumeAttemptRef = React.useRef(new Map<string, string>());

  useEffect(() => {
    const terminalStatuses = new Set(['completed', 'paused', 'failed', 'stopped']);
    for (const run of state.taskRuns) {
      if (!terminalStatuses.has(run.status) || !run.context || !shouldModelSummarizeTaskContext(run.context)) continue;
      const sourceEventCount = run.context.summary.sourceEventCount;
      const attemptKey = `${run.id}:${sourceEventCount}`;
      if (taskSummaryAttemptsRef.current.has(attemptKey)) continue;
      taskSummaryAttemptsRef.current.add(attemptKey);
      void client.summarizeTaskContext(run.context).then((proposal) => {
        if (!proposal) return;
        const latest = stateRef.current.taskRuns.find((item) => item.id === run.id);
        if (!latest?.context) return;
        dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(latest, (next) => {
          next.context = applyModelTaskSummary(next.context, proposal);
        }) });
      });
    }
  }, [state.taskRuns, dispatch]);

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
    const runConversationId = opts?.runId
      ? stateRef.current.taskRuns.find((item) => item.id === opts?.runId)?.conversationId
      : undefined;
    const conversationId = opts?.conversationId ?? runConversationId ?? ensureActiveChatSession(`team:${teamId}`);
    opts = { ...(opts ?? {}), conversationId };
    const conversationTeam: Team = {
      ...team,
      chatMessages: team.chatMessages.filter((message) => messageBelongsToConversation(message, conversationId, `team:${teamId}`)),
    };
    discussingRef.current.add(teamId);
    const activeScheduler = schedulerRef.current.get(teamId) ?? { running: true, keys: new Set<string>() };
    activeScheduler.modelRequestController?.abort();
    activeScheduler.modelRequestController = new AbortController();
    schedulerRef.current.set(teamId, activeScheduler);

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
    let latestExecutionState: ExecutionControllerSnapshot | undefined = liveRun?.recoveryContext?.controller;
    const updateRun = (mutate: (run: TaskRun) => void) => {
      if (!liveRun) return;
      liveRun = updateTaskRun(liveRun, mutate);
      const projectedWorker = stateRef.current.taskRuns.find((item) => item.id === liveRun?.id)?.worker;
      const protectedWorkerState = projectedWorker?.state === 'paused' || projectedWorker?.state === 'stopped' || projectedWorker?.state === 'expired' || projectedWorker?.state === 'released';
      if (projectedWorker && (protectedWorkerState || (projectedWorker.heartbeatAt ?? 0) > (liveRun.worker?.heartbeatAt ?? 0))) {
        liveRun.worker = projectedWorker;
      }
      dispatch({ type: 'UPDATE_TASK_RUN', run: liveRun });
    };
    let workerLeaseId: string | undefined;
    let workerHeartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let adapterCheckpointSequence = 0;
    let adapterCheckpointQueue = Promise.resolve();
    let adapterCheckpointError: string | undefined;
    const reportAdapterCheckpoint = (checkpoint: {
      kind: 'step_started' | 'step_completed' | 'step_failed' | 'run_failed' | 'run_finished';
      stepId?: string;
      summary?: string;
      finalStatus?: string;
    }): Promise<void> => {
      if (!liveRun || !workerLeaseId) return Promise.resolve();
      const sequence = ++adapterCheckpointSequence;
      const runId = liveRun.id;
      const leaseId = workerLeaseId;
      adapterCheckpointQueue = adapterCheckpointQueue.then(async () => {
        const result = await sendTaskWorkerCommand({
          commandId: `adapter-checkpoint-${runId}-${sequence}`,
          taskId: runId,
          type: 'checkpoint',
          requestedBy: 'renderer-team-discussion-adapter',
          payload: {
            leaseId,
            checkpoint: {
              protocolVersion: 1,
              checkpointId: `adapter-${runId}-${sequence}`,
              sequence,
              occurredAt: Date.now(),
              ...checkpoint,
            },
          },
        });
        if (result && !result.ok) throw new Error(result.error || `执行检查点 #${sequence} 写入失败`);
        if (result?.run?.worker && liveRun?.id === runId) {
          liveRun.worker = result.run.worker;
          dispatch({ type: 'UPDATE_TASK_RUN', run: liveRun });
        }
      }).catch((error) => {
        adapterCheckpointError = error instanceof Error ? error.message : String(error);
        console.error('[execution-adapter] checkpoint failed:', adapterCheckpointError);
      });
      return adapterCheckpointQueue;
    };
    const claimWorkerLease = async () => {
      if (!liveRun) return;
      const claimed = await sendTaskWorkerCommand({
        taskId: liveRun.id,
        type: 'claim',
        requestedBy: 'renderer-team-discussion',
        payload: { adapter: 'renderer-team-discussion', adapterProtocolVersion: 1, jobId: `team-job-${liveRun.id}` },
      });
      if (claimed && !claimed.ok) throw new Error(claimed.error || 'Worker 无法领取任务');
      if (!claimed?.run) return;
      liveRun = claimed.run;
      workerLeaseId = claimed.run.worker?.leaseId;
      adapterCheckpointSequence = claimed.run.worker?.checkpointSequence ?? 0;
      dispatch({ type: 'UPDATE_TASK_RUN', run: liveRun });
      if (workerLeaseId) {
        workerHeartbeatTimer = setInterval(() => {
          if (!liveRun || !workerLeaseId) return;
          void sendTaskWorkerCommand({ taskId: liveRun.id, type: 'heartbeat', requestedBy: 'renderer-team-discussion', payload: { leaseId: workerLeaseId } })
            .then((heartbeat) => { if (heartbeat?.ok && heartbeat.run) liveRun = heartbeat.run; });
        }, 5_000);
      }
    };
    const markRunExecuting = () => updateRun((run) => {
      run.status = 'running'; run.phase = 'executing'; run.lastError = undefined; run.executionSessionId = getExecutionSessionId();
      if (run.recoveryContext) {
        run.recoveryContext.summary = '任务正在执行，已完成内容会持续写入恢复记录。';
        run.recoveryContext.interruptedAt = undefined;
        run.recoveryContext.interruptionReason = undefined;
        run.recoveryContext.budget.updatedAt = Date.now();
      }
      run.preflight = (run.preflight ?? []).map((item) => item.label === '检查参与成员与模型'
        ? { ...item, status: 'passed', detail: '参与成员与模型配置已通过启动检查' }
        : item);
    });
    Promise.resolve().then(async () => {
      await claimWorkerLease();
      markRunExecuting();
      const layeredMemoryContext = await buildLayeredMemoryContext({ query: opts?.userText || opts?.task?.title || '', teamId, limit: 18 });
      return runTeamDiscussion(
      conversationTeam,
      stateRef.current.employees,
      { ...(opts ?? {}), extraSystemContext: [opts?.extraSystemContext, layeredMemoryContext].filter(Boolean).join('\n\n'), initialExecutionState: liveRun?.recoveryContext?.controller },
      {
        onExecutionState(controller, emp, stepId) {
          latestExecutionState = controller;
          const statusText = executionControllerStatus(controller);
          if (emp) dispatch({ type: 'UPDATE_EMPLOYEE', id: emp.id, partial: { isWorking: controller.status === 'running', currentTask: statusText } });
          updateRun((run) => {
            if (!run.recoveryContext) return;
            run.recoveryContext.controller = controller;
            run.recoveryContext.summary = statusText;
            run.recoveryContext.budget.toolAttempts = controller.attemptCount;
            run.recoveryContext.budget.updatedAt = Date.now();
            const step = run.steps.find((item) => item.id === stepId);
            if (step && step.events.at(-1)?.detail !== statusText) {
              step.events.push({ ts: Date.now(), type: controller.status === 'blocked' || controller.status === 'awaiting_user' ? 'error' : 'status', detail: statusText });
            }
          });
        },
        onMessage(emp, content, mentions, tokens, discussionRound, inReplyToMessageId, stepId, contextUsage) {
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
            contextUsage,
            discussionId: opts?.discussionId,
            discussionRound,
            triggeredBy: opts?.task ? 'task' : 'message',
            inReplyToMessageId,
            conversationId,
          };
          const stepSnapshot = stepId ? liveRun?.steps.find((item) => item.id === stepId) : undefined;
          const toolEvents = stepSnapshot?.events
            .filter((event) => event.type === 'tool')
            .slice(-8) ?? [];
          const executionSummary: ChatMessage | undefined = toolEvents.length > 0
            ? {
              id: `msg-execution-summary-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              authorId: emp.id,
              authorName: emp.name,
              roleId: emp.role,
              content: `执行过程 · ${emp.name} · ${stepSnapshot?.title ?? '当前步骤'} · ${toolEvents.length} 项工具动作\n${toolEvents.map((event) => `- ${cleanExecutionDisplay(event.detail, 320)}`).join('\n')}`,
              mentions: [], timestamp: Date.now(), kind: 'execution', discussionId: opts?.discussionId, conversationId,
            }
            : undefined;
          // Keep the chat readable: one expandable summary per completed step.
          // Full tool evidence remains in the task run and replay panels.
          dispatch({ type: 'APPEND_CHAT', teamId, msgs: executionSummary ? [executionSummary, msg] : [msg], conversationId });
          let reportedStepId: string | undefined;
          let reportedStepStatus: 'completed' | 'failed' | undefined;
          updateRun((run) => {
            const step = run.steps.find((item) => item.id === stepId) ?? run.steps.find((item) => item.employeeId === emp.id && item.status === 'running');
            if (!step) return;
            const controllerFailed = latestExecutionState?.status === 'awaiting_user'
              || latestExecutionState?.status === 'blocked'
              || latestExecutionState?.status === 'stopped';
            const awaitingReviewDecision = step.kind === 'review' && !controllerFailed;
            step.status = controllerFailed ? 'failed' : awaitingReviewDecision ? 'running' : 'completed';
            if (stepId && run.runner && !awaitingReviewDecision) {
              run.runner = recordTaskStepResult(run.runner, {
                stepId,
                success: !controllerFailed,
                output: { summary: content.slice(0, 1200) },
                error: controllerFailed ? content : undefined,
              });
            }
            if (!awaitingReviewDecision) step.completedAt = Date.now();
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
              const evidence = { ts: Date.now(), source: 'member' as const, summary: awaitingReviewDecision ? `${emp.name} 已返回审查说明，等待结构化结论` : `${emp.name} 完成：${content.slice(0, 220)}`, verified: false };
              step.evidence = [...(step.evidence ?? []), evidence].slice(-12);
              run.evidence = [...(run.evidence ?? []), evidence].slice(-40);
            }
            if (run.recoveryContext) {
              run.recoveryContext.summary = step.status === 'failed'
                ? `${emp.name} 的步骤被阻塞，等待处理后恢复。`
                : awaitingReviewDecision ? `${emp.name} 已完成检查，正在提交结构化审查结论。` : `${emp.name} 已完成“${step.title}”，继续执行后续步骤。`;
              if (step.status === 'failed') {
                run.recoveryContext.unresolvedIssues = [...run.recoveryContext.unresolvedIssues, content.slice(0, 320)].slice(-12);
              } else {
                run.recoveryContext.completedEvidence = [...run.recoveryContext.completedEvidence, `${emp.name}：${content.slice(0, 220)}`].slice(-20);
              }
              if (contextUsage) {
                run.recoveryContext.budget.promptTokens = contextUsage.promptTokens;
                run.recoveryContext.budget.contextWindowTokens = contextUsage.contextWindowTokens;
              }
              run.recoveryContext.budget.updatedAt = Date.now();
            }
            step.events.push({ ts: Date.now(), type: step.status === 'failed' ? 'error' : 'result', detail: content.slice(0, 360) });
            appendTaskRunContext(run, {
              type: step.status === 'failed' ? 'error' : 'progress', source: 'member', stepId,
              summary: `${emp.name}：${content.slice(0, 420)}`, verified: false,
            });
            if (step.kind !== 'review' && (step.status === 'completed' || step.status === 'failed')) {
              reportedStepId = step.id;
              reportedStepStatus = step.status;
            }
          });
          if (!stepId || (reportedStepId && reportedStepStatus)) {
            dispatch({ type: 'UPDATE_EMPLOYEE', id: emp.id, partial: { isWorking: false, currentTask: undefined } });
            void reportAdapterCheckpoint({
              kind: reportedStepStatus === 'failed' ? 'step_failed' : 'step_completed',
              stepId: reportedStepId,
              summary: content.slice(0, 500),
            });
          }
        },
        onSteeringReply(emp, content, tokens, contextUsage, stepId) {
          dispatch({
            type: 'APPEND_CHAT', teamId, conversationId,
            msgs: [{
              id: `msg-steering-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              authorId: emp.id, roleId: emp.role, content, mentions: [], timestamp: Date.now(), kind: 'text',
              tokens, contextUsage, discussionId: opts?.discussionId, triggeredBy: 'message', conversationId,
            }],
          });
          updateRun((run) => {
            const step = run.steps.find((item) => item.id === stepId);
            if (step) step.events.push({ ts: Date.now(), type: 'status', detail: `已回应运行中新增要求：${content.slice(0, 220)}` });
          });
        },
        onTaskAdvance(taskId, lane) {
          dispatch({ type: 'ADVANCE_TASK', teamId, taskId, lane });
        },
        onToolCall(emp, toolName, toolArgs, result, stepId, success, protocolEvidence, structuredEvidence) {
          // Tool calls update the structured task evidence below. They are not
          // appended as individual chat bubbles; the step summary is emitted
          // once in onMessage after the member has returned.
          dispatch({
            type: 'UPDATE_EMPLOYEE',
            id: emp.id,
            partial: { isWorking: true, currentTask: `姝ｅ湪璋冪敤 ${toolName}` },
          });
          updateRun((run) => {
            const step = run.steps.find((item) => item.id === stepId) ?? run.steps.find((item) => item.employeeId === emp.id && item.status === 'running');
            if (step) {
              step.events.push({ ts: Date.now(), type: 'tool', detail: `${toolName} ${toolArgs}${result && result !== '🔄 执行中…' ? ` → ${result}` : ''}`.slice(0, 360) });
              if (result && result !== '🔄 执行中…') {
                const artifact = toolName === 'write_file' ? structuredEvidence?.artifacts?.[0] : undefined;
                const review = structuredEvidence?.review;
                const verified = artifact ? artifact.verified : review ? review.decision === 'pass' : protocolEvidence
                  ? protocolEvidence.ok && protocolEvidence.stage === 'completed'
                  : isToolResultSuccessful(result, success);
                const kind = artifact ? 'file' as const
                  : review ? 'review' as const
                  : toolName === 'write_file' ? 'file' as const
                  : toolName === 'run_command' ? 'run' as const
                    : /connector|obsidian|knowledge/iu.test(toolName) ? 'connection' as const : 'progress' as const;
                const evidenceSummary = artifact
                  ? `${artifact.filename} · ${artifact.category} · ${artifact.bytes ?? 0} 字节 · ${artifact.verified ? '已重新验证' : '仅登记'}`
                  : review
                    ? `${review.decision === 'pass' ? '审查通过' : '审查退回'}：${review.reason}`
                  : protocolEvidence
                  ? `${protocolEvidence.connectorLabel} · ${protocolEvidence.action}：${protocolEvidence.ok ? '客户端验证通过' : `失败于 ${protocolEvidence.stage}`} · ${protocolEvidence.latencyMs}ms${protocolEvidence.idempotencyHit ? ' · 幂等复用' : ''}`
                  : `${toolName}：${result}`.slice(0, 260);
                const evidence = { ts: Date.now(), source: 'tool' as const, kind, summary: evidenceSummary, verified, connectorProtocol: protocolEvidence, artifact, review };
                step.evidence = [...(step.evidence ?? []), evidence].slice(-12);
                run.evidence = [...(run.evidence ?? []), evidence].slice(-40);
                const additionalArtifacts = toolName === 'write_file'
                  ? structuredEvidence?.artifacts?.slice(1) ?? []
                  : structuredEvidence?.artifacts ?? [];
                for (const additionalArtifact of additionalArtifacts) {
                  const additionalEvidence = {
                    ts: Date.now(), source: 'tool' as const, kind: 'file' as const,
                    summary: `${additionalArtifact.filename} · ${additionalArtifact.category} · ${additionalArtifact.bytes ?? 0} 字节 · ${additionalArtifact.verified ? '已重新验证' : '仅登记'}`,
                    verified: additionalArtifact.verified, artifact: additionalArtifact,
                  };
                  step.evidence = [...(step.evidence ?? []), additionalEvidence].slice(-12);
                  run.evidence = [...(run.evidence ?? []), additionalEvidence].slice(-40);
                  appendTaskRunContext(run, {
                    type: additionalArtifact.verified ? 'progress' : 'error', source: 'tool', stepId,
                    summary: additionalEvidence.summary, verified: additionalArtifact.verified,
                    data: { artifact: additionalArtifact },
                  });
                }
                appendTaskRunContext(run, {
                  type: verified ? 'progress' : 'error', source: 'tool', stepId,
                  summary: evidenceSummary.slice(0, 420), verified,
                  data: artifact ? { artifact }
                    : review ? { review }
                    : protocolEvidence ? {
                    connectorProtocol: {
                      protocolVersion: protocolEvidence.protocolVersion,
                      connectorId: protocolEvidence.connectorId,
                      connectorLabel: protocolEvidence.connectorLabel,
                      action: protocolEvidence.action,
                      stage: protocolEvidence.stage,
                      ok: protocolEvidence.ok,
                      latencyMs: protocolEvidence.latencyMs,
                      idempotencyHit: protocolEvidence.idempotencyHit,
                      error: protocolEvidence.error,
                      events: protocolEvidence.events,
                    },
                  } : undefined,
                });
                if (run.recoveryContext) {
                  run.recoveryContext.budget.toolAttempts += 1;
                  run.recoveryContext.budget.updatedAt = Date.now();
                  if (verified) {
                    run.recoveryContext.completedEvidence = [...run.recoveryContext.completedEvidence, `${toolName}：${result.slice(0, 220)}`].slice(-20);
                  }
                }
                if (/^(search_skills|read_skill|install_skill)$/u.test(toolName)) {
                  let skillId = '';
                  try { skillId = JSON.parse(toolArgs || '{}').id || JSON.parse(toolArgs || '{}').installedSkillId || ''; } catch {}
                  const skillRef = (run.skillRefs ?? []).find((ref) => ref.id === skillId);
                  const action: SkillUsageEvidence['action'] = toolName === 'search_skills' ? 'searched' : toolName === 'read_skill' ? (verified ? 'read' : 'read-failed') : 'called';
                  run.skillEvidence = [...(run.skillEvidence ?? []), {
                    ts: Date.now(), skillId: skillId || skillRef?.id, skillName: skillRef?.name,
                    action, toolName, reason: `成员 ${emp.name} 实际调用 ${toolName}`, detail: result.slice(0, 240), verified,
                  }].slice(-60);
                }
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
            if (run.runner) {
              try { run.runner = beginTaskStep(run.runner, stepId); } catch (error) {
                run.lastError = error instanceof Error ? error.message : String(error);
              }
            }
            const step = run.steps.find((item) => item.id === stepId);
            if (step) {
              step.status = 'running'; step.startedAt = Date.now(); step.attempts += 1;
              step.events.push({ ts: Date.now(), type: 'status', detail: `开始第 ${step.order} 步：${step.assignment}` });
            }
            appendTaskRunContext(run, { type: 'progress', source: 'system', stepId, summary: `${emp.name} 开始执行第 ${step?.order ?? '?'} 步：${step?.assignment ?? '未命名步骤'}` });
            if (run.recoveryContext) {
              run.recoveryContext.summary = `${emp.name} 正在执行“${step?.title ?? '当前步骤'}”。`;
              run.recoveryContext.budget.updatedAt = Date.now();
            }
          });
          void reportAdapterCheckpoint({ kind: 'step_started', stepId, summary: `${emp.name} 开始执行步骤` });
        },
        onStepAdded(step) {
          totalSteps += 1;
          updateRun((run) => {
            if (run.steps.some((item) => item.id === step.id)) return;
            run.steps.push({ ...step, status: 'queued', attempts: 0, events: [{ ts: Date.now(), type: 'status', detail: '审查退回后新增步骤' }] });
            if (run.runner) {
              run.runner = appendTaskRunnerSteps(run.runner, [formalPlanStepForRun(run.id, step)], `审查退回后新增“${step.title}”`);
              run.plan = run.runner.plan;
            }
            run.revisionCount = (run.revisionCount ?? 0) + (step.kind === 'revision' ? 1 : 0);
          });
        },
        onReviewDecision(stepId, approved, reason, responsibleEmployeeId, responsibleStepId, review) {
          updateRun((run) => {
            const step = run.steps.find((item) => item.id === stepId);
            if (!step) return;
            step.status = 'completed';
            step.completedAt = Date.now();
            step.reviewDecision = approved ? 'pass' : 'reject';
            step.reviewReason = reason;
            step.responsibleEmployeeId = responsibleEmployeeId;
            step.events.push({ ts: Date.now(), type: approved ? 'result' : 'error', detail: approved ? '审查通过' : `审查退回：${reason ?? '未说明原因'}` });
            const evidence = { ts: Date.now(), source: 'review' as const, kind: 'review' as const, summary: approved ? `审查通过：${reason ?? '符合验收要求'}` : `审查退回：${reason ?? '需要修改'}`, verified: approved };
            step.evidence = [...(step.evidence ?? []), evidence].slice(-12);
            run.evidence = [...(run.evidence ?? []), evidence].slice(-40);
            if (run.runner) {
              run.runner = recordTaskReviewDecision(run.runner, {
                stepId, approved, reason, responsibleEmployeeId, responsibleStepId,
                checkedArtifacts: review?.checkedArtifacts,
              });
              run.plan = run.runner.plan;
            }
            appendTaskRunContext(run, { type: approved ? 'resolved' : 'blocked', source: 'review', stepId, summary: evidence.summary, verified: approved });
          });
          void reportAdapterCheckpoint({
            kind: 'step_completed',
            stepId,
            summary: approved ? `审查通过：${reason ?? '符合验收要求'}` : `审查已完成并退回：${reason ?? '需要修改'}`,
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
            if (run.recoveryContext) {
              run.recoveryContext.summary = '任务遇到阻塞，已保存当前上下文。';
              run.recoveryContext.unresolvedIssues = [...run.recoveryContext.unresolvedIssues, error.slice(0, 320)].slice(-12);
              run.recoveryContext.budget.updatedAt = Date.now();
            }
            const activeReview = [...run.steps].reverse().find((step) => step.kind === 'review' && step.reviewDecision === 'reject');
            if (activeReview) { activeReview.status = 'failed'; activeReview.lastError = error; }
            appendTaskRunContext(run, { type: 'blocked', source: 'system', summary: error.slice(0, 420), verified: false });
          });
          void reportAdapterCheckpoint({ kind: 'run_failed', summary: error.slice(0, 700) });
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
            const stopped = stoppedRunIdsRef.current.has(run.id);
            const hasFailed = run.steps.some((step) => step.status === 'failed') || !!run.lastError;
            const hasUnfinished = run.steps.some((step) => step.status !== 'completed' && step.status !== 'failed' && step.status !== 'stopped');
            const evidence = run.evidence ?? [];
            const deliverableType = run.contract?.deliverableType
              ?? run.steps.find((step) => step.kind !== 'review')?.deliverableType
              ?? 'mixed';
            const hasFileEvidence = evidence.some((item) => item.kind === 'file' && item.verified);
            const hasRunEvidence = evidence.some((item) => item.kind === 'run' && item.verified);
            const hasConnectionEvidence = evidence.some((item) => item.kind === 'connection' && item.verified);
            const hasOperationEvidence = hasRunEvidence || hasConnectionEvidence;
            const hasMixedEvidence = hasFileEvidence || hasOperationEvidence;
            const reviewSteps = run.steps.filter((step) => step.kind === 'review');
            const hasReviewEvidence = reviewSteps.length === 0 || evidence.some((item) => item.kind === 'review' && item.verified);
            const deliveryVerification = deliverableType === 'file'
              ? [{ kind: 'file' as const, label: '文件交付', status: hasFileEvidence ? 'passed' as const : 'blocked' as const, detail: hasFileEvidence ? '要求的文件已写入并通过磁盘验证' : '该任务要求文件交付，但没有可交接的真实文件' }]
              : deliverableType === 'connection'
                ? [{ kind: 'connection' as const, label: '连接验证', status: hasConnectionEvidence ? 'passed' as const : 'blocked' as const, detail: hasConnectionEvidence ? '已完成最小真实连接调用' : '该任务要求连接可用性，但尚未取得真实连接证据' }]
                : deliverableType === 'operation'
                  ? [{ kind: 'run' as const, label: '操作结果', status: hasOperationEvidence ? 'passed' as const : 'blocked' as const, detail: hasOperationEvidence ? '已保留真实操作或连接结果' : '该任务要求实际操作，但尚未取得运行或连接证据' }]
                  : deliverableType === 'mixed'
                    ? [{ kind: 'file' as const, label: '交付证据', status: hasMixedEvidence ? 'passed' as const : 'blocked' as const, detail: hasMixedEvidence ? '已保留与任务匹配的文件、运行或连接证据' : '混合交付尚未保留任何真实文件、运行或连接证据' }]
                    : [];
            run.verification = [
              ...deliveryVerification,
              ...(reviewSteps.length ? [{ kind: 'review' as const, label: '责任审查', status: hasReviewEvidence ? 'passed' as const : 'blocked' as const, detail: hasReviewEvidence ? '审查步骤已给出明确结论' : '审查步骤没有提交具体的通过或退回依据' }] : []),
            ];
            const verificationBlocked = run.verification.some((item) => item.status === 'blocked');
            run.status = stopped ? 'stopped' : paused ? 'paused' : hasFailed || hasUnfinished || verificationBlocked ? 'failed' : 'completed';
            run.phase = stopped || paused ? 'blocked' : hasFailed || hasUnfinished || verificationBlocked ? 'blocked' : 'verifying';
            if (!stopped && !paused && !hasFailed && !hasUnfinished && verificationBlocked) {
              run.lastError = `验收未通过：${run.verification.filter((item) => item.status === 'blocked').map((item) => item.detail).join('；')}`;
              run.handoff = {
                ts: Date.now(), completed: run.steps.filter((step) => step.status === 'completed').map((step) => step.title),
                blocked: run.lastError, nextAction: '点击继续执行，只补齐缺少的产出、运行、连接或审查证据。',
              };
            }
            if (!stopped && !paused && hasUnfinished) {
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
            if (stopped) {
              run.lastError = undefined;
              run.steps.forEach((step) => {
                if (step.status !== 'completed' && step.status !== 'failed') {
                  step.status = 'stopped';
                  step.events.push({ ts: Date.now(), type: 'status', detail: '用户已停止任务' });
                }
              });
              run.handoff = {
                ts: Date.now(),
                completed: run.steps.filter((step) => step.status === 'completed').map((step) => step.title),
                blocked: '任务已由用户停止。',
                nextAction: '已完成内容会保留；需要继续时请重新发起任务。',
              };
            }
            if (!stopped && !paused && !hasFailed && !hasUnfinished && !verificationBlocked) {
              run.phase = 'completed';
              run.preflight = (run.preflight ?? []).map((item) => item.label === '确认最终验收'
                ? { ...item, status: 'passed', detail: '所有任务步骤已完成并通过最终汇总' }
                : item);
            }
            if (run.recoveryContext) {
              run.recoveryContext.summary = run.status === 'completed' ? '任务已完成并保留验收证据。'
                : run.status === 'paused' ? '任务已暂停，等待用户继续。'
                  : run.status === 'stopped' ? '任务已停止，已完成内容仍然保留。'
                    : '任务尚有未决问题，等待处理后恢复。';
              run.recoveryContext.budget.updatedAt = Date.now();
            }
          });
          if (liveRun) void reportAdapterCheckpoint({
            kind: 'run_finished',
            finalStatus: liveRun.status,
            summary: liveRun.status === 'completed' ? '执行适配器已完成并通过验收' : (liveRun.lastError || `任务状态：${liveRun.status}`),
          });
        },
      }, {
        shouldStop: () => !!opts?.runId && (pausedRunIdsRef.current.has(opts.runId) || stoppedRunIdsRef.current.has(opts.runId)),
        consumeSteeringMessages: () => {
          const scheduler = schedulerRef.current.get(teamId);
          const messages = scheduler?.steering?.splice(0) ?? [];
          if (messages.length) updateRun((run) => {
            if (!run.recoveryContext) return;
            run.recoveryContext.steeringMessages = [...run.recoveryContext.steeringMessages, ...messages.map((message) => message.slice(0, 500))].slice(-12);
            run.recoveryContext.summary = '已收到运行中新增要求，正在结合当前进度调整。';
            run.recoveryContext.budget.updatedAt = Date.now();
          });
          return messages;
        },
        getModelRequestSignal: () => {
          const scheduler = schedulerRef.current.get(teamId);
          if (!scheduler) return new AbortController().signal;
          if (!scheduler.modelRequestController || scheduler.modelRequestController.signal.aborted) scheduler.modelRequestController = new AbortController();
          return scheduler.modelRequestController.signal;
        },
      }
    );
    }).catch((error) => {
      updateRun((run) => { run.status = 'failed'; run.lastError = error instanceof Error ? error.message : String(error); });
    }).finally(async () => {
      if (workerHeartbeatTimer) clearInterval(workerHeartbeatTimer);
      await adapterCheckpointQueue;
      if (adapterCheckpointError) updateRun((run) => {
        run.status = 'failed';
        run.phase = 'blocked';
        run.lastError = `后台执行检查点写入失败：${adapterCheckpointError}`;
        run.handoff = {
          ts: Date.now(),
          completed: run.steps.filter((step) => step.status === 'completed').map((step) => step.title),
          blocked: run.lastError,
          nextAction: '保留当前窗口与工作区，检查任务账本后点击“继续执行”。',
        };
        appendTaskRunContext(run, { type: 'blocked', source: 'system', summary: run.lastError, verified: false });
      });
      if (liveRun && workerLeaseId && !pausedRunIdsRef.current.has(liveRun.id) && !stoppedRunIdsRef.current.has(liveRun.id)) {
        const released = await sendTaskWorkerCommand({ taskId: liveRun.id, type: 'release', requestedBy: 'renderer-team-discussion', payload: { leaseId: workerLeaseId } });
        if (released?.ok && released.run) {
          liveRun = released.run;
          dispatch({ type: 'UPDATE_TASK_RUN', run: liveRun });
        }
      }
      for (const memberId of team.memberIds) {
        dispatch({ type: 'UPDATE_EMPLOYEE', id: memberId, partial: { isWorking: false } });
      }
      discussingRef.current.delete(teamId);
      const scheduler = schedulerRef.current.get(teamId);
      if (scheduler) {
        scheduler.modelRequestController?.abort();
        scheduler.modelRequestController = undefined;
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
        scheduler.modelRequestController?.abort();
        scheduler.modelRequestController = new AbortController();
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

  const enqueueTeamAssistantReply = async (team: Team, content: string, conversationId: string): Promise<{ reply: string; messageId: string } | undefined> => {
    const busyKey = `${team.id}:${conversationId}`;
    if (supervisorBusyRef.current.has(busyKey)) return undefined;
    supervisorBusyRef.current.add(busyKey);
    const sanitizeAssistantReply = (reply: string) => {
      return reply.replace(/^(?:收到|好的|明白)[，,。！!：:\s]*/u, '').trim() || reply.trim();
    };
    const appendAssistantMessage = (reply: string, tokens?: number): { reply: string; messageId: string } => {
      const visibleReply = sanitizeAssistantReply(reply);
      const messageId = `msg-supervisor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const mentions = resolveMentionedEmployees(visibleReply, stateRef.current.employees)
        .filter((employee) => team.memberIds.includes(employee.id))
        .map((employee) => employee.id);
      dispatch({
        type: 'APPEND_CHAT',
        teamId: team.id,
        conversationId,
        msgs: [{
          id: messageId,
          authorId: 'assistant',
          roleId: 'custom',
          content: visibleReply,
          mentions,
          timestamp: Date.now(),
          kind: 'text',
          tokens,
          conversationId,
        }],
      });
      return { reply: visibleReply, messageId };
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
      const layeredMemoryContext = await buildLayeredMemoryContext({ query: content, teamId: team.id, limit: 16 });
      const userContext = [client.buildUserContext(), layeredMemoryContext].filter(Boolean).join('\n\n');
      const availableSkills = await listSkills().catch(() => []);
      const skillRoster = availableSkills.slice(0, 80).map((skill) => `${skill.name}${skill.description ? `：${skill.description.slice(0, 80)}` : ''}`).join('\n');
      const turns: client.ChatTurn[] = [
        {
          role: 'system',
          content: `${configuredPrompt ? `## 助理配置\n${configuredPrompt}\n\n` : ''}${userContext ? `${userContext}\n` : ''}你是${APP_PRODUCT_NAME}的章北海助理，也是这个团队里的常驻主助理。\n\n## 对话职责\n- 老板没有明确 @ 某位员工时，你直接理解、回答、追问必要条件或调整执行方案；不要复述老板原话，不要自称监工或临时调度员。\n- 老板明确 @ 某位员工时，该员工拥有回复权；不要抢答或代替其工作。\n- 多人任务的分工、依赖、交付和验收由任务系统处理。你只在真实状态基础上汇报，不编造成员回复、文件、连接或后台进度。\n- 普通沟通直接回答。不要为了展示流程重复输出“收到需求”“需求复述”“已完成分工”等模板化文案。\n\n## 当前团队（唯一可调度范围）\n团队名称：${team.name}\n${teamRoster || '暂无成员'}\n\n## 可用 Skill\n${skillRoster || '暂无可用 Skill'}\n\n你可以解释、分析、协调和汇报，但不能伪造成员已完成的成果。你自己不是团队成员，不能@自己。`,
        },
        { role: 'system', content: BEGINNER_RESPONSE_GUIDE },
        ...team.chatMessages.filter((message) => messageBelongsToConversation(message, conversationId, `team:${team.id}`)).slice(-12).map((message) => ({
          role: message.roleId === 'human' ? 'user' as const : 'assistant' as const,
          content: `${stateRef.current.employees.find((employee) => employee.id === message.authorId)?.name ?? '团队成员'}: ${message.content}`,
        })),
        { role: 'user', content: `老板@你说：${content}` },
      ];
      if (!client.resolveApiBase(assistantModel)) {
        const reply = `⚠️ 章北海助理没有可用模型配置，无法进行真实对话或调度。请在设置中激活全局模型，或为助理选择模型后重试。`;
        return appendAssistantMessage(reply);
      }
      const result = await client.chatCompletion(turns, 'assistant-team', `章北海/${team.name}`, undefined, assistantModel);
      const reply = result.content?.trim().replace(/@Hermes(?:\s+助理)?|@章北海(?:\s+助理)?|@驴狗蛋(?:\s+助手)?/gu, '章北海助理');
      if (!reply) return undefined;
      const assistantResult = appendAssistantMessage(reply, result.usage.totalTokens);
      client.extractUserInsights(`老板：${content}\n章北海回复：${reply}`, `团队主助理-${team.name}`).catch(() => {});
      return assistantResult;
    } catch (error) {
      console.warn('[supervisor] reply failed:', error);
      const reason = error instanceof Error ? error.message : String(error);
      const reply = `⚠️ 章北海助理本次模型调用失败：${reason.slice(0, 180)}。任务没有被伪装为已执行；请检查模型连接后重试。`;
      return appendAssistantMessage(reply);
    } finally {
      supervisorBusyRef.current.delete(busyKey);
    }
  };

  const startNativeTaskExecution = async (run: TaskRun, extraSystemContext: string, attachments?: import('./data/hermesClient').Attachment[]) => {
    if (!window.electronAPI?.taskExecutionStart) return null;
    const current = stateRef.current;
    const requiredIds = new Set(run.steps.map((step) => step.employeeId));
    const members = run.memberSnapshot
      .filter((member) => requiredIds.has(member.id))
      .map((member) => {
        const employee = current.employees.find((item) => item.id === member.id);
        return { ...member, modelConfig: employee ? client.getEmployeeModel(employee) : {} };
      });
    const connectors = loadConnectors().map((connector) => {
      const preset = CONNECTOR_PRESETS.find((item) => item.mcpServerName === connector.mcpServerName);
      const actions = [...(preset?.actions ?? []), ...(connector.discoveredActions ?? [])]
        .filter((action, index, all) => all.findIndex((item) => (item.mcpToolName ?? item.name) === (action.mcpToolName ?? action.name)) === index);
      return { ...connector, actions };
    });
    return window.electronAPI.taskExecutionStart({
      taskId: run.id,
      run,
      members,
      attachments,
      extraSystemContext,
      executionPolicy: client.getExecutionPolicy(),
      reviewModelConfig: client.getReviewModel(),
      memoryWriteApproval: client.loadSettings().memoryWriteApproval !== false,
      connectors,
      connectorTools: getConnectorTools(),
    });
  };

  // A native task that was only interrupted by an app restart returns to the
  // queue. Credentials are re-read from this device's current model settings,
  // never from the persisted task record.
  useEffect(() => {
    if (!window.electronAPI?.taskExecutionStart) return;
    for (const run of state.taskRuns) {
      if (run.status !== 'queued' || !run.recoveryContext?.autoResume) continue;
      const members = run.memberSnapshot
        .map((member) => state.employees.find((employee) => employee.id === member.id))
        .filter((employee): employee is Employee => !!employee);
      const signature = members.map((employee) => {
        const config = client.getEmployeeModel(employee);
        return `${employee.id}:${config.apiHost ?? ''}:${config.model ?? ''}`;
      }).join('|');
      if (autoResumeAttemptRef.current.get(run.id) === signature) continue;
      autoResumeAttemptRef.current.set(run.id, signature);
      if (members.length !== run.memberSnapshot.length || members.some((employee) => !client.resolveApiBase(client.getEmployeeModel(employee)))) {
        dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(run, (next) => {
          if (!next.recoveryContext) return;
          next.recoveryContext.summary = '任务已在后台队列中恢复，但还缺少本机模型配置，配置完成后会自动继续。';
          next.recoveryContext.waitingFor = '为任务成员配置可用模型';
        }) });
        continue;
      }
      void startNativeTaskExecution(run, taskRunContextPrompt(run)).then((result) => {
        if (!result?.ok) {
          autoResumeAttemptRef.current.delete(run.id);
          return;
        }
        const latest = stateRef.current.taskRuns.find((item) => item.id === run.id);
        if (!latest) return;
        dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(latest, (next) => {
          if (!next.recoveryContext) return;
          next.recoveryContext.summary = '后台任务已恢复，正在从未完成步骤继续执行。';
          next.recoveryContext.autoResume = false;
          next.recoveryContext.waitingFor = undefined;
        }) });
      });
    }
  }, [state.taskRuns, state.employees, dispatch]);

  const startTaskRun = async (teamId: string, request: string, employeeIds: string[], sourceMessageId?: string, attachments?: import('./data/hermesClient').Attachment[], explicitSkillRefs: import('./types').SkillReference[] = [], taskDecision?: import('./engine/taskDecisionKernel.mjs').TaskDecision, requestedConversationId?: string, projectBrief?: Project['brief']) => {
    const current = stateRef.current;
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return;
    const conversationId = requestedConversationId
      ?? team.chatMessages.find((message) => message.id === sourceMessageId)?.conversationId
      ?? ensureActiveChatSession(`team:${teamId}`);
    let plan = buildTaskPlan(team, current.employees, request, employeeIds);
    let codingProject: import('./engine/codingProject.mjs').CodingProject | undefined;
    if (projectBrief) {
      try {
        codingProject = compileCodingProject({
          goal: request,
          projectBrief,
          members: current.employees,
          memberIds: employeeIds,
        });
        if (codingProject.status === 'ready') {
          plan = codingProjectToTaskSteps(codingProject).map((step, index) => ({
            id: String(step.id),
            employeeId: String(step.employeeId || ''),
            order: index + 1,
            kind: step.kind === 'review' ? 'review' as const : 'work' as const,
            title: String(step.title),
            assignment: String(step.assignment),
            deliverableType: step.deliverableType as import('./types').TaskPlanStep['deliverableType'],
            dependsOnStepIds: Array.isArray(step.dependsOnStepIds) ? step.dependsOnStepIds.map(String) : [],
          })).filter((step) => step.employeeId);
        }
      } catch {
        // Non-software ProjectBriefs continue through the existing planner.
        codingProject = undefined;
      }
    }
    const skillRefs = explicitSkillRefs.length ? explicitSkillRefs : await matchSkills(request);
    const skillBundle = await buildSkillContextWithEvidence(skillRefs);
    const skillContext = skillBundle.context;
    const run = createTaskRun(team, current.employees, request, plan, sourceMessageId, skillRefs, undefined, taskDecision, conversationId);
    if (codingProject) run.codingProject = codingProject;
    const historyMatches = searchTaskRunHistory(current.taskRuns, request, { teams: current.teams, limit: 4 });
    const historyContext = buildTaskHistoryPrompt(historyMatches);
    const layeredMemoryContext = await buildLayeredMemoryContext({ query: request, teamId, limit: 18 });
    run.skillEvidence = skillBundle.evidence;
    appendTaskRunContext(run, {
      type: skillRefs.length ? 'decision' : 'progress', source: 'system',
      summary: skillRefs.length ? `已匹配 ${skillRefs.length} 个 Skill，并记录读取结果。` : '本任务没有匹配到必要 Skill，使用通用工具继续。',
      verified: true,
    });
    if (historyMatches.length > 0) {
      appendTaskRunContext(run, {
        type: 'history', source: 'system',
        summary: `检索到 ${historyMatches.length} 个相似历史任务，仅作为当前任务的只读参考。`,
        verified: false,
        data: { taskIds: historyMatches.map((item) => item.taskId) },
      });
    }
    run.projectId = team.projectId;
    if (projectBrief) {
      appendTaskRunContext(run, {
        type: 'decision', source: 'system', verified: true,
        summary: `本任务遵循已批准的项目策划 v${projectBrief.version}，共 ${projectBrief.stages.length} 个阶段。`,
        data: { projectBriefVersion: projectBrief.version, stages: projectBrief.stages.map((stage) => stage.id) },
      });
    }
    if (codingProject) {
      appendTaskRunContext(run, {
        type: 'decision', source: 'system', verified: true,
        summary: codingProject.status === 'ready'
          ? `已将项目简报编译为 Coding DAG：${codingProject.stages.map((stage) => stage.title).join(' -> ')}。`
          : `Coding DAG 发现 ${codingProject.staffingGaps.length} 个职责缺口，未把任务交给不匹配的成员。`,
        data: { codingProjectVersion: codingProject.codingProjectVersion, status: codingProject.status, staffingGaps: codingProject.staffingGaps },
      });
      if (codingProject.status !== 'ready') {
        run.status = 'awaiting_user';
        run.phase = 'awaiting_user';
        run.handoff = {
          ts: Date.now(), completed: [],
          blocked: `缺少可负责的职责：${codingProject.staffingGaps.map((gap) => gap.capability).join('、')}`,
          nextAction: '补充对应专家到团队后再继续执行；系统会保留现有项目简报和已确定的职责边界。',
        };
        dispatch({ type: 'CREATE_TASK_RUN', run });
        return;
      }
    }
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
    try {
      await initializeTaskWorkspace(run.workspaceId!, { kind: 'team', label: `${team.name} / ${run.title}`, taskId: run.id });
      await copyAttachmentsToWorkspace(`team:${team.id}`, run.workspaceId!, attachments ?? []);
      run.preflight = (run.preflight ?? []).map((item) => item.label === '初始化独立工作区'
        ? { ...item, status: 'passed', detail: `已建立任务目录：${run.workspaceId}` }
        : item);
    } catch (error) {
      run.status = 'failed';
      run.phase = 'blocked';
      run.lastError = error instanceof Error ? error.message : String(error);
      run.preflight = (run.preflight ?? []).map((item) => item.label === '初始化独立工作区'
        ? { ...item, status: 'blocked', detail: run.lastError }
        : item);
      run.handoff = {
        ts: Date.now(), completed: [], blocked: run.lastError,
        nextAction: '打开“设置 → 诊断中心”检查工作区权限，修复后点击“继续执行”。',
      };
      dispatch({ type: 'CREATE_TASK_RUN', run });
      return;
    }
    dispatch({ type: 'CREATE_TASK_RUN', run });
    const extraSystemContext = [briefExecutionContext(projectBrief), layeredMemoryContext, skillContext, historyContext, taskRunContextPrompt(run)].filter(Boolean).join('\n\n');
    const nativeResult = await startNativeTaskExecution(run, extraSystemContext, attachments);
    if (nativeResult) {
      if (!nativeResult.ok) {
        dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(run, (next) => {
          next.status = 'failed';
          next.phase = 'blocked';
          next.lastError = nativeResult.error || '主进程执行器启动失败';
          next.handoff = { ts: Date.now(), completed: [], blocked: next.lastError, nextAction: '检查模型和工作区配置后点击“继续执行”。' };
        }) });
      }
      return;
    }
    enqueueDiscussion(teamId, {
      userText: request, attachments, triggerMessageId: sourceMessageId, discussionId: run.id,
      conversationId,
      forcedMemberIds: run.steps.map((step) => step.employeeId), runSteps: run.steps, maxRounds: run.steps.length, runId: run.id, workspaceId: run.workspaceId,
      extraSystemContext,
    }, 120);
  };

  const pauseTaskRun = (runId: string) => {
    pausedRunIdsRef.current.add(runId);
    const run = stateRef.current.taskRuns.find((item) => item.id === runId);
    if (run) schedulerRef.current.get(run.teamId)?.modelRequestController?.abort();
    if (!run) return;
    const fallback = () => dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(run, (next) => {
      next.status = 'paused'; next.steps.forEach((step) => { if (step.status === 'queued' || step.status === 'running') step.status = 'paused'; });
      if (next.recoveryContext) next.recoveryContext.summary = '任务已暂停，工作区和上下文均已保留。';
    }) });
    void sendTaskWorkerCommand({ taskId: runId, type: 'pause', requestedBy: 'task-control' }).then((result) => {
      if (result?.ok && result.run) dispatch({ type: 'UPDATE_TASK_RUN', run: result.run });
      else fallback();
    });
  };

  const resumeTaskRun = async (runId: string): Promise<void> => {
    const run = stateRef.current.taskRuns.find((item) => item.id === runId);
    if (!run) return;
    const pendingSteps = run.status === 'awaiting_user'
      ? run.steps.filter((step) => step.status !== 'completed' && step.status !== 'stopped')
      : run.steps.filter((step) => step.status === 'paused' || step.status === 'failed' || step.status === 'queued');
    const pending = pendingSteps.map((step) => step.employeeId);
    const pendingStepIds = new Set(pendingSteps.map((step) => step.id));
    if (!pendingSteps.length) return;
    const reportResumeFailure = (message: string) => {
      const latest = stateRef.current.taskRuns.find((item) => item.id === runId) ?? run;
      dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(latest, (next) => {
        const reason = message.slice(0, 900);
        next.status = ['paused', 'failed', 'awaiting_user'].includes(next.status) ? next.status : 'failed';
        next.phase = next.status === 'awaiting_user' ? 'awaiting_user' : 'blocked';
        next.lastError = reason;
        next.handoff = {
          ts: Date.now(),
          completed: next.steps.filter((step) => step.status === 'completed').map((step) => step.title),
          blocked: reason,
          nextAction: '恢复命令没有生效。请查看本条真实错误；修复后可再次点击“继续执行”，已完成步骤不会重做。',
        };
        if (next.recoveryContext) {
          next.recoveryContext.summary = `恢复未启动：${reason}`;
          next.recoveryContext.unresolvedIssues = [...next.recoveryContext.unresolvedIssues, reason].slice(-12);
          next.recoveryContext.waitingFor = reason;
        }
      }) });
    };
    try {
      const preparing = updateTaskRun(run, (next) => {
        if (!next.recoveryContext) return;
        next.recoveryContext.summary = '正在校验恢复条件，并按子任务到父任务的顺序重新入队。';
        next.recoveryContext.waitingFor = undefined;
      });
      dispatch({ type: 'UPDATE_TASK_RUN', run: preparing });
      const resumedByWorker = await sendTaskWorkerCommand({ taskId: runId, type: 'resume', requestedBy: 'task-control' });
      if (resumedByWorker && !resumedByWorker.ok) {
        reportResumeFailure(resumedByWorker.error || '后台 Worker 拒绝了恢复命令。');
        return;
      }
      pausedRunIdsRef.current.delete(runId);
      stoppedRunIdsRef.current.delete(runId);
      const workerRun = resumedByWorker?.run ?? updateTaskRun(run, (next) => {
        next.status = 'queued'; next.phase = 'preflight'; next.lastError = undefined; next.handoff = undefined;
        next.steps.forEach((step) => { if (pendingStepIds.has(step.id)) step.status = 'queued'; });
      });
      try {
        await initializeTaskWorkspace(workerRun.workspaceId!, { kind: 'team', label: `恢复任务 / ${workerRun.title}`, taskId: workerRun.id });
      } catch (error) {
        dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(workerRun, (next) => {
          next.status = 'failed'; next.phase = 'blocked'; next.lastError = error instanceof Error ? error.message : String(error);
          next.handoff = { ts: Date.now(), completed: next.steps.filter((step) => step.status === 'completed').map((step) => step.title), blocked: next.lastError, nextAction: '到“设置 → 诊断中心”修复工作区后再次继续。' };
          if (next.recoveryContext) next.recoveryContext.unresolvedIssues = [...next.recoveryContext.unresolvedIssues, next.lastError!].slice(-12);
        }) });
        return;
      }
      const resumedRun = updateTaskRun(workerRun, (next) => {
        next.executionSessionId = getExecutionSessionId();
        if (next.recoveryContext) {
          next.recoveryContext.summary = '恢复检查已通过，准备从未完成步骤继续。';
          next.recoveryContext.interruptedAt = undefined;
          next.recoveryContext.interruptionReason = undefined;
          if (next.recoveryContext.controller) {
            next.recoveryContext.controller = applyExecutionSteering(next.recoveryContext.controller, '用户已要求继续执行；重新验证上次阻塞条件，再从未完成步骤推进。');
          }
        }
      });
      dispatch({ type: 'UPDATE_TASK_RUN', run: resumedRun });
      const skillBundle = await buildSkillContextWithEvidence(workerRun.skillRefs ?? []);
      const resumedWithSkills = updateTaskRun(resumedRun, (next) => {
        next.skillEvidence = [...(next.skillEvidence ?? []), ...skillBundle.evidence].slice(-60);
        appendTaskRunContext(next, { type: 'progress', source: 'system', summary: '恢复任务时重新读取已选 Skill，并沿用原任务上下文。', verified: true });
      });
      dispatch({ type: 'UPDATE_TASK_RUN', run: resumedWithSkills });
      const workerPendingSteps = resumedWithSkills.steps.filter((step) => pendingStepIds.has(step.id));
      const layeredMemoryContext = await buildLayeredMemoryContext({ query: workerRun.goal || workerRun.request, teamId: workerRun.teamId, limit: 18 });
      const extraSystemContext = [layeredMemoryContext, skillBundle.context, taskRunContextPrompt(resumedWithSkills)].filter(Boolean).join('\n\n');
      const nativeResult = await startNativeTaskExecution(resumedWithSkills, extraSystemContext);
      if (!nativeResult) {
        enqueueDiscussion(workerRun.teamId, { userText: workerRun.request, triggerMessageId: workerRun.sourceMessageId, discussionId: workerRun.id, conversationId: workerRun.conversationId, forcedMemberIds: pending, runSteps: workerPendingSteps, maxRounds: workerPendingSteps.length, runId, workspaceId: workerRun.workspaceId, extraSystemContext }, 50);
      } else if (!nativeResult.ok) {
        reportResumeFailure(nativeResult.error || '主进程执行器恢复失败。');
      }
    } catch (error) {
      reportResumeFailure(error instanceof Error ? error.message : String(error));
    }
  };

  const stopTaskRun = (runId: string) => {
    stoppedRunIdsRef.current.add(runId);
    pausedRunIdsRef.current.delete(runId);
    const run = stateRef.current.taskRuns.find((item) => item.id === runId);
    if (run) schedulerRef.current.get(run.teamId)?.modelRequestController?.abort();
    if (!run) return;
    const fallback = () => dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(run, (next) => {
      next.status = 'stopped';
      next.phase = 'blocked';
      next.lastError = undefined;
      next.steps.forEach((step) => {
        if (step.status === 'queued' || step.status === 'running' || step.status === 'paused') {
          step.status = 'stopped';
          step.events.push({ ts: Date.now(), type: 'status', detail: '用户已停止任务' });
        }
      });
      next.handoff = {
        ts: Date.now(),
        completed: next.steps.filter((step) => step.status === 'completed').map((step) => step.title),
        blocked: '任务已由用户停止。',
        nextAction: '已完成内容会保留；需要继续时请重新发起任务。',
      };
    }) });
    void sendTaskWorkerCommand({ taskId: runId, type: 'stop', requestedBy: 'task-control' }).then((result) => {
      if (result?.ok && result.run) dispatch({ type: 'UPDATE_TASK_RUN', run: result.run });
      else fallback();
    });
  };

  const closeTaskRun = (runId: string) => {
    pausedRunIdsRef.current.add(runId);
    void sendTaskWorkerCommand({ taskId: runId, type: 'close', requestedBy: 'task-control' }).then(() => {
      dispatch({ type: 'REMOVE_TASK_RUN', runId });
    });
  };

  const clearTeamExecution = (targetTeamId: string) => dispatch({ type: 'CLEAR_TEAM_EXECUTION', teamId: targetTeamId });

  const buildTeamTaskRequest = (team: Team, content: string, conversationId: string): string => {
    const current = content.trim();
    const needsPriorContext = current.length < 120
      || /拉团队|组建团队|拉群|开始执行|继续执行|按刚才|按照上面|这个任务|该项目/u.test(current);
    if (!needsPriorContext) return current;
    const prior = team.chatMessages
      .filter((message) => messageBelongsToConversation(message, conversationId, `team:${team.id}`))
      .filter((message) => message.roleId === 'human')
      .slice(-6)
      .map((message) => message.content.trim())
      .filter(Boolean)
      .join('\n');
    return prior ? `${prior}\n\n老板最新要求：${current}` : current;
  };

  const runDirectEmployeeReply = async (
    team: Team,
    employeeId: string,
    content: string,
    sourceMessageId: string,
    conversationId: string,
    attachments?: import('./data/hermesClient').Attachment[],
    inReplyToMessageId?: string,
  ) => {
    const current = stateRef.current;
    const employee = current.employees.find((item) => item.id === employeeId && team.memberIds.includes(item.id));
    if (!employee) return;
    const discussionId = `mention-${sourceMessageId}-${employee.id}`;
    dispatch({ type: 'UPDATE_EMPLOYEE', id: employee.id, partial: { isWorking: true, currentTask: '正在回复团队点名' } });
    try {
      const unfilteredTeam = stateRef.current.teams.find((item) => item.id === team.id) ?? team;
      const liveTeam = { ...unfilteredTeam, chatMessages: unfilteredTeam.chatMessages.filter((message) => messageBelongsToConversation(message, conversationId, `team:${team.id}`)) };
      const result = await runTeamMentionReply(liveTeam, stateRef.current.employees, {
        employeeId: employee.id,
        userText: content,
        triggerMessageId: sourceMessageId,
        discussionId,
        attachments,
        extraSystemContext: `当前是团队「${liveTeam.name}」中的点名回复。只回答老板本次问题，不把普通追问升级成正式任务。`,
      });
      dispatch({
        type: 'APPEND_CHAT',
        teamId: team.id,
        msgs: [{
          id: `msg-mention-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          authorId: result.employee.id,
          authorName: result.employee.name,
          roleId: result.employee.role,
          content: result.text,
          mentions: result.mentions,
          timestamp: Date.now(),
          kind: 'text',
          tokens: result.tokens,
          contextUsage: result.contextUsage,
          discussionId,
          triggeredBy: 'message',
          inReplyToMessageId: inReplyToMessageId ?? sourceMessageId,
          conversationId,
        }],
        conversationId,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      dispatch({
        type: 'APPEND_CHAT',
        teamId: team.id,
        msgs: [{
          id: `msg-mention-error-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          authorId: employee.id,
          authorName: employee.name,
          roleId: employee.role,
          content: `⚠️ ${employee.name} 回复失败：${reason.slice(0, 240)}`,
          mentions: [], timestamp: Date.now(), kind: 'text',
          discussionId, triggeredBy: 'message',
          inReplyToMessageId: inReplyToMessageId ?? sourceMessageId,
          conversationId,
        }],
        conversationId,
      });
    } finally {
      dispatch({ type: 'UPDATE_EMPLOYEE', id: employee.id, partial: { isWorking: false, currentTask: undefined } });
    }
  };

  const enqueueAutoDiscussion = (teamId: string, messageId: string, content: string, mentions: string[], attachments?: import('./data/hermesClient').Attachment[], skillRefs: import('./types').SkillReference[] = [], conversationId = ensureActiveChatSession(`team:${teamId}`)) => {
    const current = stateRef.current;
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return;
    const runBelongsToConversation = (run: TaskRun) => run.conversationId === conversationId
      || (!run.conversationId && conversationId === legacyConversationId(`team:${teamId}`));
    void (async () => {
      const directMentions = mentions.filter((id) => team.memberIds.includes(id));
      const supervisorMentioned = mentions.includes('assistant');
      const directControl = getDirectExecutionControl(content);
      if (directControl) {
        const activeRuns = current.taskRuns.filter((run) => run.teamId === teamId && runBelongsToConversation(run) && (run.status === 'queued' || run.status === 'running'));
        const latestPaused = [...current.taskRuns].reverse().find((run) => run.teamId === teamId && runBelongsToConversation(run) && run.status === 'paused');
        if (directControl === 'resume') {
          if (latestPaused) resumeTaskRun(latestPaused.id);
        } else {
          activeRuns.forEach((run) => directControl === 'stop' ? stopTaskRun(run.id) : pauseTaskRun(run.id));
        }
        dispatch({
          type: 'APPEND_CHAT', teamId, conversationId,
          msgs: [{
            id: `msg-direct-control-${Date.now()}`, authorId: 'assistant', roleId: 'custom',
            content: directControl === 'resume'
              ? latestPaused ? '团队任务已继续，会从暂停时保留的步骤接着执行。' : '当前没有暂停中的团队任务。'
              : directControl === 'stop'
                ? '团队任务已停止，已完成内容保留；旧任务不会自行恢复。'
                : '团队任务已暂停。你仍可以继续对话，只有明确说“继续”才会恢复。',
            mentions: [], timestamp: Date.now(), kind: 'text',
          }],
        });
        return;
      }
      const localOfficeQuery = classifyLocalOfficeQuery(content);
      if (localOfficeQuery) {
        dispatch({
          type: 'APPEND_CHAT', teamId, conversationId,
          msgs: [{
            id: `msg-office-fact-${Date.now()}`, authorId: 'assistant', roleId: 'custom',
            content: formatLocalOfficeAnswer(localOfficeQuery, current.employees, current.teams),
            mentions: [], timestamp: Date.now(), kind: 'text',
          }],
        });
        return;
      }
      if (isTeamMemberAdditionRequest(content)) {
        const mentionedEmployees = resolveMentionedEmployees(content, current.employees);
        const newMembers = mentionedEmployees.filter((employee) => !team.memberIds.includes(employee.id));
        if (newMembers.length) {
          addTeamMembers(team.id, newMembers.map((employee) => employee.id));
        } else {
          const alreadyMembers = mentionedEmployees.filter((employee) => team.memberIds.includes(employee.id));
          dispatch({
            type: 'APPEND_CHAT', teamId, conversationId,
            msgs: [{
              id: `msg-member-add-help-${Date.now()}`, authorId: 'assistant', roleId: 'custom',
              content: alreadyMembers.length
                ? `${alreadyMembers.map((employee) => employee.name).join('、')} 已经在「${team.name}」中，不需要重复添加。`
                : '我知道你要补充团队成员，但没有识别到明确的员工姓名。请直接说“把员工姓名加入团队”，或点成员栏顶部的添加按钮选择。',
              mentions: alreadyMembers.map((employee) => employee.id), timestamp: Date.now(), kind: 'text',
            }],
          });
        }
        return;
      }
      if (isTeamControlRequest(content)) {
        const pauseRequested = /(?:暂停|停止|先停|停下|别做|不要继续).{0,12}(?:工作|任务|手上|当前|执行)|(?:工作|任务).{0,8}(?:暂停|停止)/u.test(content);
        const reportRequested = /(?:模型|配置|状态|报数|报个数|数数|在线情况)/u.test(content);
        const targets = (directMentions.length ? directMentions : team.memberIds)
          .map((id) => current.employees.find((employee) => employee.id === id))
          .filter((employee): employee is Employee => !!employee);

        if (pauseRequested) {
          current.taskRuns
            .filter((run) => run.teamId === teamId && runBelongsToConversation(run) && (run.status === 'queued' || run.status === 'running'))
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
        if (messages.length) dispatch({ type: 'APPEND_CHAT', teamId, msgs: messages, conversationId });
        return;
      }
      // A direct employee mention is not automatically a new task. Keep
      // ordinary follow-ups in the employee's own conversation, even when a
      // previous TaskRun for this team has already finished.
      if (directMentions.length > 0 && !supervisorMentioned) {
        const route = classifyTeamMention(content);
        if (route === 'reply') {
          for (const employeeId of directMentions) {
            await runDirectEmployeeReply(team, employeeId, content, messageId, conversationId, attachments);
          }
          return;
        }
        if (route === 'task') {
          void startTaskRun(teamId, buildTeamTaskRequest(team, content, conversationId), directMentions, messageId, attachments, skillRefs, undefined, conversationId);
          return;
        }
      }
      if (shouldHoldTaskForFeedback(content)) {
        current.taskRuns
          .filter((run) => run.teamId === teamId && runBelongsToConversation(run) && (run.status === 'queued' || run.status === 'running'))
          .forEach((run) => pauseTaskRun(run.id));
        await enqueueTeamAssistantReply(team, content, conversationId);
        return;
      }
      if (isConversationOnlyMessage(content)) {
        await enqueueTeamAssistantReply(team, content, conversationId);
        return;
      }
      const activeRun = [...current.taskRuns].reverse().find((run) => run.teamId === teamId && runBelongsToConversation(run) && (run.status === 'queued' || run.status === 'running'));
      if (activeRun && (client.loadSettings().followUpMode ?? 'steer') === 'steer' && window.electronAPI?.taskExecutionSteer) {
        const steered = await window.electronAPI.taskExecutionSteer({ taskId: activeRun.id, message: content });
        if (steered.ok) {
          await enqueueTeamAssistantReply(team, content, conversationId);
          return;
        }
      }
      const taskRequest = buildTeamTaskRequest(team, content, conversationId);
      const taskDecision = await client.compileTaskDecision([
        ...team.chatMessages.filter((message) => messageBelongsToConversation(message, conversationId, `team:${team.id}`)).slice(-8).map((message) => ({
          role: message.roleId === 'human' ? 'user' as const : 'assistant' as const,
          content: message.content,
        })),
        { role: 'user', content },
      ], getRegisteredTools(), client.getAssistantModel());
      const mayDelegate = taskDecision.decision.mode === 'execute';
      const selectionRequest = [taskRequest, ...(taskDecision.decision.requiredCapabilities ?? [])].filter(Boolean).join('\n所需能力：');
      const requestedMemberIds = mayDelegate ? matchTeamMembers(team, current.employees, selectionRequest, directMentions) : [];
      const planned = requestedMemberIds.length > 0 ? buildTaskPlan(team, current.employees, taskRequest, requestedMemberIds) : [];
      if (planned.length > 0) {
        const planText = planned.map((step) => {
          const employee = current.employees.find((item) => item.id === step.employeeId);
          const dependencies = step.dependsOnStepIds.length ? `（等待第 ${step.dependsOnStepIds.map((id) => planned.find((item) => item.id === id)?.order ?? '?').join('、')} 步）` : '';
          return `${step.order}. @${employee?.name ?? step.employeeId}：${step.title}${dependencies}`;
        }).join('\n');
        const deliverables = taskDecision.decision.deliverables?.map((item) => item.label).filter(Boolean).join('、')
          || taskDecision.decision.acceptanceCriteria?.[0]
          || '按任务合同交付可验证结果';
        dispatch({
          type: 'APPEND_CHAT', teamId, conversationId,
          msgs: [{
            id: `msg-dispatch-plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            authorId: 'assistant', roleId: 'custom',
            content: `任务简报\n目标：${taskDecision.decision.goal}\n分工：\n${planText}\n交付：${deliverables}\n当前缺口：暂无，执行中如需账号、授权或业务选择会明确提出。`,
            mentions: requestedMemberIds, timestamp: Date.now(), kind: 'text',
          }],
        });
      }
      if (!mayDelegate) {
        await enqueueTeamAssistantReply(team, content, conversationId);
        return;
      }
      if (!requestedMemberIds.length) {
        await enqueueTeamAssistantReply(team, '当前目标需要执行，但团队内没有匹配的在线成员。请说明缺少的角色或补充成员后，我会重新编排。', conversationId);
        return;
      }
      void startTaskRun(teamId, taskRequest, requestedMemberIds, messageId, attachments, skillRefs, taskDecision.decision, conversationId);
    })();
  };

  const triggerDiscussion = (teamId: string, opts?: DiscussionOpts) => {
    const current = stateRef.current;
    const team = current.teams.find((item) => item.id === teamId);
    if (!team) return;
    const settings = client.loadSettings();
    const conversationId = opts?.conversationId ?? ensureActiveChatSession(`team:${teamId}`);
    const triggerText = opts?.userText?.trim() || '请团队协作讨论当前事项';
    const input: DiscussionTriggerInput = {
      teamId, messageId: opts?.triggerMessageId ?? `manual-${Date.now()}`, userText: triggerText,
      mentions: [], hasAttachments: !!opts?.attachments?.length, recentMessages: team.chatMessages.filter((message) => messageBelongsToConversation(message, conversationId, `team:${teamId}`)).slice(-12),
      activeTaskCount: (team.tasks ?? []).filter((task) => task.lane !== 'DONE').length,
      manual: true, now: Date.now(),
    };
    const decision = evaluateDiscussionTrigger(input, settings, team.memberIds);
    if (!decision.shouldStart) return;
    void startTaskRun(teamId, triggerText, opts?.forcedMemberIds ?? decision.forcedMemberIds, opts?.triggerMessageId, opts?.attachments, [], undefined, conversationId);
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
        addTeamMembers,
        setTeamMembers,
        removeTeamMembers,
        addCatalogExperts,
        setProjectMembers,
        createProjectDraft,
        approveProject,
        startProjectExecution,
        rejectProject,
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
        stopTaskRun,
        closeTaskRun,
        clearTeamExecution,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}
