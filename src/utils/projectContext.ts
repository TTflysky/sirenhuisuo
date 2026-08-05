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

function projectMarkdown(input: Pick<Project, 'id' | 'title' | 'request' | 'conversationId' | 'workspaceId' | 'createdAt' | 'members' | 'expectedOutputs' | 'requiredCapabilities'>): string {
  const memberLines = input.members.map((member) => `- ${member.employeeId}：${member.reason}`);
  return [
    `# ${input.title || '未命名项目'}`,
    '',
    `- 项目 ID：${input.id}`,
    `- 会话 ID：${input.conversationId || '未绑定'}`,
    `- 工作区：${input.workspaceId || projectWorkspaceId(input.id)}`,
    `- 创建时间：${new Date(input.createdAt).toISOString()}`,
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
  const document = await api.fsWrite(project.documentPath || projectDocumentPath(project.id), projectMarkdown({ ...project, workspaceId }));
  if (!document.ok) return document;
  const manifest = await api.fsWrite(`${workspaceId}/project.json`, JSON.stringify({
    ...project,
    workspaceId,
    documentPath: project.documentPath || projectDocumentPath(project.id),
    updatedAt: project.updatedAt || Date.now(),
  }, null, 2));
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
