export interface ReleaseGateCheck {
  name: string;
  passed: boolean;
  durationMs?: number;
  detail?: string;
}

export interface ReleaseGate {
  gateVersion: number;
  expectedVersion: string;
  packageVersion: string;
  lockVersion: string;
  versionAligned: boolean;
  requiredFiles: Array<{ path: string; exists: boolean }>;
  checks: ReleaseGateCheck[];
  generatedAt: number;
}

export declare const RELEASE_GATE_CHECKS: string[];
export declare const RELEASE_GATE_VERSION: number;
export function createReleaseGate(input?: Partial<ReleaseGate>): ReleaseGate;
export function validateReleaseGate(gate: ReleaseGate, options?: { requiredChecks?: string[] }): { valid: boolean; errors: string[] };
