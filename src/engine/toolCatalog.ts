import { TOOLS, type ToolDef } from './tools';
import { getConnectorTools } from './connectorTools';
import { buildToolRegistry, discoverTools, toolRegistrySnapshot } from './toolRegistry.mjs';

export function getToolRegistry(query = '') {
  const registry = buildToolRegistry([...TOOLS, ...getConnectorTools()]);
  return { registry, discovered: discoverTools(registry, query) };
}

export function getRegisteredTools(): ToolDef[] {
  return getToolRegistry().registry.definitions as ToolDef[];
}

export function getToolRegistrySnapshot() {
  return toolRegistrySnapshot(getToolRegistry().registry);
}
