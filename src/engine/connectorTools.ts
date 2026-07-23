import type { ToolDef } from './tools';
import type { Connector, ConnectorAction } from '../data/connectors';
import { loadConnectors, executeConnectorAction, CONNECTOR_PRESETS } from '../data/connectors';

/** 根据已启用的连接器生成 OpenAI 工具定义 */
export function getConnectorTools(): ToolDef[] {
  const connectors = loadConnectors().filter(c => c.enabled && c.status === 'connected');
  if (connectors.length === 0) return [];

  const tools: ToolDef[] = [];
  for (const conn of connectors) {
    const preset = CONNECTOR_PRESETS.find(p => p.mcpServerName === conn.mcpServerName);
    if (!preset || !preset.actions.length) continue;

    for (const action of preset.actions) {
      tools.push({
        type: 'function' as const,
        function: {
          name: `connector_${action.name}`,
          description: `[${conn.label}] ${action.description}`,
          parameters: action.parameters,
        },
      });
    }
  }
  return tools;
}

/** 执行连接器工具调用 */
export async function executeConnectorTool(
  toolName: string,
  args: Record<string, string>,
): Promise<{ success: boolean; output: string }> {
  // 去掉 connector_ 前缀
  const actionName = toolName.replace(/^connector_/, '');
  const connectors = loadConnectors().filter(c => c.enabled);

  // 查找匹配的连接器和操作
  for (const conn of connectors) {
    const preset = CONNECTOR_PRESETS.find(p => p.mcpServerName === conn.mcpServerName);
    if (!preset) continue;
    const action = preset.actions.find(a => a.name === actionName);
    if (!action) continue;

    try {
      const output = await executeConnectorAction(conn, action, args);
      return { success: true, output };
    } catch (e: any) {
      return { success: false, output: `连接器 "${conn.label}" 执行失败: ${e?.message ?? '未知错误'}` };
    }
  }

  return { success: false, output: `未找到匹配的连接器操作: ${actionName}` };
}
