const LS_CONNECTORS = 'hermes_office_connectors';

/* ===== 类型定义 ===== */

/** 连接器认证配置 */
export interface ConnectorAuth {
  type: 'apikey' | 'bearer' | 'oauth2' | 'none';
  /** API Key / Bearer Token / OAuth access_token */
  token?: string;
  /** OAuth2 特有：刷新令牌 */
  refreshToken?: string;
  /** 认证头名称，默认 Authorization */
  headerName?: string;
  /** 认证值前缀，如 'Bearer ' */
  prefix?: string;
}

/** 连接器定义 */
export interface Connector {
  id: string;
  label: string;
  icon: string;
  type: 'mcp' | 'custom';
  kind?: 'knowledge-url' | 'obsidian' | 'legacy';
  runtime?: 'native-mcp' | 'http';
  mcpServerName?: string;
  status: 'connected' | 'disconnected' | 'unknown';
  runtimeStatus?: 'available' | 'unavailable' | 'unknown';
  discoveredActions?: ConnectorAction[];
  enabled: boolean;
  lastChecked?: number;
  error?: string;
  /** 服务基础 URL */
  baseUrl?: string;
  /** Obsidian Vault 或本地知识库目录 */
  localPath?: string;
  /** 认证配置 */
  auth?: ConnectorAuth;
  /** 自定义 headers */
  headers?: Record<string, string>;
}

/** 连接器操作（工具）定义 */
export interface ConnectorAction {
  name: string;
  description: string;
  /** JSON Schema for tool parameters */
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
  source?: 'preset-http' | 'mcp-discovered' | 'knowledge-local';
  mcpToolName?: string;
  local?: 'knowledge-fetch-url' | 'obsidian-search' | 'obsidian-read';
  /** HTTP 请求配置 */
  http?: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    /** 相对于 connector.baseUrl 的路径，支持 {param} 占位符 */
    path: string;
    /** 请求体模板，支持 {param} 占位符 */
    bodyTemplate?: string;
    /** 参数传递方式 */
    paramStyle?: 'path' | 'query' | 'body';
  };
}

/* ===== 预设连接器 ===== */

export interface ConnectorPreset {
  /** Stable identifier used by the agent and UI. */
  key: string;
  label: string;
  icon: string;
  type: 'mcp' | 'custom';
  kind?: Connector['kind'];
  mcpServerName?: string;
  desc: string;
  baseUrl?: string;
  authType?: ConnectorAuth['type'];
  actions: ConnectorAction[];
}

export const CONNECTOR_PRESETS: ConnectorPreset[] = [
  {
    key: 'web-knowledge',
    label: '网页知识库', icon: '🔗', type: 'custom', kind: 'knowledge-url', mcpServerName: 'knowledge-url',
    desc: '读取网页、公开文档和在线知识库正文',
    authType: 'none',
    actions: [
      {
        name: 'read_knowledge_link',
        description: '读取已配置的网页知识库内容',
        parameters: { type: 'object', properties: {}, required: [] },
        source: 'knowledge-local',
        local: 'knowledge-fetch-url',
      },
    ],
  },
  {
    key: 'obsidian',
    label: 'Obsidian', icon: '◇', type: 'custom', kind: 'obsidian', mcpServerName: 'obsidian-vault',
    desc: '搜索并读取本机 Obsidian Vault 中的 Markdown 笔记',
    authType: 'none',
    actions: [
      {
        name: 'search_obsidian',
        description: '在 Obsidian Vault 中搜索相关笔记',
        parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] },
        source: 'knowledge-local',
        local: 'obsidian-search',
      },
      {
        name: 'read_obsidian_note',
        description: '读取 Obsidian Vault 中指定路径的笔记',
        parameters: { type: 'object', properties: { path: { type: 'string', description: '搜索结果返回的笔记相对路径' } }, required: ['path'] },
        source: 'knowledge-local',
        local: 'obsidian-read',
      },
    ],
  },
  {
    key: 'ima',
    label: 'ima 知识库', icon: '📚', type: 'custom', mcpServerName: 'ima-mcp',
    desc: '腾讯 IMA 知识库搜索与笔记管理',
    baseUrl: 'https://ima.qq.com/openapi',
    authType: 'apikey',
    actions: [
      {
        name: 'ima_search_knowledge',
        description: '在 IMA 知识库中搜索知识内容',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            kbId: { type: 'string', description: '知识库 ID（可选，留空搜全部）' },
          },
          required: ['query'],
        },
        http: {
          method: 'POST',
          path: '/wiki/v1/search',
          bodyTemplate: '{"query":"{query}","knowledge_base_id":"{kbId}","limit":10}',
          paramStyle: 'body',
        },
      },
      {
        name: 'ima_list_knowledge',
        description: '列出 IMA 知识库中的知识列表',
        parameters: {
          type: 'object',
          properties: {
            kbId: { type: 'string', description: '知识库 ID（可选）' },
          },
          required: [],
        },
        http: {
          method: 'POST',
          path: '/wiki/v1/list',
          bodyTemplate: '{"knowledge_base_id":"{kbId}"}',
          paramStyle: 'body',
        },
      },
      {
        name: 'ima_add_knowledge',
        description: '向 IMA 知识库中添加新知识',
        parameters: {
          type: 'object',
          properties: {
            kbId: { type: 'string', description: '目标知识库 ID' },
            title: { type: 'string', description: '知识标题' },
            content: { type: 'string', description: '知识内容（Markdown 格式）' },
          },
          required: ['kbId', 'title', 'content'],
        },
        http: {
          method: 'POST',
          path: '/wiki/v1/add',
          bodyTemplate: '{"knowledge_base_id":"{kbId}","title":"{title}","content":"{content}"}',
          paramStyle: 'body',
        },
      },
    ],
  },
  {
    key: 'qq-mail',
    label: 'QQ 邮箱', icon: '📧', type: 'custom', mcpServerName: 'qq-mail',
    desc: 'QQ 邮箱收发与管理',
    baseUrl: '',
    authType: 'apikey',
    actions: [
      {
        name: 'qmail_send',
        description: '通过 QQ 邮箱发送邮件',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: '收件人邮箱地址' },
            subject: { type: 'string', description: '邮件主题' },
            body: { type: 'string', description: '邮件正文（支持 Markdown）' },
          },
          required: ['to', 'subject', 'body'],
        },
        http: {
          method: 'POST',
          path: '/api/mail/send',
          bodyTemplate: '{"to":"{to}","subject":"{subject}","body":"{body}"}',
          paramStyle: 'body',
        },
      },
      {
        name: 'qmail_search',
        description: '搜索 QQ 邮箱中的邮件',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            limit: { type: 'string', description: '返回数量上限，默认 10' },
          },
          required: ['query'],
        },
        http: {
          method: 'POST',
          path: '/api/mail/search',
          bodyTemplate: '{"query":"{query}","limit":"{limit}"}',
          paramStyle: 'body',
        },
      },
    ],
  },
  {
    key: 'tencent-docs',
    label: '腾讯文档', icon: '📝', type: 'mcp', mcpServerName: 'tencent-docs',
    desc: '腾讯文档在线协作（需要腾讯文档 MCP 连接器）',
    actions: [],
  },
  {
    key: 'wecom',
    label: '企业微信', icon: '💬', type: 'mcp', mcpServerName: 'wecom',
    desc: '企业微信消息与联系人管理',
    actions: [],
  },
  {
    key: 'github',
    label: 'GitHub', icon: '🐙', type: 'custom', mcpServerName: 'github',
    desc: 'GitHub 仓库与代码管理',
    baseUrl: 'https://api.github.com',
    authType: 'bearer',
    actions: [
      {
        name: 'github_search_repos',
        description: '搜索 GitHub 仓库',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            language: { type: 'string', description: '编程语言（可选）' },
            sort: { type: 'string', description: '排序方式', enum: ['stars', 'forks', 'updated'] },
          },
          required: ['query'],
        },
        http: {
          method: 'GET',
          path: '/search/repositories?q={query}+language:{language}&sort={sort}&per_page=5',
          paramStyle: 'path',
        },
      },
    ],
  },
  {
    key: 'custom-http',
    label: '自定义 HTTP', icon: '🔌', type: 'custom',
    desc: '自定义 HTTP API 连接器，支持任何 REST API',
    baseUrl: '',
    authType: 'apikey',
    actions: [
      {
        name: 'custom_get',
        description: '发送 GET 请求到自定义 API',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'API 路径（相对 baseUrl）' },
          },
          required: ['path'],
        },
        http: {
          method: 'GET',
          path: '{path}',
          paramStyle: 'path',
        },
      },
      {
        name: 'custom_post',
        description: '发送 POST 请求到自定义 API',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'API 路径（相对 baseUrl）' },
            body: { type: 'string', description: '请求体 JSON 字符串' },
          },
          required: ['path'],
        },
        http: {
          method: 'POST',
          path: '{path}',
          bodyTemplate: '{body}',
          paramStyle: 'body',
        },
      },
    ],
  },
];

function normalizeConnectorName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, '');
}

/** Resolve a preset from a user-facing name without relying on one service. */
export function findConnectorPreset(query: string): ConnectorPreset | undefined {
  const needle = normalizeConnectorName(query);
  if (!needle) return undefined;
  return CONNECTOR_PRESETS.find((preset) => {
    const candidates = [preset.key, preset.label, preset.mcpServerName ?? ''].map(normalizeConnectorName);
    return candidates.includes(needle) || candidates.some((candidate) => candidate && (candidate.includes(needle) || needle.includes(candidate)));
  });
}

export function connectorMissingFields(connector: Connector): string[] {
  const missing: string[] = [];
  if (connector.kind === 'knowledge-url') {
    if (!connector.baseUrl) missing.push('知识库链接');
    return missing;
  }
  if (connector.kind === 'obsidian') {
    if (!connector.localPath) missing.push('Obsidian Vault 目录');
    return missing;
  }
  if (!connector.baseUrl) missing.push(connector.type === 'mcp' ? 'MCP 服务地址' : '服务地址');
  if (connector.auth?.type !== 'none' && !connector.auth?.token) missing.push('认证凭据');
  return missing;
}

/** Build a credential-free configuration draft from any preset. */
export function createConnectorDraft(preset: ConnectorPreset, existing?: Connector): Connector {
  return {
    id: existing?.id ?? `connector-${preset.key}-${Date.now()}`,
    label: existing?.label || preset.label,
    icon: preset.icon,
    type: preset.type,
    kind: preset.kind ?? 'legacy',
    runtime: preset.type === 'mcp' ? 'native-mcp' : 'http',
    mcpServerName: preset.mcpServerName,
    status: existing?.status ?? 'unknown',
    runtimeStatus: existing?.runtimeStatus ?? (preset.type === 'mcp' ? 'unknown' : undefined),
    enabled: existing?.enabled ?? true,
    baseUrl: existing?.baseUrl ?? preset.baseUrl,
    localPath: existing?.localPath,
    auth: existing?.auth ?? (preset.authType && preset.authType !== 'none' ? { type: preset.authType } : undefined),
    headers: existing?.headers,
    discoveredActions: existing?.discoveredActions,
    lastChecked: existing?.lastChecked,
    error: existing?.error,
  };
}

/* ===== 持久化 ===== */

export function loadConnectors(): Connector[] {
  try {
    const raw = localStorage.getItem(LS_CONNECTORS);
    if (raw) {
      return (JSON.parse(raw) as Connector[]).map(c => ({
        ...c,
        kind: c.kind ?? (c.mcpServerName === 'knowledge-url' ? 'knowledge-url' : c.mcpServerName === 'obsidian-vault' ? 'obsidian' : 'legacy'),
        runtime: c.runtime ?? (c.type === 'mcp' ? 'native-mcp' : 'http'),
        runtimeStatus: c.runtimeStatus ?? (c.type === 'mcp' ? 'unknown' : undefined),
      }));
    }
  } catch {}
  return [];
}

export function saveConnectors(list: Connector[]): void {
  try {
    localStorage.setItem(LS_CONNECTORS, JSON.stringify(list));
  } catch {}
}

export function addConnector(c: Connector): void {
  const list = loadConnectors();
  list.push(c);
  saveConnectors(list);
}

export function removeConnector(id: string): void {
  const list = loadConnectors().filter(c => c.id !== id);
  saveConnectors(list);
}

export function updateConnector(id: string, partial: Partial<Connector>): void {
  const list = loadConnectors().map(c => c.id === id ? { ...c, ...partial } : c);
  saveConnectors(list);
}

export function upsertConnector(connector: Connector): void {
  const list = loadConnectors();
  const index = list.findIndex((item) => item.id === connector.id);
  if (index >= 0) list[index] = connector;
  else list.push(connector);
  saveConnectors(list);
}

/* ===== 连接测试 ===== */

/** 快速 ping 检测连接器是否可达 */
export async function checkConnector(c: Connector): Promise<{ status: Connector['status']; error?: string; runtimeStatus?: Connector['runtimeStatus']; actions?: ConnectorAction[] }> {
  if (c.kind === 'knowledge-url') {
    if (!c.baseUrl) return { status: 'disconnected', error: '未配置知识库链接' };
    const result = await window.electronAPI?.knowledgeFetchUrl?.(c.baseUrl);
    return result?.ok ? { status: 'connected' } : { status: 'disconnected', error: result?.error ?? '网页知识库不可用' };
  }
  if (c.kind === 'obsidian') {
    if (!c.localPath) return { status: 'disconnected', error: '未选择 Obsidian Vault' };
    const result = await window.electronAPI?.knowledgeTestObsidian?.(c.localPath);
    return result?.ok ? { status: 'connected' } : { status: 'disconnected', error: result?.error ?? 'Obsidian Vault 不可用' };
  }
  if (c.type === 'mcp') {
    if (!c.baseUrl) return { status: 'disconnected', runtimeStatus: 'unavailable', actions: [], error: '未配置 MCP endpoint' };
    try {
      await mcpRequest(c, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'hermes-office-pro', version: '1.0.0' },
      }, 5000);
      const listed = await mcpRequest(c, 'tools/list', {}, 10000);
      const tools = Array.isArray(listed?.tools) ? listed.tools : [];
      const actions = tools.filter((tool: any) => typeof tool?.name === 'string').map((tool: any) => ({
        name: tool.name,
        mcpToolName: tool.name,
        description: typeof tool.description === 'string' ? tool.description : `MCP 工具 ${tool.name}`,
        parameters: (tool.inputSchema && tool.inputSchema.type === 'object') ? tool.inputSchema : { type: 'object', properties: {}, required: [] },
        source: 'mcp-discovered' as const,
      }));
      return { status: 'connected', runtimeStatus: 'available', actions };
    } catch (e: any) {
      return { status: 'disconnected', runtimeStatus: 'unavailable', actions: [], error: `MCP endpoint 不可用: ${e?.message ?? '请求失败'}` };
    }
  }

  // 自定义类型：检查配置完整性
  if (!c.baseUrl) {
    return { status: 'disconnected', error: '未配置服务地址' };
  }
  if (c.auth?.type !== 'none' && !c.auth?.token) {
    return { status: 'disconnected', error: '未配置认证凭据' };
  }

  // 尝试轻量 ping（通过 Electron IPC 或 fetch）
  try {
    const response = await callConnectorApi(c, { method: 'GET', path: '/', timeout: 5000 });
    if (response.status < 200 || response.status >= 300) {
      return { status: 'disconnected', error: `服务返回 HTTP ${response.status}` };
    }
    return { status: 'connected' };
  } catch (e: any) {
    return { status: 'disconnected', error: e?.message ?? '连接失败' };
  }
}

async function mcpRequest(connector: Connector, method: string, params: Record<string, unknown>, timeout = 15000): Promise<any> {
  const response = await callConnectorApi(connector, {
    method: 'POST',
    path: '',
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    timeout,
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
  const raw = response.data.trim();
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch {
    const eventData = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('');
    if (!eventData) throw new Error('响应不是有效 JSON-RPC');
    parsed = JSON.parse(eventData);
  }
  if (parsed?.error) throw new Error(parsed.error.message ?? 'JSON-RPC 错误');
  if (!Object.prototype.hasOwnProperty.call(parsed ?? {}, 'result')) throw new Error('JSON-RPC 响应缺少 result');
  if (parsed.result && typeof parsed.result === 'object' && parsed.result.isError === true) {
    throw new Error(typeof parsed.result.content === 'string' ? parsed.result.content : 'MCP 工具返回错误');
  }
  return parsed.result;
}

/* ===== API 调用 ===== */

/** 调用连接器 API（渲染进程 → Electron 主进程 IPC） */
export async function callConnectorApi(
  connector: Connector,
  opts: { method: string; path: string; body?: string; timeout?: number },
): Promise<{ status: number; data: string }> {
  const url = `${(connector.baseUrl ?? '').replace(/\/$/, '')}/${opts.path.replace(/^\//, '')}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (connector.auth?.token) {
    const prefix = connector.auth.prefix ?? (connector.auth.type === 'bearer' ? 'Bearer ' : '');
    const headerName = connector.auth.headerName ?? 'Authorization';
    headers[headerName] = `${prefix}${connector.auth.token}`;
  }
  if (connector.headers) {
    Object.assign(headers, connector.headers);
  }

  // 优先使用 Electron IPC（主进程可绕过 CORS）
  if (typeof window !== 'undefined' && (window as any).electronAPI?.connectorCall) {
    return (window as any).electronAPI.connectorCall({
      url, method: opts.method, headers, body: opts.body, timeout: opts.timeout ?? 15000,
    });
  }

  // 回退：浏览器 fetch（受 CORS 限制）
  const res = await fetch(url, {
    method: opts.method,
    headers,
    body: opts.body ?? undefined,
    signal: AbortSignal.timeout(opts.timeout ?? 15000),
  });
  const text = await res.text();
  return { status: res.status, data: text };
}

/** 执行某个连接器的某个操作 */
export async function executeConnectorAction(
  connector: Connector,
  action: ConnectorAction,
  args: Record<string, string>,
): Promise<string> {
  if (action.local === 'knowledge-fetch-url') {
    if (!connector.baseUrl) throw new Error('知识库链接未配置');
    const result = await window.electronAPI?.knowledgeFetchUrl?.(connector.baseUrl);
    if (!result?.ok) throw new Error(result?.error ?? '知识库读取失败');
    return `来源：${result.url ?? connector.baseUrl}\n标题：${result.title ?? connector.label}\n\n${result.content ?? ''}`.slice(0, 50000);
  }
  if (action.local === 'obsidian-search') {
    if (!connector.localPath) throw new Error('Obsidian Vault 未配置');
    const result = await window.electronAPI?.knowledgeSearchObsidian?.(connector.localPath, args.query ?? '');
    if (!result?.ok) throw new Error(result?.error ?? 'Obsidian 搜索失败');
    const rows = (result.results ?? []).map((item) => `- ${item.title}\n  路径: ${item.path}\n  摘要: ${item.snippet}`);
    return rows.length ? `扫描 ${result.scanned ?? 0} 篇笔记，找到 ${rows.length} 条：\n${rows.join('\n')}` : '没有找到匹配的 Obsidian 笔记。';
  }
  if (action.local === 'obsidian-read') {
    if (!connector.localPath) throw new Error('Obsidian Vault 未配置');
    const result = await window.electronAPI?.knowledgeReadObsidian?.(connector.localPath, args.path ?? '');
    if (!result?.ok) throw new Error(result?.error ?? 'Obsidian 笔记读取失败');
    return `笔记：${result.path}\n\n${result.content ?? ''}`.slice(0, 50000);
  }
  if (!action.http) {
    if (connector.type !== 'mcp' || !connector.baseUrl || !action.mcpToolName) {
      throw new Error('连接器 endpoint/runtime 不可用，无法执行此操作。');
    }
    try {
      const result = await mcpRequest(connector, 'tools/call', { name: action.mcpToolName, arguments: args }, 20000);
      return typeof result === 'string' ? result : JSON.stringify(result).slice(0, 8000);
    } catch (e: any) {
      throw new Error(`MCP 工具调用失败: ${e?.message ?? '未知错误'}`);
    }
  }

  let path = action.http.path;
  let body: string | undefined;

  if (action.http.paramStyle === 'body') {
    body = action.http.bodyTemplate ?? JSON.stringify(args);
    for (const [k, v] of Object.entries(args)) {
      const escaped = JSON.stringify(v ?? '').slice(1, -1);
      body = body.replaceAll(`{${k}}`, escaped);
    }
  } else {
    for (const [k, v] of Object.entries(args)) {
      path = path.replaceAll(`{${k}}`, encodeURIComponent(v ?? ''));
    }
  }

  try {
    const res = await callConnectorApi(connector, {
      method: action.http.method,
      path,
      body,
      timeout: 20000,
    });
    if (res.status >= 400) {
      return `API 返回错误 ${res.status}: ${res.data.slice(0, 2000)}`;
    }
    return res.data.slice(0, 8000);
  } catch (e: any) {
    return `连接器调用失败: ${e?.message ?? '未知错误'}`;
  }
}
