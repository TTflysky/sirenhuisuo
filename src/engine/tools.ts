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
      description: '读取 outputs/ 目录中已存在的文件内容。用于了解之前产出的上下文。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件名，如 "方案设计.md"' },
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
      name: 'run_command',
      description: `执行终端命令（仅 Electron 桌面版可用）。命令在项目根目录执行，最长 30 秒超时，输出上限 100KB。
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
  // 去掉路径中危险字符，限制在当前 outputs/ 概念目录
  return p.replace(/[/\\]+/g, '-').replace(/\.\./g, '');
}

// ===== 工具执行 =====
export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const { name, args, id } = call;
  try {
    switch (name) {
      case 'write_file': {
        const path = safePath(args.path ?? 'untitled.txt');
        const content = args.content ?? '';
        const ct = contentTypeFromFilename(path);
        addOutput({
          id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          ts: Date.now(),
          filename: path,
          kind: 'tool-output',
          title: `工具产出：${path}`,
          scope: call.scope ?? 'global',
          contentType: ct,
          language: ct === 'code' ? path.split('.').pop() : undefined,
          content,
        } as any);
        return {
          toolCallId: id, name, success: true,
          output: `文件已输出到 outputs/${path}（${content.split('\n').length} 行，${content.length} 字符）`,
        };
      }

      case 'read_file': {
        const path = safePath(args.path ?? '');
        const outputs = loadOutputs();
        const found = outputs.find((o: OutputRecord) => o.filename === path);
        if (!found) {
          // 尝试模糊匹配
          const fuzzy = outputs.filter((o: OutputRecord) => o.filename.includes(path));
          if (fuzzy.length === 0) {
            return { toolCallId: id, name, success: false, output: `未找到文件：${path}。可用 list_files 查看 outputs/ 目录。` };
          }
          return {
            toolCallId: id, name, success: true,
            output: `找到 ${fuzzy.length} 个匹配文件：${fuzzy.map((f: OutputRecord) => f.filename).join('、')}\n\n最新文件内容：${fuzzy[fuzzy.length - 1].content.slice(0, 3000)}`,
          };
        }
        return {
          toolCallId: id, name, success: true,
          output: `文件 ${path} 内容：\n${found.content.slice(0, 3000)}`,
        };
      }

      case 'list_files': {
        const filter = (args.filter ?? '').toLowerCase();
        const outputs = loadOutputs();
        let files = outputs as OutputRecord[];
        if (filter) files = files.filter((o: OutputRecord) => o.filename.toLowerCase().includes(filter));
        if (files.length === 0) return { toolCallId: id, name, success: true, output: 'outputs/ 目录为空。可在讨论中使用 write_file 工具产出文件。' };
        const lines = files.map((o: OutputRecord) =>
          `- ${o.filename} (${new Date(o.ts).toLocaleString('zh-CN')} · ${(o.content.length / 1000).toFixed(1)}KB · ${o.kind})`
        );
        return { toolCallId: id, name, success: true, output: `outputs/ 目录（${files.length} 个文件）：\n${lines.join('\n')}` };
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
          const result = await api.execCommand(cmd);
          const { success, exitCode, stdout, stderr, signal: sig, cwd } = result as any;
          // 自动保存输出到 outputs/
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const safeName = `cmd-${cmd.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30)}-${ts}.txt`;
          addOutput({
            id: `cmd-${Date.now()}`,
            ts: Date.now(),
            filename: safeName,
            kind: 'tool-output',
            title: `命令输出：${cmd.slice(0, 60)}`,
            scope: call.scope ?? 'global',
            contentType: 'text',
            content: `命令：${cmd}\n目录：${cwd}\n状态：${success ? '成功' : '失败'}（退出码 ${exitCode}）${sig ? ` (${sig})` : ''}\n\n--- STDOUT ---\n${stdout || '(无)'}\n\n--- STDERR ---\n${stderr || '(无)'}`,
          } as any);

          const out = [
            `状态：${success ? '成功 ✅' : `失败 ❌（退出码 ${exitCode}）`}${sig ? ` (${sig})` : ''}`,
            `目录：${cwd}`,
            `STDOUT：\n${(stdout || '(无)').slice(0, 3000)}`,
            stderr ? `\nSTDERR：\n${stderr.slice(0, 1000)}` : '',
            `输出已保存到 outputs/${safeName}`,
          ].filter(Boolean).join('\n\n');
          return { toolCallId: id, name, success, output: out };
        } catch (e: any) {
          return { toolCallId: id, name, success: false, output: `命令执行异常：${e?.message ?? '未知错误'}` };
        }
      }

      default:
        return { toolCallId: id, name, success: false, output: `未知工具：${name}` };
    }
  } catch (e: any) {
    return { toolCallId: id, name, success: false, output: `工具执行错误：${e?.message ?? '未知'}` };
  }
}
