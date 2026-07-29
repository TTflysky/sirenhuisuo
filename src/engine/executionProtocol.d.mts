export interface ExecutionProtocol { protocolVersion: number; name: string; stages: string[]; inputSchema: any; outputSchema: any; sideEffect: boolean; dryRunSupported: boolean; approvalRequired: boolean; idempotencyRequired: boolean; retryPolicy: { maxRetries: number; backoffMs: number }; }
export function createExecutionProtocol(input?: any): ExecutionProtocol;
export function validateExecutionInput(protocol: ExecutionProtocol, input: unknown): { ok: boolean; errors: string[] };
export function validateExecutionOutput(protocol: ExecutionProtocol, output: unknown): { ok: boolean; errors: string[] };
export function classifyExecutionFailure(error: unknown, stage?: string): { category: string; stage: string; message: string; retryable: boolean };
export function shouldRetryExecution(failure: { retryable?: boolean }, attempt: number, protocol: ExecutionProtocol): boolean;
export const EXECUTION_PROTOCOL_VERSION: number;
