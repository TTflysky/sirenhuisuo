import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTaskRuntimeStore } = require('../electron/taskRuntimeStore.cjs');

function makeRun(id, overrides = {}) {
  return {
    id,
    teamId: 'team-autonomous',
    conversationId: 'conversation-autonomous',
    workspaceId: `tasks/${id}`,
    request: 'Create and verify a real application',
    goal: 'Create and verify a real application',
    acceptanceCriteria: ['A real artifact exists', 'Runtime verification passes'],
    status: 'queued',
    memberSnapshot: [{ id: 'employee-one', name: 'Builder', title: 'Engineer', role: 'coder', capabilities: ['write_file', 'run_command'] }],
    steps: [{ id: 'step-one', employeeId: 'employee-one', title: 'Build', order: 1, kind: 'work', assignment: 'Build it', dependsOnStepIds: [], status: 'queued', attempts: 0, events: [] }],
    evidence: [{ ts: 10, source: 'tool', summary: 'Workspace was created', verified: true }],
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-autonomous-control-'));
try {
  const store = createTaskRuntimeStore(root);
  const legacy = makeRun('legacy-run');
  const created = await store.write([legacy], { source: 'autonomous-control-verifier' });
  assert.equal(created.ok, true);
  const first = await store.read({ taskId: 'legacy-run' });
  const run = first.runs[0];
  assert.equal(run.goalState.goalId, 'goal-legacy-run');
  assert.equal(run.goalState.conversationId, 'conversation-autonomous');
  assert.equal(run.autonomousControl.mode, 'adaptive');
  assert.equal(run.adaptivePlanGraph.graphVersion, 1);
  assert.equal(run.adaptivePlanGraph.revision, 1);
  assert.equal(run.autonomousControl.planRevision, run.adaptivePlanGraph.revision);
  assert.equal(run.autonomousControl.currentDecision.selectedAction.kind, 'start_step');
  assert.equal(run.workspaceId, legacy.workspaceId);
  assert.deepEqual(run.memberSnapshot, legacy.memberSnapshot);
  assert.deepEqual(run.steps, legacy.steps);
  assert.deepEqual(run.evidence, legacy.evidence);

  const goalId = run.goalState.goalId;
  const updated = await store.updateTask('legacy-run', (candidate) => {
    candidate.status = 'running';
    candidate.steps[0].status = 'running';
    candidate.steps[0].startedAt = 20;
  }, { source: 'autonomous-control-verifier' });
  assert.equal(updated.ok, true);
  assert.equal(updated.run.goalState.goalId, goalId);
  assert.equal(updated.run.autonomousControl.currentDecision.selectedAction.kind, 'continue_step');

  const evidenced = await store.updateTask('legacy-run', (candidate) => {
    candidate.artifacts = [{ id: 'artifact-live', path: 'app/index.html', verified: true, createdAt: 25 }];
    candidate.toolAttempts = [{ id: 'attempt-live', toolName: 'run_command', status: 'succeeded', outputSummary: 'runtime checks passed', finishedAt: 26 }];
    candidate.turnRuntime = {
      evidence: [{ evidenceId: 'turn-live', toolName: 'run_command', success: true, useful: true, summary: 'visual boundary checks passed', createdAt: 27 }],
      unresolvedIssues: [],
    };
  }, { source: 'autonomous-control-evidence-verifier' });
  assert.equal(evidenced.ok, true);
  assert.equal(evidenced.run.situationModel.artifacts.some((item) => item.path === 'app/index.html' && item.verified), true);
  assert.equal(evidenced.run.situationModel.confirmedFacts.some((item) => /runtime checks passed|visual boundary checks passed/u.test(item.statement)), true);

  const restarted = createTaskRuntimeStore(root);
  const recovered = await restarted.read({ taskId: 'legacy-run' });
  assert.equal(recovered.runs[0].goalState.goalId, goalId);
  assert.equal(recovered.runs[0].autonomousControl.currentDecision.selectedAction.kind, 'continue_step');

  const oldRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-autonomous-old-snapshot-'));
  try {
    await fs.writeFile(path.join(oldRoot, 'task-runs.json'), JSON.stringify({ schemaVersion: 1, runs: [makeRun('old-run')] }), 'utf8');
    await fs.writeFile(path.join(oldRoot, 'task-events.jsonl'), '', 'utf8');
    const migrated = await createTaskRuntimeStore(oldRoot).read({ taskId: 'old-run' });
    assert.equal(migrated.runs[0].goalState.goalId, 'goal-old-run');
    assert.equal(migrated.runs[0].autonomousControl.controlVersion, 2);
    assert.equal(migrated.runs[0].adaptivePlanGraph.graphVersion, 1);
    assert.deepEqual(migrated.runs[0].steps, makeRun('old-run').steps);
  } finally {
    await fs.rm(oldRoot, { recursive: true, force: true });
  }

  const teamChatSource = await fs.readFile(path.join(process.cwd(), 'src/components/chat/TeamChatApp.tsx'), 'utf8');
  assert.match(teamChatSource, /renderAutonomousSummary/u);
  assert.match(teamChatSource, /control\.publicSummary/u);
  assert.doesNotMatch(teamChatSource, /chainOfThought|hiddenReasoning/u);

  console.log(JSON.stringify({ passed: true, goalId, decision: recovered.runs[0].autonomousControl.currentDecision.selectedAction.kind }));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
