import type { Attachment } from '../data/hermesClient';

/** 文本类扩展名：可直接读取内容当作上下文发给模型 */
const TEXT_EXT = /\.(txt|md|markdown|json|csv|yaml|yml|xml|log|js|ts|tsx|jsx|py|java|c|cpp|h|css|scss|less|html|htm|sh|bat|ps1|go|rs|php|rb|sql|toml|ini|conf)$/i;

/** 判断附件类型 */
export function classifyFile(name: string, mime: string): Attachment['kind'] {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('text/') || TEXT_EXT.test(name)) return 'text';
  return 'file';
}

/** 读取文件为 data URL（base64） */
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** 读取文本文件内容 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** 把 File 转成 Attachment（自动分类 + 读取内容） */
export async function fileToAttachment(file: File): Promise<Attachment> {
  const kind = classifyFile(file.name, file.type);
  const base: Attachment = {
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    kind,
  };
  if (kind === 'image') {
    base.dataUrl = await readFileAsDataURL(file);
  } else if (kind === 'text') {
    try {
      base.dataUrl = await readFileAsText(file);
    } catch {
      base.dataUrl = '';
    }
  } else {
    base.dataUrl = await readFileAsDataURL(file);
  }
  return base;
}

function workspaceScope(scope: string): string {
  return scope.split(/[\\/]+/).map((part) => part.replace(/[^a-zA-Z0-9_-]/g, '_')).filter(Boolean).join('/');
}

function safeFilename(name: string): string {
  return name.replace(/[\\/<>:"|?*\p{Cc}]/gu, '_').replace(/^\.+/, '') || 'attachment.bin';
}

export type WorkspaceKind = 'assistant' | 'dm' | 'team';

/** Creates a readable, collision-resistant workspace id for one user request. */
export function createTaskWorkspaceId(kind: WorkspaceKind, ownerId = 'default'): string {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return `tasks/${kind}/${workspaceScope(ownerId)}/run-${token}`;
}

export async function initializeTaskWorkspace(workspaceId: string, metadata: { kind: WorkspaceKind; label: string; taskId?: string }): Promise<void> {
  const api = window.electronAPI;
  if (!api?.fsInitWorkspace) return;
  const result = await api.fsInitWorkspace(workspaceScope(workspaceId), {
    ...metadata,
    workspaceId,
    createdAt: new Date().toISOString(),
  });
  if (!result.ok) throw new Error(result.error ?? '任务工作区初始化失败');
}

/** 把聊天暂存区中的附件复制到本次任务目录，任务之间不再共享可写文件。 */
export async function copyAttachmentsToWorkspace(sourceScope: string, workspaceId: string, attachments: Attachment[]): Promise<void> {
  const api = window.electronAPI;
  const entries = attachments
    .filter((attachment) => !!attachment.workspacePath)
    .map((attachment) => ({ sourcePath: attachment.workspacePath!, targetPath: attachment.workspacePath! }));
  if (!api?.fsCopyIntoWorkspace || entries.length === 0) return;
  const result = await api.fsCopyIntoWorkspace(workspaceScope(sourceScope), workspaceScope(workspaceId), entries);
  if (!result.ok) {
    const detail = result.errors?.filter(Boolean).slice(0, 3).join('；') || result.error;
    throw new Error(`附件复制到任务工作区失败${detail ? `：${detail}` : ''}`);
  }
}

/** 将附件真实写入当前聊天的工作区，供员工工具读取。 */
export async function persistAttachments(scope: string, attachments: Attachment[]): Promise<Attachment[]> {
  const api = window.electronAPI;
  if (!api?.fsWrite) return attachments;
  const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return Promise.all(attachments.map(async (attachment) => {
    if (attachment.workspacePath || !attachment.dataUrl) return attachment;
    const uploadPath = `uploads/${batchId}/${safeFilename(attachment.name)}`;
    const relativePath = `${workspaceScope(scope)}/${uploadPath}`;
    try {
      const result = attachment.kind === 'text'
        ? await api.fsWrite(relativePath, attachment.dataUrl)
        : await api.fsWriteData(relativePath, attachment.dataUrl);
      if (!result.ok) return { ...attachment, persistenceError: result.error ?? '写入工作区失败' };
      return {
        ...attachment,
        workspacePath: uploadPath,
        persistenceError: undefined,
        // 二进制已落盘后不再塞进聊天 localStorage；图片仍需 data URL 做视觉输入和缩略图。
        dataUrl: attachment.kind === 'file' ? undefined : attachment.dataUrl,
      };
    } catch (error) {
      return { ...attachment, persistenceError: error instanceof Error ? error.message : String(error) };
    }
  }));
}

/** 给模型明确提供真实附件路径，禁止把已落盘文件误认为占位记录。 */
export function attachmentWorkspaceContext(attachments: Attachment[]): string {
  const lines = attachments.map((attachment) => {
    if (attachment.workspacePath) return `- ${attachment.name}：已真实保存为 ${attachment.workspacePath}（${formatFileSize(attachment.size)}）`;
    if (attachment.persistenceError) return `- ${attachment.name}：保存失败，原因：${attachment.persistenceError}`;
    if (attachment.kind === 'text' && attachment.dataUrl) return `- ${attachment.name}：\n${attachment.dataUrl.slice(0, 6000)}`;
    return undefined;
  }).filter(Boolean);
  if (!lines.length) return '';
  return `\n\n【工作区附件】\n${lines.join('\n')}\n必须使用 read_file、run_command 或相应 Skill 读取真实文件后再回答；禁止声称这些文件只是占位记录。`;
}

/** 从剪贴板提取文件/图片 */
export async function attachmentsFromClipboard(e: React.ClipboardEvent): Promise<Attachment[]> {
  const dt = e.clipboardData;
  if (!dt) return [];
  const files: File[] = [];
  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i];
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length === 0) return [];
  return Promise.all(files.map(fileToAttachment));
}

/** 格式化文件大小 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
