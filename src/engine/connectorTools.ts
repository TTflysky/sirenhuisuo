import type { ToolDef } from './tools';
import type { Connector, ConnectorAction } from '../data/connectors';
import { loadConnectors, executeConnectorAction, CONNECTOR_PRESETS } from '../data/connectors';
import { executeConnectorProtocol, type ConnectorProtocolResult } from './connectorProtocol.mjs';

const protocolCache = new Map<string, ConnectorProtocolResult>();

function actionsFor(conn: Connector): ConnectorAction[] {
  const presetActions = CONNECTOR_PRESETS.find(p => p.mcpServerName === conn.mcpServerName)?.actions ?? [];
  const discoveredActions = conn.discoveredActions ?? [];
  const actions = [...presetActions.filter(action => action.http || action.local), ...discoveredActions];
  return actions.filter((action, index) => actions.findIndex(item => (item.mcpToolName ?? item.name) === (action.mcpToolName ?? action.name)) === index);
}

function toolName(conn: Connector, action: ConnectorAction): string {
  return `connector_${conn.id}_${action.mcpToolName ?? action.name}`;
}

export function getConnectorTools(): ToolDef[] {
  const connectors = loadConnectors().filter(c => c.enabled && c.status === 'connected');
  return connectors.flatMap(conn => actionsFor(conn).map(action => ({
    type: 'function' as const,
    function: { name: toolName(conn, action), description: `[${conn.label}] ${action.description}`, parameters: { ...action.parameters, required: action.parameters.required ?? [] } },
  })));
}

function dryRunConnector(connector: Connector, action: ConnectorAction): Record<string, unknown> {
  if (!connector.enabled || connector.status !== 'connected') throw new Error('连接器未启用或未通过连接验证');
  if (action.local === 'knowledge-fetch-url') {
    if (!connector.baseUrl) throw new Error('知识库链接未配置');
    if (!window.electronAPI?.knowledgeFetchUrl) throw new Error('知识库读取运行时不可用');
    return { runtime: 'knowledge-url', operation: 'read' };
  }
  if (action.local === 'obsidian-search' || action.local === 'obsidian-read') {
    if (!connector.localPath) throw new Error('Obsidian Vault 未配置');
    const runtime = action.local === 'obsidian-search' ? window.electronAPI?.knowledgeSearchObsidian : window.electronAPI?.knowledgeReadObsidian;
    if (!runtime) throw new Error('Obsidian 读取运行时不可用');
    return { runtime: 'obsidian', operation: action.local };
  }
  if (action.http) {
    if (!connector.baseUrl) throw new Error('连接器服务地址未配置');
    try { new URL(connector.baseUrl); } catch { throw new Error('连接器服务地址格式无效'); }
    return { runtime: 'http', method: action.http.method, operation: action.name };
  }
  if (connector.type !== 'mcp' || !connector.baseUrl || !action.mcpToolName) {
    throw new Error('连接器 endpoint/runtime 不可用，无法执行此操作');
  }
  return { runtime: 'mcp', operation: action.mcpToolName };
}

function formatProtocolResult(protocol: ConnectorProtocolResult): string {
  const evidence = `客户端连接器证据 v${protocol.protocolVersion}：${protocol.ok ? '已验证' : '失败'} · 阶段 ${protocol.stage} · ${protocol.latencyMs}ms${protocol.idempotencyHit ? ' · 幂等复用（未重复执行外部操作）' : ''}`;
  if (!protocol.ok) {
    return `${evidence}\n错误分类：${protocol.error?.category ?? 'unknown'}${protocol.error?.retryable ? '（可重试）' : '（不可自动重试）'}\n原因：${protocol.error?.message ?? '未知错误'}`;
  }
  const output = typeof protocol.output === 'string' ? protocol.output : protocol.output === undefined ? '' : JSON.stringify(protocol.output);
  return `${evidence}${output ? `\n\n${output}` : ''}`;
}

export async function executeConnectorTool(
  toolNameInput: string,
  args: Record<string, string>,
  options: { permissionGranted?: boolean; dryRunOnly?: boolean; idempotencyKey?: string } = {},
): Promise<{ success: boolean; output: string; protocol?: ConnectorProtocolResult }> {
  const prefix = 'connector_';
  if (!toolNameInput.startsWith(prefix)) return { success: false, output: `未找到匹配的连接器操作: ${toolNameInput}` };
  const raw = toolNameInput.slice(prefix.length);
  const connectors = loadConnectors().filter(c => c.enabled && c.status === 'connected');
  const conn = connectors
    .filter(c => raw.startsWith(`${c.id}_`))
    .sort((a, b) => b.id.length - a.id.length)[0];
  if (!conn) return { success: false, output: `连接器未启用或不可执行: ${raw}` };
  const actionName = raw.slice(conn.id.length + 1);
  const action = actionsFor(conn).find(a => (a.mcpToolName ?? a.name) === actionName);
  if (!action) return { success: false, output: `连接器 ${conn.label} 未发现工具: ${actionName}` };
  const protocol = await executeConnectorProtocol({
    connectorId: conn.id,
    connectorLabel: conn.label,
    actionName: action.mcpToolName ?? action.name,
    action,
    args,
    permissionGranted: options.permissionGranted === true,
    dryRunOnly: options.dryRunOnly === true,
    idempotencyKey: options.idempotencyKey,
  }, {
    dryRun: () => dryRunConnector(conn, action),
    call: () => executeConnectorAction(conn, action, args),
    idempotencyStore: {
      get: (key) => protocolCache.get(key),
      set: (key, value) => { protocolCache.set(key, value); },
    },
  });
  return { success: protocol.ok, output: formatProtocolResult(protocol), protocol };
}
