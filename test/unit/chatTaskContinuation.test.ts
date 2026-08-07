import { describe, expect, it } from 'vitest';
import { continuationExecutionPrompt, requestsTaskContinuation, selectChatTaskContinuation } from '../../src/engine/chatTaskContinuation';
import type { TaskServiceTask } from '../../src/electron';

function task(patch: Partial<TaskServiceTask> = {}): TaskServiceTask {
  return {
    id: 'task-original', taskType: 'assistant', teamId: 'scope:assistant', ownerId: 'assistant',
    conversationId: 'conversation-a', workspaceId: 'tasks/assistant/run-original',
    title: '制作科学计算器', request: '制作科学计算器', goal: '制作一个可使用的科学计算器',
    status: 'awaiting_user', acceptanceCriteria: [], steps: [], toolAttempts: [], artifacts: [], references: [],
    createdAt: 100, updatedAt: 100,
    ...patch,
  };
}

describe('chat task continuation', () => {
  it('inherits the original workspace and goal for an explicit continuation', () => {
    const selected = selectChatTaskContinuation({
      tasks: [task()], conversationId: 'conversation-a', taskType: 'assistant', ownerId: 'assistant',
      message: '继续完成刚才的任务', relation: 'continuation',
    });
    expect(selected).toMatchObject({ taskId: 'task-original', workspaceId: 'tasks/assistant/run-original', goal: '制作一个可使用的科学计算器' });
  });

  it('skips an orphan task whose only goal is the continuation command', () => {
    const orphan = task({ id: 'task-orphan', goal: '继续完成刚才的任务', request: '继续完成刚才的任务', workspaceId: 'tasks/assistant/run-empty', updatedAt: 200 });
    const selected = selectChatTaskContinuation({
      tasks: [task(), orphan], conversationId: 'conversation-a', taskType: 'assistant', ownerId: 'assistant',
      message: '继续完成刚才的任务', relation: 'continuation',
    });
    expect(selected?.taskId).toBe('task-original');
    expect(selected?.workspaceId).toBe('tasks/assistant/run-original');
  });

  it('skips an orphan correction that should have been attached to the original task', () => {
    const orphan = task({
      id: 'task-orphan-correction',
      request: '继续原任务。窄屏边框仍有遮挡，请修复并复验。',
      goal: '继续原任务。窄屏边框仍有遮挡，请修复并复验。',
      workspaceId: 'tasks/assistant/run-wrong',
      status: 'stopped',
      updatedAt: 300,
    });
    const selected = selectChatTaskContinuation({
      tasks: [task(), orphan], conversationId: 'conversation-a', taskType: 'assistant', ownerId: 'assistant',
      message: '继续原任务。窄屏边框仍有遮挡，请修复并复验。', relation: 'new_task',
    });
    expect(selected?.taskId).toBe('task-original');
    expect(selected?.workspaceId).toBe('tasks/assistant/run-original');
  });

  it('does not inherit across conversations, employees, or independent new goals', () => {
    const tasks = [task()];
    expect(selectChatTaskContinuation({ tasks, conversationId: 'conversation-b', taskType: 'assistant', ownerId: 'assistant', message: '继续', relation: 'continuation' })).toBeUndefined();
    expect(selectChatTaskContinuation({ tasks, conversationId: 'conversation-a', taskType: 'assistant', ownerId: 'other', message: '继续', relation: 'continuation' })).toBeUndefined();
    expect(selectChatTaskContinuation({ tasks, conversationId: 'conversation-a', taskType: 'assistant', ownerId: 'assistant', message: '制作一份新的财务报表', relation: 'new_task' })).toBeUndefined();
    expect(selectChatTaskContinuation({
      tasks, conversationId: 'conversation-a', taskType: 'assistant', ownerId: 'assistant',
      message: 'npx skills add mattpocock/skills安装这套skill然后把名称发给我', relation: 'continuation',
    })).toBeUndefined();
  });

  it('lets a correction reopen a completed artifact in the same workspace', () => {
    const selected = selectChatTaskContinuation({
      tasks: [task({ status: 'completed' })], conversationId: 'conversation-a', taskType: 'assistant', ownerId: 'assistant',
      message: '边框还有遮挡，继续修改', relation: 'correction',
    });
    expect(selected?.workspaceId).toBe('tasks/assistant/run-original');
    expect(continuationExecutionPrompt(selected, '边框还有遮挡，继续修改')).toContain('先读取现有产物和验收证据');
  });

  it('recognizes concise continuation controls without product-specific keywords', () => {
    expect(requestsTaskContinuation('继续')).toBe(true);
    expect(requestsTaskContinuation('按刚才的结果继续处理')).toBe(true);
    expect(requestsTaskContinuation('继续原任务。窄屏下主要容器的边框和外阴影仍有遮挡，请修复并复验。', 'new_task')).toBe(true);
    expect(requestsTaskContinuation('创建一个全新的项目', 'new_task')).toBe(false);
  });
});
