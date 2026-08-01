import assert from 'node:assert/strict';
import {
  addCodingProjectMember,
  compileCodingProject,
  createCodingProjectTaskDecision,
  registerCodingArtifact,
  reopenCodingProjectResponsibility,
  replaceCodingProjectOwner,
  validateCodingStageArtifacts,
} from '../src/engine/codingProject.mjs';

const deliveryDecision = createCodingProjectTaskDecision('开发一个生图客户端', {
  requiredConstraints: ['支持图生图'],
  decisionReason: '用户要求开发软件',
});
assert.equal(deliveryDecision.deliverableType, 'mixed');
assert.equal(deliveryDecision.primaryRoute, 'team_dispatch');
assert(deliveryDecision.acceptanceCriteria.some((criterion) => criterion.includes('磁盘回读')));
assert(deliveryDecision.acceptanceCriteria.some((criterion) => criterion.includes('运行或测试证据')));
assert(deliveryDecision.deliverables.some((item) => item.type === 'file' && item.required));

const members = [
  { id: 'pm', name: 'PM', capabilities: ['coordination'], currentLoad: 0 },
  { id: 'arch-busy', name: 'Busy architect', capabilities: ['architecture'], currentLoad: 3, isWorking: true },
  { id: 'arch-free', name: 'Free architect', capabilities: ['architecture'], currentLoad: 0 },
  { id: 'ui', name: 'UI designer', capabilities: ['ui_ux'], currentLoad: 0 },
  { id: 'frontend', name: 'Frontend', capabilities: ['frontend', 'coding'], currentLoad: 0 },
  { id: 'backend', name: 'Backend', capabilities: ['backend', 'coding'], currentLoad: 0 },
  { id: 'qa', name: 'QA', capabilities: ['review'], currentLoad: 0 },
];

let project = compileCodingProject({ goal: '开发一个带 API 的 React 客户端并完成测试', members });
assert.equal(project.codingProjectVersion, 2);
assert.equal(project.status, 'ready');
assert.equal(project.stages.find((stage) => stage.id === 'architecture').ownerEmployeeId, 'arch-free');
assert(project.stages.every((stage) => stage.artifactContract?.required?.length));

project = replaceCodingProjectOwner(project, { stageId: 'frontend', employeeId: 'frontend-2', employeeName: 'Second frontend', reason: '原负责人负载过高' });
assert.equal(project.stages.find((stage) => stage.id === 'frontend').ownerEmployeeId, 'frontend-2');

project = registerCodingArtifact(project, {
  stageId: 'frontend',
  artifact: {
    id: 'frontend-delivery', verified: true,
    data: { sourceFiles: ['src/App.tsx'], buildResult: 'passed', visualVerification: 'desktop and narrow viewport passed' },
  },
});
assert.equal(validateCodingStageArtifacts(project, 'frontend').passed, true);
project.stages.forEach((stage) => { stage.status = 'completed'; });
project = reopenCodingProjectResponsibility(project, { responsibleStepId: 'frontend', reason: '缺少加载状态' });
assert.equal(project.stages.find((stage) => stage.id === 'frontend').status, 'queued');
assert.equal(project.stages.find((stage) => stage.id === 'review').status, 'queued');
assert.equal(project.stages.find((stage) => stage.id === 'delivery').status, 'queued');
assert.equal(project.stages.find((stage) => stage.id === 'backend').status, 'completed');

const gapProject = compileCodingProject({ goal: '开发 Vue 客户端', members: members.filter((member) => member.id !== 'ui') });
assert.equal(gapProject.status, 'needs_staffing');
const staffed = addCodingProjectMember(gapProject, { employeeId: 'ui-new', employeeName: 'New UI', reason: '补齐 UI 能力', affectedStageIds: ['ux-ui'] });
assert.equal(staffed.stages.find((stage) => stage.id === 'ux-ui').ownerEmployeeId, 'ui-new');
assert.equal(staffed.status, 'ready');

console.log(JSON.stringify({ passed: true, version: project.codingProjectVersion, stages: project.stages.length, targetedRework: project.reworkHistory.at(-1).reopenedStepIds }, null, 2));
