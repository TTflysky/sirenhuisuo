import type { ToolDef } from './tools';
import type { Connector, ConnectorAction } from '../data/connectors';
import { loadConnectors, executeConnectorAction, CONNECTOR_PRESETS } from '../data/connectors';

function actionsFor(conn: Connector): ConnectorAction[] {
  const presetActions = CONNECTOR_PRESETS.find(p => p.mcpServerName === conn.mcpServerName)?.actions ?? [];
  const discoveredActions = conn.discoveredActions ?? [];
  const actions = [...presetActions.filter(action => action.http), ...discoveredActions];
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

export async function executeConnectorTool(toolNameInput: string, args: Record<string, string>): Promise<{ success: boolean; output: string }> {
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
  if (!action.http) return { success: false, output: `连接器 ${conn.label} 未配置可执行 HTTP action，且项目内 MCP runtime 不可用` };
  try { return { success: true, output: await executeConnectorAction(conn, action, args) }; }
  catch (e: any) { return { success: false, output: `连接器 "${conn.label}" 执行失败: ${e?.message ?? '未知错误'}` }; }
}
