import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildProjectBoard } from '../src/engine/projectBoard.mjs';

const root = new URL('..', import.meta.url);
const read = (relativePath) => fs.readFile(new URL(relativePath, root), 'utf8');

const [matcher, adapter, store, employeeProjection, clipboard, assistant, dm, team] = await Promise.all([
  read('src/engine/taskMatcher.ts'),
  read('electron/nativeExecutionAdapter.cjs'),
  read('src/store.tsx'),
  read('src/store/nativeEmployeeProjection.ts'),
  read('src/utils/clipboard.ts'),
  read('src/components/chat/AssistantChat.tsx'),
  read('src/components/chat/DmChatApp.tsx'),
  read('src/components/chat/TeamChatApp.tsx'),
]);

assert.match(matcher, /A rejected result must be repaired before another stage can consume it/u);
assert.match(matcher, /kind: 'review'/u);
assert.match(matcher, /dependsOnStepIds: gate/u);
assert.match(adapter, /review_waiting_user/u);
assert.match(adapter, /waitingForUser/u);
assert.match(adapter, /前置审查退回，等待修订和复审通过/u);

assert.match(store, /projectNativeWorkingEmployees/u);
assert.match(store, /scheduleNativeRefresh/u);
assert.match(store, /hydrateTaskRunFromMainStore/u);
assert.match(store, /PATCH_TASK_RUN/u);
assert.match(employeeProjection, /if \(!\['queued', 'running'\]\.includes\(run\.status\)\) continue/u);
assert.match(employeeProjection, /if \(step\.status === 'running'\) active\.set/u);

assert.match(assistant, /isProjectApprovalIntent\(enriched\)/u);
assert.match(assistant, /conversationId: conversationIdRef\.current/u);
assert.match(assistant, /applyProjectRosterMutation/u);
assert.match(store, /status: 'clarifying'/u);
assert.match(store, /startProjectExecution/u);

assert.match(clipboard, /copyAndArchiveChatTranscript/u);
for (const source of [assistant, dm, team]) assert.match(source, /copyAndArchiveChatTranscript/u);

const board = buildProjectBoard([{
  id: 'run-orchestration',
  teamId: 'team-orchestration',
  title: 'Structured delivery',
  goal: 'Structured delivery',
  status: 'running',
  createdAt: 1,
  updatedAt: 2,
  steps: [
    { id: 'scope', employeeId: 'planner', title: 'Scope', assignment: 'confirm scope', status: 'completed', dependsOnStepIds: [] },
    { id: 'design', employeeId: 'designer', title: 'UI/UX design', assignment: 'design after scope review', status: 'queued', dependsOnStepIds: ['scope'] },
  ],
}]);
assert.equal(board.length, 1);
const design = board[0].stages.find((stage) => stage.id === 'design');
assert.equal(design?.status, 'queued', 'queued work must not be projected as running');
assert.equal(board[0].currentStage?.id, 'design', 'the earliest queued stage is the next stage');

console.log(JSON.stringify({ passed: true, checks: ['review-gates', 'human-escalation', 'throttled-refresh', 'markdown-handoffs', 'queued-projection'] }));
