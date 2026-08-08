function text(value, limit = 4000) {
  return String(value ?? '').trim().slice(0, limit);
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item, 500)).filter(Boolean) : [];
}

function normalizeTaskContract(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output = value.output && typeof value.output === 'object' && !Array.isArray(value.output) ? value.output : {};
  const budget = value.budget && typeof value.budget === 'object' && !Array.isArray(value.budget) ? value.budget : {};
  return {
    contractVersion: Math.max(1, Number(value.contractVersion) || 1),
    inputRefs: list(value.inputRefs),
    output: { type: text(output.type, 80) || 'answer', path: text(output.path, 500) || undefined, description: text(output.description, 1000) },
    completionConditions: list(value.completionConditions),
    verification: list(value.verification),
    budget: {
      maxModelRounds: Math.max(1, Number(budget.maxModelRounds) || 8),
      maxToolCalls: Math.max(1, Number(budget.maxToolCalls) || 24),
      maxReworkAttempts: Math.max(0, Number(budget.maxReworkAttempts) || 0),
    },
    escalationConditions: list(value.escalationConditions),
  };
}

function createStepTaskContract(input = {}, defaults = {}) {
  const title = text(input.title || input.assignment || defaults.title || 'task step', 1000);
  const deliverableType = text(input.deliverableType || defaults.deliverableType, 80) || 'answer';
  const inputRefs = list(input.inputRefs || defaults.inputRefs);
  const completionConditions = list(
    input.completionConditions || input.acceptanceCriteria || defaults.completionConditions || defaults.acceptanceCriteria,
  );
  const verification = list(
    input.verification || input.expectedEvidence || defaults.verification || defaults.expectedEvidence,
  );
  return normalizeTaskContract({
    contractVersion: 1,
    inputRefs,
    output: {
      type: deliverableType,
      path: text(input.outputPath || input.output?.path || defaults.outputPath, 500) || undefined,
      description: text(input.outputDescription || input.output?.description || title, 1000),
    },
    completionConditions: completionConditions.length ? completionConditions : [title + ' is complete'],
    verification: verification.length ? verification : ['Verify ' + title],
    budget: input.budget || defaults.budget || { maxModelRounds: 8, maxToolCalls: 24, maxReworkAttempts: 2 },
    escalationConditions: input.escalationConditions || defaults.escalationConditions || [
      'Escalate when the rework budget is exhausted or the acceptance boundary changes.',
    ],
  });
}

module.exports = { normalizeTaskContract, createStepTaskContract };
