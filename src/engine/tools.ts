/**
 * 本地工具注册表（自建，OpenAI function-calling 兼容）
 * 
 * 工具列表：
 * - write_file   : 输出文件到 outputs/（自动落 localStorage + 可下载）
 * - read_file    : 读取已产出文件或上传的内容
 * - list_files   : 浏览 outputs/ 目录
 * - web_search   : 搜互联网（DuckDuckGo 免费 API）
 * - read_web_page: 直接读取用户或搜索结果中的说明页
 * - install_skill: 安装 Markdown、GitHub 目录或 ZIP 技能包
 * - inspect_connectors / prepare_connector / test_connector: 管理外部服务连接
 * - run_command  : 按当前审批策略执行，默认限沙箱工作区
 */

import { addOutput, loadOutputs, contentTypeFromFilename, type OutputRecord, type OutputScope } from '../data/outputs';
import { getExecutionPolicy, type ExecutionPolicy } from '../data/hermesClient';

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
      description: '输出一个真实文件并登记到交付物。category 必须按用途选择：final=用户可直接验收的最终成品，working=草稿/方案/测试/中间文件，reference=输入样本/原始材料/参考资料。不要把聊天回复或工具日志写成文件。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件名，如 "方案设计.md" 或 "index.html"' },
          content: { type: 'string', description: '文件内容' },
          category: { type: 'string', enum: ['final', 'working', 'reference'], description: '交付分类：final、working 或 reference' },
        },
        required: ['path', 'content', 'category'],
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
      name: 'read_web_page',
      description: '直接读取指定网页、官方文档或公开说明页的正文。安装第三方能力前，应先读取用户提供或搜索结果中的官方说明，确认实际接入方式、下载地址、配置字段和验收方法。',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: '完整 HTTP/HTTPS 页面地址' } },
        required: ['url'],
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
      name: 'install_skill',
      description: '从官方 HTTPS 地址安装 Skill。支持 SKILL.md、GitHub 仓库/目录和包含 SKILL.md 的 ZIP 技能包；安装后必须再读取 Skill 说明并按其中要求配置、执行和验证。',
      parameters: {
        type: 'object',
        properties: {
          sourceUrl: { type: 'string', description: '从官方说明中确认的 SKILL.md、GitHub 或 ZIP 下载地址' },
          name: { type: 'string', description: '可选，技能显示名称' },
          connector: { type: 'string', description: '可选，要关联的连接器 ID 或名称' },
        },
        required: ['sourceUrl'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_connectors',
      description: '检查客户端中所有连接器及可用预设，返回已连接、未配置、缺少地址/目录/凭据等真实状态。处理连接器、MCP、知识库、邮箱、GitHub 或外部服务任务时必须先调用。不会返回密钥内容。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '可选，服务名称或类型，如 ima、Obsidian、GitHub、MCP、知识库' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'prepare_connector',
      description: '为任意连接器预设创建或复用配置草稿，并打开正确的配置窗口。只负责准备配置，绝不生成密钥，也不代表已经连接；用户保存配置后必须调用 test_connector 验证。',
      parameters: {
        type: 'object',
        properties: {
          preset: { type: 'string', description: '预设标识或服务名，必须来自 inspect_connectors 的结果' },
          label: { type: 'string', description: '可选，自定义显示名称' },
          baseUrl: { type: 'string', description: '可选，用户已经明确提供的服务地址；不得猜测' },
          localPath: { type: 'string', description: '可选，用户已经明确提供的本地目录；不得猜测' },
          documentationUrl: { type: 'string', description: '可选，已经读取确认的官方说明页地址' },
          skillSourceUrl: { type: 'string', description: '可选，官方说明中给出的 Skill 下载地址' },
          installedSkillId: { type: 'string', description: '可选，install_skill 返回并已实际安装的 Skill ID' },
        },
        required: ['preset'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'test_connector',
      description: '对已保存的连接器做真实连接测试并更新状态。只有返回连接成功，才可以向用户确认该连接器可用。',
      parameters: {
        type: 'object',
        properties: {
          connector: { type: 'string', description: '连接器 ID、名称、预设标识或服务名' },
        },
        required: ['connector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: `执行 Windows PowerShell 命令（仅 Electron 桌面版可用）。命令由 PowerShell 运行，不是 cmd 或 bash；最长 30 秒超时，输出上限 100KB。不要使用 bash heredoc（例如 python - <<'PY'）；多行脚本先用 write_file 保存，再运行脚本文件，短脚本使用 python -c。
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
          connector: { type: 'string', description: '可选，按官方 Skill 说明执行时关联的连接器 ID/名称；所需凭据只作为环境变量注入，不会返回给模型' },
          verification: { type: 'boolean', description: '仅当该命令是官方说明规定的真实连通测试时设为 true；成功后更新连接器状态' },
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
  /** 磁盘上的任务工作区；未提供时兼容旧版聊天作用域目录。 */
  workspaceId?: string;
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

function workspacePath(scope?: OutputScope, workspaceId?: string): string {
  const candidate = workspaceId?.trim();
  if (!candidate) return diskScope(scope);
  return candidate.split(/[\\/]+/)
    .map((part) => part.replace(/[^a-zA-Z0-9_-]/g, '_'))
    .filter(Boolean)
    .join('/') || diskScope(scope);
}

function isRoutineCommand(command: string): boolean {
  const cmd = command.trim().toLowerCase();
  // A delegated command must be one plainly safe command. Shell operators,
  // interpolation, and redirection can hide a second action, so they always
  // require an explicit approval even if the first word looks harmless.
  if (/[;|&`<>]/.test(cmd) || /\$[({]/.test(cmd)) return false;
  return /^(?:dir|ls|get-childitem|test-path)(?:\s+[-\w.*?\\/.:'"]+)*$/i.test(cmd)
    || /^git\s+(?:status|log|diff|branch)(?:\s+[-\w.*?\\/.:'"]+)*$/i.test(cmd)
    || /^npm\s+(?:run\s+(?:build|lint|test|check|typecheck)|test|--version)(?:\s+[-\w.*?\\/.:'"]+)*$/i.test(cmd)
    || /^(?:node|npm|python|py)\s+--version$/i.test(cmd);
}

function commandRiskSummary(command: string): string {
  if (/\b(?:npm|pnpm|yarn)\s+(?:install|add|update|remove|uninstall|publish)\b/i.test(command)) return '会下载、安装、更新或发布软件包';
  if (/\b(?:git\s+(?:push|pull|clone|commit|reset|clean)|gh\s+|curl\b|wget\b|invoke-webrequest\b)/i.test(command)) return '会联网或修改远程仓库';
  if (/\b(?:remove-item|del\b|erase\b|rmdir\b|format\b|start-process\b|start\b|winget\b|choco\b|scoop\b)/i.test(command)) return '可能删除文件、启动程序或修改本机环境';
  return '会执行未归类的系统命令';
}

function approvalPrompt(title: string, detail: string, policy: ExecutionPolicy): boolean {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
  const sandbox = policy.sandboxEnabled ? '本次命令仅可在客户端工作区内运行。' : '命令沙盒已关闭，可能访问本机其他路径。';
  return window.confirm(`${title}\n\n${detail}\n\n${sandbox}\n\n选择“确定”允许本次操作；选择“取消”则不会执行。`);
}

function requestCommandApproval(command: string): { allowed: boolean; policy: ExecutionPolicy } {
  const policy = getExecutionPolicy();
  if (policy.approvalMode === 'full') return { allowed: true, policy };
  if (policy.approvalMode === 'delegate' && isRoutineCommand(command)) return { allowed: true, policy };
  const detail = policy.approvalMode === 'ask'
    ? `助手准备执行命令：\n${command}`
    : `助手已替你检查，这一步${commandRiskSummary(command)}：\n${command}`;
  return { allowed: approvalPrompt('需要你的审核', detail, policy), policy };
}

function requestConnectorApproval(name: string, args: Record<string, string>): boolean {
  const policy = getExecutionPolicy();
  if (policy.approvalMode === 'full') return true;
  const summary = Object.entries(args).slice(0, 3).map(([key, value]) => `${key}: ${String(value).slice(0, 160)}`).join('\n');
  const detail = policy.approvalMode === 'ask'
    ? `助手准备调用连接器：${name}${summary ? `\n${summary}` : ''}`
    : `助手已替你检查，但该连接器操作可能影响外部服务：${name}${summary ? `\n${summary}` : ''}`;
  return approvalPrompt('需要你的审核', detail, policy);
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

async function workspaceFileVersions(scope: OutputScope, fsApi: any, workspaceId?: string): Promise<Map<string, WorkspaceFileVersion>> {
  const versions = new Map<string, WorkspaceFileVersion>();
  if (!fsApi?.fsList) return versions;
  const listed = await fsApi.fsList(workspacePath(scope, workspaceId), true);
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

async function syncWorkspaceFiles(scope: OutputScope, fsApi: any, before = new Map<string, WorkspaceFileVersion>(), workspaceId?: string): Promise<number> {
  if (!fsApi?.fsList) return 0;
  const physicalWorkspace = workspacePath(scope, workspaceId);
  const listed = await fsApi.fsList(physicalWorkspace, true);
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
      const read = await fsApi.fsRead(`${physicalWorkspace}/${filename}`);
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
      workspaceId: physicalWorkspace,
    });
    synced += 1;
  }
  return synced;
}

export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const { name, args, id } = call;
  const physicalWorkspace = workspacePath(call.scope, call.workspaceId);
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
        let diskBytes: number | undefined;
        if (fsApi?.fsWrite) {
          try {
            const isWordDocument = path.toLowerCase().endsWith('.docx');
            if (isWordDocument && !fsApi.fsWriteDocument) {
              return { toolCallId: id, name, success: false, output: '当前环境不能生成有效的 Word 文件，未写入伪造的 .docx。请改用桌面客户端后重试。' };
            }
            const r = isWordDocument
              ? await fsApi.fsWriteDocument(`${physicalWorkspace}/${path}`, content)
              : await fsApi.fsWrite(`${physicalWorkspace}/${path}`, content);
            if (r?.ok) {
              diskPath = r.path;
              diskBytes = Number(r.size) || undefined;
              diskInfo = isWordDocument
                ? `（已生成并重新读取校验有效的 Word 文档：${r.path}，${r.size} 字节）`
                : `（已写入磁盘工作区：${r.path}，${r.size} 字节）`;
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
          workspaceId: physicalWorkspace,
          contentType: ct,
          language: ct === 'code' ? path.split('.').pop() : undefined,
          content,
          diskPath,
          bytes: diskBytes,
          category: args.category as 'final' | 'working' | 'reference' | undefined,
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
            const r = await fsApi.fsRead(`${physicalWorkspace}/${path}`);
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
        const scopedOutputs = call.scope ? outputs.filter((output: OutputRecord) => output.scope === call.scope && (!call.workspaceId || output.workspaceId === physicalWorkspace)) : outputs;
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
            const r = await fsApi.fsList(physicalWorkspace, true);
            if (r?.ok && r.items?.length) {
              lines = r.items
                .filter((it: any) => !filter || it.name.toLowerCase().includes(filter))
                .map((it: any) => `- ${it.name}${it.type === 'dir' ? '/' : ''} (${it.type === 'dir' ? '目录' : `${(it.size / 1000).toFixed(1)}KB`})`);
            }
          } catch {}
        }
        // 应用内产出物补充
        const outputs = (loadOutputs() as OutputRecord[]).filter((output) => !call.scope || (output.scope === call.scope && (!call.workspaceId || output.workspaceId === physicalWorkspace)));
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
        const api = getFsApi();
        if (api?.knowledgeSearchWeb) {
          const searched = await api.knowledgeSearchWeb(args.query ?? '');
          if (searched?.ok) {
            const rows = (searched.results ?? []).map((item: any, index: number) => `${index + 1}. ${item.title}\n${item.url}\n${item.snippet ?? ''}`);
            return { toolCallId: id, name, success: rows.length > 0, output: rows.length ? `搜索结果：\n\n${rows.join('\n\n')}` : '没有找到可用搜索结果，请核对关键词或使用用户提供的官方地址。' };
          }
        }
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

      case 'read_web_page': {
        const rawUrl = (args.url ?? '').trim();
        let parsed: URL;
        try { parsed = new URL(rawUrl); } catch { return { toolCallId: id, name, success: false, output: '网页地址无效。' }; }
        if (!['https:', 'http:'].includes(parsed.protocol)) return { toolCallId: id, name, success: false, output: '只支持读取 HTTP/HTTPS 网页。' };
        const api = getFsApi();
        if (api?.knowledgeFetchUrl) {
          const result = await api.knowledgeFetchUrl(parsed.toString());
          if (!result?.ok) return { toolCallId: id, name, success: false, output: `说明页读取失败：${result?.error ?? '页面没有正常回应'}` };
          return { toolCallId: id, name, success: true, output: `页面：${result.title ?? parsed.hostname}\n地址：${result.url ?? parsed.toString()}\n\n${String(result.content ?? '').slice(0, 50000)}` };
        }
        try {
          const response = await fetch(parsed.toString(), { signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return { toolCallId: id, name, success: true, output: (await response.text()).slice(0, 50000) };
        } catch (error: any) {
          return { toolCallId: id, name, success: false, output: `说明页读取失败：${error?.message ?? '网络错误'}` };
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

      case 'install_skill': {
        const sourceUrl = (args.sourceUrl ?? '').trim();
        let parsed: URL;
        try { parsed = new URL(sourceUrl); } catch { return { toolCallId: id, name, success: false, output: 'Skill 下载地址无效。' }; }
        if (parsed.protocol !== 'https:') return { toolCallId: id, name, success: false, output: 'Skill 必须从 HTTPS 地址安装。' };
        const policy = getExecutionPolicy();
        if (policy.approvalMode !== 'full' && !approvalPrompt('需要你的审核', `助手准备从以下地址下载并安装 Skill：\n${parsed.toString()}\n\n安装后仍会读取说明并做真实验证。`, policy)) {
          return { toolCallId: id, name, success: false, output: 'Skill 安装没有获得批准，因此没有下载或写入任何文件。' };
        }
        const api = getFsApi();
        if (!api?.skillsInstall) return { toolCallId: id, name, success: false, output: '当前环境不支持安装 Skill，请使用桌面客户端。' };
        const result = await api.skillsInstall({ sourceUrl: parsed.toString(), name: args.name?.trim() || undefined });
        if (!result?.ok || !result.skill) return { toolCallId: id, name, success: false, output: `Skill 安装失败：${result?.error ?? '安装器没有返回有效结果'}` };
        if (args.connector?.trim()) {
          const { loadConnectors, updateConnector } = await import('../data/connectors');
          const query = args.connector.trim().toLocaleLowerCase();
          const connector = loadConnectors().find((item) => item.id.toLocaleLowerCase() === query || item.label.toLocaleLowerCase() === query || item.mcpServerName?.toLocaleLowerCase() === query);
          if (connector) {
            updateConnector(connector.id, { installedSkillId: result.skill.id, skillSourceUrl: parsed.toString(), status: 'unknown', error: undefined });
            const { BUS_CHANNELS, sendBus } = await import('../ipcBus');
            sendBus(BUS_CHANNELS.CONNECTORS_CHANGED, { connectorId: connector.id, reason: 'skill-installed' });
          }
        }
        return { toolCallId: id, name, success: true, output: `Skill 已安装到本机技能库。\nID: ${result.skill.id}\n名称: ${result.skill.name}\n来源: ${result.resolvedUrl ?? parsed.toString()}\n健康状态: ${result.skill.health ?? '尚未检查'}\n\n下一步必须调用 read_skill 读取这个 ID，按真实说明配置依赖和凭据，并执行其中的验证步骤；仅安装文件不代表外部服务已经可用。` };
      }

      case 'inspect_connectors': {
        const { CONNECTOR_PRESETS, connectorMissingFields, loadConnectors } = await import('../data/connectors');
        const query = (args.query ?? '').trim().toLocaleLowerCase();
        const includesQuery = (...values: Array<string | undefined>) => !query || values.some((value) => value?.toLocaleLowerCase().includes(query));
        const configured = loadConnectors().filter((connector) => includesQuery(connector.id, connector.label, connector.mcpServerName, connector.kind));
        const presets = CONNECTOR_PRESETS.filter((preset) => includesQuery(preset.key, preset.label, preset.mcpServerName, preset.kind));
        const configuredRows = configured.map((connector) => {
          const missing = connectorMissingFields(connector);
          const checked = connector.lastChecked ? new Date(connector.lastChecked).toLocaleString('zh-CN') : '尚未测试';
          const namedCredentialFields = connector.credentialFields ?? [];
          const namedCredentialCount = namedCredentialFields.filter((field) => Boolean(connector.credentials?.[field.key])).length;
          const credentialState = namedCredentialFields.length > 0
            ? `${namedCredentialCount}/${namedCredentialFields.length} 项已填写`
            : connector.auth?.token ? '已填写' : connector.auth?.type && connector.auth.type !== 'none' ? '未填写' : '不需要';
          return [
            `- ${connector.label}（ID: ${connector.id}）`,
            `  状态: ${connector.status === 'connected' ? '已连接' : connector.status === 'disconnected' ? '连接失败' : '尚未确认'}；${connector.enabled ? '已启用' : '未启用'}`,
            `  配置: 地址${connector.baseUrl ? '已填写' : '未填写'}；本地目录${connector.localPath ? '已选择' : '未选择'}；凭据${credentialState}`,
            `  检查: ${checked}${connector.error ? `；上次原因: ${connector.error}` : ''}`,
            missing.length ? `  还缺: ${missing.join('、')}` : '  还缺: 无（仍需真实测试）',
          ].join('\n');
        });
        const presetRows = presets.map((preset) => `- ${preset.label}（预设: ${preset.key}；接入方式: ${preset.kind === 'skill-bridge' ? 'Skill' : preset.type === 'mcp' ? 'MCP' : 'HTTP/本地'}）: ${preset.desc}`);
        return {
          toolCallId: id,
          name,
          success: true,
          output: `连接器检查完成。检查成功不代表服务已经连通。\n\n已配置：\n${configuredRows.join('\n') || '- 没有匹配的已配置连接器'}\n\n可用预设：\n${presetRows.join('\n') || '- 没有匹配的预设'}\n\n下一步规则：未配置时调用 prepare_connector 打开配置；保存后调用 test_connector；测试通过前禁止宣布完成。`,
        };
      }

      case 'prepare_connector': {
        const presetQuery = (args.preset ?? '').trim();
        const {
          CONNECTOR_PRESETS,
          createConnectorDraft,
          findConnectorPreset,
          loadConnectors,
          upsertConnector,
        } = await import('../data/connectors');
        const preset = findConnectorPreset(presetQuery);
        if (!preset) {
          return {
            toolCallId: id,
            name,
            success: false,
            output: `没有找到连接器预设“${presetQuery}”。可用预设：${CONNECTOR_PRESETS.map((item) => `${item.label}(${item.key})`).join('、')}。请先调用 inspect_connectors 核对名称。`,
          };
        }
        const existing = loadConnectors().find((connector) =>
          connector.mcpServerName === preset.mcpServerName
          || connector.id === presetQuery
          || connector.label.toLocaleLowerCase() === preset.label.toLocaleLowerCase()
        );
        const draft = createConnectorDraft(preset, existing);
        if (args.label?.trim()) draft.label = args.label.trim();
        if (args.baseUrl?.trim()) draft.baseUrl = args.baseUrl.trim();
        if (args.localPath?.trim()) draft.localPath = args.localPath.trim();
        if (args.documentationUrl?.trim()) draft.documentationUrl = args.documentationUrl.trim();
        if (args.skillSourceUrl?.trim()) draft.skillSourceUrl = args.skillSourceUrl.trim();
        if (args.installedSkillId?.trim()) draft.installedSkillId = args.installedSkillId.trim();
        if (args.baseUrl?.trim() || args.localPath?.trim() || args.skillSourceUrl?.trim() || args.installedSkillId?.trim()) {
          draft.status = 'unknown';
          draft.error = undefined;
          draft.lastChecked = undefined;
        }
        upsertConnector(draft);
        const { BUS_CHANNELS, sendBus } = await import('../ipcBus');
        sendBus(BUS_CHANNELS.CONNECTORS_CHANGED, { connectorId: draft.id, reason: 'prepared' });
        const api = getFsApi();
        if (!api?.openTool) {
          return { toolCallId: id, name, success: false, output: `已创建“${draft.label}”配置草稿，但当前环境无法打开配置窗口。请在桌面客户端的“知识库/连接器”区域点击该连接器的设置按钮。配置尚未完成。` };
        }
        const opened = await api.openTool({ type: 'connector-config', refId: draft.id, payload: draft });
        if (!opened?.ok) {
          return { toolCallId: id, name, success: false, output: `已保留“${draft.label}”配置草稿，但配置窗口没有打开：${opened?.error ?? '未知原因'}。请在连接器列表中手动点击设置。配置尚未完成。` };
        }
        const nextStep = draft.kind === 'skill-bridge'
          ? `已为“${draft.label}”打开文档驱动配置窗口。先确认并填写官方说明页与 Skill 下载地址，安装后读取 Skill 说明，再填写其中要求的命名凭据。当前仍未通过真实调用，不得宣布完成。`
          : `已为“${draft.label}”打开配置窗口。现在只是准备好了配置入口，并未连接成功。请用户填写服务要求的地址、目录或认证凭据并点击“一键配置”；保存后必须调用 test_connector 做真实测试。不得索要或编造密码、API Key、验证码。`;
        return {
          toolCallId: id,
          name,
          success: true,
          output: nextStep,
        };
      }

      case 'test_connector': {
        const query = (args.connector ?? '').trim();
        if (!query) return { toolCallId: id, name, success: false, output: '连接器名称或 ID 不能为空。请先调用 inspect_connectors。' };
        const { checkConnector, connectorMissingFields, findConnectorPreset, loadConnectors, updateConnector } = await import('../data/connectors');
        const normalized = query.toLocaleLowerCase();
        const preset = findConnectorPreset(query);
        const connector = loadConnectors().find((item) =>
          item.id.toLocaleLowerCase() === normalized
          || item.label.toLocaleLowerCase() === normalized
          || item.mcpServerName?.toLocaleLowerCase() === normalized
          || (preset?.mcpServerName && item.mcpServerName === preset.mcpServerName)
        );
        if (!connector) {
          return { toolCallId: id, name, success: false, output: `没有找到已配置的“${query}”连接器。请先调用 inspect_connectors，再用 prepare_connector 创建并打开配置。` };
        }
        const missing = connectorMissingFields(connector);
        if (missing.length > 0) {
          return { toolCallId: id, name, success: false, output: `“${connector.label}”还不能测试，因为缺少：${missing.join('、')}。请调用 prepare_connector 打开配置窗口，让用户填写后再测试。` };
        }
        if (!requestConnectorApproval(`test_connector:${connector.label}`, {})) {
          return { toolCallId: id, name, success: false, output: `没有获得连接测试批准，因此尚未访问“${connector.label}”。用户批准后再测试；目前不能确认连接成功。` };
        }
        const result = await checkConnector(connector);
        updateConnector(connector.id, {
          status: result.status,
          error: result.error,
          lastChecked: Date.now(),
          discoveredActions: result.actions,
          runtimeStatus: result.runtimeStatus,
        });
        const { BUS_CHANNELS, sendBus } = await import('../ipcBus');
        sendBus(BUS_CHANNELS.CONNECTORS_CHANGED, { connectorId: connector.id, reason: 'tested', status: result.status });
        if (result.status !== 'connected') {
          if (connector.kind === 'skill-bridge' && result.status === 'unknown') {
            return { toolCallId: id, name, success: false, output: `“${connector.label}”的 Skill 和凭据已经准备好，但还没有做真实外部调用。请读取已安装 Skill 的说明，找到官方规定的健康检查或最小查询命令，然后调用 run_command，并传 connector="${connector.id}"、verification=true。只有该命令真实成功后才算已连接。` };
          }
          return { toolCallId: id, name, success: false, output: `“${connector.label}”真实连接测试没有通过：${result.error ?? '服务没有正常回应'}。配置已保留，但不能宣布完成。请根据这个原因修正配置后再测试。` };
        }
        return { toolCallId: id, name, success: true, output: `“${connector.label}”已通过真实连接测试，现在可以确认连接器可用。${result.actions?.length ? `已发现 ${result.actions.length} 个可调用操作。` : ''}` };
      }

      case 'run_command': {
        const cmd = (args.cmd ?? '').trim();
        if (!cmd) return { toolCallId: id, name, success: false, output: '命令不能为空' };

        let connectorForCommand: import('../data/connectors').Connector | undefined;
        const injectedEnv: Record<string, string> = {};
        if (args.connector?.trim()) {
          const { connectorMissingFields, loadConnectors } = await import('../data/connectors');
          const query = args.connector.trim().toLocaleLowerCase();
          connectorForCommand = loadConnectors().find((item) => item.id.toLocaleLowerCase() === query || item.label.toLocaleLowerCase() === query || item.mcpServerName?.toLocaleLowerCase() === query);
          if (!connectorForCommand) return { toolCallId: id, name, success: false, output: `没有找到要关联的连接器“${args.connector}”。请先调用 inspect_connectors。` };
          const missing = connectorMissingFields(connectorForCommand);
          if (missing.length > 0) return { toolCallId: id, name, success: false, output: `“${connectorForCommand.label}”还缺少：${missing.join('、')}。请先完成配置，密钥不会交给模型查看。` };
          for (const field of connectorForCommand.credentialFields ?? []) {
            const value = connectorForCommand.credentials?.[field.key];
            if (field.envName && value) injectedEnv[field.envName] = value;
          }
        }

        const approval = requestCommandApproval(cmd);
        if (!approval.allowed) {
          return {
            toolCallId: id,
            name,
            success: false,
            output: '本次命令没有获得批准，因此没有执行任何操作。请在聊天窗口点击“请求审核”确认，或在确认风险后切换审批方式再重试。',
          };
        }

        // Electron 桌面版：通过 IPC 调用主进程 exec
        const api = (window as any).electronAPI;
        if (!api?.execCommand) {
          return {
            toolCallId: id, name, success: false,
            output: `⚠️ run_command 仅 Electron 桌面版可用。请在桌面应用中运行 npm start，或改用 write_file 产出文件。\n浏览器模式下无法执行命令。\n\n你想执行的命令：${cmd}`,
          };
        }

        try {
          const beforeFiles = await workspaceFileVersions(call.scope ?? 'global', api, physicalWorkspace);
          const result = await api.execCommand(cmd, physicalWorkspace, {
            sandboxEnabled: approval.policy.sandboxEnabled,
            env: injectedEnv,
            skillId: connectorForCommand?.kind === 'skill-bridge' ? connectorForCommand.installedSkillId : undefined,
          });
          const { success, exitCode, stdout, stderr, signal: sig, cwd } = result as any;
          if (connectorForCommand && String(args.verification).toLowerCase() === 'true') {
            const { updateConnector } = await import('../data/connectors');
            updateConnector(connectorForCommand.id, { status: success ? 'connected' : 'disconnected', error: success ? undefined : (stderr || stdout || '真实调用失败').slice(0, 500), lastChecked: Date.now() });
            const { BUS_CHANNELS, sendBus } = await import('../ipcBus');
            sendBus(BUS_CHANNELS.CONNECTORS_CHANGED, { connectorId: connectorForCommand.id, reason: 'skill-verified', status: success ? 'connected' : 'disconnected' });
          }
          const syncedFiles = await syncWorkspaceFiles(call.scope ?? 'global', api, beforeFiles, physicalWorkspace);

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
          if (!requestConnectorApproval(name, args)) {
            return {
              toolCallId: id,
              name,
              success: false,
              output: '本次连接器操作没有获得批准，因此没有访问外部服务。请在聊天窗口确认审核，或在确认风险后调整审批方式。',
            };
          }
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
