const crypto = require('crypto');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function text(value, limit = 4000) {
  return String(value ?? '').trim().slice(0, limit);
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item, 500)).filter(Boolean) : [];
}

function appendEvent(task, type, detail, payload = {}) {
  task.serviceEvents = Array.isArray(task.serviceEvents) ? task.serviceEvents : [];
  task.serviceEvents.push({ ts: Date.now(), type, detail: text(detail, 1000), payload: clone(payload) });
  task.serviceEvents = task.serviceEvents.slice(-500);
}

function updateStep(task, stepId, mutate) {
  const step = (task.steps || []).find((item) => item.id === stepId);
  if (!step) throw new Error(`TaskService: unknown step ${stepId}`);
  mutate(step);
  step.updatedAt = Date.now();
  return step;
}

function appendNodeEvidenceIds(task, stepId, evidenceIds = []) {
  if (!stepId || !task.adaptivePlanGraph?.nodes) return;
  const node = task.adaptivePlanGraph.nodes.find((item) => item.id === stepId);
  if (!node) return;
  node.evidenceIds = [...new Set([...(node.evidenceIds || []), ...evidenceIds.filter(Boolean)])].slice(-40);
}

function appendDurableStepEvidence(task, stepId, evidence) {
  if (!stepId || !evidence?.summary) return;
  updateStep(task, stepId, (step) => {
    step.evidence = Array.isArray(step.evidence) ? step.evidence : [];
    const evidenceId = text(evidence.id, 500);
    const index = evidenceId
      ? step.evidence.findIndex((item) => item.id === evidenceId)
      : step.evidence.findIndex((item) => item.summary === evidence.summary && item.kind === evidence.kind);
    if (index >= 0) step.evidence[index] = { ...step.evidence[index], ...clone(evidence) };
    else step.evidence.push(clone(evidence));
    step.evidence = step.evidence.slice(-60);
  });
  appendNodeEvidenceIds(task, stepId, [evidence.id || evidence.summary]);
  if (evidence.verified === true) {
    task.recoveryContext = task.recoveryContext && typeof task.recoveryContext === 'object'
      ? task.recoveryContext
      : { completedEvidence: [], unresolvedIssues: [], steeringMessages: [], autoResume: false };
    task.recoveryContext.completedEvidence = Array.isArray(task.recoveryContext.completedEvidence)
      ? task.recoveryContext.completedEvidence
      : [];
    const durableSummary = `${stepId}: ${evidence.summary}`;
    task.recoveryContext.completedEvidence = [...new Set([
      ...task.recoveryContext.completedEvidence,
      durableSummary,
    ])].slice(-60);
  }
}

module.exports = {
  clone,
  text,
  id,
  list,
  appendEvent,
  updateStep,
  appendNodeEvidenceIds,
  appendDurableStepEvidence,
};
