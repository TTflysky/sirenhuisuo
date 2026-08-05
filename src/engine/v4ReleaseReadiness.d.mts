export const V4_RELEASE_VERSION: '4.0.0';
export const V4_RELEASE_REQUIRED_ARTIFACTS: readonly string[];
export function createV4ReleaseChecklist(input?: Record<string, any>): Record<string, any>;
export function validateV4ReleaseChecklist(checklist: Record<string, any>, options?: { requireSignature?: boolean }): { valid: boolean; errors: string[]; warnings: string[]; checklist: Record<string, any> };
