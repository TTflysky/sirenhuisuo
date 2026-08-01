export const MODEL_RELIABILITY_VERSION: number;
export const MODEL_FAILURE_CLASSES: readonly string[];
export const TRANSIENT_MODEL_FAILURES: readonly string[];
export interface ModelReliabilityRegistry { version: number; updatedAt: number; models: Record<string, Record<string, unknown>>; }
export function modelKey(config?: unknown): string;
export function createModelReliabilityRegistry(seed?: unknown): ModelReliabilityRegistry;
export function startModelAttempt(registry: ModelReliabilityRegistry, key: string, now?: number): Record<string, unknown>;
export function getModelAdmission(registry: ModelReliabilityRegistry, key: string, now?: number, options?: Record<string, unknown>): Record<string, unknown> & { allowed: boolean };
export function classifyModelFailure(input?: Record<string, unknown>): string;
export function recordModelFirstToken(registry: ModelReliabilityRegistry, key: string, firstTokenMs: number, now?: number): Record<string, unknown>;
export function recordModelAttempt(registry: ModelReliabilityRegistry, event?: Record<string, unknown>): Record<string, unknown>;
export function nextModelBackoffMs(attempt?: number, failureClass?: string, options?: Record<string, unknown>): number;
export function getModelRecoveryAdvice(registry: ModelReliabilityRegistry, key: string, alternatives?: unknown[], now?: number): Record<string, unknown>;
export function summarizeModelReliability(registry: ModelReliabilityRegistry): Array<Record<string, unknown>>;
