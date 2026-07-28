const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const SCHEMA_VERSION = 2;
const LEDGER_VERSION = 1;
const DEFAULT_MAX_RUNS = 120;
const DEFAULT_MAX_RETURNED_EVENTS = 2000;
function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isTaskRun(value) {
  return value && typeof value === 'object'
    && typeof value.id === 'string'
    && typeof value.teamId === 'string'
    && typeof value.status === 'string'
    && Array.isArray(value.steps);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stableValue(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function equal(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function collectChanges(previous, next, basePath = []) {
  if (equal(previous, next)) return [];
  if (!isObject(previous) || !isObject(next)) {
    return [{ op: 'set', path: basePath, value: clone(next) }];
  }
  const changes = [];
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of [...keys].sort()) {
    const childPath = [...basePath, key];
    if (!(key in next)) changes.push({ op: 'remove', path: childPath });
    else if (!(key in previous)) changes.push({ op: 'set', path: childPath, value: clone(next[key]) });
    else changes.push(...collectChanges(previous[key], next[key], childPath));
  }
  return changes;
}

function applyChanges(value, changes) {
  let result = clone(value);
  for (const change of changes) {
    if (!Array.isArray(change.path) || change.path.length === 0) {
      if (change.op !== 'set') throw new Error('根路径只允许 set');
      result = clone(change.value);
      continue;
    }
    let target = result;
    for (let index = 0; index < change.path.length - 1; index += 1) {
      const key = change.path[index];
      if (!isObject(target[key])) target[key] = {};
      target = target[key];
    }
    const key = change.path.at(-1);
    if (change.op === 'remove') delete target[key];
    else if (change.op === 'set') target[key] = clone(change.value);
    else throw new Error(`未知变更操作：${change.op}`);
  }
  return result;
}

function eventHash(event) {
  const copy = { ...event };
  delete copy.hash;
  return crypto.createHash('sha256').update(stableStringify(copy)).digest('hex');
}

function eventDomains(changes) {
  return [...new Set(changes.map((change) => String(change.path?.[0] ?? 'task')).filter(Boolean))].sort();
}

function statusDetail(previousStatus, nextStatus, domains) {
  const status = previousStatus !== nextStatus ? `${previousStatus || '无'} -> ${nextStatus || '无'}` : '';
  const changed = domains.length ? `变化域：${domains.join('、')}` : '';
  return [status, changed].filter(Boolean).join('；') || '任务投影已更新';
}

function createEvent(input, head) {
  const sequence = head.sequence + 1;
  const occurredAt = Number(input.occurredAt) || Date.now();
  const base = {
    eventVersion: LEDGER_VERSION,
    eventId: `task-event-${sequence}-${crypto.randomUUID()}`,
    sequence,
    occurredAt,
    type: input.type,
    taskId: input.taskId,
    teamId: input.teamId,
    source: String(input.source || 'renderer').slice(0, 80),
    ...(input.sessionId ? { sessionId: String(input.sessionId).slice(0, 160) } : {}),
    previousStatus: input.previousStatus,
    nextStatus: input.nextStatus,
    domains: input.domains ?? [],
    detail: String(input.detail || '').slice(0, 800),
    payload: clone(input.payload ?? {}),
    previousHash: head.hash,
  };
  return { ...base, hash: eventHash(base) };
}

function applyEvent(projected, event) {
  if (event.type === 'task_created' || event.type === 'task_migrated') {
    if (!isTaskRun(event.payload?.snapshot)) throw new Error('创建事件缺少有效任务快照');
    projected.set(event.taskId, clone(event.payload.snapshot));
    return;
  }
  if (event.type === 'task_changed') {
    const current = projected.get(event.taskId);
    if (!current) throw new Error('更新事件找不到任务');
    const next = applyChanges(current, event.payload?.changes ?? []);
    if (!isTaskRun(next) || next.id !== event.taskId) throw new Error('更新事件产生无效任务投影');
    projected.set(event.taskId, next);
    return;
  }
  if (event.type === 'task_removed') {
    projected.delete(event.taskId);
    return;
  }
  throw new Error(`未知任务事件：${event.type}`);
}

async function atomicWrite(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, 'utf8');
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    try { await fs.rm(tempPath, { force: true }); } catch {}
    throw error;
  }
}

function createTaskRuntimeStore(rootDir, options = {}) {
  const maxRuns = Number.isInteger(options.maxRuns) && options.maxRuns > 0 ? options.maxRuns : DEFAULT_MAX_RUNS;
  const maxReturnedEvents = Number.isInteger(options.maxReturnedEvents) && options.maxReturnedEvents > 0
    ? options.maxReturnedEvents : DEFAULT_MAX_RETURNED_EVENTS;
  const checkpointPath = path.join(rootDir, 'task-runs.json');
  const ledgerPath = path.join(rootDir, 'task-events.jsonl');
  let writeQueue = Promise.resolve();
  let initialized = false;
  let initializationPromise;
  let projected = new Map();
  let events = [];
  let integrity = { ok: true, recovered: false, lastSequence: 0, lastHash: '', eventCount: 0 };

  async function readLegacyCheckpoint() {
    try {
      const parsed = JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
      if (!parsed || !Array.isArray(parsed.runs) || !parsed.runs.every(isTaskRun)) throw new Error('任务快照包含无效任务记录');
      return { ok: true, exists: true, schemaVersion: parsed.schemaVersion, runs: parsed.runs.slice(-maxRuns) };
    } catch (error) {
      if (error?.code === 'ENOENT') return { ok: true, exists: false, runs: [] };
      return { ok: false, exists: true, runs: [], error: `读取任务快照失败：${error?.message ?? String(error)}` };
    }
  }

  async function recoverLedgerTail(validLines, invalidLines) {
    if (invalidLines.length === 0) return undefined;
    const corruptPath = path.join(rootDir, `task-events-corrupt-${Date.now()}.jsonl`);
    await fs.writeFile(corruptPath, invalidLines.join('\n'), 'utf8');
    await fs.writeFile(ledgerPath, validLines.length ? `${validLines.join('\n')}\n` : '', 'utf8');
    return corruptPath;
  }

  async function readLedger() {
    let raw;
    try { raw = await fs.readFile(ledgerPath, 'utf8'); }
    catch (error) {
      if (error?.code === 'ENOENT') return { exists: false, events: [], projected: new Map(), recovered: false };
      throw error;
    }
    const lines = raw.split(/\r?\n/u).filter((line) => line.trim());
    const validLines = [];
    const validEvents = [];
    const state = new Map();
    let previousHash = '';
    let previousSequence = 0;
    let invalidIndex = -1;
    for (let index = 0; index < lines.length; index += 1) {
      try {
        const event = JSON.parse(lines[index]);
        if (!event || event.eventVersion !== LEDGER_VERSION || event.sequence !== previousSequence + 1) throw new Error('事件版本或序号无效');
        if (event.previousHash !== previousHash || event.hash !== eventHash(event)) throw new Error('事件哈希链无效');
        applyEvent(state, event);
        validLines.push(lines[index]);
        validEvents.push(event);
        previousHash = event.hash;
        previousSequence = event.sequence;
      } catch {
        invalidIndex = index;
        break;
      }
    }
    const invalidLines = invalidIndex >= 0 ? lines.slice(invalidIndex) : [];
    const corruptPath = await recoverLedgerTail(validLines, invalidLines);
    return { exists: true, events: validEvents, projected: state, recovered: invalidLines.length > 0, corruptPath };
  }

  async function writeCheckpoint() {
    const runs = [...projected.values()].slice(-maxRuns);
    const payload = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      ledgerVersion: LEDGER_VERSION,
      updatedAt: Date.now(),
      lastSequence: integrity.lastSequence,
      lastHash: integrity.lastHash,
      runs,
    }, null, 2);
    await atomicWrite(checkpointPath, payload);
  }

  async function appendEvents(nextEvents) {
    if (nextEvents.length === 0) return;
    await fs.mkdir(rootDir, { recursive: true });
    await fs.appendFile(ledgerPath, `${nextEvents.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
    events.push(...nextEvents);
    integrity = {
      ...integrity,
      ok: true,
      lastSequence: nextEvents.at(-1).sequence,
      lastHash: nextEvents.at(-1).hash,
      eventCount: events.length,
    };
  }

  async function initializeOnce() {
    await fs.mkdir(rootDir, { recursive: true });
    const ledger = await readLedger();
    let legacyForMigration;
    if (ledger.exists && ledger.events.length === 0) {
      const candidate = await readLegacyCheckpoint();
      if (candidate.ok && candidate.exists && candidate.schemaVersion !== SCHEMA_VERSION && candidate.runs.length > 0) {
        legacyForMigration = candidate;
      }
    }
    if (ledger.exists && !legacyForMigration) {
      projected = ledger.projected;
      events = ledger.events;
      integrity = {
        ok: true,
        recovered: ledger.recovered,
        corruptPath: ledger.corruptPath,
        lastSequence: events.at(-1)?.sequence ?? 0,
        lastHash: events.at(-1)?.hash ?? '',
        eventCount: events.length,
      };
      await writeCheckpoint();
      initialized = true;
      return;
    }
    const legacy = legacyForMigration ?? await readLegacyCheckpoint();
    if (!legacy.ok) throw new Error(legacy.error);
    projected = new Map();
    events = [];
    integrity = { ok: true, recovered: false, lastSequence: 0, lastHash: '', eventCount: 0 };
    const migrated = [];
    for (const run of legacy.runs) {
      const event = createEvent({
        type: 'task_migrated', taskId: run.id, teamId: run.teamId, source: 'snapshot-migration',
        nextStatus: run.status, domains: ['task'], detail: '从 v0.17 任务快照迁入追加式事件账本', payload: { snapshot: run },
      }, { sequence: integrity.lastSequence + migrated.length, hash: migrated.at(-1)?.hash ?? integrity.lastHash });
      migrated.push(event);
      applyEvent(projected, event);
    }
    await appendEvents(migrated);
    if (legacy.exists || migrated.length > 0) await writeCheckpoint();
    initialized = true;
  }

  async function initialize() {
    if (initialized) return;
    if (!initializationPromise) {
      initializationPromise = initializeOnce().catch((error) => {
        initializationPromise = undefined;
        throw error;
      });
    }
    await initializationPromise;
  }

  async function read(options = {}) {
    await writeQueue;
    try {
      await initialize();
      const taskId = String(options.taskId || '');
      const limit = Math.max(1, Math.min(maxReturnedEvents, Number(options.limit) || maxReturnedEvents));
      const selectedEvents = events.filter((event) => !taskId || event.taskId === taskId).slice(-limit);
      return {
        ok: true,
        exists: events.length > 0 || projected.size > 0,
        schemaVersion: SCHEMA_VERSION,
        ledgerVersion: LEDGER_VERSION,
        runs: [...projected.values()].slice(-maxRuns).map(clone),
        events: selectedEvents.map(clone),
        integrity: { ...integrity },
      };
    } catch (error) {
      return { ok: false, exists: true, runs: [], events: [], error: `读取任务事件账本失败：${error?.message ?? String(error)}` };
    }
  }

  function write(runs, metadata = {}) {
    if (!Array.isArray(runs) || !runs.every(isTaskRun)) return Promise.resolve({ ok: false, error: '任务快照写入内容无效' });
    const nextRuns = runs.slice(-maxRuns).map(clone);
    const operation = writeQueue.then(async () => {
      await initialize();
      const nextMap = new Map(nextRuns.map((run) => [run.id, run]));
      const nextProjection = new Map([...projected].map(([id, run]) => [id, clone(run)]));
      const appended = [];
      let head = { sequence: integrity.lastSequence, hash: integrity.lastHash };
      const add = (input) => {
        const event = createEvent(input, head);
        appended.push(event);
        applyEvent(nextProjection, event);
        head = { sequence: event.sequence, hash: event.hash };
      };
      for (const current of [...nextProjection.values()]) {
        if (!nextMap.has(current.id)) add({
          type: 'task_removed', taskId: current.id, teamId: current.teamId,
          source: metadata.source, sessionId: metadata.sessionId, previousStatus: current.status,
          domains: ['task'], detail: `任务已从列表移除：${current.title || current.id}`, payload: {},
        });
      }
      for (const next of nextRuns) {
        const current = projected.get(next.id);
        if (!current) {
          add({
            type: 'task_created', taskId: next.id, teamId: next.teamId,
            source: metadata.source, sessionId: metadata.sessionId, nextStatus: next.status,
            domains: ['task'], detail: `任务已创建：${next.title || next.id}`, payload: { snapshot: next },
          });
          continue;
        }
        const changes = collectChanges(current, next);
        if (changes.length === 0) continue;
        const domains = eventDomains(changes);
        add({
          type: 'task_changed', taskId: next.id, teamId: next.teamId,
          source: metadata.source, sessionId: metadata.sessionId,
          previousStatus: current.status, nextStatus: next.status, domains,
          detail: metadata.detail || statusDetail(current.status, next.status, domains),
          payload: { changes, ...(metadata.command ? { command: clone(metadata.command) } : {}) },
        });
      }
      await appendEvents(appended);
      projected = nextProjection;
      await writeCheckpoint();
      return {
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        ledgerVersion: LEDGER_VERSION,
        count: nextRuns.length,
        eventsAppended: appended.length,
        events: appended.map(clone),
        integrity: { ...integrity },
      };
    });
    writeQueue = operation.then(() => undefined, () => undefined);
    return operation.catch((error) => ({ ok: false, error: `写入任务事件账本失败：${error?.message ?? String(error)}` }));
  }

  function updateTask(taskId, updater, metadata = {}) {
    if (typeof taskId !== 'string' || !taskId || typeof updater !== 'function') {
      return Promise.resolve({ ok: false, error: '任务原子更新参数无效' });
    }
    const operation = writeQueue.then(async () => {
      await initialize();
      const current = projected.get(taskId);
      if (!current) throw new Error(`找不到任务：${taskId}`);
      const next = clone(current);
      const returned = updater(next);
      const candidate = returned === undefined ? next : returned;
      if (!isTaskRun(candidate) || candidate.id !== taskId) throw new Error('任务原子更新产生无效投影');
      candidate.updatedAt = Date.now();
      const changes = collectChanges(current, candidate);
      if (changes.length === 0) {
        return { ok: true, unchanged: true, run: clone(current), events: [], integrity: { ...integrity } };
      }
      const domains = eventDomains(changes);
      const event = createEvent({
        type: 'task_changed', taskId, teamId: candidate.teamId,
        source: metadata.source || 'task-worker', sessionId: metadata.sessionId,
        previousStatus: current.status, nextStatus: candidate.status, domains,
        detail: metadata.detail || statusDetail(current.status, candidate.status, domains),
        payload: { changes, ...(metadata.command ? { command: clone(metadata.command) } : {}) },
      }, { sequence: integrity.lastSequence, hash: integrity.lastHash });
      const nextProjection = new Map([...projected].map(([id, run]) => [id, clone(run)]));
      applyEvent(nextProjection, event);
      await appendEvents([event]);
      projected = nextProjection;
      await writeCheckpoint();
      return { ok: true, unchanged: false, run: clone(candidate), events: [clone(event)], integrity: { ...integrity } };
    });
    writeQueue = operation.then(() => undefined, () => undefined);
    return operation.catch((error) => ({ ok: false, error: `更新任务事件账本失败：${error?.message ?? String(error)}` }));
  }

  function removeTask(taskId, metadata = {}) {
    if (typeof taskId !== 'string' || !taskId) return Promise.resolve({ ok: false, error: '任务移除参数无效' });
    const operation = writeQueue.then(async () => {
      await initialize();
      const current = projected.get(taskId);
      if (!current) return { ok: true, unchanged: true, events: [], integrity: { ...integrity } };
      const event = createEvent({
        type: 'task_removed', taskId, teamId: current.teamId,
        source: metadata.source || 'task-worker', sessionId: metadata.sessionId,
        previousStatus: current.status, domains: ['task'],
        detail: metadata.detail || `任务已从列表移除：${current.title || current.id}`,
        payload: { ...(metadata.command ? { command: clone(metadata.command) } : {}) },
      }, { sequence: integrity.lastSequence, hash: integrity.lastHash });
      const nextProjection = new Map([...projected].map(([id, run]) => [id, clone(run)]));
      applyEvent(nextProjection, event);
      await appendEvents([event]);
      projected = nextProjection;
      await writeCheckpoint();
      return { ok: true, unchanged: false, events: [clone(event)], integrity: { ...integrity } };
    });
    writeQueue = operation.then(() => undefined, () => undefined);
    return operation.catch((error) => ({ ok: false, error: `移除任务事件账本失败：${error?.message ?? String(error)}` }));
  }

  return { checkpointPath, ledgerPath, filePath: checkpointPath, read, write, updateTask, removeTask };
}

module.exports = {
  SCHEMA_VERSION,
  LEDGER_VERSION,
  DEFAULT_MAX_RUNS,
  createTaskRuntimeStore,
  collectChanges,
  applyChanges,
  eventHash,
};
