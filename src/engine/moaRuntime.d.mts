export function buildAdvisorMessages(input?: { goal?: string; assignment?: string; evidence?: unknown[] }): Array<{ role: 'system' | 'user'; content: string }>;
export function aggregateAdvisorGuidance(results?: Array<{ success?: boolean; label?: string; content?: string }>): { runtimeVersion: number; used: number; guidance: string; skipped: boolean };
export function shouldConsultAdvisors(input?: { disabled?: boolean; memberCount?: number; riskLevel?: string; stepKind?: string; requiredCapabilities?: unknown[] }): boolean;
export const TAIJI_MOA_RUNTIME_VERSION: number;
