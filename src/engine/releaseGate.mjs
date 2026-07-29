const RELEASE_GATE_VERSION_VALUE = 1;

export const RELEASE_GATE_CHECKS = [
  'build',
  'lint',
  'verify:foundation',
  'verify:task-plan',
  'verify:agent-kernel',
  'verify:execution-controller',
  'verify:task-runner',
  'verify:team-mentions',
  'verify:task-handoff',
  'verify:task-state-machine',
  'verify:execution-protocol',
  'verify:skill-evidence',
  'verify:dynamic-delegation-v2',
  'verify:recovery-capsule-v2',
];

function text(value, max = 180) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeCheck(input = {}) {
  return {
    name: text(input.name, 120),
    passed: input.passed === true,
    durationMs: Number.isFinite(input.durationMs) ? Math.max(0, input.durationMs) : undefined,
    detail: text(input.detail, 500) || undefined,
  };
}

export function createReleaseGate(input = {}) {
  const checks = Array.isArray(input.checks) ? input.checks.map(normalizeCheck) : [];
  const requiredFiles = Array.isArray(input.requiredFiles)
    ? input.requiredFiles.map((item) => ({ path: text(item.path ?? item, 300), exists: item?.exists !== false }))
    : [];
  const expectedVersion = text(input.expectedVersion, 40);
  const packageVersion = text(input.packageVersion, 40);
  const lockVersion = text(input.lockVersion, 40);
  const versionAligned = Boolean(expectedVersion && packageVersion === expectedVersion && lockVersion === expectedVersion);
  return {
    gateVersion: RELEASE_GATE_VERSION_VALUE,
    expectedVersion,
    packageVersion,
    lockVersion,
    versionAligned,
    requiredFiles,
    checks,
    generatedAt: Number.isFinite(input.generatedAt) ? input.generatedAt : Date.now(),
  };
}

export function validateReleaseGate(gate, options = {}) {
  const errors = [];
  if (!gate || typeof gate !== 'object') return { valid: false, errors: ['gate must be an object'] };
  if (gate.gateVersion !== RELEASE_GATE_VERSION_VALUE) errors.push(`gateVersion must be ${RELEASE_GATE_VERSION_VALUE}`);
  if (gate.versionAligned !== true) errors.push('package, lockfile and expected versions are not aligned');
  for (const file of gate.requiredFiles ?? []) if (!file?.path || file.exists !== true) errors.push(`required file missing: ${file?.path || 'unknown'}`);
  const requiredChecks = Array.isArray(options.requiredChecks) ? options.requiredChecks : RELEASE_GATE_CHECKS;
  const checks = new Map((gate.checks ?? []).map((check) => [check.name, check]));
  for (const name of requiredChecks) {
    const check = checks.get(name);
    if (!check) errors.push(`required check missing: ${name}`);
    else if (check.passed !== true) errors.push(`required check failed: ${name}`);
  }
  return { valid: errors.length === 0, errors };
}

export const RELEASE_GATE_VERSION = RELEASE_GATE_VERSION_VALUE;
