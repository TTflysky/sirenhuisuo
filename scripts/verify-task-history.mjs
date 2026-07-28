import assert from 'node:assert/strict';
import { appendTaskContextEvent, createTaskContext } from '../src/engine/taskContext.mjs';
import { buildTaskHistoryPrompt, buildTaskReplay, searchTaskRunHistory } from '../src/engine/taskHistory.mjs';

function historicalRun({ id, teamId, title, goal, status = 'completed', ts = 1000, artifact }) {
  let context = createTaskContext({ taskId: id, goal, acceptanceCriteria: ['真实文件已验证'], createdAt: ts });
  context = appendTaskContextEvent(context, {
    ts: ts + 10,
    type: 'progress',
    source: 'tool',
    stepId: 'deliver',
    summary: `${title} 已生成并验证`,
    verified: true,
    data: artifact ? { artifact: { path: artifact, diskPath: `C:/workspace/${artifact}` } } : undefined,
  });
  context = appendTaskContextEvent(context, {
    ts: ts + 20,
    type: 'blocked',
    source: 'review',
    stepId: 'review',
    summary: `${title} 曾因格式校验失败被退回`,
  });
  return {
    id, teamId, title, goal, request: goal, status, context,
    createdAt: ts, updatedAt: ts + 20,
    runner: { events: [{ id: `${id}-runner`, ts: ts + 15, type: 'step_succeeded', stepId: 'deliver', detail: '交付步骤完成' }] },
  };
}

const report = historicalRun({ id: 'report-1', teamId: 'finance', title: '季度财务报表', goal: '生成季度财务报表 Excel', artifact: '季度报表.xlsx' });
const script = historicalRun({ id: 'script-1', teamId: 'dev', title: '自动备份脚本', goal: '编写自动备份 PowerShell 脚本', artifact: 'backup.ps1', ts: 2000 });
const running = historicalRun({ id: 'running-1', teamId: 'finance', title: '实时财务报表', goal: '处理财务报表', status: 'running', ts: 3000 });
const teams = [{ id: 'finance', name: '财务组' }, { id: 'dev', name: '开发组' }];

const matches = searchTaskRunHistory([script, running, report], '重新制作财务报表 Excel', { teams, limit: 5 });
assert.equal(matches.length, 1);
assert.equal(matches[0].taskId, 'report-1');
assert.equal(matches[0].teamName, '财务组');
assert.deepEqual(matches[0].artifactPaths, ['季度报表.xlsx']);

const prompt = buildTaskHistoryPrompt(matches);
assert.match(prompt, /跨会话只读参考/u);
assert.match(prompt, /不能覆盖当前目标/u);
assert.match(prompt, /季度报表\.xlsx/u);

const ledgerEvents = [{
  eventVersion: 1,
  eventId: 'event-1',
  sequence: 1,
  occurredAt: report.updatedAt + 1,
  type: 'task_created',
  taskId: report.id,
  teamId: report.teamId,
  source: 'test',
  nextStatus: 'completed',
  domains: ['task'],
  detail: '任务从事件账本创建',
  payload: { snapshot: report },
  previousHash: '',
  hash: 'test-hash',
}];
const replay = buildTaskReplay(report, ledgerEvents);
assert.equal(replay.taskId, 'report-1');
assert.equal(replay.events.length, 2);
assert.equal(replay.runnerEvents.length, 1);
assert.equal(replay.ledgerEvents.length, 1);
assert.equal(replay.ledgerEvents[0].sequence, 1);
assert.ok(replay.events[0].ts < replay.events[1].ts);
assert.deepEqual(replay.summary.artifactPaths, ['季度报表.xlsx']);

console.log(JSON.stringify({ passed: true, matches: matches.length, replayEvents: replay.events.length + replay.runnerEvents.length }));
