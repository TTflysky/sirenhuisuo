export type ConnectorProtocolStage = 'validate-input' | 'permission' | 'idempotency' | 'dry-run' | 'call' | 'validate-output' | 'completed';
export type ConnectorErrorCategory = 'authentication' | 'permission' | 'rate-limit' | 'timeout' | 'network' | 'server' | 'validation' | 'configuration' | 'unknown';

export interface ConnectorProtocolEvent {
  stage: ConnectorProtocolStage;
  ok: boolean;
  ts: number;
  detail: string;
}

export interface ConnectorProtocolResult {
  protocolVersion: number;
  connectorId: string;
  connectorLabel: string;
  action: string;
  stage: ConnectorProtocolStage;
  ok: boolean;
  dryRun: boolean;
  sideEffect: boolean;
  idempotencyKey?: string;
  idempotencyHit: boolean;
  startedAt: number;
  completedAt: number;
  latencyMs: number;
  input: unknown;
  output?: unknown;
  dryRunResult?: unknown;
  error?: { category: ConnectorErrorCategory; retryable: boolean; message: string };
  events: ConnectorProtocolEvent[];
}

export interface ConnectorProtocolInput {
  connectorId: string;
  connectorLabel?: string;
  actionName: string;
  action: Record<string, any>;
  args: Record<string, unknown>;
  permissionGranted?: boolean;
  dryRunOnly?: boolean;
  idempotencyKey?: string;
  idempotencyTtlMs?: number;
}

export interface ConnectorProtocolAdapters {
  now?: () => number;
  checkPermission?: (input: ConnectorProtocolInput) => boolean | { allowed: boolean; reason?: string } | Promise<boolean | { allowed: boolean; reason?: string }>;
  dryRun: (input: ConnectorProtocolInput) => unknown | Promise<unknown>;
  call: (input: ConnectorProtocolInput) => unknown | Promise<unknown>;
  validateOutput?: (output: unknown, input: ConnectorProtocolInput) => boolean | { ok: boolean; errors?: string[] } | Promise<boolean | { ok: boolean; errors?: string[] }>;
  idempotencyStore?: {
    get: (key: string) => ConnectorProtocolResult | undefined | Promise<ConnectorProtocolResult | undefined>;
    set: (key: string, value: ConnectorProtocolResult) => void | Promise<void>;
  };
}

export function redactConnectorValue(value: unknown, key?: string): unknown;
export function createConnectorIdempotencyKey(input: Pick<ConnectorProtocolInput, 'connectorId' | 'actionName' | 'args'>): string;
export function validateConnectorSchema(value: unknown, schema: Record<string, any>): { ok: boolean; errors: string[] };
export function classifyConnectorError(error: unknown): { category: ConnectorErrorCategory; retryable: boolean; message: string };
export function connectorActionHasSideEffect(action?: Record<string, any>): boolean;
export function executeConnectorProtocol(input: ConnectorProtocolInput, adapters: ConnectorProtocolAdapters): Promise<ConnectorProtocolResult>;
export const CONNECTOR_PROTOCOL_VERSION: number;
