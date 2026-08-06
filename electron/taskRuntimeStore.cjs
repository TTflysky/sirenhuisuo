const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

const SCHEMA_VERSION = 3;
const LEDGER_VERSION = 1;
const RECOVERY_POINT_VERSION = 1;
const DEFAULT_MAX_RUNS = 120;
const DEFAULT_MAX_RETURNED_EVENTS = 2000;
const DEFAULT_DEFERRED_CHECKPOINT_THRESHOLD_BYTES = 2 * 1024 * 1024;
const DEFAULT_CHECKPOINT_DEBOUNCE_MS = 500;
let autonomousControlPromise;

function loadAutonomousControl() {
  if (!autonomousControlPromise) {
    autonomousControlPromise = import(pathToFileURL(path.join(__dirname, '../src/engine/autonomousControl.mjs')).href);
  }
  return autonomousControlPromise;
}

async function reconcileTaskControl(run, now = Date.now()) {
  const { reconcileAutonomousControl } = await loadAutonomousControl();
  return reconcileAutonomousControl(run, { now });
}
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

function digest(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function verifiedEnvelope(value) {
  const payload = clone(value);
  return { ...payload, checksum: digest(payload) };
}

function verifyEnvelope(value) {
  if (!isObject(value) || typeof value.checksum !== 'string') return false;
  const payload = { ...value };
  delete payload.checksum;
  return digest(payload) === value.checksum;
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

function searchableRun(run) {
  const steps = Array.isArray(run.steps) ? run.steps : [];
  const evidence = Array.isArray(run.evidence) ? run.evidence : [];
  const executionMessages = Array.isArray(run.executionMessages) ? run.executionMessages : [];
  const context = run.context || {};
  const contextSummary = context.summary || {};
  return [
    run.id, run.teamId, run.title, run.request, run.goal, run.workspaceId, run.lastError,
    ...(run.acceptanceCriteria || []),
    ...(run.memberSnapshot || []).flatMap((member) => [member.name, member.title]),
    ...steps.flatMap((step) => [
      step.title, step.assignment, step.lastError, step.reviewReason,
      ...(step.events || []).map((event) => event.detail),
      ...(step.evidence || []).map((item) => item.summary),
    ]),
    ...evidence.map((item) => item.summary),
    ...(run.verification || []).flatMap((item) => [item.label, item.detail]),
    ...(run.preflight || []).flatMap((item) => [item.label, item.detail]),
    ...(run.skillRefs || []).flatMap((item) => [item.name, item.description]),
    ...(run.skillEvidence || []).flatMap((item) => [item.skillName, item.skillId, item.toolName, item.detail, item.reason]),
    run.handoff?.blocked, run.handoff?.nextAction, ...(run.handoff?.completed || []),
    run.recoveryContext?.summary, run.recoveryContext?.waitingFor, run.recoveryContext?.interruptionReason,
    ...(run.recoveryContext?.completedEvidence || []), ...(run.recoveryContext?.unresolvedIssues || []),
    contextSummary.narrative, contextSummary.modelNarrative,
    ...(contextSummary.verifiedFacts || []), ...(contextSummary.artifactPaths || []), ...(contextSummary.blockers || []),
    ...(context.events || []).map((event) => event.summary),
    ...(run.runner?.events || []).map((event) => event.detail),
    ...executionMessages.map((message) => message.content),
  ]
    .map((value) => String(value ?? '').toLocaleLowerCase())
    .join('\n')
    .slice(0, 60000);
}

function taskIndexEntry(run) {
  return {
    id: run.id,
    teamId: run.teamId,
    title: String(run.title || run.id).slice(0, 240),
    status: run.status,
    phase: run.phase,
    workspaceId: run.workspaceId,
    createdAt: Number(run.createdAt) || 0,
    updatedAt: Number(run.updatedAt) || 0,
    search: searchableRun(run),
  };
}

function projectEvents(sourceEvents, sequence = Number.MAX_SAFE_INTEGER) {
  const state = new Map();
  for (const event of sourceEvents) {
    if (event.sequence > sequence) break;
    applyEvent(state, event);
  }
  return state;
}

function eventDomains(changes) {
  return [...new Set(changes.map((change) => String(change.path?.[0] ?? 'task')).filter(Boolean))].sort();
}

function statusDetail(previousStatus, nextStatus, domains) {
  const status = previousStatus !== nextStatus ? `${previousStatus || '无'} -> ${nextStatus || '无'}` : '';
  const changed = domains.length ? `变化域：${domains.join('、')}` : '';
  return [status, changed].filter(Boolean).join('；') || '任务投影已更新';
}

function mergeWorkerAuthority(current, incoming, source) {
  const next = clone(incoming);
  if (current) {
    if (!next.projectId && current.projectId) next.projectId = current.projectId;
    if (!next.goalState && current.goalState) next.goalState = clone(current.goalState);
    if (!next.situationModel && current.situationModel) next.situationModel = clone(current.situationModel);
    if (!next.factLedger && current.factLedger) next.factLedger = clone(current.factLedger);
    if (!next.adaptivePlanGraph && current.adaptivePlanGraph) next.adaptivePlanGraph = clone(current.adaptivePlanGraph);
    if (!next.autonomousControl && current.autonomousControl) next.autonomousControl = clone(current.autonomousControl);
  }
  if (source !== 'renderer' || !current?.worker) return next;
  if (current.worker.adapter === 'main-native-execution-adapter') {
    // Native jobs own their complete projection. Renderer windows only read it
    // and send control commands, so a stale full snapshot must not erase
    // messages, evidence, revisions, recovery context or verification.
    return clone(current);
  }
  const currentSequence = Number(current.worker.checkpointSequence) || 0;
  const incomingSequence = Number(next.worker?.checkpointSequence) || 0;
  if (currentSequence < incomingSequence) return next;
  next.worker = clone(current.worker);

  const checkpoint = current.worker.lastCheckpoint;
  if (checkpoint?.stepId) {
    const currentStep = current.steps.find((step) => step.id === checkpoint.stepId);
    const incomingStep = next.steps.find((step) => step.id === checkpoint.stepId);
    if (currentStep && incomingStep) {
      if (checkpoint.kind === 'step_completed' || checkpoint.kind === 'step_failed') {
        Object.assign(incomingStep, clone(currentStep));
      } else if (checkpoint.kind === 'step_started' && ['queued', 'paused'].includes(incomingStep.status)) {
        incomingStep.status = currentStep.status;
        incomingStep.startedAt = currentStep.startedAt;
        incomingStep.attempts = currentStep.attempts;
        incomingStep.events = clone(currentStep.events);
      }
    }
  }
  if (checkpoint?.kind === 'run_failed' || checkpoint?.kind === 'run_finished') {
    next.status = current.status;
    next.phase = current.phase;
    next.lastError = current.lastError;
  }
  if (['paused', 'expired', 'stopped'].includes(current.worker.state)) {
    next.status = current.status;
    next.phase = current.phase;
    next.lastError = current.lastError;
    next.handoff = clone(current.handoff);
    next.steps = clone(current.steps);
  }
  return next;
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

const TRANSIENT_RENAME_ERRORS = new Set(['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM']);
const ATOMIC_RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200, 400, 800, 1200];

async function atomicWrite(filePath, content, options = {}) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const rename = options.renameImpl || fs.rename;
  const delay = options.delayImpl || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const retryDelays = options.retryDelays || ATOMIC_RENAME_RETRY_DELAYS_MS;
  await fs.writeFile(tempPath, content, 'utf8');
  try {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(tempPath, filePath);
        break;
      } catch (error) {
        const retryDelay = retryDelays[attempt];
        if (!TRANSIENT_RENAME_ERRORS.has(error?.code) || retryDelay === undefined) throw error;
        await delay(retryDelay);
      }
    }
  } catch (error) {
    try { await fs.rm(tempPath, { force: true }); } catch {}
    throw error;
  }
}

function createTaskRuntimeStore(rootDir, options = {}) {
  const diagnostics = options.diagnostics;
  const maxRuns = Number.isInteger(options.maxRuns) && options.maxRuns > 0 ? options.maxRuns : DEFAULT_MAX_RUNS;
  const maxReturnedEvents = Number.isInteger(options.maxReturnedEvents) && options.maxReturnedEvents > 0
    ? options.maxReturnedEvents : DEFAULT_MAX_RETURNED_EVENTS;
  const checkpointPath = path.join(rootDir, 'task-runs.json');
  const ledgerPath = path.join(rootDir, 'task-events.jsonl');
  const indexPath = path.join(rootDir, 'task-index.json');
  const recoveryDir = path.join(rootDir, 'task-recovery-points');
  let writeQueue = Promise.resolve();
  let initialized = false;
  let initializationPromise;
  let checkpointTimer;
  let checkpointBytes = 0;
  let projected = new Map();
  let events = [];
  let integrity = { ok: true, recovered: false, snapshotValid: true, indexValid: true, lastSequence: 0, lastHash: '', eventCount: 0 };

  async function reportFailure(operation, error, details = {}) {
    const message = String(error?.message ?? error);
    await diagnostics?.record({
      scope: 'task-runtime-store', operation, taskId: details.taskId, teamId: details.teamId,
      message, error, context: { source: details.source, sessionId: details.sessionId, detail: details.detail, runCount: details.runCount },
    });
  }

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
    const payload = verifiedEnvelope({
      schemaVersion: SCHEMA_VERSION,
      ledgerVersion: LEDGER_VERSION,
      updatedAt: Date.now(),
      lastSequence: integrity.lastSequence,
      lastHash: integrity.lastHash,
      runs,
    });
    const checkpointText = JSON.stringify(payload, null, 2);
    await atomicWrite(checkpointPath, checkpointText);
    checkpointBytes = Buffer.byteLength(checkpointText, 'utf8');
    const indexPayload = verifiedEnvelope({
      schemaVersion: SCHEMA_VERSION,
      updatedAt: payload.updatedAt,
      lastSequence: integrity.lastSequence,
      lastHash: integrity.lastHash,
      entries: runs.map(taskIndexEntry).sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)),
    });
    await atomicWrite(indexPath, JSON.stringify(indexPayload, null, 2));
    integrity.snapshotValid = true;
    integrity.indexValid = true;
  }

  function deferCheckpoint() {
    if (checkpointTimer) clearTimeout(checkpointTimer);
    integrity.snapshotValid = false;
    integrity.indexValid = false;
    checkpointTimer = setTimeout(() => {
      checkpointTimer = undefined;
      const operation = writeQueue.then(() => writeCheckpoint());
      writeQueue = operation.then(() => undefined, () => undefined);
      operation.catch((error) => reportFailure('deferred-checkpoint', error));
    }, Number(options.checkpointDebounceMs) || DEFAULT_CHECKPOINT_DEBOUNCE_MS);
  }

  async function persistCheckpoint() {
    const threshold = Number(options.deferredCheckpointThresholdBytes) || DEFAULT_DEFERRED_CHECKPOINT_THRESHOLD_BYTES;
    if (checkpointBytes >= threshold) {
      deferCheckpoint();
      return;
    }
    await writeCheckpoint();
  }

  async function validateCachedProjection() {
    try {
      const checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
      integrity.snapshotValid = verifyEnvelope(checkpoint)
        && checkpoint.schemaVersion === SCHEMA_VERSION
        && checkpoint.lastSequence === integrity.lastSequence
        && checkpoint.lastHash === integrity.lastHash;
    } catch (error) {
      integrity.snapshotValid = error?.code === 'ENOENT' ? events.length === 0 : false;
    }
    try {
      const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
      integrity.indexValid = verifyEnvelope(index)
        && index.schemaVersion === SCHEMA_VERSION
        && index.lastSequence === integrity.lastSequence
        && index.lastHash === integrity.lastHash;
    } catch (error) {
      integrity.indexValid = error?.code === 'ENOENT' ? events.length === 0 : false;
    }
    integrity.snapshotRebuilt = !integrity.snapshotValid;
    integrity.indexRebuilt = !integrity.indexValid;
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

  async function migrateAutonomousProjection() {
    const appended = [];
    let head = { sequence: integrity.lastSequence, hash: integrity.lastHash };
    const now = Date.now();
    for (const current of [...projected.values()]) {
      const candidate = await reconcileTaskControl(current, now);
      const changes = collectChanges(current, candidate);
      if (changes.length === 0) continue;
      const event = createEvent({
        type: 'task_changed', taskId: current.id, teamId: current.teamId,
        source: 'autonomous-control-migration', previousStatus: current.status, nextStatus: candidate.status,
        domains: eventDomains(changes), detail: 'Initialized or upgraded the v3.7 adaptive planning snapshot.',
        payload: { changes },
      }, head);
      appended.push(event);
      applyEvent(projected, event);
      head = { sequence: event.sequence, hash: event.hash };
    }
    await appendEvents(appended);
    return appended.length;
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
      await migrateAutonomousProjection();
      await validateCachedProjection();
      await persistCheckpoint();
      initialized = true;
      return;
    }
    const legacy = legacyForMigration ?? await readLegacyCheckpoint();
    if (!legacy.ok) throw new Error(legacy.error);
    projected = new Map();
    events = [];
    integrity = { ok: true, recovered: false, snapshotValid: true, indexValid: true, lastSequence: 0, lastHash: '', eventCount: 0 };
    const migrated = [];
    for (const legacyRun of legacy.runs) {
      const run = await reconcileTaskControl(legacyRun);
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
      const teamId = String(options.teamId || '');
      const projectId = String(options.projectId || '');
      const conversationId = String(options.conversationId || '');
      const query = String(options.query || '').trim().toLocaleLowerCase();
      const statuses = new Set((Array.isArray(options.statuses) ? options.statuses : options.status ? [options.status] : []).map(String));
      const updatedAfter = Number(options.updatedAfter) || 0;
      const updatedBefore = Number(options.updatedBefore) || Number.MAX_SAFE_INTEGER;
      const cursor = Math.max(0, Number(options.cursor) || 0);
      const limit = Math.max(1, Math.min(maxReturnedEvents, Number(options.limit) || maxReturnedEvents));
      const allRuns = [...projected.values()].sort((left, right) => (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0));
      const filteredRuns = allRuns.filter((run) => (!taskId || run.id === taskId)
        && (!teamId || run.teamId === teamId)
        && (!projectId || run.projectId === projectId)
        && (!conversationId || run.conversationId === conversationId)
        && (statuses.size === 0 || statuses.has(run.status))
        && (Number(run.updatedAt) || 0) >= updatedAfter
        && (Number(run.updatedAt) || 0) <= updatedBefore
        && (!query || searchableRun(run).includes(query)));
      const selectedEvents = events.filter((event) => (!taskId || event.taskId === taskId)
        && (!teamId || event.teamId === teamId)
        && (!projectId || projected.get(event.taskId)?.projectId === projectId)
        && (!conversationId || projected.get(event.taskId)?.conversationId === conversationId)
        && (!options.afterSequence || event.sequence > Number(options.afterSequence))
        && (!options.beforeSequence || event.sequence < Number(options.beforeSequence))).slice(-limit);
      return {
        ok: true,
        exists: events.length > 0 || projected.size > 0,
        schemaVersion: SCHEMA_VERSION,
        ledgerVersion: LEDGER_VERSION,
        runs: filteredRuns.slice(cursor, cursor + Math.min(maxRuns, limit)).map(clone),
        page: { cursor, nextCursor: cursor + limit < filteredRuns.length ? cursor + limit : undefined, total: filteredRuns.length },
        events: selectedEvents.map(clone),
        integrity: { ...integrity },
      };
    } catch (error) {
      return { ok: false, exists: true, runs: [], events: [], error: `读取任务事件账本失败：${error?.message ?? String(error)}` };
    }
  }

  async function audit(options = {}) {
    return read({ ...options, cursor: 0, limit: options.limit || 500 }).then((result) => ({
      ...result,
      runs: undefined,
      page: {
        cursor: Number(options.afterSequence) || 0,
        nextCursor: result.events?.at(-1)?.sequence,
        total: result.events?.length ?? 0,
      },
    }));
  }

  function rebuild(options = {}) {
    const operation = writeQueue.then(async () => {
      await initialize();
      const sequence = Math.max(0, Math.min(integrity.lastSequence, Number(options.sequence) || integrity.lastSequence));
      const state = projectEvents(events, sequence);
      const taskId = String(options.taskId || '');
      const runs = [...state.values()].filter((run) => !taskId || run.id === taskId).map(clone);
      return {
        ok: true,
        sequence,
        headHash: events.find((event) => event.sequence === sequence)?.hash ?? '',
        runs,
        checksum: digest({ sequence, runs }),
      };
    });
    return operation.catch((error) => ({ ok: false, error: `重建任务投影失败：${error?.message ?? String(error)}` }));
  }

  function createRecoveryPoint(options = {}) {
    const operation = writeQueue.then(async () => {
      await initialize();
      await fs.mkdir(recoveryDir, { recursive: true });
      const taskId = String(options.taskId || '');
      const runs = [...projected.values()].filter((run) => !taskId || run.id === taskId).map(clone);
      if (taskId && runs.length === 0) throw new Error(`找不到任务：${taskId}`);
      const createdAt = Date.now();
      const recoveryPointId = `recovery-${createdAt}-${crypto.randomUUID().slice(0, 8)}`;
      const envelope = verifiedEnvelope({
        recoveryPointVersion: RECOVERY_POINT_VERSION,
        recoveryPointId,
        label: String(options.label || '手动恢复点').slice(0, 160),
        taskId: taskId || undefined,
        createdAt,
        lastSequence: integrity.lastSequence,
        lastHash: integrity.lastHash,
        runs,
      });
      await atomicWrite(path.join(recoveryDir, `${recoveryPointId}.json`), JSON.stringify(envelope, null, 2));
      return { ok: true, recoveryPoint: clone(envelope) };
    });
    writeQueue = operation.then(() => undefined, () => undefined);
    return operation.catch((error) => ({ ok: false, error: `创建任务恢复点失败：${error?.message ?? String(error)}` }));
  }

  async function readRecoveryPoint(recoveryPointId) {
    if (!/^recovery-\d+-[a-f0-9-]+$/iu.test(String(recoveryPointId || ''))) throw new Error('恢复点编号无效');
    const point = JSON.parse(await fs.readFile(path.join(recoveryDir, `${recoveryPointId}.json`), 'utf8'));
    if (point.recoveryPointVersion !== RECOVERY_POINT_VERSION || !verifyEnvelope(point) || !Array.isArray(point.runs) || !point.runs.every(isTaskRun)) {
      throw new Error('恢复点校验失败，已拒绝使用');
    }
    return point;
  }

  function listRecoveryPoints(options = {}) {
    const operation = writeQueue.then(async () => {
      await initialize();
      let names = [];
      try { names = await fs.readdir(recoveryDir); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      const points = [];
      for (const name of names.filter((item) => item.endsWith('.json')).sort().reverse()) {
        try {
          const point = await readRecoveryPoint(name.slice(0, -5));
          if (!options.taskId || point.taskId === options.taskId || point.runs.some((run) => run.id === options.taskId)) {
            points.push({ recoveryPointId: point.recoveryPointId, label: point.label, taskId: point.taskId, createdAt: point.createdAt, lastSequence: point.lastSequence, runCount: point.runs.length, checksum: point.checksum });
          }
        } catch {}
      }
      return { ok: true, recoveryPoints: points.slice(0, Math.max(1, Math.min(200, Number(options.limit) || 50))) };
    });
    return operation.catch((error) => ({ ok: false, error: `读取任务恢复点失败：${error?.message ?? String(error)}` }));
  }

  function restoreRecoveryPoint(recoveryPointId, metadata = {}) {
    const operation = writeQueue.then(async () => {
      await initialize();
      const point = await readRecoveryPoint(recoveryPointId);
      const restoreIds = new Set(point.runs.map((run) => run.id));
      const nextProjection = new Map(projected);
      const appended = [];
      let head = { sequence: integrity.lastSequence, hash: integrity.lastHash };
      for (const storedSnapshot of point.runs) {
        const snapshot = await reconcileTaskControl(storedSnapshot);
        const current = nextProjection.get(snapshot.id);
        const changes = current ? collectChanges(current, snapshot) : [];
        const event = createEvent({
          type: current ? 'task_changed' : 'task_created', taskId: snapshot.id, teamId: snapshot.teamId,
          source: metadata.source || 'task-recovery', sessionId: metadata.sessionId,
          previousStatus: current?.status, nextStatus: snapshot.status,
          domains: current ? eventDomains(changes) : ['task'],
          detail: `已从恢复点 ${point.label} 恢复任务投影`,
          payload: current ? { changes, recoveryPointId } : { snapshot, recoveryPointId },
        }, head);
        if (!current || changes.length > 0) {
          appended.push(event);
          applyEvent(nextProjection, event);
          head = { sequence: event.sequence, hash: event.hash };
        }
      }
      if (!point.taskId && metadata.replaceAll === true) {
        for (const current of [...nextProjection.values()]) {
          if (restoreIds.has(current.id)) continue;
          const event = createEvent({
            type: 'task_removed', taskId: current.id, teamId: current.teamId,
            source: metadata.source || 'task-recovery', sessionId: metadata.sessionId,
            previousStatus: current.status, domains: ['task'], detail: `全量恢复点不包含该任务，已移出当前投影`,
            payload: { recoveryPointId },
          }, head);
          appended.push(event); applyEvent(nextProjection, event); head = { sequence: event.sequence, hash: event.hash };
        }
      }
      await appendEvents(appended);
      projected = nextProjection;
      await persistCheckpoint();
      return { ok: true, recoveryPointId, eventsAppended: appended.length, runs: [...projected.values()].map(clone), integrity: { ...integrity } };
    });
    writeQueue = operation.then(() => undefined, () => undefined);
    return operation.catch((error) => ({ ok: false, error: `恢复任务失败：${error?.message ?? String(error)}` }));
  }

  function write(runs, metadata = {}) {
    if (!Array.isArray(runs) || !runs.every(isTaskRun)) return Promise.resolve({ ok: false, error: '任务快照写入内容无效' });
    const nextRuns = runs.slice(-maxRuns).map(clone);
    const explicitRemovals = new Set(Array.isArray(metadata.removedTaskIds)
      ? metadata.removedTaskIds.map((taskId) => String(taskId || '')).filter(Boolean)
      : []);
    const operation = writeQueue.then(async () => {
      await initialize();
      const mergedRuns = await Promise.all(nextRuns.map(async (run) => reconcileTaskControl(mergeWorkerAuthority(projected.get(run.id), run, metadata.source))));
      const nextMap = new Map(mergedRuns.map((run) => [run.id, run]));
      const nextProjection = new Map(projected);
      const appended = [];
      const skippedRemovals = [];
      let head = { sequence: integrity.lastSequence, hash: integrity.lastHash };
      const add = (input) => {
        const event = createEvent(input, head);
        appended.push(event);
        applyEvent(nextProjection, event);
        head = { sequence: event.sequence, hash: event.hash };
      };
      for (const current of [...nextProjection.values()]) {
        if (nextMap.has(current.id)) continue;
        // Renderer snapshots are advisory. A stale window must never turn an
        // omitted background task into a durable task_removed event.
        if (metadata.source === 'renderer' && !explicitRemovals.has(current.id)) {
          skippedRemovals.push(current.id);
          continue;
        }
        if (metadata.source === 'renderer' && ['queued', 'running', 'awaiting_user', 'paused'].includes(current.status)) {
          skippedRemovals.push(current.id);
          continue;
        }
        add({
          type: 'task_removed', taskId: current.id, teamId: current.teamId,
          source: metadata.source, sessionId: metadata.sessionId, previousStatus: current.status,
          domains: ['task'], detail: `任务已从列表移除：${current.title || current.id}`, payload: {},
        });
      }
      for (const next of mergedRuns) {
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
      await persistCheckpoint();
      return {
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        ledgerVersion: LEDGER_VERSION,
        count: nextRuns.length,
        skippedRemovals,
        eventsAppended: appended.length,
        events: appended.map(clone),
        integrity: { ...integrity },
      };
    });
    writeQueue = operation.then(() => undefined, () => undefined);
    return operation.catch(async (error) => {
      await reportFailure('write', error, { source: metadata.source, sessionId: metadata.sessionId, runCount: nextRuns.length });
      return { ok: false, error: `写入任务事件账本失败：${error?.message ?? String(error)}` };
    });
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
      let candidate = returned === undefined ? next : returned;
      if (!isTaskRun(candidate) || candidate.id !== taskId) throw new Error('任务原子更新产生无效投影');
      candidate.updatedAt = Date.now();
      candidate = await reconcileTaskControl(candidate, candidate.updatedAt);
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
      const nextProjection = new Map(projected);
      applyEvent(nextProjection, event);
      await appendEvents([event]);
      projected = nextProjection;
      await persistCheckpoint();
      return { ok: true, unchanged: false, run: clone(candidate), events: [clone(event)], integrity: { ...integrity } };
    });
    writeQueue = operation.then(() => undefined, () => undefined);
    return operation.catch(async (error) => {
      await reportFailure('update-task', error, { taskId, source: metadata.source, sessionId: metadata.sessionId, detail: metadata.detail });
      return { ok: false, error: `更新任务事件账本失败：${error?.message ?? String(error)}` };
    });
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
      const nextProjection = new Map(projected);
      applyEvent(nextProjection, event);
      await appendEvents([event]);
      projected = nextProjection;
      await persistCheckpoint();
      return { ok: true, unchanged: false, events: [clone(event)], integrity: { ...integrity } };
    });
    writeQueue = operation.then(() => undefined, () => undefined);
    return operation.catch(async (error) => {
      await reportFailure('remove-task', error, { taskId, source: metadata.source, sessionId: metadata.sessionId, detail: metadata.detail });
      return { ok: false, error: `移除任务事件账本失败：${error?.message ?? String(error)}` };
    });
  }

  return { checkpointPath, ledgerPath, indexPath, recoveryDir, filePath: checkpointPath, read, audit, rebuild, write, updateTask, removeTask, createRecoveryPoint, listRecoveryPoints, restoreRecoveryPoint };
}

module.exports = {
  SCHEMA_VERSION,
  LEDGER_VERSION,
  RECOVERY_POINT_VERSION,
  DEFAULT_MAX_RUNS,
  atomicWrite,
  createTaskRuntimeStore,
  collectChanges,
  applyChanges,
  eventHash,
  digest,
  verifyEnvelope,
  projectEvents,
};
