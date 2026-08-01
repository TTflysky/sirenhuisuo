import type { TaskApprovalContract, TaskStageSummary } from '../types';

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

export interface ChatTranscriptAttachment {
  name: string;
  mime?: string;
  size?: number;
  kind?: 'image' | 'text' | 'file' | string;
  dataUrl?: string;
  workspacePath?: string;
  path?: string;
  persistenceError?: string;
}

export interface ChatTranscriptMessage {
  role: string;
  author?: string;
  content: string;
  time?: string;
  attachments?: ChatTranscriptAttachment[];
  kind?: 'text' | 'task' | 'execution' | 'stage_summary' | 'approval';
  stageSummary?: TaskStageSummary;
  approval?: TaskApprovalContract;
}

function formatAttachmentSize(size: number | undefined): string {
  if (!Number.isFinite(size) || !size || size < 0) return '大小未知';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[\\[\]]/gu, '\\$&');
}

function attachmentPath(attachment: ChatTranscriptAttachment): string | undefined {
  return attachment.workspacePath || attachment.path;
}

function markdownPath(value: string): string {
  return `<${value.replaceAll('\\', '/')}>`;
}

function attachmentMarkdown(attachment: ChatTranscriptAttachment): string[] {
  const persistedPath = attachmentPath(attachment);
  const state = attachment.persistenceError
    ? `保存失败：${attachment.persistenceError}`
    : persistedPath
      ? `已保存：\`${persistedPath}\``
      : '尚未确认落盘位置';
  const mime = attachment.mime ? `，${attachment.mime}` : '';
  const lines = [`- **${escapeMarkdownLabel(attachment.name)}**（${attachment.kind ?? 'file'}${mime}，${formatAttachmentSize(attachment.size)}；${state}）`];
  if (persistedPath) {
    const target = markdownPath(persistedPath);
    lines.push(`  - [打开附件](${target})`);
    if (attachment.kind === 'image') lines.push('', `  ![${escapeMarkdownLabel(attachment.name)}](${target})`);
  } else if (attachment.kind === 'image' && attachment.dataUrl) {
    lines.push('  - 图片未落盘；为避免导出文件膨胀，未写入 Base64 正文。');
  }
  if (attachment.kind === 'text' && attachment.dataUrl) {
    const preview = attachment.dataUrl.slice(0, 6000);
    lines.push('', '  ```text', preview, '  ```');
    if (attachment.dataUrl.length > preview.length) lines.push('  _文本预览已截断，完整内容请打开上方附件。_');
  }
  return lines;
}

/** 把消息列表转成纯文本 */
export function messagesToText(msgs: ChatTranscriptMessage[]): string {
  return msgs.map((m) => {
    const head = m.author ? `[${m.time ?? ''}] ${m.author}（${m.role}）` : `[${m.time ?? ''}] ${m.role}`;
    const attachments = (m.attachments ?? []).map((attachment) => `[附件] ${attachment.name}（${formatAttachmentSize(attachment.size)}）`).join('\n');
    return `${head}\n${m.content}${attachments ? `\n${attachments}` : ''}\n`;
  }).join('\n---\n\n');
}

/** 把消息列表转成 markdown */
export function messagesToMarkdown(msgs: ChatTranscriptMessage[], title: string): string {
  const lines = [`# ${title}`, '', `> 导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
  for (const m of msgs) {
    const head = m.author ? `**${m.author}**（${m.role}）· ${m.time ?? ''}` : `**${m.role}** · ${m.time ?? ''}`;
    lines.push(`### ${head}`);
    lines.push('');
    if (m.kind === 'stage_summary' && m.stageSummary) {
      const summary = m.stageSummary;
      lines.push(`#### 阶段交接：${summary.stageTitle}`);
      lines.push('');
      lines.push(`- **状态**：${summary.status === 'completed' ? '已完成' : summary.status === 'blocked' ? '等待处理' : '执行失败'}`);
      lines.push(`- **负责人**：${summary.ownerName}`);
      lines.push(`- **解决什么**：${summary.problem}`);
      lines.push(`- **为什么这样做**：${summary.rationale}`);
      lines.push(`- **已经做到**：${summary.completed.length ? summary.completed.join('；') : '尚无可确认结果'}`);
      lines.push(`- **可核对证据**：${summary.evidence.length ? summary.evidence.join('；') : '本阶段未登记已验证证据'}`);
      lines.push(`- **还没有做**：${summary.remaining.length ? summary.remaining.join('；') : '当前计划没有剩余阶段'}`);
      lines.push(`- **下一步**：${summary.nextAction}`);
      if (summary.operations.length) {
        lines.push('', '<details>', '<summary>执行过程</summary>', '');
        for (const operation of summary.operations) {
          lines.push(`- ${new Date(operation.ts).toLocaleTimeString('zh-CN')} · ${operation.success ? '成功' : '失败'} · ${operation.detail}`);
        }
        lines.push('', '</details>');
      }
    } else if (m.kind === 'approval' && m.approval) {
      const approval = m.approval;
      lines.push(`#### 授权：${approval.title}`);
      lines.push('');
      lines.push(`- **状态**：${approval.status === 'pending' ? '等待决定' : approval.status === 'rejected' ? '已拒绝' : '已允许'}`);
      lines.push(`- **申请人**：${approval.requestedByName}`);
      lines.push(`- **目的**：${approval.purpose}`);
      lines.push(`- **准备执行**：${approval.action}`);
      lines.push(`- **读取范围**：${approval.reads.join('；') || '无'}`);
      lines.push(`- **写入范围**：${approval.writes.join('；') || '无'}`);
      lines.push(`- **风险**：${approval.risks.join('；') || '未发现额外风险'}`);
      lines.push(`- **允许后**：${approval.approveEffect}`);
      lines.push(`- **拒绝后**：${approval.rejectEffect}`);
    } else {
      lines.push(m.content);
    }
    if (m.attachments?.length) {
      lines.push('', '**附件（与本条消息一起导出）**', '');
      for (const attachment of m.attachments) lines.push(...attachmentMarkdown(attachment), '');
    }
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
  messages: ChatTranscriptMessage[];
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
