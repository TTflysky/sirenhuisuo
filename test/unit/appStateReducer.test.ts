import { describe, expect, it } from 'vitest';
import { initialAppState, reduceAppState } from '../../src/store/appStateReducer';

const employee = { id: 'emp-1', name: 'Tester', title: 'QA', role: 'custom', avatar: '', avatarKind: 'preset' } as any;
const team = { id: 'team-1', name: 'Test team', icon: '', memberIds: ['emp-1'], chatMessages: [], tasks: [] } as any;
const project = { id: 'project-1', title: 'Project', teamId: 'team-1', status: 'active', createdAt: 1, updatedAt: 1 } as any;
const task = { id: 'task-1', title: 'Build', lane: 'PLANNING' } as any;

describe('app state reducer', () => {
  it('updates employees without mutating the previous snapshot', () => {
    const withEmployee = reduceAppState(initialAppState, { type: 'ADD_EMPLOYEE', emp: employee });
    const updated = reduceAppState(withEmployee, { type: 'UPDATE_EMPLOYEE', id: 'emp-1', partial: { isWorking: true } });
    expect(initialAppState.employees).toHaveLength(0);
    expect(updated.employees[0].isWorking).toBe(true);
    expect(withEmployee.employees[0].isWorking).not.toBe(true);
  });

  it('removes an employee from the directory and every team membership', () => {
    const state = { ...initialAppState, employees: [employee], teams: [team] };
    const next = reduceAppState(state, { type: 'REMOVE_EMPLOYEE', id: 'emp-1' });
    expect(next.employees).toHaveLength(0);
    expect(next.teams[0].memberIds).toEqual([]);
  });

  it('keeps task execution messages idempotent during hydration', () => {
    const message = { id: 'message-1', authorId: 'emp-1', roleId: 'custom', content: 'done', mentions: [], timestamp: 1, kind: 'execution' } as any;
    const run = { id: 'run-1', teamId: 'team-1', conversationId: 'conversation-1', executionMessages: [message] } as any;
    const state = { ...initialAppState, teams: [team] };
    const first = reduceAppState(state, { type: 'HYDRATE_TASK_RUNS', runs: [run] });
    const second = reduceAppState(first, { type: 'HYDRATE_TASK_RUNS', runs: [run] });
    expect(second.teams[0].chatMessages).toHaveLength(1);
    expect(second.teams[0].chatMessages[0].conversationId).toBe('conversation-1');
  });

  it('initializes, upserts, patches, and removes task runs', () => {
    const initialized = reduceAppState(initialAppState, { type: 'INIT', state: { ...initialAppState, employees: [employee] } });
    const changedEmployee = { ...employee, title: 'Senior test' };
    const upserted = reduceAppState(initialized, { type: 'ADD_EMPLOYEE', emp: changedEmployee });
    expect(upserted.employees).toEqual([changedEmployee]);
    const run = { id: 'run-1', teamId: 'team-1', status: 'running' } as any;
    const created = reduceAppState(upserted, { type: 'CREATE_TASK_RUN', run });
    const patched = reduceAppState(created, { type: 'PATCH_TASK_RUN', run: { ...run, status: 'paused' } });
    expect(patched.taskRuns[0].status).toBe('paused');
    const removed = reduceAppState(patched, { type: 'REMOVE_TASK_RUN', runId: 'run-1' });
    expect(removed.taskRuns).toHaveLength(0);
  });

  it('maintains team, project, and employee relationships', () => {
    const state = {
      ...initialAppState,
      employees: [{ ...employee, currentTeamId: 'team-1' }],
      teams: [{ ...team, projectId: 'project-1' }],
      projects: [project],
    } as any;
    const renamed = reduceAppState(state, { type: 'UPDATE_TEAM', id: 'team-1', partial: { name: 'New team' } });
    expect(renamed.projects[0].title).toBe('New team');
    const removed = reduceAppState(renamed, { type: 'REMOVE_TEAM', id: 'team-1' });
    expect(removed.teams).toHaveLength(0);
    expect(removed.employees[0].currentTeamId).toBeUndefined();
    expect(removed.projects[0].teamId).toBeUndefined();
    expect(reduceAppState(removed, { type: 'ADD_TEAM', team }).teams).toHaveLength(1);
  });

  it('creates and updates projects with bounded project history', () => {
    const many = Array.from({ length: 80 }, (_, index) => ({ ...project, id: `p-${index}` }));
    const created = reduceAppState({ ...initialAppState, projects: many } as any, { type: 'CREATE_PROJECT', project });
    expect(created.projects).toHaveLength(80);
    const updated = reduceAppState({ ...initialAppState, projects: [project] }, { type: 'UPDATE_PROJECT', id: 'project-1', partial: { title: 'Updated' } });
    expect(updated.projects[0].title).toBe('Updated');
    expect(updated.projects[0].updatedAt).toBeGreaterThan(1);
  });

  it('appends chat, creates tasks, advances lanes, and claims work', () => {
    const state = { ...initialAppState, employees: [employee], teams: [team] } as any;
    const message = { id: 'message-2', authorId: 'emp-1', roleId: 'custom', content: 'hello', mentions: [], timestamp: 2 } as any;
    const chatted = reduceAppState(state, { type: 'APPEND_CHAT', teamId: 'team-1', msgs: [message], conversationId: 'conversation-2' });
    expect(chatted.teams[0].chatMessages[0].conversationId).toBe('conversation-2');
    const tasked = reduceAppState(chatted, { type: 'ADD_TASK', teamId: 'team-1', task });
    expect(tasked.teams[0].tasks).toHaveLength(1);
    const advanced = reduceAppState(tasked, { type: 'ADVANCE_TASK', teamId: 'team-1', taskId: 'task-1', lane: 'TESTING' as any });
    expect(advanced.teams[0].tasks[0].lane).toBe('TESTING');
    const claimed = reduceAppState({ ...tasked, employees: [employee] }, { type: 'CLAIM_TASK', teamId: 'team-1', taskId: 'task-1', claimerId: 'emp-1' });
    expect(claimed.teams[0].tasks[0].lane).toBe('CODING');
    expect(claimed.employees[0].isWorking).toBe(true);
  });

  it('updates status, progress, project completion, and execution cleanup', () => {
    const execution = { id: 'execution-1', authorId: 'emp-1', roleId: 'custom', content: 'working', mentions: [], timestamp: 1, kind: 'execution', discussionId: 'run-1' } as any;
    const state = {
      ...initialAppState,
      teams: [{ ...team, chatMessages: [execution] }],
      projects: [project],
      taskRuns: [{ id: 'run-1', teamId: 'team-1', projectId: 'project-1', status: 'running' } as any],
    };
    const status = reduceAppState(state, { type: 'SET_STATUS', partial: { backendOnline: true } });
    expect(status.status.backendOnline).toBe(true);
    const progress = reduceAppState(status, { type: 'SET_PROGRESS', progress: { stage: 'running' } as any });
    expect(progress.status.progress).toEqual({ stage: 'running' });
    const completedRun = { ...state.taskRuns[0], status: 'completed' } as any;
    const completed = reduceAppState(progress, { type: 'UPDATE_TASK_RUN', run: completedRun });
    expect(completed.projects[0].status).toBe('completed');
    const cleared = reduceAppState(completed, { type: 'CLEAR_TEAM_EXECUTION', teamId: 'team-1' });
    expect(cleared.teams[0].chatMessages).toHaveLength(0);
  });
});
