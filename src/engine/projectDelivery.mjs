const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const list = (value, max = 50) => Array.isArray(value) ? value.map((item) => text(item, 500)).filter(Boolean).slice(0, max) : [];

export function createProjectDelivery(input = {}) {
  const now = Number(input.now) || Date.now();
  return {
    schema: 1, projectId: text(input.projectId || `project-${now}`, 120), goal: text(input.goal, 4000),
    members: Array.isArray(input.members) ? input.members.map((m) => ({ id: text(m.id, 120), role: text(m.role, 200), responsibility: text(m.responsibility, 500) })).filter((m) => m.id) : [],
    stages: Array.isArray(input.stages) ? input.stages.map((s, i) => ({ id: text(s.id || `stage-${i + 1}`, 120), title: text(s.title, 300), ownerId: text(s.ownerId, 120), dependsOn: list(s.dependsOn, 20), status: ['pending', 'running', 'review', 'completed', 'blocked'].includes(s.status) ? s.status : 'pending', evidence: list(s.evidence, 20), review: s.review === 'approved' ? 'approved' : s.review === 'rejected' ? 'rejected' : 'pending' })) : [],
    risks: Array.isArray(input.risks) ? input.risks.map((r) => ({ id: text(r.id, 120), title: text(r.title, 300), severity: ['low', 'medium', 'high', 'critical'].includes(r.severity) ? r.severity : 'medium', ownerId: text(r.ownerId, 120), mitigation: text(r.mitigation, 800), status: r.status === 'closed' ? 'closed' : 'open' })).filter((r) => r.id && r.title) : [],
    changes: [], decisions: [], createdAt: now, updatedAt: now,
  };
}
export function recordProjectChange(project, change = {}) { const next = structuredClone(project); next.changes.push({ id: text(change.id || `change-${Date.now()}`, 120), summary: text(change.summary, 1000), reason: text(change.reason, 1000), impact: text(change.impact, 1000), approvedBy: text(change.approvedBy, 120), at: Date.now() }); next.updatedAt = Date.now(); return next; }
export function reviewStage(project, stageId, decision, reviewer) { const next = structuredClone(project); const stage = next.stages.find((item) => item.id === stageId); if (!stage) throw new Error(`Unknown stage: ${stageId}`); stage.review = decision === 'approved' ? 'approved' : 'rejected'; stage.status = stage.review === 'approved' ? 'completed' : 'pending'; stage.reviewer = text(reviewer, 120); stage.reviewedAt = Date.now(); next.updatedAt = Date.now(); return next; }
export function buildAcceptancePackage(project) { return { format: 'taiji-project-acceptance/v1', projectId: project.projectId, goal: project.goal, members: project.members, stages: project.stages, risks: project.risks, changes: project.changes, unresolvedRisks: project.risks.filter((r) => r.status !== 'closed'), generatedAt: new Date().toISOString() }; }
