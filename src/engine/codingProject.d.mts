export type CodingArtifactContract = { type: string; required: string[] };
export type CodingArtifact = { id: string; type: string; verified: boolean; data?: Record<string, unknown>; registeredAt: number; [key: string]: unknown };
export type CodingProjectStage = {
  id: string; role: string; title: string; ownerEmployeeId?: string; ownerName?: string; requiredCapability: string;
  dependsOn: string[]; kind: 'work' | 'review'; status: 'queued' | 'running' | 'completed' | 'failed';
  assignment: string; deliverableType: 'answer' | 'file' | 'connection' | 'operation' | 'decision' | 'mixed';
  acceptanceCriteria: string[]; artifactContract: CodingArtifactContract; artifacts: CodingArtifact[]; reworkReason?: string;
};
export type CodingProject = {
  codingProjectVersion: number; goal: string; stages: CodingProjectStage[];
  staffingGaps: Array<Record<string, string>>; status: 'ready' | 'needs_staffing'; revision?: number;
  teamChanges?: Array<Record<string, unknown>>; artifactRegistry?: Array<CodingArtifact & { stageId: string }>;
  reworkHistory?: Array<Record<string, unknown>>;
};
export function createCodingProjectTaskDecision(goal: string, decision?: Partial<import('./taskDecisionKernel.mjs').TaskDecision>): import('./taskDecisionKernel.mjs').TaskDecision;
export function compileCodingProject(input?: Record<string, unknown>): CodingProject;
export function codingProjectToTaskSteps(project: CodingProject): Array<Record<string, unknown>>;
export function addCodingProjectMember(project: CodingProject, input?: Record<string, unknown>): CodingProject;
export function replaceCodingProjectOwner(project: CodingProject, input?: Record<string, unknown>): CodingProject;
export function registerCodingArtifact(project: CodingProject, input?: Record<string, unknown>): CodingProject;
export function validateCodingStageArtifacts(project: CodingProject, stageId: string): { passed: boolean; missing: string[]; verifiedArtifacts: CodingArtifact[] };
export function reopenCodingProjectResponsibility(project: CodingProject, input?: Record<string, unknown>): CodingProject;
