import { executeTool, type ToolCall, type ToolResult } from './tools';

export function executeAgentTool(call: ToolCall): Promise<ToolResult> {
  return executeTool(call);
}
