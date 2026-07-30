/** 复制文本到剪贴板 */
export function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  // 兜底 execCommand
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed'; el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return Promise.resolve(ok);
  } catch {
    return Promise.resolve(false);
  }
}

/** 把消息列表转成纯文本 */
export function messagesToText(msgs: { role: string; author?: string; content: string; time?: string }[]): string {
  return msgs.map((m) => {
    const head = m.author ? `[${m.time ?? ''}] ${m.author}（${m.role}）` : `[${m.time ?? ''}] ${m.role}`;
    return `${head}\n${m.content}\n`;
  }).join('\n---\n\n');
}

/** 把消息列表转成 markdown */
export function messagesToMarkdown(msgs: { role: string; author?: string; content: string; time?: string }[], title: string): string {
  const lines = [`# ${title}`, '', `> 导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
  for (const m of msgs) {
    const head = m.author ? `**${m.author}**（${m.role}）· ${m.time ?? ''}` : `**${m.role}** · ${m.time ?? ''}`;
    lines.push(`### ${head}`);
    lines.push('');
    lines.push(m.content);
    lines.push('');
  }
  lines.push('---');
  lines.push('_由太极助手导出_');
  return lines.join('\n');
}

/** 直接下载文本，不把聊天导出混入产出物列表。 */
export interface ChatTranscriptInput {
  scope: string;
  title: string;
  messages: { role: string; author?: string; content: string; time?: string }[];
}

function transcriptScope(value: string): string {
  return String(value || 'chat').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'chat';
}

/**
 * A copied conversation is also persisted as Markdown. This keeps a readable
 * handoff in the workspace instead of making the clipboard the only record.
 */
export async function copyAndArchiveChatTranscript(input: ChatTranscriptInput): Promise<{ copied: boolean; path?: string; error?: string }> {
  const markdown = messagesToMarkdown(input.messages, input.title);
  const copied = await copyToClipboard(markdown);
  const filename = `${transcriptScope(input.scope)}-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
  const relativePath = `transcripts/${transcriptScope(input.scope)}/${filename}`;
  const writer = typeof window !== 'undefined' ? window.electronAPI?.fsWrite : undefined;
  if (!writer) {
    downloadTextFile(filename, markdown);
    return { copied };
  }
  try {
    const result = await writer(relativePath, markdown);
    if (result.ok) return { copied, path: result.path };
    // Preserve the user's handoff even when the workspace cannot be written.
    downloadTextFile(filename, markdown);
    return { copied, error: result.error || '聊天记录写入工作区失败，已下载 Markdown 文件。' };
  } catch (error) {
    downloadTextFile(filename, markdown);
    return { copied, error: error instanceof Error ? error.message : String(error) };
  }
}

export function downloadTextFile(filename: string, content: string, mime = 'text/markdown;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
