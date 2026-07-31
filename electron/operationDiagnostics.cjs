const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MAX_ENTRIES = 5000;
const SENSITIVE_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|cookie|session)/iu;
const SENSITIVE_VALUE = /(?:\b(?:sk|rk|pk)_[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._-]{12,}\b|(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;"']+)/giu;

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

function redact(value, depth = 0) {
  if (depth > 8) return '[truncated]';
  if (typeof value === 'string') return value.replace(SENSITIVE_VALUE, '[redacted]').slice(0, 12000);
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => redact(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? '[redacted]' : redact(item, depth + 1)]));
}

function errorDetails(error) {
  if (!error) return {};
  if (typeof error === 'string') return { message: error };
  return { message: String(error.message || error), errorCode: error.code ? String(error.code) : undefined };
}

function classifyFailure(input = {}) {
  const text = `${String(input.errorCode || input.code || '').toLowerCase()} ${String(input.message || '').toLowerCase()}`;
  if (/timeout|timed.?out|operation_timeout/.test(text)) return { failureClass: 'timeout', recoverable: true };
  if (/enotfound|econn|network|fetch failed|socket|dns|http [45]\d\d/.test(text)) return { failureClass: 'network', recoverable: true };
  if (/eacces|eperm|permission|unauthori[sz]ed|forbidden|not allowed/.test(text)) return { failureClass: 'permission', recoverable: false };
  if (/api key|credential|connector|configuration|not configured|missing.*(?:key|config)/.test(text)) return { failureClass: 'configuration', recoverable: false };
  if (/not found|does not exist|找不到任务|找不到/.test(text)) return { failureClass: 'missing_resource', recoverable: true };
  if (/invalid|validation|schema|malformed|参数.*无效/.test(text)) return { failureClass: 'validation', recoverable: false };
  if (/ledger|checksum|integrity|corrupt|账本|快照/.test(text)) return { failureClass: 'data_integrity', recoverable: true };
  if (/abort|cancel|stopped|paused/.test(text)) return { failureClass: 'interrupted', recoverable: true };
  return { failureClass: 'unknown', recoverable: false };
}

function createOperationDiagnostics(rootDir, options = {}) {
  const maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0 ? options.maxEntries : DEFAULT_MAX_ENTRIES;
  const filePath = path.join(rootDir, 'diagnostics.jsonl');
  let writeQueue = Promise.resolve();
  async function readAll() {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return raw.split(/\r?\n/u).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return undefined; } }).filter(Boolean);
    } catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  }
  async function trimIfNeeded() {
    const entries = await readAll();
    if (entries.length > maxEntries) await fs.writeFile(filePath, `${entries.slice(-maxEntries).map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
  }
  function record(input = {}) {
    const operation = writeQueue.then(async () => {
      await fs.mkdir(rootDir, { recursive: true });
      const details = errorDetails(input.error);
      const classification = classifyFailure({ ...input, ...details });
      const entry = redact({
        id: `diag-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`,
        occurredAt: Number(input.occurredAt) || Date.now(), level: ['info', 'warning', 'error'].includes(input.level) ? input.level : 'error',
        scope: String(input.scope || 'runtime').slice(0, 120), operation: String(input.operation || 'unknown').slice(0, 160),
        taskId: input.taskId ? String(input.taskId).slice(0, 240) : undefined, teamId: input.teamId ? String(input.teamId).slice(0, 240) : undefined,
        errorCode: input.errorCode || details.errorCode, failureClass: input.failureClass || classification.failureClass,
        recoverable: typeof input.recoverable === 'boolean' ? input.recoverable : classification.recoverable,
        message: input.message || details.message || 'Operation diagnostic', context: input.context || {},
      });
      await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
      await trimIfNeeded();
      return { ok: true, entry };
    });
    writeQueue = operation.then(() => undefined, () => undefined);
    return operation.catch((error) => ({ ok: false, error: String(error?.message || error) }));
  }
  async function query(options = {}) {
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
    const after = Number(options.after) || 0;
    const filtered = (await readAll()).filter((entry) => (!after || Number(entry.occurredAt) >= after)
      && (!options.taskId || entry.taskId === String(options.taskId)) && (!options.teamId || entry.teamId === String(options.teamId))
      && (!options.failureClass || entry.failureClass === options.failureClass) && (!options.level || entry.level === options.level));
    const entries = filtered.slice(-limit).reverse();
    return { ok: true, filePath, entries: clone(entries), total: filtered.length };
  }
  async function summary(options = {}) {
    const entries = (await query({ ...options, limit: maxEntries })).entries || [];
    const countBy = (key) => Object.fromEntries(entries.reduce((map, entry) => { const value = String(entry[key] || 'unknown'); map.set(value, (map.get(value) || 0) + 1); return map; }, new Map()));
    return { ok: true, filePath, total: entries.length, errors: entries.filter((entry) => entry.level === 'error').length,
      recoverable: entries.filter((entry) => entry.recoverable).length, byFailureClass: countBy('failureClass'), byScope: countBy('scope'), latest: entries.slice(0, 8) };
  }
  async function exportData(options = {}) { const result = await query({ ...options, limit: Math.min(maxEntries, Number(options.limit) || maxEntries) }); return { format: 'taiji-operation-diagnostics/v1', exportedAt: Date.now(), filters: redact(options), diagnostics: result.entries || [] }; }
  return { filePath, record, query, summary, exportData, redact, classifyFailure };
}

module.exports = { createOperationDiagnostics, classifyFailure, redact };
