const MAX_EVENTS = 120;
const ACTIONS = new Set(['matched', 'read', 'read-failed', 'searched', 'installed', 'called', 'produced', 'accepted', 'rejected', 'skipped']);

function text(value, max = 700) { return String(value ?? '').trim().slice(0, max); }

export function normalizeSkillEvidence(input = {}) {
  const action = ACTIONS.has(input.action) ? input.action : 'skipped';
  return {
    ts: Number.isFinite(input.ts) ? input.ts : Date.now(),
    skillId: text(input.skillId, 180) || undefined,
    skillName: text(input.skillName, 180) || undefined,
    action,
    toolName: text(input.toolName, 120) || undefined,
    reason: text(input.reason, 500) || undefined,
    detail: text(input.detail, 700) || undefined,
    verified: input.verified === true,
    stage: text(input.stage, 80) || (action === 'matched' || action === 'searched' ? 'discovery'
      : action === 'read' || action === 'read-failed' ? 'rules'
        : action === 'called' ? 'invocation'
          : action === 'produced' ? 'output'
            : action === 'accepted' || action === 'rejected' ? 'acceptance' : 'installation'),
    score: Number.isFinite(input.score) ? input.score : undefined,
    source: text(input.source, 80) || 'scheduler',
  };
}

export function appendSkillEvidence(events = [], input = {}) {
  const next = normalizeSkillEvidence(input);
  const current = Array.isArray(events) ? events.map(normalizeSkillEvidence) : [];
  const duplicate = current.find((item) => item.skillId === next.skillId && item.action === next.action && item.toolName === next.toolName && item.detail === next.detail);
  if (duplicate) return current.slice(-MAX_EVENTS);
  return [...current, next].slice(-MAX_EVENTS);
}

export function summarizeSkillEvidence(events = []) {
  const normalized = events.map(normalizeSkillEvidence);
  return {
    total: normalized.length,
    matched: normalized.filter((item) => item.action === 'matched').length,
    read: normalized.filter((item) => item.action === 'read').length,
    failed: normalized.filter((item) => item.action === 'read-failed').length,
    called: normalized.filter((item) => item.action === 'called').length,
    produced: normalized.filter((item) => item.action === 'produced').length,
    accepted: normalized.filter((item) => item.action === 'accepted').length,
    verified: normalized.filter((item) => item.verified).length,
    latest: normalized.slice(-8),
  };
}

export function buildSkillLifecycle(events = [], skillId) {
  const normalized = events.map(normalizeSkillEvidence).filter((item) => !skillId || item.skillId === skillId || item.skillName === skillId);
  const passed = (actions) => normalized.some((item) => actions.includes(item.action) && item.verified);
  const stages = {
    discovery: passed(['matched', 'searched']),
    rules: passed(['read']),
    invocation: passed(['called']),
    output: passed(['produced']),
    acceptance: passed(['accepted']) && !normalized.some((item) => item.action === 'rejected'),
  };
  return { stages, usable: Object.values(stages).every(Boolean), latest: normalized.slice(-12) };
}

export const SKILL_EVIDENCE_VERSION = 3;
