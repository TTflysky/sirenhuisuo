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
  lines.push('_由 Hermes 助手导出_');
  return lines.join('\n');
}

/** 直接下载文本，不把聊天导出混入产出物列表。 */
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
