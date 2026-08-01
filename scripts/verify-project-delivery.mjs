import assert from 'node:assert/strict';
import { createProjectDelivery, recordProjectChange, reviewStage, buildAcceptancePackage } from '../src/engine/projectDelivery.mjs';
let project = createProjectDelivery({ projectId: 'p1', goal: 'creator platform', members: [{ id: 'arch', role: '架构' }], stages: [{ id: 'architecture', title: '架构', ownerId: 'arch' }], risks: [{ id: 'r1', title: '依赖', severity: 'high' }] });
project = recordProjectChange(project, { summary: '调整接口', reason: '需求补充', impact: '增加一个阶段' });
project = reviewStage(project, 'architecture', 'approved', 'qa');
const pkg = buildAcceptancePackage(project);
assert.equal(pkg.format, 'taiji-project-acceptance/v1'); assert.equal(pkg.stages[0].review, 'approved'); assert.equal(pkg.changes.length, 1); assert.equal(pkg.unresolvedRisks.length, 1);
console.log(JSON.stringify({ passed: true, projectId: pkg.projectId, stages: pkg.stages.length, unresolvedRisks: pkg.unresolvedRisks.length }, null, 2));
