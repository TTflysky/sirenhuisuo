const UPGRADE_GOVERNANCE_VERSION = 1;
const REQUIRED_MIGRATION_DOMAINS = Object.freeze([
  'employees', 'teams', 'sessions', 'tasks', 'memory', 'models', 'connectors', 'workspace',
]);

function text(value, limit = 600) { return String(value ?? '').trim().slice(0, limit); }

function createMigrationMatrix(domains = REQUIRED_MIGRATION_DOMAINS) {
  const names = [...new Set((Array.isArray(domains) ? domains : REQUIRED_MIGRATION_DOMAINS).map((domain) => text(domain, 80)).filter(Boolean))];
  return Object.fromEntries(names.map((domain) => [domain, { domain, status: 'pending', checkedAt: 0, detail: '' }]));
}

function normalizeResult(domain, result = {}) {
  return {
    domain,
    status: result.ok === true ? 'ready' : result.status === 'warning' ? 'warning' : 'blocked',
    checkedAt: Number(result.checkedAt) || Date.now(),
    detail: text(result.detail || result.error, 800),
    beforeCount: Number.isFinite(Number(result.beforeCount)) ? Number(result.beforeCount) : undefined,
    afterCount: Number.isFinite(Number(result.afterCount)) ? Number(result.afterCount) : undefined,
    digest: text(result.digest, 180) || undefined,
  };
}

function validateMigrationMatrix(matrix, domains = REQUIRED_MIGRATION_DOMAINS) {
  const expected = [...new Set((Array.isArray(domains) ? domains : REQUIRED_MIGRATION_DOMAINS).map((domain) => text(domain, 80)).filter(Boolean))];
  const entries = matrix && typeof matrix === 'object' ? matrix : {};
  const missing = expected.filter((domain) => !entries[domain] || entries[domain].status === 'pending');
  const blocked = expected.filter((domain) => entries[domain]?.status === 'blocked');
  const warnings = expected.filter((domain) => entries[domain]?.status === 'warning');
  return { ready: missing.length === 0 && blocked.length === 0, expected, missing, blocked, warnings, checkedAt: Date.now() };
}

function summarizeMigrationMatrix(matrix) {
  const entries = Object.values(matrix || {});
  return {
    total: entries.length,
    ready: entries.filter((entry) => entry.status === 'ready').length,
    warnings: entries.filter((entry) => entry.status === 'warning').length,
    blocked: entries.filter((entry) => entry.status === 'blocked').length,
    pending: entries.filter((entry) => entry.status === 'pending').length,
  };
}

module.exports = {
  UPGRADE_GOVERNANCE_VERSION,
  REQUIRED_MIGRATION_DOMAINS,
  createMigrationMatrix,
  normalizeResult,
  validateMigrationMatrix,
  summarizeMigrationMatrix,
};
