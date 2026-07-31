export interface ExplicitResourceContract {
  kind: 'web-content';
  operation: 'read-transform';
  urls: string[];
  requiredTool: 'read_web_page';
}
export interface ExplicitResourceCall { name: string; args?: string | Record<string, unknown>; arguments?: string | Record<string, unknown>; success?: boolean }
export function normalizeExplicitUrl(value: unknown): string;
export function extractExplicitUrls(value: unknown): string[];
export function isExplicitWebContentRequest(value: unknown): boolean;
export function createExplicitResourceContract(goal: unknown, supplementalUrls?: unknown[]): ExplicitResourceContract | undefined;
export function explicitResourceProgress(contract: ExplicitResourceContract | undefined, callLog?: ExplicitResourceCall[]): { attemptedUrls: string[]; succeededUrls: string[]; failedUrls: string[]; complete: boolean };
export function validateExplicitResourceToolCall(contract: ExplicitResourceContract | undefined, toolName: string, argumentsValue: unknown, callLog?: ExplicitResourceCall[]): { allowed: boolean; reason: string };
export function assessExplicitResourceCompletion(contract: ExplicitResourceContract | undefined, callLog?: ExplicitResourceCall[]): { passed: boolean; issues: string[]; progress?: { attemptedUrls: string[]; succeededUrls: string[]; failedUrls: string[]; complete: boolean } };
export function buildExplicitResourceGuidance(contract: ExplicitResourceContract | undefined): string;
