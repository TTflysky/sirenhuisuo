import type {
  AgentStatus,
  AppState,
  ChatMessage,
  DiscussionProgress,
  Employee,
  Project,
  TaskLane,
  TaskRun,
  Team,
  TeamTask,
} from '../types';
import { ensureActiveChatSession } from '../data/chatSessions';

export type AppStateAction =
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

export const initialAppState: AppState = {
  employees: [],
  teams: [],
  projects: [],
  taskRuns: [],
  status: { backendOnline: false, demoRunning: false },
};

function upsertEmployee(employee: Employee, employees: Employee[]): Employee[] {
  const index = employees.findIndex((item) => item.id === employee.id);
  if (index < 0) return [...employees, employee];
  const next = [...employees];
  next[index] = employee;
  return next;
}

function mergeTaskExecutionMessages(state: AppState, runs: TaskRun[]): AppState {
  const byTeam = new Map<string, ChatMessage[]>();
  for (const run of runs) {
    if (!run.executionMessages?.length) continue;
    const current = byTeam.get(run.teamId) ?? [];
    current.push(...run.executionMessages.map((message) => message.conversationId || !run.conversationId
      ? message
      : { ...message, conversationId: run.conversationId }));
    byTeam.set(run.teamId, current);
  }
  if (!byTeam.size) return { ...state, taskRuns: runs };
  const teams = state.teams.map((team) => {
    const incoming = byTeam.get(team.id);
    if (!incoming?.length) return team;
    const seen = new Set(team.chatMessages.map((message) => message.id));
    const appended = incoming.filter((message) => !seen.has(message.id));
    if (!appended.length) return team;
    return { ...team, chatMessages: [...team.chatMessages, ...appended].sort((a, b) => a.timestamp - b.timestamp).slice(-1200) };
  });
  return { ...state, teams, taskRuns: runs };
}

export function reduceAppState(state: AppState, action: AppStateAction): AppState {
  switch (action.type) {
    case 'INIT':
      return action.state;
    case 'HYDRATE_TASK_RUNS':
      return mergeTaskExecutionMessages(state, action.runs);
    case 'PATCH_TASK_RUN': {
      const taskRuns = state.taskRuns.some((run) => run.id === action.run.id)
        ? state.taskRuns.map((run) => run.id === action.run.id ? action.run : run)
        : [...state.taskRuns, action.run].slice(-120);
      return mergeTaskExecutionMessages(state, taskRuns);
    }
    case 'ADD_EMPLOYEE':
      return { ...state, employees: upsertEmployee(action.emp, state.employees) };
    case 'UPDATE_EMPLOYEE':
      return { ...state, employees: state.employees.map((employee) => employee.id === action.id ? { ...employee, ...action.partial } : employee) };
    case 'REMOVE_EMPLOYEE': {
      const employees = state.employees.filter((employee) => employee.id !== action.id);
      const teams = state.teams.map((team) => ({ ...team, memberIds: team.memberIds.filter((memberId) => memberId !== action.id) }));
      return { ...state, employees, teams };
    }
    case 'ADD_TEAM':
      return { ...state, teams: [...state.teams, action.team] };
    case 'UPDATE_TEAM': {
      const teams = state.teams.map((team) => team.id === action.id ? { ...team, ...action.partial } : team);
      const renamed = action.partial.name?.trim();
      const target = state.teams.find((team) => team.id === action.id);
      const projects = renamed && target?.projectId
        ? state.projects.map((project) => project.id === target.projectId ? { ...project, title: renamed, updatedAt: Date.now() } : project)
        : state.projects;
      return { ...state, teams, projects };
    }
    case 'REMOVE_TEAM': {
      const teams = state.teams.filter((team) => team.id !== action.id);
      const employees = state.employees.map((employee) => employee.currentTeamId === action.id ? { ...employee, currentTeamId: undefined } : employee);
      const projects = state.projects.map((project) => project.teamId === action.id ? { ...project, teamId: undefined, updatedAt: Date.now() } : project);
      return { ...state, teams, employees, projects };
    }
    case 'CREATE_PROJECT':
      return { ...state, projects: [...state.projects, action.project].slice(-80) };
    case 'UPDATE_PROJECT':
      return { ...state, projects: state.projects.map((project) => project.id === action.id ? { ...project, ...action.partial, updatedAt: Date.now() } : project) };
    case 'APPEND_CHAT': {
      const sessionId = action.conversationId ?? ensureActiveChatSession(`team:${action.teamId}`);
      const messages = action.msgs.map((message) => message.conversationId ? message : { ...message, conversationId: sessionId });
      const teams = state.teams.map((team) => team.id === action.teamId
        ? { ...team, chatMessages: [...(team.chatMessages || []), ...messages] }
        : team);
      return { ...state, teams };
    }
    case 'ADD_TASK': {
      const conversationId = ensureActiveChatSession(`team:${action.teamId}`);
      const taskMessage: ChatMessage = {
        id: `msg-task-${Date.now()}`,
        authorId: 'emp-me',
        roleId: 'human',
        content: `[新任务] ${action.task.title}`,
        mentions: [],
        timestamp: Date.now(),
        kind: 'task',
        taskRef: action.task.id,
        conversationId,
      };
      const teams = state.teams.map((team) => team.id === action.teamId
        ? { ...team, tasks: [...(team.tasks || []), action.task], chatMessages: [...(team.chatMessages || []), taskMessage] }
        : team);
      return { ...state, teams };
    }
    case 'ADVANCE_TASK': {
      const teams = state.teams.map((team) => team.id !== action.teamId ? team : {
        ...team,
        tasks: (team.tasks || []).map((task) => task.id === action.taskId ? { ...task, lane: action.lane } : task),
      });
      return { ...state, teams };
    }
    case 'CLAIM_TASK': {
      const teams = state.teams.map((team) => team.id !== action.teamId ? team : {
        ...team,
        tasks: (team.tasks || []).map((task) => task.id === action.taskId
          ? { ...task, claimedBy: action.claimerId, assigneeId: action.claimerId, lane: (task.lane as TaskLane) === 'PLANNING' ? 'CODING' as TaskLane : task.lane }
          : task),
      });
      const employees = state.employees.map((employee) => employee.id === action.claimerId
        ? { ...employee, isWorking: true, currentTask: '' }
        : employee);
      return { ...state, teams, employees };
    }
    case 'SET_STATUS':
      return { ...state, status: { ...state.status, ...action.partial } };
    case 'SET_PROGRESS':
      return { ...state, status: { ...state.status, progress: action.progress ?? undefined } };
    case 'CREATE_TASK_RUN':
      return { ...state, taskRuns: [...state.taskRuns, action.run].slice(-120) };
    case 'UPDATE_TASK_RUN': {
      const taskRuns = state.taskRuns.map((run) => run.id === action.run.id ? action.run : run);
      const project = action.run.projectId && (action.run.status === 'completed' || action.run.status === 'failed')
        ? state.projects.find((item) => item.id === action.run.projectId)
        : undefined;
      const projects = project
        ? state.projects.map((item) => item.id === project.id ? { ...item, status: (action.run.status === 'completed' ? 'completed' : 'failed') as Project['status'], updatedAt: Date.now() } : item)
        : state.projects;
      return { ...state, taskRuns, projects };
    }
    case 'REMOVE_TASK_RUN': {
      const target = state.taskRuns.find((run) => run.id === action.runId);
      const taskRuns = state.taskRuns.filter((run) => run.id !== action.runId);
      const teams = target ? state.teams.map((team) => team.id !== target.teamId ? team : {
        ...team,
        chatMessages: team.chatMessages.filter((message) => !(message.kind === 'execution' && message.discussionId === action.runId)),
      }) : state.teams;
      return { ...state, taskRuns, teams };
    }
    case 'CLEAR_TEAM_EXECUTION':
      return {
        ...state,
        teams: state.teams.map((team) => team.id !== action.teamId ? team : {
          ...team,
          chatMessages: team.chatMessages.filter((message) => message.kind !== 'execution'),
        }),
      };
    default:
      return state;
  }
}
