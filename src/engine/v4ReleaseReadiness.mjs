export const V4_RELEASE_VERSION = '4.0.0';
export const V4_RELEASE_REQUIRED_ARTIFACTS = Object.freeze([
  'source', 'lockfile', 'sbom', 'provenance', 'migration', 'rollback', 'health',
]);

function text(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function bool(value) { return value === true; }

export function createV4ReleaseChecklist(input = {}) {
  const artifacts = Object.fromEntries(V4_RELEASE_REQUIRED_ARTIFACTS.map((name) => [name, input.artifacts?.[name] === true]));
  return {
    version: text(input.version || input.packageVersion, 40),
    lockVersion: text(input.lockVersion, 40),
    unifiedHost: {
      singleHost: bool(input.unifiedHost?.singleHost),
      mode: text(input.unifiedHost?.mode, 40),
      entrypoints: Array.isArray(input.unifiedHost?.entrypoints) ? input.unifiedHost.entrypoints.map((item) => text(item, 40)).filter(Boolean) : [],
    },
    migrationReady: bool(input.migrationReady),
    rollbackEvidence: bool(input.rollbackEvidence),
    healthReady: bool(input.healthReady),
    artifacts,
    signature: {
      required: bool(input.signature?.required),
      signed: bool(input.signature?.signed),
      provider: text(input.signature?.provider, 160),
    },
    generatedAt: Number(input.generatedAt) || Date.now(),
  };
}

export function validateV4ReleaseChecklist(checklist, options = {}) {
  const errors = [];
  const warnings = [];
  if (!checklist || typeof checklist !== 'object') return { valid: false, errors: ['release checklist is required'], warnings };
  if (checklist.version !== V4_RELEASE_VERSION || checklist.lockVersion !== V4_RELEASE_VERSION) errors.push('package and lockfile must both be v4.0.0');
  if (checklist.unifiedHost?.singleHost !== true || checklist.unifiedHost.mode !== 'adaptive') errors.push('unified adaptive host is not the only execution host');
  if (checklist.unifiedHost.entrypoints.length < 5) errors.push('all five execution entrypoints must be registered');
  if (checklist.migrationReady !== true) errors.push('migration matrix has not passed');
  if (checklist.rollbackEvidence !== true) errors.push('rollback evidence is missing');
  if (checklist.healthReady !== true) errors.push('post-install health evidence is missing');
  for (const artifact of V4_RELEASE_REQUIRED_ARTIFACTS) if (checklist.artifacts?.[artifact] !== true) errors.push(`release artifact evidence is missing: ${artifact}`);
  if (checklist.signature?.required && !checklist.signature.signed) errors.push('code signing is required but no signed artifact is present');
  else if (!checklist.signature?.signed) warnings.push('code signing certificate is not configured; Windows SmartScreen may warn');
  if (options.requireSignature === true && !checklist.signature?.signed) errors.push('release policy requires a signed artifact');
  return { valid: errors.length === 0, errors, warnings, checklist };
}
