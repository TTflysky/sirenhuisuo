const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

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
      domains: Array.isArray(input.domains) ? input.domains : ['employees', 'teams', 'sessions', 'tasks', 'memory', 'models', 'connectors', 'workspace'],
      evidence: [], failure: undefined,
    });
  }
  async function transition(phase, input = {}) {
    if (!PHASES.includes(phase)) throw new Error(`未知升级阶段：${phase}`);
    const current = (await read()) || await begin(input);
    const allowed = phase === 'rollback' || PHASES.indexOf(phase) >= PHASES.indexOf(current.phase || 'prepare');
    if (!allowed) throw new Error(`升级阶段不能从 ${current.phase} 回退到 ${phase}`);
    return write({ ...current, phase, status: input.status || (phase === 'commit' ? 'committed' : phase === 'rollback' ? 'rolling_back' : 'running'), evidence: [...(current.evidence || []), { phase, at: new Date().toISOString(), detail: String(input.detail || '').slice(0, 500), digest: input.digest || undefined }].slice(-100), failure: input.failure || current.failure });
  }
  async function fail(error, phase) { return transition(phase || (await read())?.phase || 'prepare', { status: 'failed', failure: String(error?.message || error).slice(0, 800), detail: '故障注入或真实升级失败' }); }
  async function digestFile(file) { const data = await fs.readFile(file); return crypto.createHash('sha256').update(data).digest('hex'); }
  return { begin, transition, fail, read, digestFile, journalPath, phases: PHASES, schema: TRANSACTION_SCHEMA };
}

module.exports = { TRANSACTION_SCHEMA, PHASES, createUpdateTransaction };
