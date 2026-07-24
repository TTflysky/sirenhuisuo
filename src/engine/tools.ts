/**
 * 本地工具注册表（自建，OpenAI function-calling 兼容）
 * 
 * 工具列表：
 * - write_file   : 输出文件到 outputs/（自动落 localStorage + 可下载）
 * - read_file    : 读取已产出文件或上传的内容
 * - list_files   : 浏览 outputs/ 目录
 * - web_search   : 搜互联网（DuckDuckGo 免费 API）
 * - run_command  : 需要真人确认（弹窗 confirm，限沙箱输出路径）
 */

import { addOutput, loadOutputs, contentTypeFromFilename, type OutputRecord, type OutputScope } from '../data/outputs';

// ===== Tool Schema（OpenAI function-calling 格式）=====
export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: { type: string; properties: Record<string, unknown>; required: string[] };
  };
}

export const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '输出一个文件。写入后文件会出现在 outputs/ 目录中，可以被后续 read_file 读取。参数：path 为文件名（不含路径前缀，自动写入 outputs/），content 为文件内容（markdown/html/code 等）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件名，如 "方案设计.md" 或 "index.html"' },
          content: { type: 'string', description: '文件内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取工作区中的真实文件。支持文本、代码、CSV/JSON，以及 Excel、Word、PowerPoint、PDF、OpenDocument、RTF、EPUB 的内容提取。长文件可用 offset 和 limit 分段读取。上传文件路径以 uploads/ 开头。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件名，如 "方案设计.md"' },
          offset: { type: 'string', description: '可选，开始字符位置，默认 0' },
          limit: { type: 'string', description: '可选，本次最多读取字符数，默认 12000，最大 50000' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: '列出 outputs/ 目录中的所有文件。用于查看有哪些产出物。',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: '可选的文件名过滤关键词，如 ".md" 只看 markdown' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '搜索互联网获取最新信息。用于查找资料、技术文档、新闻等。返回纯文本摘要。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_skills',
      description: '检索本机技能库。开始处理任务前使用，根据任务目标搜索可用 Skill，返回技能 ID、名称和说明。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '任务目标或技能关键词，例如“短视频脚本创作”' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_skill',
      description: '读取 search_skills 返回的 Skill 完整操作说明。确定技能适用后必须读取，再按说明执行。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'search_skills 返回的技能 ID' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: `执行终端命令（仅 Electron 桌面版可用）。命令在自主代理工作区（workspace）内执行，最长 30 秒超时，输出上限 100KB。
可用命令示例：
- "npm install package-name" 安装依赖
- "npm run build" 构建项目
- "node script.js" 运行脚本
- "git status" 查看 git 状态
- "mkdir -p outputs/xxx" 创建目录
- "python script.py" 运行 Python
- "dir" 或 "ls -la" 列出文件
输出的 stdout/stderr 会返回给调用者，同时自动保存到 outputs/ 以便后续查看。`,
      parameters: {
        type: 'object',
        properties: {
          cmd: { type: 'string', description: '完整命令，如 "npm install react" 或 "git log --oneline -5"' },
        },
        required: ['cmd'],
      },
    },
  },
];

// ===== Tool 执行结果 =====
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, string>;
  scope?: OutputScope;   // 产出物作用域
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  success: boolean;
  output: string;
}

// ===== Sandbox 检查 =====
function safePath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => part.replace(/[<>:"|?*\u0000-\u001f]/g, '_'));
  return parts.join('/') || 'untitled.txt';
}

function diskScope(scope?: OutputScope): string {
  return scope ? scope.replace(/[^a-zA-Z0-9_-]/g, '_') : 'global';
}

// ===== 工具执行 =====
// 真实文件系统桥（Electron 桌面版）：把文件落到自主代理工作区（userData/workspace）
function getFsApi(): any {
  return (typeof window !== 'undefined' && (window as any).electronAPI) ? (window as any).electronAPI : null;
}

const TEXT_PREVIEW_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'csv', 'tsv', 'html', 'htm', 'css', 'scss', 'less',
  'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp',
  'cs', 'rb', 'php', 'swift', 'kt', 'sql', 'sh', 'bash', 'ps1', 'bat', 'cmd',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'xml', 'svg', 'vue', 'svelte', 'log',
]);

type WorkspaceFileVersion = { size: number; modifiedAt: number };

async function workspaceFileVersions(scope: OutputScope, fsApi: any): Promise<Map<string, WorkspaceFileVersion>> {
  const versions = new Map<string, WorkspaceFileVersion>();
  if (!fsApi?.fsList) return versions;
  const listed = await fsApi.fsList(diskScope(scope), true);
  if (!listed?.ok || !Array.isArray(listed.items)) return versions;
  for (const item of listed.items) {
    if (item.type !== 'file') continue;
    versions.set(String(item.name).replace(/\\/g, '/'), {
      size: Number(item.size) || 0,
      modifiedAt: Number(item.modifiedAt) || 0,
    });
  }
  return versions;
}

async function syncWorkspaceFiles(scope: OutputScope, fsApi: any, before = new Map<string, WorkspaceFileVersion>()): Promise<number> {
  if (!fsApi?.fsList) return 0;
  const listed = await fsApi.fsList(diskScope(scope), true);
  if (!listed?.ok || !Array.isArray(listed.items)) return 0;
  let synced = 0;
  for (const item of listed.items) {
    if (item.type !== 'file') continue;
    const filename = String(item.name).replace(/\\/g, '/');
    if (filename === 'uploads' || filename.startsWith('uploads/')) continue;
    const previous = before.get(filename);
    if (previous && previous.size === (Number(item.size) || 0) && previous.modifiedAt === (Number(item.modifiedAt) || 0)) continue;
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const type = contentTypeFromFilename(filename);
    let content = `文件已保存到工作区。点击“打开”可使用系统默认程序查看。`;
    if (TEXT_PREVIEW_EXTENSIONS.has(ext) && item.size <= 2 * 1024 * 1024 && fsApi.fsRead) {
      const read = await fsApi.fsRead(`${diskScope(scope)}/${filename}`);
      if (read?.ok && typeof read.content === 'string') content = read.content;
    }
    const root = String(listed.path ?? '').replace(/[\\/]+$/, '');
    addOutput({
      filename,
      kind: 'file',
      title: filename.split('/').pop() || filename,
      scope,
      contentType: type,
      language: type === 'code' ? ext : undefined,
      content,
      bytes: Number(item.size) || undefined,
      diskPath: root ? `${root}/${filename}` : undefined,
    });
    synced += 1;
  }
  return synced;
}

export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const { name, args, id } = call;
  try {
    switch (name) {
      case 'write_file': {
        const path = safePath(args.path ?? 'untitled.txt');
        const content = args.content ?? '';
        const ct = contentTypeFromFilename(path);
        // 1) 落到真实工作区文件（桌面版可用；浏览器版跳过）
        const fsApi = getFsApi();
        let diskInfo = '';
        let diskPath: string | undefined;
        if (fsApi?.fsWrite) {
          try {
            const r = await fsApi.fsWrite(`${diskScope(call.scope)}/${path}`, content);
            if (r?.ok) {
              diskPath = r.path;
              diskInfo = `（已写入磁盘工作区：${r.path}，${r.size} 字节）`;
            } else {
              return { toolCallId: id, name, success: false, output: `文件写入失败：${r?.error ?? '未知错误'}` };
            }
          } catch (e: any) {
            return { toolCallId: id, name, success: false, output: `文件写入异常：${e?.message ?? '未知错误'}` };
          }
        }
        // 同一路径使用 upsert，只展示磁盘上最新的文件版本。
        addOutput({
          filename: path,
          kind: 'file',
          title: path.split('/').pop() || path,
          scope: call.scope ?? 'global',
          contentType: ct,
          language: ct === 'code' ? path.split('.').pop() : undefined,
          content,
          diskPath,
        });
        return {
          toolCallId: id, name, success: true,
          output: `文件已写入：${path}（${content.split('\n').length} 行，${content.length} 字符）${diskInfo}`,
        };
      }

      case 'read_file': {
        const path = safePath(args.path ?? '');
        const offset = Math.max(0, Number.parseInt(args.offset ?? '0', 10) || 0);
        const limit = Math.min(50000, Math.max(1000, Number.parseInt(args.limit ?? '12000', 10) || 12000));
        // 优先读真实工作区文件
        const fsApi = getFsApi();
        if (fsApi?.fsRead) {
          try {
            const r = await fsApi.fsRead(`${diskScope(call.scope)}/${path}`);
            if (r?.ok) {
              const content = String(r.content ?? '');
              const section = content.slice(offset, offset + limit);
              const next = offset + section.length < content.length ? `\n\n[还有内容；下一段请用 offset=${offset + section.length}]` : '';
              const format = r.format ? `（${r.format}，${r.size ?? 0} 字节）` : '';
              return { toolCallId: id, name, success: true, output: `文件 ${path}${format} 内容：\n${section}${next}` };
            }
            return { toolCallId: id, name, success: false, output: `读取文件 ${path} 失败：${r?.error ?? '未知错误'}${r?.path ? `\n真实路径：${r.path}` : ''}` };
          } catch {}
        }
        // 回退到应用内产出物
        const outputs = loadOutputs();
        const scopedOutputs = call.scope ? outputs.filter((output: OutputRecord) => output.scope === call.scope) : outputs;
        const found = scopedOutputs.find((o: OutputRecord) => o.filename === path);
        if (!found) {
          const fuzzy = scopedOutputs.filter((o: OutputRecord) => o.filename.includes(path));
          if (fuzzy.length === 0) {
            return { toolCallId: id, name, success: false, output: `未找到文件：${path}。可用 list_files 查看工作区目录。` };
          }
          return {
            toolCallId: id, name, success: true,
            output: `找到 ${fuzzy.length} 个匹配文件：${fuzzy.map((f: OutputRecord) => f.filename).join('、')}\n\n最新文件内容：${fuzzy[fuzzy.length - 1].content.slice(0, 3000)}`,
          };
        }
        return { toolCallId: id, name, success: true, output: `文件 ${path} 内容：\n${found.content.slice(0, 3000)}` };
      }

      case 'list_files': {
        const filter = (args.filter ?? '').toLowerCase();
        const fsApi = getFsApi();
        // 优先列出真实工作区
        let lines: string[] = [];
        let source = '工作区';
        if (fsApi?.fsList) {
          try {
            const r = await fsApi.fsList(diskScope(call.scope), true);
            if (r?.ok && r.items?.length) {
              lines = r.items
                .filter((it: any) => !filter || it.name.toLowerCase().includes(filter))
                .map((it: any) => `- ${it.name}${it.type === 'dir' ? '/' : ''} (${it.type === 'dir' ? '目录' : `${(it.size / 1000).toFixed(1)}KB`})`);
            }
          } catch {}
        }
        // 应用内产出物补充
        const outputs = (loadOutputs() as OutputRecord[]).filter((output) => !call.scope || output.scope === call.scope);
        const outFiles = outputs
          .filter((o) => !filter || o.filename.toLowerCase().includes(filter))
          .map((o) => `- ${o.filename} (产出物 · ${(o.content.length / 1000).toFixed(1)}KB)`);
        if (lines.length === 0 && outFiles.length === 0) {
          return { toolCallId: id, name, success: true, output: '工作区为空。可用 write_file 产出文件，或用 run_command 创建目录。' };
        }
        const merged = [...lines, ...outFiles];
        return { toolCallId: id, name, success: true, output: `${source}目录（${merged.length} 项）：\n${merged.join('\n')}` };
      }

      case 'web_search': {
        const q = encodeURIComponent(args.query ?? '');
        // 用 DuckDuckGo 免费 Instant Answer API
        try {
          const res = await fetch(`https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`, {
            signal: AbortSignal.timeout(5000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const abstract = (data as any).AbstractText ?? '';
          const topics = ((data as any).RelatedTopics ?? []).slice(0, 3).map((t: any) => t.Text ?? '').filter(Boolean);
          const heading = (data as any).Heading ?? '';
          let text = heading ? `${heading}\n` : '';
          if (abstract) text += `${abstract}\n`;
          if (topics.length) text += `\n相关内容：\n${topics.map((t: string) => `- ${t}`).join('\n')}`;
          if (!text.trim()) text = `搜索「${args.query}」未找到直接结果。建议换关键词。`;
          return { toolCallId: id, name, success: true, output: text.trim() };
        } catch {
          // DuckDuckGo 挂了，返回可用提示
          return {
            toolCallId: id, name, success: false,
            output: `搜索 API 暂时不可用。建议基于自身知识回答，关键词：「${args.query}」`,
          };
        }
      }

      case 'search_skills': {
        const query = (args.query ?? '').trim();
        if (!query) return { toolCallId: id, name, success: false, output: '技能检索关键词不能为空' };
        const { listSkills, matchSkills } = await import('../data/skills');
        const [all, matched] = await Promise.all([listSkills(), matchSkills(query, 8)]);
        const rows = matched.map((ref) => {
          const skill = all.find((item) => item.id === ref.id);
          return `- ID: ${ref.id}\n  名称: ${ref.name}\n  说明: ${skill?.description || '无说明'}\n  来源: ${skill?.source || '未知'}`;
        });
        return { toolCallId: id, name, success: true, output: rows.length ? `为「${query}」找到 ${rows.length} 个技能：\n${rows.join('\n')}` : `没有找到与「${query}」直接匹配的技能，可继续使用通用工具完成。` };
      }

      case 'read_skill': {
        const skillId = (args.id ?? '').trim();
        if (!skillId) return { toolCallId: id, name, success: false, output: '技能 ID 不能为空' };
        const { readSkill } = await import('../data/skills');
        const skill = await readSkill(skillId);
        return { toolCallId: id, name, success: true, output: `已读取 Skill「${skill.name}」：\n${skill.content.slice(0, 12000)}` };
      }

      case 'run_command': {
        const cmd = (args.cmd ?? '').trim();
        if (!cmd) return { toolCallId: id, name, success: false, output: '命令不能为空' };

        // Electron 桌面版：通过 IPC 调用主进程 exec
        const api = (window as any).electronAPI;
        if (!api?.execCommand) {
          return {
            toolCallId: id, name, success: false,
            output: `⚠️ run_command 仅 Electron 桌面版可用。请在桌面应用中运行 npm start，或改用 write_file 产出文件。\n浏览器模式下无法执行命令。\n\n你想执行的命令：${cmd}`,
          };
        }

        try {
          const beforeFiles = await workspaceFileVersions(call.scope ?? 'global', api);
          const result = await api.execCommand(cmd, diskScope(call.scope));
          const { success, exitCode, stdout, stderr, signal: sig, cwd } = result as any;
          const syncedFiles = await syncWorkspaceFiles(call.scope ?? 'global', api, beforeFiles);

          const out = [
            `状态：${success ? '成功 ✅' : `失败 ❌（退出码 ${exitCode}）`}${sig ? ` (${sig})` : ''}`,
            `目录：${cwd}`,
            `STDOUT：\n${(stdout || '(无)').slice(0, 3000)}`,
            stderr ? `\nSTDERR：\n${stderr.slice(0, 1000)}` : '',
            syncedFiles > 0 ? `工作区文件已同步到产出物：${syncedFiles} 个` : '',
          ].filter(Boolean).join('\n\n');
          return { toolCallId: id, name, success, output: out };
        } catch (e: any) {
          return { toolCallId: id, name, success: false, output: `命令执行异常：${e?.message ?? '未知错误'}` };
        }
      }

      default:
        // 连接器工具（以 connector_ 开头）
        if (name.startsWith('connector_')) {
          try {
            const { executeConnectorTool } = await import('./connectorTools');
            const result = await executeConnectorTool(name, args as Record<string, string>);
            return { toolCallId: id, name, success: result.success, output: result.output.slice(0, 6000) };
          } catch (e: any) {
            return { toolCallId: id, name, success: false, output: `连接器工具执行错误：${e?.message ?? '未知'}` };
          }
        }
        return { toolCallId: id, name, success: false, output: `未知工具：${name}` };
    }
  } catch (e: any) {
    return { toolCallId: id, name, success: false, output: `工具执行错误：${e?.message ?? '未知'}` };
  }
}
