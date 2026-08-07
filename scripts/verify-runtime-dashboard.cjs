const assert = require('node:assert/strict');
const { buildRuntimeDashboard } = require('../electron/runtimeDashboard.cjs');

const runs = [{
  id: 'root-1', projectId: 'project-1', teamId: 'team-1', title: '交付测试项目', status: 'running', phase: 'execution', updatedAt: 200,
  memberSnapshot: [{ id: 'coder', name: '前端工程师' }],
  steps: [
    { id: 'step-1', employeeId: 'coder', title: '实现页面', assignment: '编写并验证页面', status: 'running', startedAt: 150 },
    { id: 'step-2', employeeId: 'reviewer', title: '验收页面', status: 'queued', dependsOnStepIds: ['step-1'] },
  ],
  artifacts: [{ path: 'index.html', verified: true }],
  approvals: [{ id: 'approval-1', status: 'pending', title: '发布到外部站点', reason: '会产生对外可见内容', requestedBy: '前端工程师' }],
  worker: { activity: '正在运行本地页面验证' },
}];
const telemetry = [
  { eventId: 'heartbeat', taskId: 'root-1', type: 'worker.heartbeat', severity: 'info', occurredAt: 220, public: { summary: '心跳' } },
  { eventId: 'tool', taskId: 'root-1', type: 'execution.tool_result', severity: 'info', occurredAt: 210, public: { summary: '页面文件已写入' } },
];
const dashboard = buildRuntimeDashboard(runs, telemetry);
assert.equal(dashboard.project.projectId, 'project-1');
assert.equal(dashboard.counts.running, 1);
assert.equal(dashboard.counts.verifiedArtifacts, 1);
assert.equal(dashboard.activeWork[0].actorName, '前端工程师');
assert.equal(dashboard.approvals.length, 1);
assert.deepEqual(dashboard.meaningfulEvents.map((event) => event.eventId), ['tool']);
assert.equal(dashboard.technical.latest.length, 2, '技术详情仍保留完整事件');
console.log('verify-runtime-dashboard: PASS');
