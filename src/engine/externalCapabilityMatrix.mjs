export const EXTERNAL_CAPABILITY_MATRIX_SCHEMA = 1;

export const EXTERNAL_CAPABILITY_KINDS = Object.freeze([
  'chat_model', 'image_generation', 'web_page', 'skillhub', 'knowledge_base',
  'email', 'github', 'generic_http', 'mcp',
]);

export const EXTERNAL_CAPABILITY_STATES = Object.freeze([
  'missing_config', 'not_tested', 'available', 'authentication_failed',
  'rate_limited', 'protocol_error', 'invalid_content', 'unavailable',
]);

const FAILURE_STATES = new Set(EXTERNAL_CAPABILITY_STATES.filter((state) => !['missing_config', 'not_tested', 'available'].includes(state)));
const SECRET_PATTERN = /(authorization|api[-_ ]?key|token|secret|password|cookie)\s*[:=]\s*[^\s,;&]+/igu;

function text(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function number(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }

export function sanitizeCapabilityEvidence(value, max = 500) {
  return text(value, max).replace(SECRET_PATTERN, '$1=<redacted>');
}

export function sanitizeResourceIdentity(value) {
  const raw = text(value, 1200);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/key|token|secret|password|signature|auth/iu.test(key)) url.searchParams.set(key, '<redacted>');
    }
    return url.toString();
  } catch {
    return sanitizeCapabilityEvidence(raw, 1200);
  }
}

function normalizeProfile(profile = {}) {
  const kind = EXTERNAL_CAPABILITY_KINDS.includes(profile.kind) ? profile.kind : 'generic_http';
  const id = text(profile.id, 240) || `${kind}:default`;
  return {
    id,
    kind,
    label: text(profile.label, 180) || id,
    source: text(profile.source, 120) || 'configuration',
    configured: profile.configured === true,
    resourceIdentity: sanitizeResourceIdentity(profile.resourceIdentity),
  };
}

export function completeExternalCapabilityProfiles(profiles = [], labels = {}) {
  const normalized = profiles.map((profile) => normalizeProfile(profile));
  const discoveredKinds = new Set(normalized.map((profile) => profile.kind));
  const missing = EXTERNAL_CAPABILITY_KINDS
    .filter((kind) => !discoveredKinds.has(kind))
    .map((kind) => normalizeProfile({
      id: `inventory:${kind}`,
      kind,
      label: labels[kind] || kind,
      source: 'capability-inventory',
      configured: false,
    }));
  return [...normalized, ...missing];
}

function initialEntry(profile, previous = {}) {
  const normalized = normalizeProfile(profile);
  const state = normalized.configured
    ? (EXTERNAL_CAPABILITY_STATES.includes(previous.state) ? previous.state : 'not_tested')
    : 'missing_config';
  return {
    ...normalized,
    state,
    checkedAt: number(previous.checkedAt),
    lastHttpStatus: number(previous.lastHttpStatus) || undefined,
    lastDetail: sanitizeCapabilityEvidence(previous.lastDetail),
    recoveryCount: number(previous.recoveryCount),
    recoveredAt: number(previous.recoveredAt) || undefined,
    evidence: {
      configured: normalized.configured,
      invoked: previous.evidence?.invoked === true,
      response: previous.evidence?.response === true,
      validated: previous.evidence?.validated === true,
      recovered: previous.evidence?.recovered === true,
    },
    history: Array.isArray(previous.history) ? previous.history.slice(-20) : [],
  };
}

export function createExternalCapabilityMatrix(profiles = [], seed = {}) {
  const previousEntries = seed?.entries && typeof seed.entries === 'object' ? seed.entries : {};
  const inventory = profiles.length ? profiles : Object.values(previousEntries);
  const entries = Object.fromEntries(inventory.map((profile) => {
    const normalized = normalizeProfile(profile);
    return [normalized.id, initialEntry(normalized, previousEntries[normalized.id])];
  }));
  return { schema: EXTERNAL_CAPABILITY_MATRIX_SCHEMA, updatedAt: Date.now(), entries };
}

export function classifyExternalCapabilityProbe(input = {}) {
  if (input.configured === false || input.missingConfig === true) return 'missing_config';
  if (input.actualCall !== true) return 'not_tested';
  const status = number(input.httpStatus ?? input.status);
  const detail = text(input.error ?? input.detail ?? input.body, 800).toLowerCase();
  if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|api.?key|鉴权|认证/u.test(detail)) return 'authentication_failed';
  if (status === 429 || /rate.?limit|too many requests|限流/u.test(detail)) return 'rate_limited';
  if (input.invalidContent === true || /empty content|invalid content|正文为空|内容无效/u.test(detail)) return 'invalid_content';
  if (input.protocolError === true || /protocol|schema|json-rpc|响应字段|协议/u.test(detail)) return 'protocol_error';
  if (input.ok === true && input.validated !== false) return 'available';
  return 'unavailable';
}

export function applyExternalCapabilityProbe(matrix, event = {}) {
  const source = matrix?.entries && typeof matrix.entries === 'object' ? matrix : createExternalCapabilityMatrix();
  const profile = normalizeProfile(event.profile ?? event);
  const previous = initialEntry(profile, source.entries[profile.id]);
  const classifiedState = classifyExternalCapabilityProbe({ configured: profile.configured, ...event });
  if (classifiedState === 'not_tested' && previous.checkedAt) {
    return { ...source, entries: { ...source.entries, [profile.id]: { ...previous, ...profile } } };
  }
  const state = classifiedState;
  const checkedAt = number(event.checkedAt, Date.now());
  const recovered = FAILURE_STATES.has(previous.state) && state === 'available';
  const historyItem = {
    checkedAt,
    state,
    httpStatus: number(event.httpStatus ?? event.status) || undefined,
    detail: sanitizeCapabilityEvidence(event.detail ?? event.error),
    actualCall: event.actualCall === true,
    validated: event.validated === true || state === 'available',
  };
  const entry = {
    ...previous,
    ...profile,
    state,
    checkedAt,
    lastHttpStatus: historyItem.httpStatus,
    lastDetail: historyItem.detail,
    recoveryCount: previous.recoveryCount + (recovered ? 1 : 0),
    recoveredAt: recovered ? checkedAt : previous.recoveredAt,
    evidence: {
      configured: profile.configured,
      invoked: event.actualCall === true,
      response: event.responseReceived === true || Boolean(historyItem.httpStatus) || state === 'available',
      validated: historyItem.validated,
      recovered: recovered || previous.evidence.recovered,
    },
    history: [...previous.history, historyItem].slice(-20),
  };
  return { ...source, schema: EXTERNAL_CAPABILITY_MATRIX_SCHEMA, updatedAt: checkedAt, entries: { ...source.entries, [profile.id]: entry } };
}

export function summarizeExternalCapabilityMatrix(matrix) {
  const entries = Object.values(matrix?.entries ?? {});
  return {
    total: entries.length,
    available: entries.filter((entry) => entry.state === 'available').length,
    missingConfig: entries.filter((entry) => entry.state === 'missing_config').length,
    notTested: entries.filter((entry) => entry.state === 'not_tested').length,
    blocked: entries.filter((entry) => FAILURE_STATES.has(entry.state)).length,
    recovered: entries.reduce((sum, entry) => sum + number(entry.recoveryCount), 0),
  };
}
