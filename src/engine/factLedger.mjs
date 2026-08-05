export const FACT_LEDGER_VERSION = 1;
const MAX_FACT_VERSIONS = 160;
const MAX_CONFLICTS = 80;

function text(value, max = 1200) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ').slice(0, max);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value ?? '')) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function normalized(value) {
  return text(value, 2000).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function stableKey(value) {
  return text(value, 240) || `statement:${hash(normalized(value))}`;
}

function statementFingerprint(value) {
  return `statement-${hash(normalized(value))}`;
}

function factId(key, version, statement) {
  return `fact-${hash(`${key}|${version}|${statementFingerprint(statement)}`)}`;
}

function observationId(input, key, statement, at) {
  return text(input?.observationId || input?.id, 220)
    || `observation-${hash(`${key}|${statementFingerprint(statement)}|${at}|${input?.sourceId || ''}`)}`;
}

function sameStatement(left, right) {
  return normalized(left) === normalized(right);
}

function normalizeResolution(value) {
  return ['accept_latest', 'keep_previous', 'accept_both', 'dismiss'].includes(value) ? value : undefined;
}

function normalizeObservation(input = {}, now = Date.now()) {
  const statement = text(input.statement || input.content || input.value, 1200);
  if (!statement) throw new Error('事实观察必须包含 statement');
  const at = Number(input.at || input.observedAt || input.ts) || now;
  const key = stableKey(input.factKey || input.key || input.subject || input.claimKey || statement);
  const verified = input.verified === true;
  return {
    observationId: observationId(input, key, statement, at),
    factKey: key,
    statement,
    statementFingerprint: statementFingerprint(statement),
    source: text(input.source || 'unknown', 180),
    sourceId: text(input.sourceId || input.toolCallId || input.evidenceId, 220),
    evidenceIds: [...new Set([
      ...(Array.isArray(input.evidenceIds) ? input.evidenceIds : []),
      ...(input.evidenceId ? [input.evidenceId] : []),
      ...(input.sourceId ? [input.sourceId] : []),
    ].map((item) => text(item, 220)).filter(Boolean))].slice(0, 12),
    verified,
    confidence: Math.max(0, Math.min(1, Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : (verified ? 1 : 0.6))),
    at,
  };
}

function emptyLedger(now = Date.now()) {
  return {
    ledgerVersion: FACT_LEDGER_VERSION,
    factVersions: [],
    conflicts: [],
    updatedAt: now,
  };
}

function normalizeLedger(snapshot, now = Date.now()) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const ledger = {
    ...emptyLedger(now),
    ...clone(source),
    ledgerVersion: FACT_LEDGER_VERSION,
    factVersions: Array.isArray(source.factVersions) ? source.factVersions : [],
    conflicts: Array.isArray(source.conflicts) ? source.conflicts : [],
  };
  ledger.factVersions = ledger.factVersions.slice(-MAX_FACT_VERSIONS);
  ledger.conflicts = ledger.conflicts.slice(-MAX_CONFLICTS);
  return ledger;
}

function versionFor(ledger, key, statement) {
  return ledger.factVersions.find((item) => item.status === 'current' && item.factKey === key && sameStatement(item.statement, statement));
}

function openConflictFor(ledger, key, previousId, latestId) {
  return ledger.conflicts.find((item) => item.status === 'open'
    && item.factKey === key
    && ((item.previousFactId === previousId && item.latestFactId === latestId)
      || (item.previousFactId === latestId && item.latestFactId === previousId)));
}

function addObservationToVersion(version, observation) {
  const known = new Set(version.observationIds || []);
  if (known.has(observation.observationId)) return false;
  version.observationIds = [...known, observation.observationId].slice(-24);
  version.evidenceIds = [...new Set([...(version.evidenceIds || []), ...(observation.evidenceIds || [])])].slice(-24);
  version.sources = [...new Set([...(version.sources || []), observation.source].filter(Boolean))].slice(-12);
  version.verified = version.verified || observation.verified;
  version.confidence = Math.max(Number(version.confidence) || 0, observation.confidence);
  version.lastObservedAt = Math.max(Number(version.lastObservedAt) || 0, observation.at);
  version.observationCount = (Number(version.observationCount) || 0) + 1;
  return true;
}

export function createFactLedger(input = {}) {
  const now = Number(input.now) || Date.now();
  let ledger = normalizeLedger(input.snapshot, now);
  for (const observation of Array.isArray(input.observations) ? input.observations : []) {
    ledger = recordFactObservation(ledger, observation, { now: Number(observation?.at) || now }).ledger;
  }
  return ledger;
}

export function recordFactObservation(snapshot, input = {}, options = {}) {
  const now = Number(options.now) || Date.now();
  const ledger = normalizeLedger(snapshot, now);
  const observation = normalizeObservation(input, now);
  const matching = versionFor(ledger, observation.factKey, observation.statement);
  if (matching) {
    const changed = addObservationToVersion(matching, observation);
    if (changed) ledger.updatedAt = now;
    return { ledger, observation, action: 'confirmed', fact: clone(matching), conflict: undefined };
  }
  const versions = ledger.factVersions.filter((item) => item.factKey === observation.factKey);
  const previous = versions.at(-1);
  const version = (versions.reduce((max, item) => Math.max(max, Number(item.version) || 0), 0) || 0) + 1;
  const fact = {
    id: factId(observation.factKey, version, observation.statement),
    factKey: observation.factKey,
    version,
    statement: observation.statement,
    statementFingerprint: observation.statementFingerprint,
    status: 'current',
    verified: observation.verified,
    confidence: observation.confidence,
    sources: observation.source ? [observation.source] : [],
    observationIds: [observation.observationId],
    evidenceIds: observation.evidenceIds,
    firstObservedAt: observation.at,
    lastObservedAt: observation.at,
    observationCount: 1,
    createdAt: now,
  };
  if (previous) {
    const conflict = openConflictFor(ledger, observation.factKey, previous.id, fact.id);
    previous.status = 'superseded';
    if (conflict) {
      conflict.latestFactId = fact.id;
      conflict.latestVersion = fact.version;
      conflict.latestEvidenceIds = fact.evidenceIds;
      conflict.updatedAt = now;
    } else {
      ledger.conflicts.push({
        id: `fact-conflict-${hash(`${observation.factKey}|${previous.id}|${fact.id}`)}`,
        factKey: observation.factKey,
        status: 'open',
        resolution: undefined,
        requiresUser: previous.verified && fact.verified,
        previousFactId: previous.id,
        previousVersion: previous.version,
        previousStatement: previous.statement,
        previousEvidenceIds: previous.evidenceIds || [],
        latestFactId: fact.id,
        latestVersion: fact.version,
        latestStatement: fact.statement,
        latestEvidenceIds: fact.evidenceIds,
        detectedAt: now,
        updatedAt: now,
      });
    }
  }
  ledger.factVersions.push(fact);
  ledger.factVersions = ledger.factVersions.slice(-MAX_FACT_VERSIONS);
  ledger.conflicts = ledger.conflicts.slice(-MAX_CONFLICTS);
  ledger.updatedAt = now;
  const conflict = ledger.conflicts.find((item) => item.latestFactId === fact.id && item.status === 'open');
  return { ledger, observation, action: previous ? 'conflict' : 'added', fact: clone(fact), conflict: clone(conflict) };
}

export function resolveFactConflict(snapshot, conflictId, resolution, options = {}) {
  const ledger = normalizeLedger(snapshot, Number(options.now) || Date.now());
  const conflict = ledger.conflicts.find((item) => item.id === conflictId);
  if (!conflict) throw new Error(`事实冲突不存在：${conflictId}`);
  const choice = normalizeResolution(resolution);
  if (!choice) throw new Error('事实冲突处理方式无效');
  const now = Number(options.now) || Date.now();
  const previous = ledger.factVersions.find((item) => item.id === conflict.previousFactId);
  const latest = ledger.factVersions.find((item) => item.id === conflict.latestFactId);
  if (choice === 'keep_previous' && previous) {
    previous.status = 'current';
    if (latest) latest.status = 'rejected';
  } else if (choice === 'accept_latest' && latest) {
    latest.status = 'current';
    if (previous) previous.status = 'superseded';
  } else if (choice === 'accept_both') {
    if (previous) previous.status = 'current';
    if (latest) latest.status = 'current';
  } else if (choice === 'dismiss') {
    if (latest) latest.status = 'current';
  }
  conflict.status = 'resolved';
  conflict.resolution = choice;
  conflict.resolvedBy = text(options.resolvedBy || 'system', 160);
  conflict.resolvedAt = now;
  conflict.updatedAt = now;
  ledger.updatedAt = now;
  return clone(ledger);
}

export function openFactConflicts(snapshot) {
  return (snapshot?.conflicts || []).filter((item) => item.status === 'open').map(clone);
}

export function factLedgerSummary(snapshot) {
  const ledger = normalizeLedger(snapshot);
  const open = openFactConflicts(ledger);
  const current = ledger.factVersions.filter((item) => item.status === 'current');
  return {
    ledgerVersion: ledger.ledgerVersion,
    factVersions: ledger.factVersions.length,
    currentFacts: current.length,
    openConflicts: open.length,
    userConflicts: open.filter((item) => item.requiresUser).length,
    lastUpdatedAt: ledger.updatedAt,
  };
}
