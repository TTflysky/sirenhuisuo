import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createTaskRuntimeStore } from '../electron/taskRuntimeStore.cjs';
import { buildTaskReplay, searchTaskRunHistory } from '../src/engine/taskHistory.mjs';

const now = Date.now();

function makeRun({ id, projectId, conversationId, title = 'risk dashboard', status = 'completed' }) {
  return {
    id,
    teamId: 'team-v54',
    projectId,
    conversationId,
    title,
    request: `Build ${title}`,
    goal: `Build ${title}`,
    status,
    phase: status === 'completed' ? 'completed' : 'executing',
    createdAt: now,
    updatedAt: now,
    memberSnapshot: [{ id: 'builder', name: 'Builder', title: 'Builder', role: 'custom' }],
    steps: [{
      id: `${id}-step-1`,
      employeeId: 'builder',
      title: 'Build',
      assignment: `Implement ${title}`,
      dependsOnStepIds: [],
      status: 'queued',
      attempts: 0,
      events: [],
      evidence: [],
    }],
    sourceAttachments: [{
      name: 'brief.png',
      mime: 'image/png',
      kind: 'image',
      size: 2048,
      workspacePath: `uploads/${id}/brief.png`,
    }],
  };
}

const current = makeRun({ id: 'run-current', projectId: 'project-a', conversationId: 'chat-a' });
const sameProjectOtherChat = makeRun({ id: 'run-other-chat', projectId: 'project-a', conversationId: 'chat-b' });
const otherProject = makeRun({ id: 'run-other-project', projectId: 'project-b', conversationId: 'chat-c' });
const matches = searchTaskRunHistory(
  [current, sameProjectOtherChat, otherProject],
  'risk dashboard',
  { teamId: 'team-v54', projectId: 'project-a', conversationId: 'chat-a', limit: 10 },
);
assert.deepEqual(matches.map((item) => item.taskId), ['run-current'], 'history search must stay inside the active project and conversation');

const replay = buildTaskReplay(current, []);
assert.ok(replay, 'task replay must be created');
assert.equal(replay.projectId, 'project-a');
assert.equal(replay.conversationId, 'chat-a');
assert.equal(replay.attachments.length, 1);
assert.equal(replay.attachments[0].workspacePath, 'uploads/run-current/brief.png');
assert.equal(replay.attachments[0].available, true);

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-v54-'));
try {
  const child = makeRun({ id: 'child-current', projectId: 'project-a', conversationId: 'chat-a', title: 'risk implementation' });
  child.parentTaskId = current.id;
  child.steps[0].responsibilityTaskId = 'responsibility-child-current';
  const firstStore = createTaskRuntimeStore(rootDir, { checkpointDebounceMs: 0 });
  const writeResult = await firstStore.write([current, child], { source: 'v54-test', sessionId: 'v54-test' });
  assert.equal(writeResult.ok, true);
  await firstStore.updateTask(current.id, (task) => {
    task.status = 'running';
    task.phase = 'executing';
    task.steps[0].status = 'completed';
    task.steps[0].responsibilityTaskId = 'responsibility-current';
    task.steps[0].executionBinding = {
      kind: 'team-step',
      rootTaskId: current.id,
      sourceStepId: task.steps[0].id,
      childTaskId: 'responsibility-current',
      employeeId: 'builder',
    };
  }, { source: 'v54-test', detail: 'Persist completed step and responsibility binding' });

  const secondStore = createTaskRuntimeStore(rootDir, { checkpointDebounceMs: 0 });
  const restored = await secondStore.read({ projectId: 'project-a', conversationId: 'chat-a', limit: 20 });
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.runs.map((run) => run.id).sort(), ['child-current', 'run-current']);
  const restoredRoot = restored.runs.find((run) => run.id === current.id);
  assert.equal(restoredRoot.steps[0].status, 'completed', 'completed steps must survive a restart');
  assert.equal(restoredRoot.steps[0].responsibilityTaskId, 'responsibility-current');
  assert.equal(restoredRoot.steps[0].executionBinding.childTaskId, 'responsibility-current');
  assert.equal(restoredRoot.sourceAttachments[0].workspacePath, 'uploads/run-current/brief.png');
  assert.ok(restored.events.every((event) => ['run-current', 'child-current'].includes(event.taskId)), 'filtered event ledger must stay in scope');

  const otherChat = await secondStore.read({ projectId: 'project-a', conversationId: 'chat-b', limit: 20 });
  assert.deepEqual(otherChat.runs.map((run) => run.id), [], 'a different conversation must not leak into the active replay scope');
} finally {
  await fs.rm(rootDir, { recursive: true, force: true });
}

console.log(JSON.stringify({ passed: true, historyMatches: matches.length, restoredRuns: 2, attachments: replay.attachments.length }));
