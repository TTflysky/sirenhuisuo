export interface NormalizedSkillEvidence { ts: number; skillId?: string; skillName?: string; action: 'matched' | 'read' | 'read-failed' | 'searched' | 'installed' | 'called' | 'produced' | 'accepted' | 'rejected' | 'skipped'; toolName?: string; reason?: string; detail?: string; verified: boolean; stage: string; score?: number; source: string; }
export function normalizeSkillEvidence(input?: any): NormalizedSkillEvidence;
export function appendSkillEvidence(events: any[], input?: any): NormalizedSkillEvidence[];
export function summarizeSkillEvidence(events: any[]): { total: number; matched: number; read: number; failed: number; called: number; produced: number; accepted: number; verified: number; latest: NormalizedSkillEvidence[] };
export function buildSkillLifecycle(events: any[], skillId?: string): { stages: { discovery: boolean; rules: boolean; invocation: boolean; output: boolean; acceptance: boolean }; usable: boolean; latest: NormalizedSkillEvidence[] };
export const SKILL_EVIDENCE_VERSION: number;
