export const MODEL_RELIABILITY_VERSION = 1;
export const MODEL_FAILURE_CLASSES = Object.freeze([
  'server', 'rate_limit', 'timeout', 'network', 'authentication', 'authorization',
  'billing', 'endpoint', 'protocol', 'content_filter', 'cancelled', 'unknown',
]);
export const TRANSIENT_MODEL_FAILURES = Object.freeze(['server', 'rate_limit', 'timeout', 'network']);

const DEFAULTS = Object.freeze({
  failureThreshold: 3,
  cooldownMs: 30000,
  maxBackoffMs: 120000,
});

function number(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function positive(value, fallback) {
  const result = number(value, fallback);
  return result > 0 ? result : fallback;
}

function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function safeError(value) {
  return text(value, 300)
    .replace(/(authorization|api[-_ ]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/igu, '$1=<redacted>');
}

function normalizeBase(value) {
  return text(value, 1000).replace(/\/+$/u, '').toLowerCase();
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function emptyEntry(key, now) {
  return {
    key,
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    failureClasses: {},
    latency: { count: 0, totalMs: 0, lastMs: 0, maxMs: 0 },
    firstToken: { count: 0, totalMs: 0, lastMs: 0, maxMs: 0 },
    consecutiveFailures: 0,
    circuitState: 'closed',
    openedAt: 0,
    nextProbeAt: 0,
    probeInFlight: false,
    lastStatus: 0,
    lastFailureClass: '',
    lastError: '',
    lastAttemptAt: 0,
    lastSuccessAt: 0,
    lastFailureAt: 0,
    recovery: { recovered: 0, failed: 0 },
    updatedAt: now,
  };
}

function normalizeEntry(key, source, now) {
  const base = emptyEntry(key, now);
  const item = source && typeof source === 'object' ? source : {};
  return {
    ...base,
    ...item,
    key,
    failureClasses: { ...(item.failureClasses ?? {}) },
    latency: { ...base.latency, ...(item.latency ?? {}) },
    firstToken: { ...base.firstToken, ...(item.firstToken ?? {}) },
    recovery: { ...base.recovery, ...(item.recovery ?? {}) },
    circuitState: ['closed', 'open', 'half_open'].includes(item.circuitState) ? item.circuitState : 'closed',
    probeInFlight: item.probeInFlight === true,
  };
}

export function modelKey(config = {}) {
  if (typeof config === 'string') return text(config, 1200) || 'unknown';
  const provider = text(config.provider, 120).toLowerCase() || 'custom';
  const base = normalizeBase(config.apiHost);
  const model = text(config.model || config.refModelId, 240).toLowerCase() || 'unknown';
  return `${provider}|${base}|${model}`;
}

export function createModelReliabilityRegistry(seed = {}) {
  const now = Date.now();
  const source = seed && typeof seed === 'object' ? seed : {};
  const entries = source.models && typeof source.models === 'object' ? source.models : {};
  return {
    version: MODEL_RELIABILITY_VERSION,
    updatedAt: number(source.updatedAt, now),
    models: Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, normalizeEntry(key, value, now)])),
  };
}

function ensureEntry(registry, key, now = Date.now()) {
  if (!registry || typeof registry !== 'object') throw new Error('model reliability registry is required');
  if (!registry.models || typeof registry.models !== 'object') registry.models = {};
  if (!registry.models[key]) registry.models[key] = emptyEntry(key, now);
  registry.models[key] = normalizeEntry(key, registry.models[key], now);
  registry.version = MODEL_RELIABILITY_VERSION;
  registry.updatedAt = now;
  return registry.models[key];
}

export function startModelAttempt(registry, key, now = Date.now()) {
  const entry = ensureEntry(registry, key, now);
  entry.requestCount += 1;
  entry.lastAttemptAt = now;
  entry.updatedAt = now;
  if (entry.circuitState === 'half_open') entry.probeInFlight = true;
  return clone(entry);
}

export function getModelAdmission(registry, key, now = Date.now(), options = {}) {
  const entry = ensureEntry(registry, key, now);
  const cooldownMs = positive(options.cooldownMs, DEFAULTS.cooldownMs);
  if (entry.circuitState === 'open') {
    if (now < entry.nextProbeAt) {
      return {
        key,
        allowed: false,
        state: 'open',
        retryAfterMs: Math.max(0, entry.nextProbeAt - now),
        nextProbeAt: entry.nextProbeAt,
        reason: 'cooldown',
      };
    }
    entry.circuitState = 'half_open';
    entry.probeInFlight = false;
    entry.updatedAt = now;
  }
  if (entry.circuitState === 'half_open' && entry.probeInFlight) {
    return {
      key,
      allowed: false,
      state: 'half_open',
      retryAfterMs: cooldownMs,
      nextProbeAt: now + cooldownMs,
      reason: 'probe_in_flight',
    };
  }
  return { key, allowed: true, state: entry.circuitState, retryAfterMs: 0, nextProbeAt: entry.nextProbeAt || 0, reason: 'admitted' };
}

export function classifyModelFailure(input = {}) {
  const status = number(input.status ?? input.statusCode ?? input.httpStatus, 0);
  const raw = text(input.error ?? input.message ?? input.body, 800).toLowerCase();
  if (input.cancelled === true || input.errorName === 'ExternalAbortError' || input.errorName === 'AbortError') return 'cancelled';
  if (input.timeout === true || /timeout|timed?\s*out|超时/u.test(raw)) return 'timeout';
  if (status === 429 || /rate.?limit|too many requests|限流/u.test(raw)) return 'rate_limit';
  if (status === 401 || /unauthori[sz]ed|api.?key|认证|密钥/u.test(raw)) return 'authentication';
  if (status === 403 || /forbidden|permission|权限/u.test(raw)) return 'authorization';
  if (status === 402 || /billing|欠费|余额|quota/u.test(raw)) return 'billing';
  if (status === 404 || /endpoint|not found|不存在/u.test(raw)) return 'endpoint';
  if (status >= 500 || /service unavailable|server error|服务器|服务不可用|\b5\d\d\b/u.test(raw)) return 'server';
  if (/content|safety|moderation|policy|敏感|过滤/u.test(raw)) return 'content_filter';
  if (input.network === true || /network|fetch failed|dns|econn|网络|连接失败/u.test(raw)) return 'network';
  if (input.protocol === true || /protocol|schema|json|流式|返回为空/u.test(raw)) return 'protocol';
  return 'unknown';
}

function addMeasurement(target, value) {
  const amount = Math.max(0, number(value, 0));
  if (!amount) return;
  target.count += 1;
  target.totalMs += amount;
  target.lastMs = amount;
  target.maxMs = Math.max(target.maxMs, amount);
}

export function recordModelFirstToken(registry, key, firstTokenMs, now = Date.now()) {
  const entry = ensureEntry(registry, key, now);
  addMeasurement(entry.firstToken, firstTokenMs);
  entry.updatedAt = now;
  return clone(entry);
}

export function recordModelAttempt(registry, event = {}) {
  const now = number(event.now, Date.now());
  const key = text(event.key || event.modelKey, 1200) || 'unknown';
  const entry = ensureEntry(registry, key, now);
  const previousCircuit = entry.circuitState;
  const success = event.success === true;
  const failureClass = success ? '' : (MODEL_FAILURE_CLASSES.includes(event.failureClass) ? event.failureClass : classifyModelFailure(event));
  addMeasurement(entry.latency, event.latencyMs);
  entry.lastStatus = number(event.status ?? event.httpStatus, 0);
  entry.lastAttemptAt = now;
  entry.updatedAt = now;
  entry.probeInFlight = false;
  if (success) {
    entry.successCount += 1;
    entry.lastSuccessAt = now;
    entry.lastFailureClass = '';
    entry.lastError = '';
    if (previousCircuit !== 'closed' || entry.consecutiveFailures > 0) entry.recovery.recovered += 1;
    entry.consecutiveFailures = 0;
    entry.circuitState = 'closed';
    entry.openedAt = 0;
    entry.nextProbeAt = 0;
  } else {
    entry.failureCount += 1;
    entry.lastFailureAt = now;
    entry.lastFailureClass = failureClass;
    entry.lastError = safeError(event.error);
    entry.failureClasses[failureClass] = number(entry.failureClasses[failureClass], 0) + 1;
    if (TRANSIENT_MODEL_FAILURES.includes(failureClass)) entry.consecutiveFailures += 1;
    else entry.consecutiveFailures = 0;
    if (previousCircuit !== 'closed') entry.recovery.failed += 1;
    const threshold = Math.max(1, Math.floor(positive(event.failureThreshold, DEFAULTS.failureThreshold)));
    if (TRANSIENT_MODEL_FAILURES.includes(failureClass)
      && (previousCircuit === 'half_open' || entry.consecutiveFailures >= threshold)) {
      entry.circuitState = 'open';
      entry.openedAt = now;
      const cooldownMs = positive(event.cooldownMs, DEFAULTS.cooldownMs);
      entry.nextProbeAt = now + Math.min(DEFAULTS.maxBackoffMs, cooldownMs);
    } else if (previousCircuit === 'half_open') {
      entry.circuitState = 'open';
      entry.openedAt = now;
      entry.nextProbeAt = now + positive(event.cooldownMs, DEFAULTS.cooldownMs);
    } else {
      entry.circuitState = 'closed';
    }
  }
  return clone(entry);
}

export function nextModelBackoffMs(attempt = 0, failureClass = 'unknown', options = {}) {
  const n = Math.max(0, Math.floor(number(attempt, 0)));
  const baseByClass = { rate_limit: 2000, server: 1500, timeout: 1200, network: 1500 };
  const base = positive(options.baseMs, baseByClass[failureClass] ?? 800);
  const cap = positive(options.maxMs, DEFAULTS.maxBackoffMs);
  return Math.min(cap, base * (2 ** Math.min(n, 10)));
}

export function getModelRecoveryAdvice(registry, key, alternatives = [], now = Date.now()) {
  const entry = ensureEntry(registry, key, now);
  const candidates = alternatives.map((item) => modelKey(item)).filter((item) => item && item !== key);
  if (entry.circuitState === 'open') {
    return {
      key,
      state: entry.circuitState,
      retryAfterMs: Math.max(0, entry.nextProbeAt - now),
      action: candidates.length ? 'wait_or_switch' : 'wait',
      alternatives: [...new Set(candidates)].slice(0, 5),
      reason: 'The model is inside a temporary protection window after repeated transient failures.',
    };
  }
  if (entry.lastFailureClass && TRANSIENT_MODEL_FAILURES.includes(entry.lastFailureClass)) {
    return {
      key,
      state: entry.circuitState,
      retryAfterMs: nextModelBackoffMs(entry.consecutiveFailures - 1, entry.lastFailureClass),
      action: candidates.length ? 'retry_or_switch' : 'retry',
      alternatives: [...new Set(candidates)].slice(0, 5),
      reason: `The last model failure was classified as ${entry.lastFailureClass}.`,
    };
  }
  return { key, state: entry.circuitState, retryAfterMs: 0, action: 'inspect', alternatives: [], reason: 'No automatic recovery action is required.' };
}

export function summarizeModelReliability(registry) {
  const source = createModelReliabilityRegistry(registry);
  return Object.values(source.models).map((entry) => ({
    key: entry.key,
    circuitState: entry.circuitState,
    requestCount: entry.requestCount,
    successCount: entry.successCount,
    failureCount: entry.failureCount,
    successRate: entry.requestCount ? entry.successCount / entry.requestCount : 0,
    failureClasses: { ...entry.failureClasses },
    averageLatencyMs: entry.latency.count ? Math.round(entry.latency.totalMs / entry.latency.count) : 0,
    averageFirstTokenMs: entry.firstToken.count ? Math.round(entry.firstToken.totalMs / entry.firstToken.count) : 0,
    lastStatus: entry.lastStatus,
    lastFailureClass: entry.lastFailureClass,
    consecutiveFailures: entry.consecutiveFailures,
    nextProbeAt: entry.nextProbeAt,
    recovery: { ...entry.recovery },
    updatedAt: entry.updatedAt,
  }));
}
