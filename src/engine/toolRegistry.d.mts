export const TOOL_REGISTRY_PROTOCOL_VERSION: number;
export interface ToolRegistryRecord {
  name: string;
  definition: any;
  source: 'builtin' | 'connector' | 'skill' | string;
  capability: string;
  runtime: string;
  risk: 'read' | 'write' | 'system' | 'external' | string;
  approval: 'none' | 'policy' | string;
  health: string;
  healthMessage: string;
  schemaFingerprint: string;
}
export interface ToolRegistry {
  protocolVersion: number;
  records: ToolRegistryRecord[];
  definitions: any[];
  invalid: Array<{ name: string; errors: string[] }>;
  collisions: string[];
  ready: number;
  blocked: number;
}
export function buildToolRegistry(definitions?: any[], options?: { metadata?: Record<string, Partial<ToolRegistryRecord>> }): ToolRegistry;
export function discoverTools(registry: ToolRegistry, query?: string): Array<ToolRegistryRecord & { score: number }>;
export function preflightToolCall(registry: ToolRegistry, name: string, args: unknown, options?: { approvalGranted?: boolean; enforceApproval?: boolean }): { ok: boolean; protocolVersion: number; name: string; stage: string; category: string; message: string; record?: ToolRegistryRecord; requiresApproval?: boolean };
export function toolRegistrySnapshot(registry: ToolRegistry): { protocolVersion: number; ready: number; blocked: number; collisions: string[]; invalid: Array<{ name: string; errors: string[] }>; tools: Array<Omit<ToolRegistryRecord, 'definition'>> };
