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
  source?: 'preset-http' | 'mcp-discovered';
  mcpToolName?: string;
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
  label: string;
  icon: string;
  type: 'mcp' | 'custom';
  mcpServerName?: string;
  desc: string;
  baseUrl?: string;
  authType?: ConnectorAuth['type'];
  actions: ConnectorAction[];
}

export const CONNECTOR_PRESETS: ConnectorPreset[] = [
  {
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
    label: '腾讯文档', icon: '📝', type: 'mcp', mcpServerName: 'tencent-docs',
    desc: '腾讯文档在线协作（需要腾讯文档 MCP 连接器）',
    actions: [],
  },
  {
    label: '企业微信', icon: '💬', type: 'mcp', mcpServerName: 'wecom',
    desc: '企业微信消息与联系人管理',
    actions: [],
  },
  {
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

/* ===== 持久化 ===== */

export function loadConnectors(): Connector[] {
  try {
    const raw = localStorage.getItem(LS_CONNECTORS);
    if (raw) {
      return (JSON.parse(raw) as Connector[]).map(c => ({
        ...c,
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

/* ===== 连接测试 ===== */

/** 快速 ping 检测连接器是否可达 */
export async function checkConnector(c: Connector): Promise<{ status: Connector['status']; error?: string; runtimeStatus?: Connector['runtimeStatus']; actions?: ConnectorAction[] }> {
  if (c.type === 'mcp') {
    return { status: 'unknown', runtimeStatus: 'unavailable', actions: [], error: `未发现项目内 MCP runtime 或 ${c.mcpServerName ?? '目标服务'} 工具` };
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
    await callConnectorApi(c, { method: 'GET', path: '/', timeout: 5000 });
    return { status: 'connected' };
  } catch (e: any) {
    return { status: 'disconnected', error: e?.message ?? '连接失败' };
  }
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
  if (!action.http) {
    return '此操作暂不支持直接调用，需通过 MCP 连接器使用。';
  }

  let path = action.http.path;
  let body: string | undefined;

  if (action.http.paramStyle === 'body') {
    body = action.http.bodyTemplate ?? JSON.stringify(args);
    for (const [k, v] of Object.entries(args)) {
      body = body.replaceAll(`{${k}}`, v ?? '');
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
