const LS_CONNECTORS = 'hermes_office_connectors';

/** 连接器定义 */
export interface Connector {
  id: string;
  label: string;         // 显示名称，如"ima 知识库"
  icon: string;          // 图标 emoji，如"📚"
  type: 'mcp' | 'custom'; // 连接类型
  mcpServerName?: string; // MCP 服务名（type='mcp'时填）
  status: 'connected' | 'disconnected' | 'unknown';
  lastChecked?: number;
  error?: string;
  // 自定义连接器的配置
  apiHost?: string;
  apiKey?: string;
  model?: string;
  // 关联的模型（可选，如 ima 用某个模型做语义搜索）
  refModelId?: string;
}

/** 预设连接器模板 */
export const CONNECTOR_PRESETS: Array<{
  label: string;
  icon: string;
  type: 'mcp' | 'custom';
  mcpServerName?: string;
  desc: string;
}> = [
  { label: 'ima 知识库', icon: '📚', type: 'mcp', mcpServerName: 'ima-mcp', desc: '腾讯 IMA 知识库搜索与笔记管理' },
  { label: '微信助理', icon: '💬', type: 'mcp', mcpServerName: 'wecom', desc: '企业微信消息与联系人管理' },
  { label: '飞书文档', icon: '📄', type: 'mcp', mcpServerName: 'feishu', desc: '飞书文档与表格协作' },
  { label: '腾讯文档', icon: '📝', type: 'mcp', mcpServerName: 'tencent-docs', desc: '腾讯文档在线协作' },
  { label: 'GitHub', icon: '🐙', type: 'mcp', mcpServerName: 'github', desc: 'GitHub 仓库与代码管理' },
  { label: '钉钉', icon: '🔔', type: 'mcp', mcpServerName: 'dingtalk', desc: '钉钉消息与审批' },
];

export function loadConnectors(): Connector[] {
  try {
    const raw = localStorage.getItem(LS_CONNECTORS);
    if (raw) return JSON.parse(raw) as Connector[];
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

/** 探测连接器状态（发 ping 或检查配置是否完整） */
export function checkConnector(c: Connector): { status: Connector['status']; error?: string } {
  if (c.type === 'mcp') {
    // MCP 类型：检查有没有对应的 MCP 服务注册
    // 这里简化为检查是否配置了对应的 server。实际需要 IPC 桥接
    // 由于当前应用没有 MCP 运行时，标记为 "connected"（已配置）或 "unknown"
    return { status: 'unknown', error: 'MCP 服务需在 WorkBuddy 中启用' };
  }
  // 自定义类型：检查配置是否完整
  if (c.apiHost) return { status: 'connected' };
  return { status: 'disconnected', error: '未配置 API 地址' };
}
