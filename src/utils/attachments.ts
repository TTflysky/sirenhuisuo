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
  }
  return base;
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
