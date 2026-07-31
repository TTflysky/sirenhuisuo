export const MODEL_COMPATIBILITY_SCHEMA: number;
export const COMPATIBILITY_CAPABILITIES: readonly string[];
export interface ModelCompatibilityReport {
  schema: number;
  generatedAt: number;
  provider: string;
  model: string;
  baseUrl?: string;
  capabilities: Record<string, { capability: string; label: string; state: string; recoverable: boolean; nextAction?: string; error?: string }>;
  probes: Array<{ capability?: string; endpoint?: string; httpStatus?: number; state: string }>;
  status: 'compatible' | 'partial' | 'blocked';
  nextActions: string[];
}
export function classifyModelProbe(input?: Record<string, unknown>): { state: string; recoverable: boolean; capability: string; nextAction?: string; error?: string };
export function createCompatibilityReport(input?: Record<string, unknown>): ModelCompatibilityReport;
export function buildModelProbePlan(modelConfig?: Record<string, unknown>): Array<{ capability: string; method: string; endpoint: string; required: boolean }>;
export function probeModelCompatibility(modelConfig?: Record<string, unknown>, options?: Record<string, unknown>): Promise<ModelCompatibilityReport>;
