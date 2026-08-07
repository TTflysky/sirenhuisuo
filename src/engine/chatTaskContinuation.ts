import type { TaskServiceTask } from '../electron';
import { isExplicitSkillInstallOperation, resolveSkillInstallRequest } from './skillInstallRouting.mjs';

export type ContinuationRelation = 'new_task' | 'continuation' | 'correction' | 'control' | 'question' | string;

export interface ChatTaskContinuation {
  taskId: string;
  projectId?: string;
  workspaceId: string;
  goal: string;
  request: string;
  title: string;
}

const RESUMABLE_STATUSES = new Set(['queued', 'running', 'awaiting_user', 'paused', 'failed', 'stopped']);
const CONTINUATION_RELATIONS = new Set(['continuation', 'correction', 'control']);
const CONTINUATION_ONLY = /^(?:请)?(?:继续|接着|恢复|重新继续|继续完成|接着完成|继续修改|继续处理|从刚才继续|按刚才的继续)(?:刚才|之前|上次|原来|这个|该)?(?:的)?(?:任务|工作|内容|项目|修改|处理)?[吧。！!，,\s]*$/u;
const EXPLICIT_CONTINUATION = /(?:^|[，。！？!?\s])(?:继续|接着|恢复)(?:刚才|之前|上次|上一个|原来|原|当前|这个|该)?(?:的)?(?:任务|工作|内容|项目|修改|处理|完成)|(?:按|根据)(?:刚才|之前|上次|上一个|原来|原|当前)(?:的)?(?:结果|任务|内容|项目).{0,40}(?:继续|修改|处理|修复|优化)/u;

function normalized(value: unknown): string {
  return String(value ?? '').trim();
}

function workspaceIdOf(task: TaskServiceTask): string {
  return normalized(task.workspaceId || task.workspace?.workspaceId);
}

function isContinuationOnlyGoal(value: unknown): boolean {
  return CONTINUATION_ONLY.test(normalized(value));
}

export function requestsTaskContinuation(message: string, relation?: ContinuationRelation): boolean {
  if (relation && CONTINUATION_RELATIONS.has(relation)) return true;
  return CONTINUATION_ONLY.test(message.trim()) || EXPLICIT_CONTINUATION.test(message.trim());
}

export function selectChatTaskContinuation(input: {
  tasks: TaskServiceTask[];
  conversationId: string;
  taskType: 'assistant' | 'dm';
  ownerId: string;
  message: string;
  relation?: ContinuationRelation;
}): ChatTaskContinuation | undefined {
  // A newly supplied concrete Skill source is a new task contract even when a
  // model relation label says "continuation". Never reuse an older workspace
  // and repository for it.
  if (isExplicitSkillInstallOperation(input.message) && resolveSkillInstallRequest(input.message)?.sourceUrl) return undefined;
  if (!requestsTaskContinuation(input.message, input.relation)) return undefined;
  const allowCompleted = input.relation === 'correction' || /(?:修改|修正|优化|调整|边框|问题|缺陷)/u.test(input.message);
  const matching = input.tasks
    .filter((task) => task.taskType === input.taskType)
    .filter((task) => task.ownerId === input.ownerId)
    .filter((task) => task.conversationId === input.conversationId)
    .filter((task) => RESUMABLE_STATUSES.has(task.status) || (allowCompleted && task.status === 'completed'))
    .sort((left, right) => Number(right.updatedAt || right.createdAt) - Number(left.updatedAt || left.createdAt));

  const byId = new Map(matching.map((task) => [task.id, task]));
  for (const candidate of matching) {
    // A prior buggy client could persist a continuation sentence as a new
    // root task. Never inherit that orphan; continue searching for the last
    // substantive root in the same conversation.
    if (!candidate.parentTaskId && requestsTaskContinuation(candidate.request)) continue;
    let task: TaskServiceTask | undefined = candidate;
    const visited = new Set<string>();
    while (task?.parentTaskId && !visited.has(task.id)) {
      visited.add(task.id);
      const parent = byId.get(task.parentTaskId);
      if (!parent) break;
      task = parent;
    }
    if (!task) continue;
    const workspaceId = workspaceIdOf(task) || workspaceIdOf(candidate);
    const goal = normalized(task.goal || task.request);
    if (!workspaceId || !goal || isContinuationOnlyGoal(goal)) continue;
    return {
      taskId: candidate.id,
      projectId: task.projectId,
      workspaceId,
      goal,
      request: normalized(task.request || goal),
      title: normalized(task.title || goal).slice(0, 240),
    };
  }
  return undefined;
}

export async function resolveChatTaskContinuation(input: Omit<Parameters<typeof selectChatTaskContinuation>[0], 'tasks'>): Promise<ChatTaskContinuation | undefined> {
  const api = window.electronAPI;
  if (!api?.taskServiceRead || !requestsTaskContinuation(input.message, input.relation)) return undefined;
  const result = await api.taskServiceRead({ teamId: `scope:${input.taskType}`, limit: 120 });
  if (!result.ok || !result.runs?.length) return undefined;
  return selectChatTaskContinuation({ ...input, tasks: result.runs });
}

export function continuationExecutionPrompt(context: ChatTaskContinuation | undefined, instruction: string): string {
  if (!context) return instruction;
  return [
    '这是同一聊天中上一项任务的续作，不是新任务。',
    `原始目标：${context.goal}`,
    `本轮新增指令：${instruction}`,
    `继续使用原工作区：${context.workspaceId}`,
    '先读取现有产物和验收证据，再针对未完成项修改并重新验证。不得从空目录重做，也不得只口头回答。',
  ].join('\n');
}
