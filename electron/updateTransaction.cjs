const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const {
  REQUIRED_MIGRATION_DOMAINS,
  createMigrationMatrix,
  normalizeResult,
  validateMigrationMatrix,
  summarizeMigrationMatrix,
} = require('./upgradeGovernance.cjs');

const TRANSACTION_SCHEMA = 1;
const PHASES = ['prepare', 'download', 'verify', 'backup', 'install', 'migrate', 'health', 'commit', 'rollback'];

function createUpdateTransaction(options = {}) {
  const root = path.resolve(options.root || path.join(process.cwd(), 'upgrade-transaction'));
  const journalPath = path.join(root, 'transaction.json');
  async function read() { try { return JSON.parse(await fs.readFile(journalPath, 'utf8')); } catch { return null; } }
  async function write(value) {
    await fs.mkdir(root, { recursive: true });
    const next = { ...value, schema: TRANSACTION_SCHEMA, updatedAt: new Date().toISOString() };
    const temp = `${journalPath}.tmp-${process.pid}`;
    await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await fs.rename(temp, journalPath);
    return next;
  }
  async function begin(input = {}) {
    const previous = await read();
    return write({
      ...(previous || {}), id: input.id || `upgrade-${Date.now()}`, fromVersion: String(input.fromVersion || ''), toVersion: String(input.toVersion || ''),
      phase: 'prepare', status: 'prepared', startedAt: previous?.startedAt || new Date().toISOString(),
      domains: Array.isArray(input.domains) ? input.domains : [...REQUIRED_MIGRATION_DOMAINS],
      domainMatrix: createMigrationMatrix(input.domains || REQUIRED_MIGRATION_DOMAINS),
      evidence: [], failure: undefined,
    });
  }
  async function transition(phase, input = {}) {
    if (!PHASES.includes(phase)) throw new Error(`未知升级阶段：${phase}`);
    const current = (await read()) || await begin(input);
    if (input.injectFailure === true || process.env.TAIJI_UPDATE_INJECT_FAILURE === phase) {
      return write({ ...current, phase, status: 'failed', failure: `Injected failure at ${phase}` });
    }
    const allowed = phase === 'rollback' || PHASES.indexOf(phase) >= PHASES.indexOf(current.phase || 'prepare');
    if (!allowed) throw new Error(`升级阶段不能从 ${current.phase} 回退到 ${phase}`);
    if (input.requireDomainValidation === true && (phase === 'health' || phase === 'commit')) {
      const readiness = validateMigrationMatrix(current.domainMatrix, current.domains);
      if (!readiness.ready) {
        return write({ ...current, phase, status: 'failed', failure: `Migration domains are not ready: ${[...readiness.missing, ...readiness.blocked].join(', ')}`, domainReadiness: readiness });
      }
    }
    return write({ ...current, phase, status: input.status || (phase === 'commit' ? 'committed' : phase === 'rollback' ? 'rolling_back' : 'running'), evidence: [...(current.evidence || []), { phase, at: new Date().toISOString(), detail: String(input.detail || '').slice(0, 500), digest: input.digest || undefined }].slice(-100), failure: input.failure || current.failure });
  }
  async function recordDomainValidation(domain, result = {}) {
    const current = (await read()) || await begin({});
    const name = String(domain || '').trim().slice(0, 80);
    if (!current.domains.includes(name)) throw new Error(`Unknown migration domain: ${name}`);
    const nextMatrix = { ...(current.domainMatrix || createMigrationMatrix(current.domains)), [name]: normalizeResult(name, result) };
    return write({ ...current, domainMatrix: nextMatrix, domainReadiness: validateMigrationMatrix(nextMatrix, current.domains) });
  }
  async function validateReadiness() {
    const current = (await read()) || await begin({});
    const readiness = validateMigrationMatrix(current.domainMatrix, current.domains);
    return { ...readiness, summary: summarizeMigrationMatrix(current.domainMatrix) };
  }
  async function fail(error, phase) { return transition(phase || (await read())?.phase || 'prepare', { status: 'failed', failure: String(error?.message || error).slice(0, 800), detail: '故障注入或真实升级失败' }); }
  async function digestFile(file) { const data = await fs.readFile(file); return crypto.createHash('sha256').update(data).digest('hex'); }
  async function simulateFailure(input = {}) {
    const phases = Array.isArray(input.phases) ? input.phases : PHASES.slice(1, 8);
    await begin(input);
    for (const phase of phases) {
      const result = await transition(phase, { detail: `simulation:${phase}`, injectFailure: phase === input.failAt });
      if (result.status === 'failed') {
        const rolledBack = await transition('rollback', { detail: `simulation rollback:${phase}`, status: 'rolled_back' });
        return { passed: rolledBack.status === 'rolled_back', failedAt: phase, journal: rolledBack };
      }
    }
    return { passed: false, reason: 'failure point was not reached', journal: await read() };
  }
  return { begin, transition, recordDomainValidation, validateReadiness, fail, simulateFailure, read, digestFile, journalPath, phases: PHASES, schema: TRANSACTION_SCHEMA };
}

module.exports = { TRANSACTION_SCHEMA, PHASES, createUpdateTransaction };
