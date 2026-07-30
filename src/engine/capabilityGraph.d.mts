export type CapabilityId = 'ui_ux' | 'frontend' | 'backend' | 'architecture' | 'content' | 'research' | 'office_document' | 'connector' | 'skill' | 'coding' | 'review' | 'coordination';
export function normalizeCapabilityId(value: unknown): CapabilityId | '';
export function inferCapabilityIds(input: unknown, provided?: unknown[]): CapabilityId[];
export function employeeCapabilityProfile(member: any): CapabilityId[];
export function capabilityCoverage(member: any, requiredCapabilities?: unknown[]): { profile: CapabilityId[]; covered: CapabilityId[]; missing: CapabilityId[]; ratio: number };
export function selectCapabilityTeam(members: any[], input?: { request?: string; goal?: string; requiredCapabilities?: unknown[]; explicitMemberIds?: string[]; requiresTeam?: boolean; requiresReview?: boolean }): { graphVersion: number; requiredCapabilities: CapabilityId[]; selected: Array<{ employeeId: string; employeeName: string; capabilities: CapabilityId[]; covers: CapabilityId[]; reason: string }>; uncoveredCapabilities: CapabilityId[]; complete: boolean };
export function capabilityLabel(id: unknown): string;
export const TAIJI_CAPABILITY_GRAPH_VERSION: number;
export const TAIJI_CAPABILITIES: Readonly<Record<CapabilityId, { label: string; patterns: RegExp[] }>>;
