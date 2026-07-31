import type { AppState, ChatMessage } from '../types';
import * as client from '../data/hermesClient';
import { saveTaskRuns } from '../data/taskRuns';
import type { AppStateAction } from './appStateReducer';

function appendedMessages(previous: AppState, next: AppState, teamId: string): ChatMessage[] {
  const before = previous.teams.find((team) => team.id === teamId)?.chatMessages ?? [];
  const after = next.teams.find((team) => team.id === teamId)?.chatMessages ?? [];
  const known = new Set(before.map((message) => message.id));
  return after.filter((message) => !known.has(message.id));
}

export function persistAppStateTransition(previous: AppState, action: AppStateAction, next: AppState): void {
  switch (action.type) {
    case 'INIT':
    case 'HYDRATE_TASK_RUNS':
    case 'PATCH_TASK_RUN':
    case 'SET_STATUS':
    case 'SET_PROGRESS':
      return;
    case 'ADD_EMPLOYEE':
    case 'UPDATE_EMPLOYEE':
      client.saveEmployees(next.employees);
      return;
    case 'REMOVE_EMPLOYEE':
      client.saveEmployees(next.employees);
      client.saveTeams(next.teams);
      return;
    case 'ADD_TEAM':
      client.saveTeams(next.teams);
      if (action.team.chatMessages?.length) client.appendChat(action.team.id, action.team.chatMessages);
      return;
    case 'UPDATE_TEAM':
      client.saveTeams(next.teams);
      if (next.projects !== previous.projects) client.saveProjects(next.projects);
      return;
    case 'REMOVE_TEAM':
      client.saveTeams(next.teams);
      client.saveEmployees(next.employees);
      client.saveProjects(next.projects);
      return;
    case 'CREATE_PROJECT':
    case 'UPDATE_PROJECT':
      client.saveProjects(next.projects);
      return;
    case 'APPEND_CHAT':
    case 'ADD_TASK': {
      if (action.type === 'ADD_TASK') client.saveTeams(next.teams);
      const teamId = action.teamId;
      const messages = appendedMessages(previous, next, teamId);
      if (messages.length) client.appendChat(teamId, messages);
      return;
    }
    case 'ADVANCE_TASK':
      client.saveTeams(next.teams.filter((team) => team.id === action.teamId));
      return;
    case 'CLAIM_TASK':
      client.saveTeams(next.teams.filter((team) => team.id === action.teamId));
      client.saveEmployees(next.employees);
      return;
    case 'CREATE_TASK_RUN':
      saveTaskRuns(next.taskRuns);
      return;
    case 'UPDATE_TASK_RUN':
      saveTaskRuns(next.taskRuns);
      if (next.projects !== previous.projects) client.saveProjects(next.projects);
      return;
    case 'REMOVE_TASK_RUN': {
      const target = previous.taskRuns.find((run) => run.id === action.runId);
      if (target) {
        const team = next.teams.find((item) => item.id === target.teamId);
        if (team) client.replaceChat(team.id, team.chatMessages);
      }
      saveTaskRuns(next.taskRuns, { removedTaskIds: [action.runId] });
      return;
    }
    case 'CLEAR_TEAM_EXECUTION': {
      const team = next.teams.find((item) => item.id === action.teamId);
      if (team) client.replaceChat(team.id, team.chatMessages);
      return;
    }
  }
}
