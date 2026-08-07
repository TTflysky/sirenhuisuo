import React, { useReducer, useEffect, type ReactNode } from 'react';
import { StoreContext } from './storeContext';
import { initialAppState, reduceAppState, type AppStateAction } from './store/appStateReducer';
import { persistAppStateTransition } from './store/appStatePersistence';
import { createOfficeCommands } from './store/officeCommands';
import { createTaskRunControls } from './store/taskRunControls';
import { createTeamMessageCommands } from './store/teamMessageCommands';
import { createTeamDiscussionRuntime, type DiscussionOpts, type DiscussionScheduler } from './store/teamDiscussionRuntime';
import type {
  Employee,
  ChatMessage,
  TeamTask,
  TaskLane,
  OpcRoleId,
  AppState,
  RoleId,
  Project,
  ProjectMember,
  TaskRun,
} from './types';
import * as client from './data/hermesClient';
import { runScript, cancelDemo as cancelScript, type ScriptHandlers } from './engine/simulationEngine';
import { PROACTIVE_SCRIPT } from './engine/proactiveScript';
import { sendBus, onBus, BUS_CHANNELS } from './ipcBus';
import { appendTaskRunContext, createTaskRun, hydrateTaskRunFromMainStore, hydrateTaskRunsFromMainStore, taskRunContextPrompt, updateTaskRun } from './data/taskRuns';
import { buildTaskPlan } from './engine/taskMatcher';
import { briefExecutionContext } from './engine/expertOrchestration';
import { codingProjectToTaskSteps, compileCodingProject, createCodingProjectTaskDecision } from './engine/codingProject.mjs';
import { buildSkillContextWithEvidence, matchSkills } from './data/skills';
import { attachmentWorkspaceContext, copyAttachmentsToWorkspace, initializeTaskWorkspace } from './utils/attachments';
import { syncNativeArtifacts, syncNativeRunArtifacts } from './data/outputs';
import { applyModelTaskSummary, shouldModelSummarizeTaskContext } from './engine/taskContext.mjs';
import { buildTaskHistoryPrompt, searchTaskRunHistory } from './engine/taskHistory.mjs';
import { CONNECTOR_PRESETS, loadConnectors } from './data/connectors';
import { getConnectorTools } from './engine/connectorTools';
import { retrieveLayeredMemoryContext } from './data/layeredMemory';
import { ensureActiveChatSession } from './data/chatSessions';
import { projectNativeWorkingEmployees } from './store/nativeEmployeeProjection';
import { createTeamSupervisorResponder } from './engine/teamSupervisor';
import { employeeModelSummary } from './engine/teamControl';

const reducer = (state: AppState, action: AppStateAction): AppState => {
  const next = reduceAppState(state, action);
  persistAppStateTransition(state, action, next);
  return next;
};
export interface StoreCtx {
  state: AppState;
  dispatch: React.Dispatch<AppStateAction>;
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
  approveProject: (projectId: string, override?: { memberIds?: string[]; requiredCapabilities?: string[]; decisionReason?: string; proposalRevision?: number }) => ProjectMember[];
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
const SKIP_BROADCAST = new Set<AppStateAction['type']>(['INIT', 'HYDRATE_TASK_RUNS', 'PATCH_TASK_RUN']);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, initialAppState);
  const nativeWorkingEmployeesRef = React.useRef<Set<string>>(new Set());
  const nativeTaskHydratedRef = React.useRef(false);
  // 标记当前是否正在应用「来自其他窗口」的广播，避免回环广播
  const applyingRemote = React.useRef(false);

  // 包装后的 dispatch：本地执行 + 向其他窗口广播
  const dispatch = React.useCallback((action: AppStateAction) => {
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
        rawDispatch(action as AppStateAction);
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
      const active = projectNativeWorkingEmployees(runs);
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
        nativeTaskHydratedRef.current = true;
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
      if (project?.status === 'clarifying') {
        const team = stateRef.current.teams.find((item) => item.id === teamId);
        if (team) void enqueueTeamAssistantReply(team, content, conversationId);
        return;
      }
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

  const {
    addEmployee,
    addCatalogExperts,
    createTeam,
    addTeamMembers,
    setTeamMembers,
    removeTeamMembers,
    setProjectMembers,
    createProjectDraft,
    approveProject,
    startProjectExecution,
    archiveProject,
    rejectProject,
  } = createOfficeCommands({
    getState: () => stateRef.current,
    dispatch,
    startTaskRun: (...args: Parameters<typeof startTaskRun>) => startTaskRun(...args),
  });
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
  const discussingRef = React.useRef<Set<string>>(new Set());
  const schedulerRef = React.useRef(new Map<string, DiscussionScheduler>());
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const supervisorBusyRef = React.useRef(new Set<string>());
  const supervisorQueuedRef = React.useRef(new Map<string, string>());
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

  const runDiscussion = createTeamDiscussionRuntime({
    getState: () => stateRef.current,
    dispatch,
    discussing: discussingRef.current,
    schedulers: schedulerRef.current,
    pausedRunIds: pausedRunIdsRef.current,
    stoppedRunIds: stoppedRunIdsRef.current,
  });
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

  const enqueueTeamAssistantReply = createTeamSupervisorResponder({
    getState: () => stateRef.current,
    dispatch,
    busy: supervisorBusyRef.current,
    queued: supervisorQueuedRef.current,
    employeeModelSummary,
    setPresence: (presence) => dispatch({
      type: 'SET_STATUS',
      partial: { teamAssistantPresence: { ...presence, updatedAt: Date.now() } },
    }),
  });

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

  // Native tasks interrupted by app restart return to the queue after authoritative ledger hydration.
  useEffect(() => {
    if (!window.electronAPI?.taskExecutionStart) return;
    if (!nativeTaskHydratedRef.current) return;
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

  const startTaskRun = async (teamId: string, request: string, employeeIds: string[], sourceMessageId?: string, attachments?: import('./data/hermesClient').Attachment[], explicitSkillRefs: import('./types').SkillReference[] = [], taskDecision?: import('./engine/taskDecisionKernel.mjs').TaskDecision, requestedConversationId?: string, projectBrief?: Project['brief'], continuationRun?: TaskRun) => {
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
    const inheritedAttachments = [...(continuationRun?.sourceAttachments ?? []), ...(attachments ?? [])]
      .filter((attachment, index, items) => items.findIndex((candidate) => candidate.workspacePath === attachment.workspacePath && candidate.name === attachment.name) === index);
    const skillRefs = explicitSkillRefs.length ? explicitSkillRefs : await matchSkills(request);
    const skillBundle = await buildSkillContextWithEvidence(skillRefs);
    const skillContext = skillBundle.context;
    const effectiveTaskDecision = codingProject ? createCodingProjectTaskDecision(request, taskDecision) : taskDecision;
    const run = createTaskRun(team, current.employees, request, plan, sourceMessageId, skillRefs, undefined, effectiveTaskDecision, conversationId);
    run.sourceAttachments = inheritedAttachments;
    if (continuationRun) {
      let root = continuationRun;
      const seen = new Set<string>();
      while (root.parentTaskId && !seen.has(root.id)) {
        seen.add(root.id);
        const parent = current.taskRuns.find((item) => item.id === root.parentTaskId);
        if (!parent) break;
        root = parent;
      }
      run.parentTaskId = root.id;
      run.projectId = continuationRun.projectId ?? root.projectId ?? team.projectId;
      run.workspaceId = continuationRun.workspaceId ?? root.workspaceId ?? run.workspaceId;
      run.goal = root.goal ?? root.request;
      appendTaskRunContext(run, {
        type: 'steering', source: 'user', verified: true,
        summary: `这是原项目“${root.title}”的后续调整，不创建新的项目目标。`,
        data: { parentTaskId: root.id, continuationOf: continuationRun.id },
      });
    }
    if (codingProject) run.codingProject = codingProject;
    run.projectId = run.projectId ?? team.projectId;
    const historyMatches = searchTaskRunHistory(current.taskRuns, request, {
      teams: current.teams,
      teamId: team.id,
      projectId: continuationRun?.projectId ?? team.projectId,
      conversationId,
      limit: 4,
    });
    const historyContext = buildTaskHistoryPrompt(historyMatches);
    const layeredMemory = await retrieveLayeredMemoryContext({ query: request, projectId: run.projectId, taskId: run.id, conversationId, teamId, limit: 18 });
    const layeredMemoryContext = layeredMemory.ok ? layeredMemory.context ?? '' : '';
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
    if (layeredMemory.retrievalId) {
      appendTaskRunContext(run, {
        type: 'history', source: 'system', verified: true,
        summary: `本轮引用 ${layeredMemory.references?.length ?? 0} 条记忆事实，已登记检索原因和来源。`,
        data: { retrievalId: layeredMemory.retrievalId, references: layeredMemory.references },
      });
    }
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
      await copyAttachmentsToWorkspace(`team:${team.id}`, run.workspaceId!, inheritedAttachments);
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
    const nativeResult = await startNativeTaskExecution(run, extraSystemContext, inheritedAttachments);
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
      userText: request, attachments: inheritedAttachments, triggerMessageId: sourceMessageId, discussionId: run.id,
      conversationId,
      forcedMemberIds: run.steps.map((step) => step.employeeId), runSteps: run.steps, maxRounds: run.steps.length, runId: run.id, workspaceId: run.workspaceId,
      extraSystemContext,
    }, 120);
  };

  const { pauseTaskRun, resumeTaskRun, stopTaskRun, closeTaskRun, clearTeamExecution } = createTaskRunControls({
    getState: () => stateRef.current,
    dispatch,
    pausedRunIds: pausedRunIdsRef.current,
    stoppedRunIds: stoppedRunIdsRef.current,
    abortTeamModelRequest: (teamId) => schedulerRef.current.get(teamId)?.modelRequestController?.abort(),
    startNativeTaskExecution: (...args: Parameters<typeof startNativeTaskExecution>) => startNativeTaskExecution(...args),
    enqueueDiscussion: (...args: Parameters<typeof enqueueDiscussion>) => enqueueDiscussion(...args),
  });
  const { enqueueAutoDiscussion, triggerDiscussion } = createTeamMessageCommands({
    getState: () => stateRef.current,
    dispatch,
    enqueueTeamAssistantReply,
    startTaskRun: (...args: Parameters<typeof startTaskRun>) => startTaskRun(...args),
    addTeamMembers,
    pauseTaskRun,
    resumeTaskRun,
    stopTaskRun,
  });
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
