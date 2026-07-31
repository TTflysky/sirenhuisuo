export type ResourceKind = 'web' | 'file' | 'attachment' | 'skill' | 'connector' | 'employee' | 'task';
export interface ResourceRef { kind: ResourceKind; id: string; locator: string; label?: string; source: string; metadata: Record<string, unknown> }
export interface ResourceContract { version: 1; operation: string; resources: ResourceRef[]; acquisitionRequired: boolean; evidenceRequired: boolean; substitutionAllowed: boolean }
export function normalizeWebUrl(value: unknown): string;
export function extractWebUrls(value: unknown): string[];
export function normalizeResourceRef(input: unknown): ResourceRef | undefined;
export function createResourceContract(input?: Record<string, unknown>): ResourceContract | undefined;
export function isWebContentTransformation(value: unknown): boolean;
export function createWebContentContract(goal: unknown, supplementalUrls?: unknown[]): ResourceContract | undefined;
export function resourceContractProgress(contract: ResourceContract | undefined, callLog?: unknown[]): Record<string, unknown>;
export function validateResourceToolCall(contract: ResourceContract | undefined, toolName: string, argumentsValue: unknown, callLog?: unknown[]): { allowed: boolean; reason: string };
export function assessResourceCompletion(contract: ResourceContract | undefined, callLog?: unknown[]): { passed: boolean; issues: string[]; progress?: Record<string, unknown> };
export function buildResourceGuidance(contract: ResourceContract | undefined): string;
