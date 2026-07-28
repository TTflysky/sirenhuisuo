export interface FileArtifactEvidence {
  artifactVersion: 1;
  path: string;
  filename: string;
  workspaceId: string;
  diskPath?: string;
  bytes?: number;
  contentType: string;
  category: 'final' | 'working' | 'reference';
  persistence: 'disk' | 'renderer';
  verification: 'read_back' | 'write_ack' | 'registered_only';
  verified: boolean;
  recordedAt: number;
}

export interface ReviewSubmissionEvidence {
  reviewVersion: 1;
  decision: 'pass' | 'reject';
  reason: string;
  responsibleStepId?: string;
  responsibleEmployeeId?: string;
  checkedArtifacts: string[];
  submittedAt: number;
}

export interface ToolExecutionEvidence {
  evidenceVersion: 1;
  artifacts?: FileArtifactEvidence[];
  review?: ReviewSubmissionEvidence;
}

export function createFileArtifactEvidence(input?: Partial<FileArtifactEvidence>): FileArtifactEvidence;
export function validateFileArtifactEvidence(value: unknown): { valid: boolean; errors: string[] };
export function createReviewSubmissionEvidence(input?: Partial<ReviewSubmissionEvidence>): ReviewSubmissionEvidence;
export function validateReviewSubmissionEvidence(value: unknown): { valid: boolean; errors: string[] };
export function createToolExecutionEvidence(input?: Partial<ToolExecutionEvidence>): ToolExecutionEvidence;
export const TOOL_EXECUTION_EVIDENCE_VERSION: number;
