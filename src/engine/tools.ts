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
 * - submit_review: 提交结构化审查结论
 * - verify_web_artifact: 用 Electron 内核真实验收本地网页产物
 * - run_command  : 按当前审批策略执行，默认限沙箱工作区
 */

import { addOutput, loadOutputs, contentTypeFromFilename, type OutputRecord, type OutputScope } from '../data/outputs';
import { externalCapabilityProfileForConnector, recordExternalCapabilityProbe } from '../data/externalCapabilityMatrix';
import { getExecutionPolicy, type ExecutionPolicy } from '../data/hermesClient';
import { classifySensitiveAction, containsInlineSecret, redactToolArgsObject } from './securityBoundary';
import type { ConnectorProtocolResult } from './connectorProtocol.mjs';
import { createFileArtifactEvidence, createReviewSubmissionEvidence, createToolExecutionEvidence } from './executionEvidence.mjs';
import type { FileArtifactEvidence, ReviewSubmissionEvidence, ToolExecutionEvidence } from './executionEvidence.mjs';
import { buildToolRegistry, discoverTools, preflightToolCall } from './toolRegistry.mjs';
import { formatSkillHubResults, searchSkillHub } from './skillHubSearch.mjs';
import { parseSkillCliInstall, resolveSkillInstallInput } from './skillInstallRouting.mjs';
import * as connectorData from '../data/connectors';
import * as skillData from '../data/skills';
import * as connectorToolRuntime from './connectorTools';
import { BUS_CHANNELS, sendBus } from '../ipcBus';
export type { FileArtifactEvidence, ReviewSubmissionEvidence, ToolExecutionEvidence } from './executionEvidence.mjs';

// ===== Tool Schema（OpenAI function-calling 格式）=====
export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: { type: string; properties: Record<string, unknown>; required: string[] };
  };
}

const SEMANTIC_CHECKS_SCHEMA = {
  type: 'array',
  description: '可选的通用产品语义验收契约；用于检查分组、顺序、相邻位置、网格坐标和关键交互。建议使用稳定的 data-testid 选择器。',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' }, label: { type: 'string' },
      type: { type: 'string', enum: ['group', 'order', 'adjacent', 'grid', 'interaction', 'visible', 'count', 'canvas_nonblank'] },
      viewports: { type: 'array', items: { type: 'string' } },
      container: { type: 'string' }, members: { type: 'array', items: { type: 'string' } },
      selectors: { type: 'array', items: { type: 'string' } }, axis: { type: 'string', enum: ['dom', 'horizontal', 'vertical', 'reading'] },
      first: { type: 'string' }, second: { type: 'string' }, direction: { type: 'string', enum: ['left', 'right', 'above', 'below'] }, maxGap: { type: 'number' },
      selector: { type: 'string' }, minCount: { type: 'number' }, maxCount: { type: 'number' }, minPixels: { type: 'number' }, minCoverage: { type: 'number' },
      cells: { type: 'array', items: { type: 'object', properties: { selector: { type: 'string' }, row: { type: 'number' }, column: { type: 'number' } }, required: ['selector', 'row', 'column'] } },
      steps: { type: 'array', items: { type: 'object', properties: { action: { type: 'string', enum: ['click', 'input', 'select', 'check'] }, selector: { type: 'string' }, value: { type: 'string' }, waitMs: { type: 'number' } }, required: ['action', 'selector'] } },
      assertions: { type: 'array', items: { type: 'object', properties: { selector: { type: 'string' }, property: { type: 'string', enum: ['text', 'value', 'visible', 'hidden', 'checked', 'attribute'] }, equals: { type: 'string' }, includes: { type: 'string' }, attribute: { type: 'string' } }, required: ['selector', 'property'] } },
    },
    required: ['type'],
  },
} as const;

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
      name: 'search_tools',
      description: '按目标搜索太极统一工具注册中心。仅在不确定应使用哪个工具时调用，返回真实工具名、能力、风险和简短说明。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '需要完成的能力或动作' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'describe_tool',
      description: '读取统一工具注册中心中某个工具的完整参数 Schema、风险和审批信息。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'search_tools 返回的准确工具名' } },
        required: ['name'],
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
      description: '同时检索本机技能库和 SkillHub 官方市场，返回本机 ID 或市场 slug、详情页和真实下载地址。',
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
      description: '使用客户端原生安装器安装完整 Skill。可传 SkillHub slug、技能名、商城详情页、安装说明页、GitHub、SKILL.md 或 ZIP；安装器会自动回读验证，禁止改用 skillhub 命令。',
      parameters: {
        type: 'object',
        properties: {
          sourceUrl: { type: 'string', description: '可选：官方来源、SkillHub 详情页或下载地址' },
          slug: { type: 'string', description: '可选：search_skills 返回的 SkillHub 精确 slug' },
          name: { type: 'string', description: '可选：技能名；名称符合 slug 格式时可直接安装' },
          connector: { type: 'string', description: '可选，要关联的连接器 ID 或名称' },
        },
        required: [],
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
      name: 'submit_review',
      description: '审查者提交机器可读的验收结论。团队审查步骤必须调用本工具，不能只在聊天中口头说通过或退回。REJECT 时应填写责任步骤或责任员工，系统会据此生成修订与复审步骤。',
      parameters: {
        type: 'object',
        properties: {
          decision: { type: 'string', enum: ['PASS', 'REJECT'], description: 'PASS=验收通过，REJECT=退回修改' },
          reason: { type: 'string', description: '基于实际文件或运行结果得出的验收理由' },
          responsibleStepId: { type: 'string', description: '退回时应负责修订的原步骤 ID，可选' },
          responsibleEmployeeId: { type: 'string', description: '退回时应负责修订的员工 ID，可选' },
          checkedArtifacts: { type: 'array', items: { type: 'string' }, description: '实际检查过的文件路径' },
        },
        required: ['decision', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'verify_web_artifact',
      description: '使用太极内置 Electron 浏览器真实打开工作区 HTML，在桌面和窄屏视口截图，并按任务契约检查布局与产品语义。支持元素分组、顺序、相邻关系、网格坐标和关键交互；任何一项失败都必须修复后重新验收。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '工作区中的 HTML 相对路径' },
          viewports: { type: 'array', items: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' }, label: { type: 'string' } } }, description: '可选视口列表；默认桌面 1440x900 和窄屏 375x844' },
          semanticChecks: SEMANTIC_CHECKS_SCHEMA,
        },
        required: ['path'],
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
  /** Structured client evidence for connector calls. Never sourced from model text. */
  protocolEvidence?: ConnectorProtocolResult;
  /** Structured evidence emitted by the client after a real file or review operation. */
  structuredEvidence?: ToolExecutionEvidence;
}

// ===== Sandbox 检查 =====
function safePath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => part.replace(/[<>:"|?*\p{Cc}]/gu, '_'));
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
  const risks = classifySensitiveAction('run_command', { cmd: command });
  if (risks.length > 0) {
    return { allowed: approvalPrompt('必须由你确认', `这条命令涉及：${risks.join('、')}。\n\n${redactToolArgsObject({ cmd: command })}`, policy), policy };
  }
  if (policy.approvalMode === 'full') return { allowed: true, policy };
  if (policy.approvalMode === 'delegate' && isRoutineCommand(command)) return { allowed: true, policy };
  const detail = policy.approvalMode === 'ask'
    ? `助手准备执行命令：\n${command}`
    : `助手已替你检查，这一步${commandRiskSummary(command)}：\n${command}`;
  return { allowed: approvalPrompt('需要你的审核', detail, policy), policy };
}

function requestConnectorApproval(name: string, args: Record<string, string>): boolean {
  const policy = getExecutionPolicy();
  const risks = classifySensitiveAction(name, args);
  if (risks.length > 0) {
    return approvalPrompt('必须由你确认', `这个外部操作涉及：${risks.join('、')}。\n\n${redactToolArgsObject(args)}`, policy);
  }
  if (policy.connectorApprovalMode === 'full') return true;
  const summary = redactToolArgsObject(Object.fromEntries(Object.entries(args).slice(0, 3)));
  const detail = policy.connectorApprovalMode === 'ask'
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

function artifactEvidence(output: OutputRecord, verification: FileArtifactEvidence['verification'], verified: boolean): FileArtifactEvidence {
  return createFileArtifactEvidence({
    path: output.filename,
    filename: output.filename.split('/').pop() || output.filename,
    workspaceId: output.workspaceId ?? 'global',
    diskPath: output.diskPath,
    bytes: output.bytes,
    contentType: output.contentType,
    category: output.category ?? 'working',
    persistence: output.diskPath ? 'disk' : 'renderer',
    verification,
    verified,
    recordedAt: Date.now(),
  });
}

async function syncWorkspaceFiles(scope: OutputScope, fsApi: any, before = new Map<string, WorkspaceFileVersion>(), workspaceId?: string): Promise<FileArtifactEvidence[]> {
  if (!fsApi?.fsList) return [];
  const physicalWorkspace = workspacePath(scope, workspaceId);
  const listed = await fsApi.fsList(physicalWorkspace, true);
  if (!listed?.ok || !Array.isArray(listed.items)) return [];
  const artifacts: FileArtifactEvidence[] = [];
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
    const output = addOutput({
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
    artifacts.push(artifactEvidence(output, 'write_ack', Boolean(output.diskPath)));
  }
  return artifacts;
}

async function executeToolInternal(call: ToolCall): Promise<ToolResult> {
  const { name, args, id } = call;
  const physicalWorkspace = workspacePath(call.scope, call.workspaceId);
  try {
    const registryDefinitions = name.startsWith('connector_')
      ? [...TOOLS, ...connectorToolRuntime.getConnectorTools()]
      : TOOLS;
    const preflight = preflightToolCall(buildToolRegistry(registryDefinitions), name, args, { approvalGranted: true });
    if (!preflight.ok) {
      return { toolCallId: id, name, success: false, output: `工具预检未通过：${preflight.message}` };
    }
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
        let readBackVerified = false;
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
              if (isWordDocument) {
                readBackVerified = true;
              } else if (fsApi.fsRead) {
                const readBack = await fsApi.fsRead(`${physicalWorkspace}/${path}`);
                if (!readBack?.ok || String(readBack.content ?? '') !== content) {
                  return { toolCallId: id, name, success: false, output: `文件写入后重新读取不一致：${path}` };
                }
                readBackVerified = true;
              }
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
        const output = addOutput({
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
          structuredEvidence: createToolExecutionEvidence({
            artifacts: [artifactEvidence(output, readBackVerified ? 'read_back' : diskPath ? 'write_ack' : 'registered_only', readBackVerified || Boolean(diskPath))],
          }),
        };
      }

      case 'submit_review': {
        const decision = String(args.decision ?? '').trim().toUpperCase();
        const reason = String(args.reason ?? '').trim().slice(0, 1200);
        if (decision !== 'PASS' && decision !== 'REJECT') {
          return { toolCallId: id, name, success: false, output: '审查结论必须是 PASS 或 REJECT。' };
        }
        if (!reason) return { toolCallId: id, name, success: false, output: '审查结论必须包含具体理由。' };
        if (decision === 'PASS' && /(?:未|没有|无法|不能|尚未).{0,24}(?:执行|完成|取得|进行).{0,24}(?:验证|验收|测试|运行|打开|截图)|(?:缺少|没有).{0,20}(?:证据|验证结果)/iu.test(reason)) {
          return { toolCallId: id, name, success: false, output: '审查理由明确承认关键验证尚未完成，因此不能提交 PASS。请先取得真实证据；当前无法验证时应提交 REJECT 或说明阻塞。' };
        }
        const checkedArtifacts = Array.isArray(args.checkedArtifacts)
          ? args.checkedArtifacts.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
          : [];
        const review: ReviewSubmissionEvidence = createReviewSubmissionEvidence({
          decision: decision === 'PASS' ? 'pass' : 'reject',
          reason,
          responsibleStepId: String(args.responsibleStepId ?? '').trim() || undefined,
          responsibleEmployeeId: String(args.responsibleEmployeeId ?? '').trim() || undefined,
          checkedArtifacts,
          submittedAt: Date.now(),
        });
        return {
          toolCallId: id,
          name,
          success: true,
          output: decision === 'PASS' ? `结构化审查已提交：通过。${reason}` : `结构化审查已提交：退回修改。${reason}`,
          structuredEvidence: createToolExecutionEvidence({ review }),
        };
      }

      case 'verify_web_artifact': {
        const artifactPath = safePath(args.path ?? '');
        if (!artifactPath || !/\.html?$/iu.test(artifactPath)) {
          return { toolCallId: id, name, success: false, output: '请提供工作区中的 HTML 文件路径。' };
        }
        const api = getFsApi();
        if (!api?.verifyWebArtifact) {
          return { toolCallId: id, name, success: false, output: '当前环境没有太极内置网页验收运行时，不能把 Web UI 宣布为已通过。' };
        }
        const result = await api.verifyWebArtifact({
          workspaceId: physicalWorkspace,
          path: artifactPath,
          viewports: Array.isArray(args.viewports) ? args.viewports : undefined,
          semanticChecks: Array.isArray(args.semanticChecks) ? args.semanticChecks : undefined,
        });
        const screenshots = (result.viewports ?? []).map((item: any) => createFileArtifactEvidence({
          path: item.screenshot,
          filename: String(item.screenshot || '').split('/').pop() || 'web-artifact.png',
          workspaceId: physicalWorkspace,
          diskPath: item.screenshotPath,
          bytes: item.screenshotBytes,
          contentType: 'image',
          category: 'working',
          persistence: 'disk',
          verification: 'write_ack',
          verified: true,
          recordedAt: Date.now(),
        }));
        const summary = JSON.stringify(result, null, 2);
        return {
          toolCallId: id,
          name,
          success: result.ok === true,
          output: result.ok ? `网页真实验收通过。\n${summary}` : `网页真实验收未通过，必须根据以下证据修复后重新调用本工具。\n${summary}`,
          structuredEvidence: createToolExecutionEvidence({ artifacts: screenshots }),
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

      case 'search_tools': {
        const query = (args.query ?? '').trim();
        if (!query) return { toolCallId: id, name, success: false, output: '工具搜索目标不能为空。' };
        const registry = buildToolRegistry([...TOOLS, ...connectorToolRuntime.getConnectorTools()]);
        const found = discoverTools(registry, query).slice(0, 12);
        return {
          toolCallId: id,
          name,
          success: found.length > 0,
          output: found.length
            ? `统一工具注册中心找到 ${found.length} 个候选：\n${found.map((record) => `- ${record.name}｜能力=${record.capability}｜风险=${record.risk}｜${record.definition.function.description}`).join('\n')}\n\n需要参数细节时调用 describe_tool。`
            : `统一工具注册中心没有找到与“${query}”匹配的可用工具。请换一种能力描述，或基于现有工具重新规划。`,
        };
      }

      case 'describe_tool': {
        const toolName = (args.name ?? '').trim();
        const registry = buildToolRegistry([...TOOLS, ...connectorToolRuntime.getConnectorTools()]);
        const record = registry.records.find((item) => item.name === toolName);
        if (!record) return { toolCallId: id, name, success: false, output: `工具“${toolName}”未注册或当前不可用。` };
        return {
          toolCallId: id,
          name,
          success: true,
          output: JSON.stringify({
            name: record.name,
            description: record.definition.function.description,
            parameters: record.definition.function.parameters,
            capability: record.capability,
            source: record.source,
            risk: record.risk,
            approval: record.approval,
            health: record.health,
          }, null, 2),
        };
      }

      case 'web_search': {
        const q = encodeURIComponent(args.query ?? '');
        const api = getFsApi();
        const failures: string[] = [];
        if (api?.knowledgeSearchWeb) {
          try {
            const searched = await api.knowledgeSearchWeb(args.query ?? '');
            if (searched?.ok) {
              const rows = (searched.results ?? []).map((item: any, index: number) => `${index + 1}. ${item.title}\n${item.url}\n${item.snippet ?? ''}`);
              const source = searched.provider ? `（来源：${searched.provider}，${searched.durationMs ?? 0}ms）` : '';
              return { toolCallId: id, name, success: rows.length > 0, output: rows.length ? `搜索结果${source}：\n\n${rows.join('\n\n')}` : '搜索服务已响应，但没有解析到可用结果。请调整关键词后重试。' };
            }
            failures.push(`桌面搜索：${searched?.error ?? '搜索服务没有返回具体原因'}`);
          } catch (error: any) {
            failures.push(`桌面搜索：${error?.message ?? String(error)}`);
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
        } catch (error: any) {
          failures.push(`浏览器备用搜索：${error?.message ?? String(error)}`);
          return {
            toolCallId: id, name, success: false,
            output: `联网搜索已真实调用但未成功。${failures.join('；')}。关键词：「${args.query}」。请检查代理是否允许客户端访问 Bing 或 DuckDuckGo，详细记录可在主日志中查看。`,
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
        const [all, matched] = await Promise.all([skillData.listSkills(), skillData.matchSkills(query, 8)]);
        const inventorySummary = `本地技能库存：共 ${all.length} 个（内置 ${all.filter((skill) => skill.scope !== 'mine').length}，用户 ${all.filter((skill) => skill.scope === 'mine').length}）；本次匹配 ${matched.length} 个。`;
        const localRows = matched.map((ref) => {
          const skill = all.find((item) => item.id === ref.id);
          return `- ${ref.id} | ${ref.name} | ${skill?.description || '无说明'} | 来源: ${skill?.source || '未知'}`;
        });
        localRows.unshift(inventorySummary);
        const api = getFsApi();
        const market = api?.skillsSearchMarket
          ? await api.skillsSearchMarket(query)
          : await searchSkillHub(query);
        const explicitlyRequestedMarket = /skillhub|技能商城|第三方技能|外部技能/iu.test(query);
        if (!market.ok) {
          const output = `SkillHub 官方检索失败：${market.error}\n\n本机已安装匹配：\n${localRows.join('\n') || '- 没有'}`;
          return { toolCallId: id, name, success: !explicitlyRequestedMarket && localRows.length > 0, output };
        }
        if (market.results?.length) {
          return {
            toolCallId: id,
            name,
            success: true,
            output: `SkillHub 官方市场结果（查询：${market.query}）：\n${formatSkillHubResults(market)}\n\n以上是候选，只有 install_skill 自动回读验证通过后才算安装完成。\n\n本机已安装匹配：\n${localRows.join('\n') || '- 没有'}`,
          };
        }
        return {
          toolCallId: id,
          name,
          success: localRows.length > 0,
          output: localRows.length
            ? `SkillHub 没有直接匹配项。\n\n本机已安装匹配：\n${localRows.join('\n')}`
            : `SkillHub 和本机技能库都没有找到与“${market.query}”直接匹配的 Skill。`,
        };
      }

      case 'read_skill': {
        const skillId = (args.id ?? '').trim();
        if (!skillId) return { toolCallId: id, name, success: false, output: '技能 ID 不能为空' };
        const skill = await skillData.readSkill(skillId);
        const documents = skill.documents?.map((document) => document.path).join('、');
        return { toolCallId: id, name, success: true, output: `已读取 Skill「${skill.name}」${documents ? `及其引用规则（${documents}）` : ''}：\n${skillData.skillInstructionText(skill)}` };
      }

      case 'install_skill': {
        const resolved = resolveSkillInstallInput(args);
        if (resolved.error || !resolved.sourceUrl) return { toolCallId: id, name, success: false, output: resolved.error || 'Skill 来源无效。' };
        const policy = getExecutionPolicy();
        if (policy.approvalMode !== 'full' && !approvalPrompt('需要你的审核', `助手准备从以下地址下载并安装 Skill：\n${resolved.sourceUrl}\n\n安装器会在写入后自动回读并检查完整性。`, policy)) {
          return { toolCallId: id, name, success: false, output: 'Skill 安装没有获得批准，因此没有下载或写入任何文件。' };
        }
        const api = getFsApi();
        if (!api?.skillsInstall) return { toolCallId: id, name, success: false, output: '当前环境不支持安装 Skill，请使用桌面客户端。' };
        const result = await api.skillsInstall(resolved);
        const installedSkills = Array.isArray((result as any)?.skills) && (result as any).skills.length
          ? (result as any).skills
          : (result?.skill ? [result.skill] : []);
        const installedSummary = installedSkills.length > 1
          ? `已安装 ${installedSkills.length} 个 Skill：${installedSkills.slice(0, 12).map((skill: any) => skill.name || skill.id).filter(Boolean).join('、')}${installedSkills.length > 12 ? ' 等' : ''}\n`
          : '';
        if (result?.ok && installedSkills.length) {
          installedSkills.forEach((skill: any) => sendBus(BUS_CHANNELS.SKILLS_CHANGED, { action: 'installed', skillId: skill.id }));
        }
        if (!result?.ok || !result.skill) return { toolCallId: id, name, success: false, output: `Skill 安装失败：${result?.error ?? '安装器没有返回有效结果'}` };
        if (args.connector?.trim()) {
          const query = args.connector.trim().toLocaleLowerCase();
          const connector = connectorData.loadConnectors().find((item) => item.id.toLocaleLowerCase() === query || item.label.toLocaleLowerCase() === query || item.mcpServerName?.toLocaleLowerCase() === query);
          if (connector) {
            connectorData.updateConnector(connector.id, { installedSkillId: result.skill.id, skillSourceUrl: resolved.sourceUrl, status: 'unknown', error: undefined });
            sendBus(BUS_CHANNELS.CONNECTORS_CHANGED, { connectorId: connector.id, reason: 'skill-installed' });
          }
        }
        return { toolCallId: id, name, success: true, output: `Skill 已安装并完成完整包回读验证。\n${installedSummary}ID: ${result.skill.id}\n名称: ${result.skill.name}\nSlug: ${result.slug ?? resolved.slug ?? ''}\n来源: ${result.resolvedUrl ?? resolved.sourceUrl}\n健康状态: ${result.verification?.health ?? result.skill.health ?? 'ready'}\n已核验源文件: ${result.verification?.sourceFileCount ?? 0}\n已回读规则文档: ${result.verification?.documentCount ?? 0}\n包校验哈希: ${result.verification?.bundleHash ?? ''}\n\n如果该 Skill 还依赖账号、外部软件或连接器，再按说明配置并做实际调用验证；纯安装任务到这里已经完成。` };
      }

      case 'inspect_connectors': {
        const { CONNECTOR_PRESETS, connectorMissingFields, loadConnectors } = connectorData;
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
            connector.kind === 'skill-bridge' ? `  Skill: ${connector.installedSkillId || '未关联'}` : '',
            `  检查: ${checked}${connector.error ? `；上次原因: ${connector.error}` : ''}`,
            missing.length ? `  还缺: ${missing.join('、')}` : '  还缺: 无（仍需真实测试）',
          ].filter(Boolean).join('\n');
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
        } = connectorData;
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
        if (!draft.installedSkillId && preset.bundledSkillSource) {
          draft.installedSkillId = (await skillData.findBundledSkill(preset.bundledSkillSource))?.id;
        }
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
          ? `已为“${draft.label}”打开文档驱动配置窗口。${draft.installedSkillId ? '安装包内置 Skill 已自动关联；' : '请先安装官方 Skill；'}填写其中要求的命名凭据后保存，客户端会读取完整规则并执行真实验证。当前仍未通过真实调用，不得宣布完成。`
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
        const { checkConnector, connectorMissingFields, ensureConnectorSkillAssociation, hydrateConnectorCredentials, findConnectorPreset, loadConnectors, updateConnector } = connectorData;
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
        await ensureConnectorSkillAssociation(connector);
        await hydrateConnectorCredentials(connector);
        const missing = connectorMissingFields(connector);
        if (missing.length > 0) {
          return { toolCallId: id, name, success: false, output: `“${connector.label}”还不能测试，因为缺少：${missing.join('、')}。请调用 prepare_connector 打开配置窗口，让用户填写后再测试。` };
        }
        if (!requestConnectorApproval(`test_connector:${connector.label}`, {})) {
          return { toolCallId: id, name, success: false, output: `没有获得连接测试批准，因此尚未访问“${connector.label}”。用户批准后再测试；目前不能确认连接成功。` };
        }
        const result = await checkConnector(connector);
        if (connector.kind === 'skill-bridge' && result.status === 'unknown') {
          const connectorPreset = findConnectorPreset(connector.mcpServerName || connector.label);
          const verification = connectorPreset?.verification;
          if (!verification || !connector.installedSkillId) {
            updateConnector(connector.id, { status: result.status, error: result.error, lastChecked: Date.now() });
            return { toolCallId: id, name, success: false, output: `“${connector.label}”的 Skill 和凭据已经准备好，但当前客户端没有对应的内置验收适配器。这是客户端能力缺失，不应要求用户查找或提供命令。` };
          }

          let skillContent = '';
          try {
            skillContent = skillData.skillInstructionText(await skillData.readSkill(connector.installedSkillId));
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            updateConnector(connector.id, { status: 'disconnected', error: `无法读取 Skill 规则：${detail}`, lastChecked: Date.now() });
            return { toolCallId: id, name, success: false, output: `“${connector.label}”验证失败：无法读取已关联 Skill“${connector.installedSkillId}”的规则：${detail}` };
          }
          const missingRule = verification.requiredSkillText?.find((text) => !skillContent.includes(text));
          if (missingRule) {
            const detail = `Skill 说明缺少客户端验收所需规则“${missingRule}”`;
            updateConnector(connector.id, { status: 'disconnected', error: detail, lastChecked: Date.now() });
            return { toolCallId: id, name, success: false, output: `“${connector.label}”验证已停止：${detail}。请检查 Skill 版本或重新安装官方版本，客户端不会猜测接口。` };
          }

          let businessSuccess = false;
          let safeDetail = '真实调用失败';
          let verificationSummary = '';
          if (verification.adapter) {
            const verified = await window.electronAPI?.connectorVerifyPreset?.({
              adapter: verification.adapter,
              credentials: connector.credentials,
            });
            if (!verified) {
              safeDetail = '当前桌面客户端没有开放连接器适配器 IPC';
            } else {
              businessSuccess = verified.ok;
              const stageLabels: Record<string, string> = {
                configuration: '配置检查', adapter: '适配器选择', network: '网络请求', timeout: '请求超时',
                http: 'HTTP 响应', response: '响应解析', business: '业务验收', complete: '验收完成',
              };
              const metrics = [
                `阶段=${stageLabels[verified.stage] ?? verified.stage}`,
                verified.httpStatus ? `HTTP=${verified.httpStatus}` : '',
                verified.code !== undefined ? `业务码=${String(verified.code)}` : '',
                `尝试=${verified.attempts}次`,
                verified.latencyMs !== undefined ? `耗时=${verified.latencyMs}ms` : '',
              ].filter(Boolean).join('，');
              safeDetail = `${verified.error ?? verified.message ?? (verified.ok ? 'success' : '未知错误')}（${metrics}）`.slice(0, 500);
              verificationSummary = `客户端原生适配器“${verification.adapter}”已执行最小只读请求；${metrics}`;
            }
          } else if (verification.command) {
            const injectedEnv: Record<string, string> = {};
            for (const field of connector.credentialFields ?? []) {
              const value = connector.credentials?.[field.key];
              if (field.envName && value) injectedEnv[field.envName] = value;
            }
            const api = getFsApi();
            if (!api?.execCommand) {
              safeDetail = '当前不是 Electron 桌面环境，无法执行真实验收命令';
            } else {
              const executed = await api.execCommand(verification.command, physicalWorkspace, {
                sandboxEnabled: true,
                env: injectedEnv,
                skillId: connector.installedSkillId,
              });
              businessSuccess = Boolean(executed.success);
              let businessError = executed.stderr || '';
              if (businessSuccess && verification.successJsonField) {
                try {
                  const body = JSON.parse(executed.stdout || '{}') as Record<string, unknown>;
                  const actual = body[verification.successJsonField];
                  businessSuccess = (verification.successJsonValues ?? []).some((expected) => expected === actual);
                  if (!businessSuccess) businessError = `接口返回 ${verification.successJsonField}=${String(actual ?? '缺失')}`;
                } catch {
                  businessSuccess = false;
                  businessError = '接口返回的不是可验证 JSON';
                }
              }
              safeDetail = (businessError || executed.stdout || '真实调用失败').slice(0, 500);
              verificationSummary = '客户端兼容命令适配器已执行最小只读请求';
            }
          } else {
            safeDetail = '连接器预设没有定义可执行的客户端适配器';
          }
          updateConnector(connector.id, {
            status: businessSuccess ? 'connected' : 'disconnected',
            error: businessSuccess ? undefined : safeDetail,
            lastChecked: Date.now(),
          });
          sendBus(BUS_CHANNELS.CONNECTORS_CHANGED, { connectorId: connector.id, reason: 'preset-verified', status: businessSuccess ? 'connected' : 'disconnected' });
          return businessSuccess
            ? { toolCallId: id, name, success: true, output: `“${connector.label}”已完成闭环验证：读取了已关联 Skill“${connector.installedSkillId}”的完整规则；${verificationSummary}；接口业务状态通过，现在可以确认连接器可用。` }
            : { toolCallId: id, name, success: false, output: `“${connector.label}”已由客户端自主完成规则核对和真实只读调用，但验证未通过：${safeDetail}。配置已保留；客户端不会要求用户查找 README、复制命令或重复读取 Skill。` };
        }
        updateConnector(connector.id, {
          status: result.status,
          error: result.error,
          lastChecked: Date.now(),
          discoveredActions: result.actions,
          runtimeStatus: result.runtimeStatus,
        });
        sendBus(BUS_CHANNELS.CONNECTORS_CHANGED, { connectorId: connector.id, reason: 'tested', status: result.status });
        if (result.status !== 'connected') {
          if (connector.kind === 'skill-bridge' && result.status === 'unknown') {
            return { toolCallId: id, name, success: false, output: `“${connector.label}”的 Skill 和凭据已经准备好，但客户端没有完成真实外部调用。这属于连接器适配器缺失或异常；不得要求用户查找命令或重复读取 Skill。` };
          }
          return { toolCallId: id, name, success: false, output: `“${connector.label}”真实连接测试没有通过：${result.error ?? '服务没有正常回应'}。配置已保留，但不能宣布完成。请根据这个原因修正配置后再测试。` };
        }
        return { toolCallId: id, name, success: true, output: `“${connector.label}”已通过真实连接测试，现在可以确认连接器可用。${result.actions?.length ? `已发现 ${result.actions.length} 个可调用操作。` : ''}` };
      }

      case 'run_command': {
        const cmd = (args.cmd ?? '').trim();
        if (!cmd) return { toolCallId: id, name, success: false, output: '命令不能为空' };
        if (/(?:^|[;&|]\s*)skillhub(?:\.bat)?\s+(?:install|update)\b/iu.test(cmd) || parseSkillCliInstall(cmd)) {
          return { toolCallId: id, name, success: false, output: '技能 CLI 安装路线已停用：交互式命令无法在后台可靠完成，也不会写入太极的受管 Skill 目录。请直接调用客户端原生 install_skill，安装器会完整落盘并回读校验。' };
        }
        if (containsInlineSecret(cmd)) {
          return { toolCallId: id, name, success: false, output: '命令中包含疑似明文密钥、Token 或密码，已阻止执行。请把凭据保存到连接器配置，再通过 connector 参数以临时环境变量注入；密钥不会进入聊天和日志。' };
        }

        let connectorForCommand: import('../data/connectors').Connector | undefined;
        const injectedEnv: Record<string, string> = {};
        if (args.connector?.trim()) {
          const { connectorMissingFields, hydrateConnectorCredentials, loadConnectors } = connectorData;
          const query = args.connector.trim().toLocaleLowerCase();
          connectorForCommand = loadConnectors().find((item) => item.id.toLocaleLowerCase() === query || item.label.toLocaleLowerCase() === query || item.mcpServerName?.toLocaleLowerCase() === query);
          if (!connectorForCommand) return { toolCallId: id, name, success: false, output: `没有找到要关联的连接器“${args.connector}”。请先调用 inspect_connectors。` };
          await hydrateConnectorCredentials(connectorForCommand);
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
            connectorData.updateConnector(connectorForCommand.id, { status: success ? 'connected' : 'disconnected', error: success ? undefined : (stderr || stdout || '真实调用失败').slice(0, 500), lastChecked: Date.now() });
            sendBus(BUS_CHANNELS.CONNECTORS_CHANGED, { connectorId: connectorForCommand.id, reason: 'skill-verified', status: success ? 'connected' : 'disconnected' });
          }
          const syncedFiles = await syncWorkspaceFiles(call.scope ?? 'global', api, beforeFiles, physicalWorkspace);

          const out = [
            `状态：${success ? '成功 ✅' : `失败 ❌（退出码 ${exitCode}）`}${sig ? ` (${sig})` : ''}`,
            `目录：${cwd}`,
            `STDOUT：\n${(stdout || '(无)').slice(0, 3000)}`,
            stderr ? `\nSTDERR：\n${stderr.slice(0, 1000)}` : '',
            syncedFiles.length > 0 ? `工作区文件已同步到产出物：${syncedFiles.length} 个` : '',
          ].filter(Boolean).join('\n\n');
          return {
            toolCallId: id,
            name,
            success,
            output: out,
            structuredEvidence: syncedFiles.length > 0 ? createToolExecutionEvidence({ artifacts: syncedFiles }) : undefined,
          };
        } catch (e: any) {
          return { toolCallId: id, name, success: false, output: `命令执行异常：${e?.message ?? '未知错误'}` };
        }
      }

      default:
      // 连接器工具（以 connector_ 开头）
      if (name.startsWith('connector_')) {
          const permissionGranted = requestConnectorApproval(name, args);
          try {
            const result = await connectorToolRuntime.executeConnectorTool(name, args as Record<string, string>, { permissionGranted });
            return {
              toolCallId: id,
              name,
              success: result.success,
              output: result.output.slice(0, 6000),
              protocolEvidence: result.protocol,
            };
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

async function recordExternalToolResult(call: ToolCall, result: ToolResult): Promise<void> {
  try {
    const httpStatus = Number(result.output.match(/HTTP\s+(\d{3})/iu)?.[1] ?? 0) || undefined;
    if (call.name === 'read_web_page') {
      const invalidInput = /地址无效|只支持读取/u.test(result.output);
      recordExternalCapabilityProbe({
        id: 'builtin:web-page', kind: 'web_page', label: '指定网页读取', source: 'desktop-runtime',
        configured: Boolean(getFsApi()?.knowledgeFetchUrl || globalThis.fetch), resourceIdentity: call.args.url,
      }, {
        actualCall: !invalidInput,
        ok: result.success,
        validated: result.success && result.output.trim().length > 40,
        responseReceived: !invalidInput,
        invalidContent: result.success && result.output.trim().length <= 40,
        httpStatus,
        detail: result.success ? `已读取指定对象：${call.args.url ?? ''}` : result.output.slice(0, 500),
      });
      return;
    }
    if (call.name === 'search_skills' || call.name === 'install_skill') {
      const supported = Boolean(getFsApi()?.skillsSearchMarket && getFsApi()?.skillsInstall);
      recordExternalCapabilityProbe({ id: 'builtin:skillhub', kind: 'skillhub', label: 'SkillHub', source: 'skill-runtime', configured: supported }, {
        actualCall: supported,
        ok: result.success,
        validated: result.success,
        responseReceived: supported,
        httpStatus,
        detail: result.output.slice(0, 500),
      });
      return;
    }
    if (call.name === 'test_connector' || call.name.startsWith('connector_') || (call.name === 'run_command' && String(call.args.verification).toLowerCase() === 'true')) {
      const connectorId = result.protocolEvidence?.connectorId || call.args.connector || call.args.id;
      const query = String(connectorId ?? '').toLocaleLowerCase();
      const connector = connectorData.loadConnectors().find((item) => item.id.toLocaleLowerCase() === query || item.label.toLocaleLowerCase() === query || item.mcpServerName?.toLocaleLowerCase() === query);
      if (!connector) return;
      const profile = externalCapabilityProfileForConnector(connector, connectorData.connectorMissingFields(connector).length === 0);
      const actualCall = profile.configured && !/没有获得批准|还缺少|尚未配置|没有找到/u.test(result.output);
      recordExternalCapabilityProbe(profile, {
        actualCall,
        ok: result.success,
        validated: result.success,
        responseReceived: actualCall,
        httpStatus,
        protocolError: /协议|json-rpc|响应字段/iu.test(result.output),
        invalidContent: result.success && !result.output.trim(),
        detail: result.output.slice(0, 500),
      });
    }
  } catch {}
}

export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const result = await executeToolInternal(call);
  await recordExternalToolResult(call, result);
  return result;
}
