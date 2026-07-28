const EVIDENCE_VERSION = 1;

function text(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

function list(value, max = 20) {
  return Array.isArray(value) ? value.map((item) => text(item, 500)).filter(Boolean).slice(0, max) : [];
}

export function createFileArtifactEvidence(input = {}) {
  const path = text(input.path, 800).replace(/\\/gu, '/');
  const category = ['final', 'working', 'reference'].includes(input.category) ? input.category : 'working';
  const persistence = input.persistence === 'disk' ? 'disk' : 'renderer';
  const verification = ['read_back', 'write_ack', 'registered_only'].includes(input.verification)
    ? input.verification
    : persistence === 'disk' ? 'write_ack' : 'registered_only';
  const diskPath = text(input.diskPath, 1200) || undefined;
  return {
    artifactVersion: EVIDENCE_VERSION,
    path,
    filename: text(input.filename, 260) || path.split('/').pop() || path,
    workspaceId: text(input.workspaceId, 500) || 'global',
    diskPath,
    bytes: Number.isFinite(input.bytes) ? Math.max(0, Number(input.bytes)) : undefined,
    contentType: text(input.contentType, 80) || 'text',
    category,
    persistence,
    verification,
    verified: input.verified === true && persistence === 'disk' && Boolean(diskPath),
    recordedAt: Number.isFinite(input.recordedAt) ? Number(input.recordedAt) : Date.now(),
  };
}

export function validateFileArtifactEvidence(value) {
  const errors = [];
  if (!value || typeof value !== 'object') return { valid: false, errors: ['artifact must be an object'] };
  if (value.artifactVersion !== EVIDENCE_VERSION) errors.push(`artifactVersion must be ${EVIDENCE_VERSION}`);
  if (!text(value.path, 800)) errors.push('path is required');
  if (!text(value.filename, 260)) errors.push('filename is required');
  if (!text(value.workspaceId, 500)) errors.push('workspaceId is required');
  if (!['final', 'working', 'reference'].includes(value.category)) errors.push('category is invalid');
  if (!['disk', 'renderer'].includes(value.persistence)) errors.push('persistence is invalid');
  if (!['read_back', 'write_ack', 'registered_only'].includes(value.verification)) errors.push('verification is invalid');
  if (value.verified === true && value.persistence !== 'disk') errors.push('verified artifacts must be persisted to disk');
  if (value.verified === true && !text(value.diskPath, 1200)) errors.push('verified artifacts must include diskPath');
  return { valid: errors.length === 0, errors };
}

export function createReviewSubmissionEvidence(input = {}) {
  const decision = String(input.decision ?? '').toLowerCase() === 'pass' ? 'pass' : 'reject';
  return {
    reviewVersion: EVIDENCE_VERSION,
    decision,
    reason: text(input.reason),
    responsibleStepId: text(input.responsibleStepId, 160) || undefined,
    responsibleEmployeeId: text(input.responsibleEmployeeId, 160) || undefined,
    checkedArtifacts: list(input.checkedArtifacts),
    submittedAt: Number.isFinite(input.submittedAt) ? Number(input.submittedAt) : Date.now(),
  };
}

export function validateReviewSubmissionEvidence(value) {
  const errors = [];
  if (!value || typeof value !== 'object') return { valid: false, errors: ['review must be an object'] };
  if (value.reviewVersion !== EVIDENCE_VERSION) errors.push(`reviewVersion must be ${EVIDENCE_VERSION}`);
  if (!['pass', 'reject'].includes(value.decision)) errors.push('decision is invalid');
  if (!text(value.reason)) errors.push('reason is required');
  if (!Array.isArray(value.checkedArtifacts)) errors.push('checkedArtifacts must be an array');
  return { valid: errors.length === 0, errors };
}

export function createToolExecutionEvidence(input = {}) {
  const artifacts = Array.isArray(input.artifacts) ? input.artifacts.map(createFileArtifactEvidence) : undefined;
  const review = input.review ? createReviewSubmissionEvidence(input.review) : undefined;
  return {
    evidenceVersion: EVIDENCE_VERSION,
    artifacts: artifacts?.length ? artifacts : undefined,
    review,
  };
}

export const TOOL_EXECUTION_EVIDENCE_VERSION = EVIDENCE_VERSION;
