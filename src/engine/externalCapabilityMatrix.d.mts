export type ExternalCapabilityKind = 'chat_model' | 'image_generation' | 'web_page' | 'skillhub' | 'knowledge_base' | 'email' | 'github' | 'generic_http' | 'mcp';
export type ExternalCapabilityState = 'missing_config' | 'not_tested' | 'available' | 'authentication_failed' | 'rate_limited' | 'protocol_error' | 'invalid_content' | 'unavailable';
export interface ExternalCapabilityProfile { id: string; kind: ExternalCapabilityKind; label: string; source?: string; configured: boolean; resourceIdentity?: string; }
export interface ExternalCapabilityEntry extends ExternalCapabilityProfile { state: ExternalCapabilityState; checkedAt: number; lastHttpStatus?: number; lastDetail?: string; recoveryCount: number; recoveredAt?: number; evidence: { configured: boolean; invoked: boolean; response: boolean; validated: boolean; recovered: boolean }; history: Array<Record<string, unknown>>; }
export interface ExternalCapabilityMatrix { schema: number; updatedAt: number; entries: Record<string, ExternalCapabilityEntry>; }
export const EXTERNAL_CAPABILITY_MATRIX_SCHEMA: number;
export const EXTERNAL_CAPABILITY_KINDS: readonly ExternalCapabilityKind[];
export const EXTERNAL_CAPABILITY_STATES: readonly ExternalCapabilityState[];
export function sanitizeCapabilityEvidence(value: unknown, max?: number): string;
export function sanitizeResourceIdentity(value: unknown): string | undefined;
export function completeExternalCapabilityProfiles(profiles?: ExternalCapabilityProfile[], labels?: Partial<Record<ExternalCapabilityKind, string>>): ExternalCapabilityProfile[];
export function createExternalCapabilityMatrix(profiles?: ExternalCapabilityProfile[], seed?: Partial<ExternalCapabilityMatrix>): ExternalCapabilityMatrix;
export function classifyExternalCapabilityProbe(input?: Record<string, unknown>): ExternalCapabilityState;
export function applyExternalCapabilityProbe(matrix: ExternalCapabilityMatrix, event?: Record<string, any>): ExternalCapabilityMatrix;
export function summarizeExternalCapabilityMatrix(matrix: ExternalCapabilityMatrix): { total: number; available: number; missingConfig: number; notTested: number; blocked: number; recovered: number };
