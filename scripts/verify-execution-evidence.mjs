import assert from 'node:assert/strict';
import {
  createFileArtifactEvidence,
  createReviewSubmissionEvidence,
  createToolExecutionEvidence,
  validateFileArtifactEvidence,
  validateReviewSubmissionEvidence,
} from '../src/engine/executionEvidence.mjs';

const artifact = createFileArtifactEvidence({
  path: 'reports/final.md', workspaceId: 'tasks/team/example', diskPath: 'C:/workspace/reports/final.md',
  bytes: 128, contentType: 'markdown', category: 'final', persistence: 'disk', verification: 'read_back', verified: true,
});
assert.equal(validateFileArtifactEvidence(artifact).valid, true);
assert.equal(artifact.filename, 'final.md');
assert.equal(createFileArtifactEvidence({ path: 'only-renderer.md', verified: true }).verified, false);

const review = createReviewSubmissionEvidence({
  decision: 'reject', reason: '缺少运行证据', responsibleStepId: 'build', responsibleEmployeeId: 'coder', checkedArtifacts: ['reports/final.md'],
});
assert.equal(validateReviewSubmissionEvidence(review).valid, true);
assert.equal(review.decision, 'reject');
assert.equal(validateReviewSubmissionEvidence({ ...review, reason: '' }).valid, false);

const envelope = createToolExecutionEvidence({ artifacts: [artifact], review });
assert.equal(envelope.evidenceVersion, 1);
assert.equal(envelope.artifacts?.[0].verified, true);
assert.equal(envelope.review?.responsibleStepId, 'build');

console.log(JSON.stringify({ passed: true, artifact: artifact.filename, persistence: artifact.persistence, decision: review.decision }));
