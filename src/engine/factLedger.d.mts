export interface FactObservation {
  observationId: string; factKey: string; statement: string; statementFingerprint: string;
  source: string; sourceId?: string; evidenceIds: string[]; verified: boolean; confidence: number; at: number;
}
export interface FactVersion {
  id: string; factKey: string; version: number; statement: string; statementFingerprint: string;
  status: 'current' | 'superseded' | 'rejected'; verified: boolean; confidence: number;
  sources: string[]; observationIds: string[]; evidenceIds: string[]; firstObservedAt: number; lastObservedAt: number;
  observationCount: number; createdAt: number;
}
export interface FactConflict {
  id: string; factKey: string; status: 'open' | 'resolved'; resolution?: string; requiresUser: boolean;
  previousFactId: string; previousVersion: number; previousStatement: string; previousEvidenceIds: string[];
  latestFactId: string; latestVersion: number; latestStatement: string; latestEvidenceIds: string[];
  detectedAt: number; updatedAt: number; resolvedAt?: number; resolvedBy?: string;
}
export interface FactLedger { ledgerVersion: number; factVersions: FactVersion[]; conflicts: FactConflict[]; updatedAt: number }
export const FACT_LEDGER_VERSION: number;
export function createFactLedger(input?: { snapshot?: FactLedger; observations?: Partial<FactObservation>[]; now?: number }): FactLedger;
export function recordFactObservation(snapshot: FactLedger | undefined, input?: Partial<FactObservation>, options?: { now?: number }): { ledger: FactLedger; observation: FactObservation; action: 'added' | 'confirmed' | 'conflict'; fact: FactVersion; conflict?: FactConflict };
export function resolveFactConflict(snapshot: FactLedger, conflictId: string, resolution: 'accept_latest' | 'keep_previous' | 'accept_both' | 'dismiss', options?: { now?: number; resolvedBy?: string }): FactLedger;
export function openFactConflicts(snapshot: FactLedger): FactConflict[];
export function factLedgerSummary(snapshot: FactLedger): Record<string, number>;
