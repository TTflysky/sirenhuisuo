const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { redact, classifyFailure } = require('./operationDiagnostics.cjs');

const SCHEMA_VERSION = 1;
const MAX_EVENTS = 12000;
const PUBLIC_LIMIT = 1400;

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function text(value, limit = PUBLIC_LIMIT) { return [...String(value ?? '')].filter((character) => character.charCodeAt(0) >= 32).join('').trim().slice(0, limit); }
function safeId(value, limit = 240) { return value ? text(value, limit) : undefined; }
const PRIVATE_FIELD = /(?:reasoning|chain[_-]?of[_-]?thought|prompt|attachment|file[_-]?content|raw[_-]?content)/iu;

function stripPrivate(value, depth = 0) {
  if (depth > 6 || value === undefined || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => stripPrivate(item, depth + 1));
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE_FIELD.test(key)).slice(0, 60).map(([key, item]) => [key, stripPrivate(item, depth + 1)]));
}

function publicSummary(input = {}) {
  return redact({
    summary: text(input.summary || input.detail || input.message || input.activity || '运行事件'),
    error: input.error ? text(input.error?.message || input.error) : undefined,
    metadata: stripPrivate(input.metadata || input.context || {}),
  });
}

function normalize(input = {}) {
  const status = text(input.status, 60) || undefined;
  const error = input.error ? text(input.error?.message || input.error) : undefined;
  const failure = input.failureClass || (error ? classifyFailure({ message: error }).failureClass : undefined);
  return redact({
    schemaVersion: SCHEMA_VERSION,
    eventId: `telemetry-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`,
    occurredAt: Number(input.occurredAt) || Date.now(),
    type: text(input.type || 'runtime.event', 120),
    source: text(input.source || 'runtime', 120),
    severity: ['info', 'warning', 'error'].includes(input.severity) ? input.severity : error ? 'error' : 'info',
    status,
    sessionId: safeId(input.sessionId), conversationId: safeId(input.conversationId), projectId: safeId(input.projectId),
    taskId: safeId(input.taskId), stepId: safeId(input.stepId), attemptId: safeId(input.attemptId), traceId: safeId(input.traceId),
    parentSpanId: safeId(input.parentSpanId), actorId: safeId(input.actorId), modelId: safeId(input.modelId), toolCallId: safeId(input.toolCallId),
    durationMs: Number.isFinite(Number(input.durationMs)) ? Math.max(0, Number(input.durationMs)) : undefined,
    usage: input.usage && typeof input.usage === 'object' ? {
      inputTokens: Number.isFinite(Number(input.usage.inputTokens)) ? Math.max(0, Number(input.usage.inputTokens)) : undefined,
      outputTokens: Number.isFinite(Number(input.usage.outputTokens)) ? Math.max(0, Number(input.usage.outputTokens)) : undefined,
      totalTokens: Number.isFinite(Number(input.usage.totalTokens)) ? Math.max(0, Number(input.usage.totalTokens)) : undefined,
    } : undefined,
    failureClass: failure,
    recoverable: typeof input.recoverable === 'boolean' ? input.recoverable : undefined,
    evidenceIds: Array.isArray(input.evidenceIds) ? [...new Set(input.evidenceIds.map((item) => safeId(item)).filter(Boolean))].slice(0, 80) : [],
    public: publicSummary(input),
  });
}

function createTelemetryLedger(rootDir, options = {}) {
  const filePath = path.join(rootDir, 'telemetry-events.jsonl');
  const maxEvents = Number.isInteger(options.maxEvents) ? Math.max(500, options.maxEvents) : MAX_EVENTS;
  let writeQueue = Promise.resolve();

  async function readAll() {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return raw.split(/\r?\n/u).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return undefined; } }).filter(Boolean);
    } catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  }
  async function trim() {
    const entries = await readAll();
    if (entries.length > maxEvents) await fs.writeFile(filePath, `${entries.slice(-maxEvents).map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
  }
  function record(input = {}) {
    const operation = writeQueue.then(async () => {
      await fs.mkdir(rootDir, { recursive: true });
      const event = normalize(input);
      await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
      await trim();
      return { ok: true, event };
    });
    writeQueue = operation.then(() => undefined, () => undefined);
    return operation.catch((error) => ({ ok: false, error: text(error?.message || error) }));
  }
  function recordMany(inputs = []) { return Promise.all(inputs.filter(Boolean).map((item) => record(item))); }
  async function query(options = {}) {
    const limit = Math.max(1, Math.min(1000, Number(options.limit) || 200));
    const after = Number(options.after) || 0;
    const matches = (entry) => (!after || entry.occurredAt >= after)
      && (!options.taskId || entry.taskId === String(options.taskId))
      && (!options.projectId || entry.projectId === String(options.projectId))
      && (!options.type || entry.type === String(options.type))
      && (!options.severity || entry.severity === String(options.severity))
      && (!options.failureClass || entry.failureClass === String(options.failureClass));
    const all = (await readAll()).filter(matches);
    return { ok: true, filePath, total: all.length, entries: clone(all.slice(-limit).reverse()) };
  }
  async function summary(options = {}) {
    const entries = (await query({ ...options, limit: maxEvents })).entries || [];
    const by = (field) => Object.fromEntries(entries.reduce((map, entry) => { const value = String(entry[field] || 'unknown'); map.set(value, (map.get(value) || 0) + 1); return map; }, new Map()));
    const active = entries.find((entry) => entry.taskId && !['completed', 'failed', 'stopped', 'canceled'].includes(entry.status || ''));
    const totalTokens = entries.reduce((sum, entry) => sum + (Number(entry.usage?.totalTokens) || 0), 0);
    return { ok: true, total: entries.length, errors: entries.filter((entry) => entry.severity === 'error').length, warnings: entries.filter((entry) => entry.severity === 'warning').length,
      totalTokens, byType: by('type'), byFailureClass: by('failureClass'), latest: entries.slice(0, 30), activeTask: active ? clone(active) : undefined };
  }
  async function exportData(options = {}) { return { format: 'taiji-runtime-telemetry/v1', exportedAt: Date.now(), filters: redact(options), events: (await query({ ...options, limit: maxEvents })).entries || [] }; }
  return { filePath, record, recordMany, query, summary, exportData };
}

module.exports = { SCHEMA_VERSION, createTelemetryLedger, normalize };
