import type { Team, TeamTask, Employee } from '../types';
import { sendBus, BUS_CHANNELS } from '../ipcBus';
import { APP_PRODUCT_NAME } from '../brand';

const LS_OUTPUTS = 'hermes_office_outputs';
const MAX_OUTPUTS = 200;

// ===== 内容类型 =====
export type OutputContentType = 'markdown' | 'html' | 'code' | 'json' | 'csv' | 'image' | 'url' | 'text' | 'chart';
export type OutputCategory = 'final' | 'working' | 'reference';

export const OUTPUT_CATEGORY_META: Record<OutputCategory, { label: string; description: string }> = {
  final: { label: '最终交付', description: '可以直接验收或交给用户使用的成品' },
  working: { label: '工作文件', description: '草稿、方案、测试和中间过程文件' },
  reference: { label: '参考资料', description: '输入样本、原始材料和检索资料' },
};

// ===== 作用域：每个产出物属于哪个对话 =====
export type OutputScope = `team:${string}` | `dm:${string}` | 'assistant' | 'global';

export interface OutputRecord {
  id: string;
  filename: string;
  kind: 'file' | 'discussion' | 'task' | 'export' | 'tool-output';
  title: string;
  ts: number;
  scope: OutputScope;           // 作用域，过滤用
  /** 真实磁盘工作区。一个聊天可聚合多个任务工作区的交付物。 */
  workspaceId?: string;
  teamId?: string;
  taskId?: string;
  content: string;              // 文本内容
  contentType: OutputContentType; // 内容类型
  dataUrl?: string;             // 二进制内容（图片等）的 data URL
  bytes?: number;               // 文件大小
  language?: string;            // 代码语言（code 类型时）
  snippet?: string;             // 简短预览
  diskPath?: string;            // Electron 工作区中的真实文件路径
  category?: OutputCategory;    // 交付层级（旧数据读取时自动推断）
  verified?: boolean;            // 只有真实落盘并通过回读校验的文件才进入产出物索引
}

export interface NativeArtifactInput {
  path?: string;
  filename?: string;
  workspaceId?: string;
  diskPath?: string;
  bytes?: number;
  category?: OutputCategory;
  persistence?: string;
  verification?: string;
  verified?: boolean;
  recordedAt?: number;
}

function isPersistedNativeArtifact(artifact: NativeArtifactInput): boolean {
  return artifact.verified === true
    && artifact.persistence === 'disk'
    && typeof artifact.diskPath === 'string'
    && artifact.diskPath.trim().length > 0
    && typeof (artifact.path || artifact.filename) === 'string'
    && String(artifact.path || artifact.filename).trim().length > 0;
}

/** 将 Electron 原生执行器的真实文件证据投影到所有聊天窗口共用的产出物索引。 */
export async function syncNativeArtifacts(
  artifacts: NativeArtifactInput[] | undefined,
  meta: { teamId?: string; taskId?: string; workspaceId?: string; scope?: OutputScope } = {},
): Promise<OutputRecord[]> {
  if (!Array.isArray(artifacts) || !artifacts.length) return [];
  const scope = meta.scope ?? (meta.teamId ? `team:${meta.teamId}` : 'global');
  const synced: OutputRecord[] = [];
  for (const artifact of artifacts) {
    if (!isPersistedNativeArtifact(artifact)) continue;
    const filename = String(artifact.path || artifact.filename).replace(/\\/g, '/');
    const workspaceId = artifact.workspaceId || meta.workspaceId;
    let content = `文件已保存到工作区：${filename}`;
    if (workspaceId && window.electronAPI?.fsRead) {
      try {
        const read = await window.electronAPI.fsRead(`${workspaceId}/${filename}`);
        if (read?.ok && typeof read.content === 'string') content = read.content;
      } catch {
        // 二进制文件或解析失败的文件仍保留真实磁盘路径，可直接用系统程序打开。
      }
    }
    synced.push(addOutput({
      filename,
      kind: 'file',
      title: filename.split('/').pop() || filename,
      scope,
      workspaceId,
      teamId: meta.teamId,
      taskId: meta.taskId,
      content,
      contentType: contentTypeFromFilename(filename),
      language: languageFromFilename(filename),
      bytes: Number(artifact.bytes) || undefined,
      diskPath: artifact.diskPath,
      category: artifact.category,
      verified: true,
    }));
  }
  return synced;
}

/** 在窗口重启或任务结果延迟到达时，从持久化任务账本恢复已验证文件。 */
export async function syncNativeRunArtifacts(runs: Array<{ teamId?: string; id?: string; workspaceId?: string; evidence?: Array<{ artifact?: NativeArtifactInput }> }> | undefined): Promise<OutputRecord[]> {
  if (!Array.isArray(runs)) return [];
  const synced: OutputRecord[] = [];
  for (const run of runs) {
    const artifacts = (run.evidence || []).map((item) => item.artifact).filter((item): item is NativeArtifactInput => !!item);
    synced.push(...await syncNativeArtifacts(artifacts, {
      teamId: run.teamId,
      taskId: run.id,
      workspaceId: run.workspaceId,
    }));
  }
  return synced;
}

// ===== 工具函数 =====

/** 根据文件名推断内容类型 */
export function contentTypeFromFilename(filename: string): OutputContentType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'md': return 'markdown';
    case 'html': case 'htm': case 'xhtml': return 'html';
    case 'js': case 'ts': case 'jsx': case 'tsx': case 'py': case 'go': case 'rs':
    case 'java': case 'c': case 'cpp': case 'h': case 'hpp': case 'cs':
    case 'rb': case 'php': case 'swift': case 'kt': case 'scala':
    case 'vue': case 'svelte': case 'css': case 'scss': case 'less':
    case 'sql': case 'sh': case 'bash': case 'ps1': case 'bat':
    case 'yaml': case 'yml': case 'toml': case 'ini': case 'cfg':
    case 'xml': case 'svg': case 'dockerfile': case 'makefile': return 'code';
    case 'json': return 'json';
    case 'csv': return 'csv';
    case 'tsv': return 'csv';
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'webp': case 'bmp': case 'ico': return 'image';
    case 'url': return 'url';
    case 'txt': case 'log': case 'out': case 'stdout': case 'stderr': return 'text';
    default:
      // 检查文件名关键词
      const base = filename.toLowerCase();
      if (base.startsWith('http') || base.startsWith('https://') || base.startsWith('www.')) return 'url';
      return 'text';
  }
}

/** 根据内容类型推断代码语言（用于语法高亮） */
export function languageFromFilename(filename: string): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    js: 'javascript', ts: 'typescript', jsx: 'jsx', tsx: 'tsx',
    py: 'python', go: 'go', rs: 'rust', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
    rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
    vue: 'vue', svelte: 'svelte', css: 'css', scss: 'scss', less: 'less',
    sql: 'sql', sh: 'bash', bash: 'bash', ps1: 'powershell',
    yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml', svg: 'xml',
    dockerfile: 'dockerfile', json: 'json', md: 'markdown',
    html: 'html', htm: 'html',
  };
  return langMap[ext];
}

/** MIME 类型映射 */
function mimeFromType(_contentType: OutputContentType, filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const mimeMap: Record<string, string> = {
    md: 'text/markdown;charset=utf-8',
    html: 'text/html;charset=utf-8',
    htm: 'text/html;charset=utf-8',
    json: 'application/json;charset=utf-8',
    csv: 'text/csv;charset=utf-8',
    tsv: 'text/tab-separated-values;charset=utf-8',
    txt: 'text/plain;charset=utf-8',
    log: 'text/plain;charset=utf-8',
    xml: 'application/xml;charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

export function formatOutputSize(r: OutputRecord): string {
  const size = r.bytes ?? (r.dataUrl ? Math.round(r.dataUrl.length * 0.75) : new Blob([r.content]).size);
  return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
}

/** 获取内容类型的图标 emoji */
export function contentTypeIcon(type: OutputContentType): string {
  switch (type) {
    case 'markdown': return '📝';
    case 'html': return '🌐';
    case 'code': return '💻';
    case 'json': return '📊';
    case 'csv': return '📋';
    case 'image': return '🖼️';
    case 'url': return '🔗';
    case 'text': return '📄';
    case 'chart': return '📈';
  }
}

/** 获取生成种类的图标 */
export function kindIcon(kind: string): string {
  switch (kind) {
    case 'discussion': return '💬';
    case 'task': return '📋';
    case 'tool-output': return '🔧';
    default: return '📄';
  }
}

export function inferOutputCategory(filename: string, explicit?: string): OutputCategory {
  if (explicit === 'final' || explicit === 'working' || explicit === 'reference') return explicit;
  const normalized = filename.replace(/\\/g, '/').toLowerCase();
  if (/(^|\/)(references?|sources?|inputs?|uploads?|素材|参考资料|原始资料)(\/|$)|原始|素材|参考资料|无答案|题目版|输入样本/u.test(normalized)) return 'reference';
  if (/(^|\/)(drafts?|working|temp|tmp|tests?|notes?|草稿|过程|工作文件)(\/|$)|草稿|初稿|中间版|过程|测试记录|诊断|日志|会议纪要/u.test(normalized)) return 'working';
  return 'final';
}

// ===== CRUD =====

export function loadOutputs(): OutputRecord[] {
  try {
    const raw = localStorage.getItem(LS_OUTPUTS);
    if (raw) {
      const parsed = JSON.parse(raw) as OutputRecord[];
      // 只保留真实文件。旧版自动生成的聊天纪要、任务摘要、命令日志和附件占位不属于最终产物。
      const normalized = parsed.map((o) => ({
        ...o,
        scope: (o as any).scope ?? 'global',
        contentType: (o as any).contentType ?? 'markdown',
        category: inferOutputCategory(o.filename, (o as any).category),
      })).filter((output) => output.kind === 'file'
        && !output.id.startsWith('att-')
        && !output.title?.startsWith('附件：')
        && !output.content?.startsWith('已上传附件 '));
      const latestByPath = new Map<string, OutputRecord>();
      normalized.sort((a, b) => a.ts - b.ts).forEach((output) => {
        latestByPath.set(`${output.scope}\n${output.workspaceId ?? 'legacy'}\n${output.filename.replace(/\\/g, '/').toLowerCase()}`, output);
      });
      const cleaned = [...latestByPath.values()].sort((a, b) => a.ts - b.ts);
      if (cleaned.length !== parsed.length) saveOutputs(cleaned);
      return cleaned;
    }
  } catch {}
  return [];
}

function saveOutputs(list: OutputRecord[]): void {
  try {
    localStorage.setItem(LS_OUTPUTS, JSON.stringify(list.slice(-MAX_OUTPUTS)));
  } catch (e) {
    console.warn('[outputs] save failed:', e);
  }
}

export function addOutput(r: Omit<OutputRecord, 'id' | 'ts'>): OutputRecord {
  const rec: OutputRecord = {
    id: `out-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    ...r,
    scope: r.scope ?? 'global',
    contentType: r.contentType ?? contentTypeFromFilename(r.filename),
    category: inferOutputCategory(r.filename, r.category),
  } as OutputRecord;
  // 自动计算 bytes
  if (!rec.bytes) {
    rec.bytes = rec.dataUrl
      ? Math.round(rec.dataUrl.length * 0.75)
      : new Blob([rec.content]).size;
  }
  const list = loadOutputs();
  const key = `${rec.scope}\n${rec.workspaceId ?? 'legacy'}\n${rec.filename.replace(/\\/g, '/').toLowerCase()}`;
  const existingIndex = list.findIndex((item) => `${item.scope}\n${item.workspaceId ?? 'legacy'}\n${item.filename.replace(/\\/g, '/').toLowerCase()}` === key);
  if (existingIndex >= 0) {
    rec.id = list[existingIndex].id;
    list[existingIndex] = rec;
  } else {
    list.push(rec);
  }
  saveOutputs(list);
  // 广播产出物变更，让其他窗口（主办公室 / 原生聊天子窗口）实时刷新
  sendBus(BUS_CHANNELS.OUTPUTS_CHANGED, { scope: rec.scope });
  return rec;
}

export function removeOutput(id: string): void {
  saveOutputs(loadOutputs().filter((o) => o.id !== id));
}

export function clearOutputs(): void {
  try { localStorage.removeItem(LS_OUTPUTS); } catch {}
}

/** 按作用域过滤产出物 */
export function loadOutputsByScope(scope: OutputScope | 'all'): OutputRecord[] {
  const all = loadOutputs();
  if (scope === 'all') return all;
  return all.filter((o) => o.scope === scope);
}

/** 按 teamId 过滤产出物 */
export function loadOutputsByTeam(teamId: string): OutputRecord[] {
  return loadOutputs().filter((o) => o.scope === `team:${teamId}`);
}

/** 按 empId 过滤产出物 */
export function loadOutputsByDm(empId: string): OutputRecord[] {
  return loadOutputs().filter((o) => o.scope === `dm:${empId}`);
}

/** 助手对话产出物 */
export function loadOutputsByAssistant(): OutputRecord[] {
  return loadOutputs().filter((o) => o.scope === 'assistant');
}

// ===== 外部浏览器预览 =====

/** 在浏览器新标签中打开产出物预览 */
export function openOutputInBrowser(r: OutputRecord): void {
  if (r.diskPath && window.electronAPI?.openPath) {
    void window.electronAPI.openPath(r.diskPath);
    return;
  }
  let html: string;
  const title = r.title || r.filename;

  if (r.contentType === 'image' && r.dataUrl) {
    // 图片 → 直接 data URL
    window.open(r.dataUrl, '_blank');
    return;
  }

  if (r.contentType === 'html') {
    // HTML → 直接渲染
    html = r.content;
  } else if (r.contentType === 'markdown') {
    // Markdown → 包裹为 HTML
    html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;
max-width:860px;margin:0 auto;padding:32px 24px;line-height:1.6;color:#1a1f36;font-size:15px;}
pre{background:#f5f6fa;padding:16px;border-radius:8px;overflow:auto;font-size:13px;}
code{background:#eef0f6;padding:2px 6px;border-radius:3px;font-size:13px;}
pre code{background:none;padding:0;}
blockquote{border-left:3px solid #ddd;padding:4px 16px;margin:12px 0;color:#666;}
img{max-width:100%;border-radius:6px;}
table{border-collapse:collapse;width:100%;}
th,td{border:1px solid #e2e6ef;padding:8px 12px;text-align:left;}</style></head><body>
<div id="content">${mdToHtml(r.content)}</div>
<script>document.getElementById('content').innerHTML = document.getElementById('content').textContent</script>
</body></html>`;
  } else if (r.contentType === 'url') {
    window.open(r.content.trim(), '_blank');
    return;
  } else if (r.contentType === 'json') {
    html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:ui-monospace,Consolas,monospace;padding:24px;font-size:13px;line-height:1.5;}</style></head>
<body><pre>${escapeHtml(r.content)}</pre></body></html>`;
  } else if (r.contentType === 'csv') {
    const lines = r.content.trim().split('\n');
    const rows = lines.map(l => `<tr>${l.split(',').map(c => `<td>${escapeHtml(c.trim())}</td>`).join('')}</tr>`).join('\n');
    html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;padding:24px;}
table{border-collapse:collapse;font-size:13px;}
th,td{border:1px solid #ddd;padding:6px 10px;text-align:left;}
tr:nth-child(even){background:#f8f9fa;}</style></head>
<body><table>${rows}</table></body></html>`;
  } else {
    // 代码/文本/默认
    html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:ui-monospace,Consolas,monospace;padding:24px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;}</style></head>
<body><pre>${escapeHtml(r.content)}</pre></body></html>`;
  }

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // 延迟释放以避免浏览器尚未加载
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mdToHtml(md: string): string {
  let h = escapeHtml(md);
  h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n\n/g, '</p><p>');
  return `<p>${h}</p>`;
}

// ===== 下载 =====
export function downloadOutput(r: OutputRecord): void {
  let blob: Blob;
  if (r.dataUrl) {
    // 二进制内容：从 data URL 创建
    fetch(r.dataUrl).then((res) => res.blob()).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }).catch(() => {
      // fallback: 直接下载
      const a = document.createElement('a');
      a.href = r.dataUrl!;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
    return;
  }
  const mime = mimeFromType(r.contentType, r.filename);
  blob = new Blob([r.content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = r.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===== 生成产出物内容 =====

/** 团队讨论纪要 */
export function buildDiscussionOutput(
  team: Team,
  employees: Employee[],
  trigger: { kind: 'task' | 'user'; task?: TeamTask; userText?: string }
): OutputRecord {
  const lines: string[] = [];
  const now = new Date();
  lines.push(`# ${team.name} 讨论纪要`);
  lines.push('');
  lines.push(`- 时间：${now.toLocaleString('zh-CN')}`);
  lines.push(`- 成员：${team.memberIds.map((id) => employees.find((e) => e.id === id)?.name).filter(Boolean).join('、')}`);
  if (trigger.kind === 'task' && trigger.task) {
    lines.push(`- 任务：${trigger.task.title}`);
    if (trigger.task.description) lines.push(`  ${trigger.task.description}`);
  } else if (trigger.userText) {
    lines.push(`- 触发：老板在群里说「${trigger.userText}」`);
  }
  lines.push('');
  lines.push('## 讨论内容');
  lines.push('');
  for (const m of team.chatMessages) {
    const author = employees.find((e) => e.id === m.authorId);
    const name = author?.name ?? m.authorId;
    const role = author?.title ?? m.roleId;
    const time = new Date(m.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const tokens = m.tokens ? ` _(≈${m.tokens} tokens)_` : '';
    lines.push(`### ${time} · ${name}（${role}）${tokens}`);
    lines.push('');
    lines.push(m.content);
    lines.push('');
  }
  if (trigger.task) {
    const t = trigger.task;
    lines.push('## 任务交付');
    lines.push('');
    lines.push(`- 标题：${t.title}`);
    lines.push(`- 最终状态：**DONE** ✅`);
    if (t.description) lines.push(`- 描述：${t.description}`);
    lines.push('');
  }
  lines.push('---');
  lines.push(`_由 ${APP_PRODUCT_NAME} 自动生成 · ${now.toISOString()}_`);

  const ts = now.getTime();
  const filename = `${team.name}-${formatDate(now)}-纪要.md`;
  return {
    id: '',
    ts,
    filename,
    kind: 'discussion',
    title: `${team.name} 讨论纪要`,
    scope: `team:${team.id}`,
    teamId: team.id,
    taskId: trigger.task?.id,
    content: lines.join('\n'),
    contentType: 'markdown',
  } as OutputRecord;
}

/** 任务交付说明 */
export function buildTaskOutput(
  team: Team,
  employees: Employee[],
  task: TeamTask
): OutputRecord {
  const now = new Date();
  const owner = employees.find((e) => e.id === task.claimedBy);
  const lines = [
    `# 任务交付：${task.title}`,
    ``,
    `## 任务信息`,
    ``,
    `- 团队：${team.name}`,
    `- 状态：**${task.lane}**`,
    owner ? `- 认领人：${owner.name}（${owner.title}）` : `- 认领人：未认领`,
    `- 发布时间：${new Date().toLocaleString('zh-CN')}`,
    ``,
    `## 任务描述`,
    ``,
    task.description || '（无）',
    ``,
    `## 验收标准`,
    ``,
    task.acceptance || '（未指定）',
    ``,
    `## 相关讨论摘录`,
    ``,
  ];
  for (const m of team.chatMessages.slice(-10)) {
    const author = employees.find((e) => e.id === m.authorId);
    lines.push(`> **${author?.name ?? m.authorId}**：${m.content}`);
    lines.push(``);
  }
  lines.push(`---`);
  lines.push(`_自动生成于 ${now.toISOString()}_`);

  return {
    id: '',
    ts: now.getTime(),
    filename: `${team.name}-${task.title}-交付.md`,
    kind: 'task',
    title: `任务交付：${task.title}`,
    scope: `team:${team.id}`,
    teamId: team.id,
    taskId: task.id,
    content: lines.join('\n'),
    contentType: 'markdown',
  } as OutputRecord;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}
