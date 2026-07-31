export type CodingProjectStage = {
  id: string;
  role: string;
  title: string;
  ownerEmployeeId?: string;
  dependsOn: string[];
  kind: 'work' | 'review';
  assignment: string;
  deliverableType: 'answer' | 'file' | 'connection' | 'operation' | 'decision' | 'mixed';
  acceptanceCriteria: string[];
};
export type CodingProject = { codingProjectVersion: number; goal: string; stages: CodingProjectStage[]; staffingGaps: Array<Record<string, string>>; status: 'ready' | 'needs_staffing' };
export function compileCodingProject(input?: Record<string, unknown>): CodingProject;
export function codingProjectToTaskSteps(project: CodingProject): Array<Record<string, unknown>>;
export function addCodingProjectMember(project: CodingProject, input?: Record<string, unknown>): CodingProject;
