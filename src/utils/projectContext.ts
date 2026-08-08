import type { Project } from '../types';

const CONVERSATION_PROJECTS_KEY = 'taiji_conversation_projects_v1';
const projectEventQueues = new Map<string, Promise<void>>();

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 120) || 'unknown';
}

export function projectWorkspaceId(projectId: string): string {
  return `projects/${safePart(projectId)}`;
}

export function projectDocumentPath(projectId: string): string {
  return `${projectWorkspaceId(projectId)}/project.md`;
}

export function projectTaskDocumentPath(projectId: string, taskId: string): string {
  return `${projectWorkspaceId(projectId)}/tasks/${safePart(taskId)}.md`;
}

export function projectTaskWorkspaceId(projectId: string, kind: string, ownerId = 'default'): string {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return `${projectWorkspaceId(projectId)}/tasks/${safePart(kind)}/${safePart(ownerId)}/run-${token}`;
}

function projectManifestPath(projectId: string): string {
  return `${projectWorkspaceId(projectId)}/project.json`;
}

export function conversationProjectId(conversationId: string): string {
  try {
    const raw = JSON.parse(localStorage.getItem(CONVERSATION_PROJECTS_KEY) ?? '{}') as Record<string, string>;
    if (typeof raw[conversationId] === 'string' && raw[conversationId]) return raw[conversationId];
  } catch {}
  const id = `conversation-project-${safePart(conversationId)}`;
  try {
    const raw = JSON.parse(localStorage.getItem(CONVERSATION_PROJECTS_KEY) ?? '{}') as Record<string, string>;
    raw[conversationId] = id;
    localStorage.setItem(CONVERSATION_PROJECTS_KEY, JSON.stringify(raw));
  } catch {}
  return id;
}

function projectMarkdown(input: Pick<Project, 'id' | 'title' | 'request' | 'conversationId' | 'workspaceId' | 'createdAt' | 'members' | 'expectedOutputs' | 'requiredCapabilities'> & { status?: string }): string {
  const memberLines = input.members.map((member) => `- ${member.employeeId}：${member.reason}`);
  return [
    `# ${input.title || '未命名项目'}`,
    '',
    `- 项目 ID：${input.id}`,
    `- 会话 ID：${input.conversationId || '未绑定'}`,
    `- 工作区：${input.workspaceId || projectWorkspaceId(input.id)}`,
    `- 创建时间：${new Date(input.createdAt).toISOString()}`,
    `- 当前状态：${input.status || 'running'}`,
    '',
    '## 目标',
    input.request || '未记录',
    '',
    '## 成员与职责',
    ...(memberLines.length ? memberLines : ['- 尚未确定']),
    '',
    '## 预期产出',
    ...(input.expectedOutputs?.length ? input.expectedOutputs.map((item) => `- ${item}`) : ['- 尚未确定']),
    '',
    '## 所需能力',
    ...(input.requiredCapabilities?.length ? input.requiredCapabilities.map((item) => `- ${item}`) : ['- 由智能体根据目标动态判断']),
    '',
    '## 运行记录',
    '- 项目文档已建立；后续阶段、任务、证据和产物必须继续写入本项目目录。',
    '',
  ].join('\n');
}

/** Create the durable project directory and its traceable document. No-op in browser-only mode. */
export async function initializeProjectContext(project: Project): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (typeof window === 'undefined') return { ok: false, error: '当前环境没有桌面工作区' };
  const api = window.electronAPI;
  if (!api?.fsInitWorkspace || !api.fsWrite || !api.fsMkdir) return { ok: false, error: '当前环境没有项目工作区文件接口' };
  const workspaceId = project.workspaceId || projectWorkspaceId(project.id);
  const initialized = await api.fsInitWorkspace(workspaceId, {
    kind: 'project',
    label: project.title || '未命名项目',
    projectId: project.id,
    conversationId: project.conversationId,
    createdAt: new Date(project.createdAt).toISOString(),
  });
  if (!initialized.ok) return initialized;
  const directories = [
    'conversations', 'tasks', 'artifacts/final', 'artifacts/working',
    'artifacts/reference', 'artifacts/logs', 'evidence',
  ];
  for (const directory of directories) {
    const result = await api.fsMkdir(`${workspaceId}/${directory}`);
    if (!result.ok) return result;
  }
  let existing: Partial<Project> = {};
  const existingManifest = await api.fsRead(projectManifestPath(project.id));
  if (existingManifest.ok && typeof existingManifest.content === 'string') {
    try {
      const parsed = JSON.parse(existingManifest.content) as Partial<Project>;
      if (parsed && typeof parsed === 'object') existing = parsed;
    } catch {}
  }
  const merged = {
    ...existing,
    ...project,
    id: project.id,
    title: project.title || existing.title || '未命名项目',
    request: project.request || existing.request || '',
    conversationId: project.conversationId || existing.conversationId,
    workspaceId: existing.workspaceId || project.workspaceId || workspaceId,
    documentPath: existing.documentPath || project.documentPath || projectDocumentPath(project.id),
    createdAt: existing.createdAt || project.createdAt,
    updatedAt: Date.now(),
    members: Array.isArray(project.members) && project.members.length ? project.members : (existing.members || []),
    expectedOutputs: Array.isArray(project.expectedOutputs) && project.expectedOutputs.length ? project.expectedOutputs : (existing.expectedOutputs || []),
    requiredCapabilities: Array.isArray(project.requiredCapabilities) && project.requiredCapabilities.length ? project.requiredCapabilities : (existing.requiredCapabilities || []),
    status: project.status || existing.status || 'running',
  } as Project;
  const document = await api.fsWrite(merged.documentPath || projectDocumentPath(project.id), projectMarkdown(merged));
  if (!document.ok) return document;
  const manifest = await api.fsWrite(projectManifestPath(project.id), JSON.stringify(merged, null, 2));
  return manifest.ok ? { ok: true, path: document.path } : manifest;
}

export async function appendProjectEvent(projectId: string, event: Record<string, unknown>): Promise<void> {
  const path = `${projectWorkspaceId(projectId)}/events.jsonl`;
  const previousQueue = projectEventQueues.get(path) ?? Promise.resolve();
  const nextQueue = previousQueue.catch(() => undefined).then(async () => {
    if (typeof window === 'undefined') return;
    const api = window.electronAPI;
    if (!api?.fsRead || !api.fsWrite) return;
    const previous = await api.fsRead(path);
    const content = previous.ok && typeof previous.content === 'string' ? previous.content : '';
    await api.fsWrite(path, `${content}${JSON.stringify({ ...event, ts: event.ts ?? Date.now() })}\n`);
  });
  projectEventQueues.set(path, nextQueue);
  try {
    await nextQueue;
  } finally {
    if (projectEventQueues.get(path) === nextQueue) projectEventQueues.delete(path);
  }
}

export async function initializeProjectTaskRecord(input: {
  projectId: string;
  taskId: string;
  title: string;
  goal: string;
  conversationId?: string;
  workspaceId?: string;
  acceptanceCriteria?: string[];
  parentTaskId?: string;
  status?: string;
  phase?: string;
  nextAction?: string;
  artifacts?: Array<{ path: string; category?: string; verified?: boolean }>;
}): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (typeof window === 'undefined') return { ok: false, error: '当前环境没有桌面工作区' };
  const api = window.electronAPI;
  if (!api?.fsMkdir || !api.fsWrite) return { ok: false, error: '当前环境没有项目文件接口' };
  const workspaceId = projectWorkspaceId(input.projectId);
  const directory = `${workspaceId}/tasks`;
  const directoryResult = await api.fsMkdir(directory);
  if (!directoryResult.ok) return directoryResult;
  const path = projectTaskDocumentPath(input.projectId, input.taskId);
  const content = [
    `# ${input.title || '任务'}`,
    '',
    `- 任务 ID：${input.taskId}`,
    `- 项目 ID：${input.projectId}`,
    `- 会话 ID：${input.conversationId || '未绑定'}`,
    `- 工作区：${input.workspaceId || '未分配'}`,
    `- 父任务：${input.parentTaskId || '无'}`,
    `- 状态：${input.status || 'queued'}`,
    `- 阶段：${input.phase || 'preflight'}`,
    `- 更新时间：${new Date().toISOString()}`,
    '',
    '## 目标',
    input.goal || '未记录',
    '',
    '## 验收标准',
    ...(input.acceptanceCriteria?.length ? input.acceptanceCriteria.map((item) => `- ${item}`) : ['- 必须有真实证据支持完成']),
    '',
    '## 产物',
    ...(input.artifacts?.length ? input.artifacts.map((item) => `- ${item.path}${item.category ? `（${item.category}）` : ''}${item.verified ? ' [已验证]' : ''}`) : ['- 尚未登记']),
    '',
    '## 下一步',
    input.nextAction || '由 TaskService 根据当前证据决定下一步。',
    '',
    '## 追踪',
    '- TaskService 负责执行状态、工具尝试、产物和验证证据；项目事件账本记录完整回放。',
  ].join('\n');
  const result = await api.fsWrite(path, content);
  return result.ok ? { ok: true, path: result.path || path } : result;
}
