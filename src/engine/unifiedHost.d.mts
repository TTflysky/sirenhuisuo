export const UNIFIED_HOST_VERSION: 1;
export const UNIFIED_HOST_ENTRYPOINTS: readonly ['assistant', 'employee', 'team', 'worker', 'background'];
export function capabilityKindForTool(toolName?: string): string | undefined;
export function normalizeUnifiedHostRequest(input?: Record<string, any>): Record<string, any>;
export function evaluateCapabilityReadiness(matrix?: Record<string, any>, requiredCapabilities?: string[]): Record<string, any>;
export function buildUnifiedHostState(input?: Record<string, any>): Record<string, any>;
export function validateUnifiedHostRequest(input?: Record<string, any>): { valid: boolean; errors: string[]; request: Record<string, any> };
export function validateUnifiedHostAction(input?: Record<string, any>): { allowed: boolean; errors: string[]; reason: string; request: Record<string, any>; readiness: Record<string, any>; action: Record<string, any> };
