export interface GatewayToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ModelOutputDiagnostics {
  gatewayVersion: number;
  protocol: string;
  controlDetected: boolean;
  parseStatus: string;
  fatal: boolean;
  toolCallCount: number;
  errors: string[];
  rawContentLength: number;
  toolsEnabled: boolean;
}

export function normalizeModelMessage(
  message?: Record<string, unknown>,
  options?: { toolsEnabled?: boolean },
): {
  message: Record<string, unknown> & { content: string | null; tool_calls?: GatewayToolCall[] };
  content: string | null;
  toolCalls: GatewayToolCall[];
  diagnostics: ModelOutputDiagnostics;
};

export function createStreamingContentFilter(
  onTextDelta?: (delta: string, accumulated: string) => void,
): {
  push(delta: string): void;
  finish(): string;
  readonly raw: string;
};

export function hasModelProtocolMarkers(value: unknown): boolean;
