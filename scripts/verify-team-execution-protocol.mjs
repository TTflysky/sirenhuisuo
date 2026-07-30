import assert from 'node:assert/strict';
import {
  TEAM_EXECUTION_PROTOCOL_VERSION,
  classifyTeamRetry,
  createArtifactIndex,
  createExecutionSyncEnvelope,
  createRecoveryPlan,
  createReviewRevision,
  createTeamExecutionProtocol,
  decideCapabilityUse,
  projectTeamExecutionEvent,
  shouldApplyExecutionSync,
  summarizeTeamExecution,
  validateTeamExecutionProtocol,
} from '../src/engine/teamExecutionProtocol.mjs';

const protocol = createTeamExecutionProtocol({
  teamId: 'team-a', teamName: '脚本团队', runId: 'run-a', goal: '完成一份脚本',
  members: [
    { id: 'writer', name: '编剧', role: 'coder', model: 'model-writer' },
    { id: 'checker', name: '审查者', role: 'checker', model: 'model-checker' },
  ],
  steps: [
    { id: 'draft', employeeId: 'writer', title: '起草脚本', kind: 'work', dependsOnStepIds: [] },
    { id: 'review', employeeId: 'checker', title: '审查脚本', kind: 'review', dependsOnStepIds: ['draft'] },
  ],
});
assert.equal(TEAM_EXECUTION_PROTOCOL_VERSION, 1);
assert.equal(validateTeamExecutionProtocol(protocol).valid, true);
assert.match(protocol.kickoff.content, /任务简报/u);
assert.match(protocol.kickoff.content, /@编剧/u);
assert.doesNotMatch(protocol.kickoff.content, /需求复述/u);
assert.deepEqual(protocol.members.map((member) => member.model), ['model-writer', 'model-checker']);

const started = projectTeamExecutionEvent(protocol, { type: 'step_started', stepId: 'draft', employeeId: 'writer', tool: 'write_file' });
assert.equal(started.status, 'running');
assert.equal(started.employeeStates.writer.status, 'working');
assert.equal(started.employeeStates.writer.currentTool, 'write_file');
assert.equal(summarizeTeamExecution(started, started.updatedAt).activeDurationMs >= 0, true);
const failed = projectTeamExecutionEvent(started, { type: 'step_failed', stepId: 'draft', employeeId: 'writer', detail: 'network timeout' });
assert.equal(failed.steps[0].status, 'failed');
assert.equal(failed.employeeStates.writer.status, 'failed');
assert.equal(classifyTeamRetry({ category: 'timeout', attempt: 1, maxRetries: 3 }).action, 'retry_same_route');
assert.equal(classifyTeamRetry({ category: 'invalid_input', attempt: 1 }).action, 'block');
assert.equal(createRecoveryPlan(failed, { stepId: 'draft' }).status, 'ready');
assert.equal(createRecoveryPlan(projectTeamExecutionEvent(failed, { type: 'step_failed', stepId: 'review', employeeId: 'checker', detail: 'blocked' }), { stepId: 'review' }).status, 'waiting_dependency');

const revision = createReviewRevision({ reviewStepId: 'review', responsibleStepId: 'draft', responsibleEmployeeId: 'writer', reason: '补齐验收标准' });
assert.equal(revision.ok, true);
assert.equal(revision.revisionOfStepId, 'draft');
assert.equal(decideCapabilityUse({ capability: 'web_search', selected: false, used: false }).decision, 'not_needed');
assert.equal(decideCapabilityUse({ capability: 'web_search', selected: true, used: true, evidence: ['source-1'] }).decision, 'used');

const artifacts = createArtifactIndex([
  { path: 'draft.md', filename: 'draft.md', teamId: 'team-a', category: 'working', persistence: 'disk', verified: true },
  { path: 'final.md', filename: 'final.md', teamId: 'team-a', category: 'final', persistence: 'disk', verified: true },
  { path: 'chat-message.txt', filename: 'chat-message.txt', teamId: 'team-a', category: 'working', persistence: 'renderer', verified: false },
], { teamId: 'team-a' });
assert.deepEqual(artifacts.map((item) => item.path), ['draft.md', 'final.md', 'chat-message.txt']);
assert.equal(artifacts.find((item) => item.path === 'final.md').verified, true);

const envelope = createExecutionSyncEnvelope({ teamId: 'team-a', runId: 'run-a', sequence: 4, payload: { status: 'running' } });
assert.equal(shouldApplyExecutionSync({ teamId: 'team-a', sequence: 3 }, envelope), true);
assert.equal(shouldApplyExecutionSync({ teamId: 'team-b', sequence: 0 }, envelope), false);

console.log(JSON.stringify({ passed: true, version: TEAM_EXECUTION_PROTOCOL_VERSION, sequence: failed.sequence, kickoffMentions: protocol.kickoff.mentions.length, artifacts: artifacts.length }));
