const PROTOCOL_VERSION = 1;
const DEFAULT_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|token|auth(?:orization)?|password|passwd|secret|client[_-]?secret|验证码|校验码|密码|密钥|令牌)/iu;

function nowFrom(adapters) {
  return typeof adapters.now === 'function' ? adapters.now() : Date.now();
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function redactString(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.stringify(redactConnectorValue(JSON.parse(trimmed))); } catch {}
  }
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/giu, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|password|secret|client[_-]?secret|验证码|密码|密钥|令牌)["']?\s*[:=：]\s*["']?)[^\s,;，；}"']{4,}/giu, '$1[REDACTED]');
}

export function redactConnectorValue(value, key = '') {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactConnectorValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactConnectorValue(entryValue, entryKey)]));
  }
  return typeof value === 'string' ? redactString(value) : value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function hash(value) {
  let result = 2166136261;
  for (const char of value) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function createConnectorIdempotencyKey(input) {
  const payload = JSON.stringify(stableValue({
    connectorId: input.connectorId,
    action: input.actionName,
    args: input.args ?? {},
  }));
  return `connector-${input.connectorId}-${input.actionName}-${hash(payload)}`;
}

function valueType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function validateSchema(value, schema, path = '$') {
  if (!schema || typeof schema !== 'object') return [];
  const errors = [];
  const expected = schema.type;
  const actual = valueType(value);
  if (expected) {
    const matches = expected === actual || (expected === 'number' && (actual === 'number' || actual === 'integer'));
    if (!matches) return [`${path} should be ${expected}, received ${actual}`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path} is not an allowed value`);
  if (typeof value === 'string') {
    if (Number.isFinite(schema.minLength) && value.length < schema.minLength) errors.push(`${path} is too short`);
    if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) errors.push(`${path} is too long`);
    if (schema.pattern) {
      try { if (!new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path} has an invalid format`); } catch {}
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => errors.push(...validateSchema(item, schema.items, `${path}[${index}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!(key in value) || value[key] === undefined || value[key] === null || value[key] === '') errors.push(`${path}.${key} is required`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value && value[key] !== undefined) errors.push(...validateSchema(value[key], childSchema, `${path}.${key}`));
    }
  }
  return errors;
}

export function validateConnectorSchema(value, schema) {
  const errors = validateSchema(value, schema);
  return { ok: errors.length === 0, errors };
}

export function classifyConnectorError(error) {
  const message = String(error?.message ?? error ?? 'Unknown connector error');
  if (/401|unauthorized|api\s*key|token|credential|鉴权|密钥|凭据/iu.test(message)) return { category: 'authentication', retryable: false, message };
  if (/403|forbidden|permission|denied|权限|拒绝/iu.test(message)) return { category: 'permission', retryable: false, message };
  if (/429|rate.?limit|too many requests|限流/iu.test(message)) return { category: 'rate-limit', retryable: true, message };
  if (/timeout|timed out|aborted|超时/iu.test(message)) return { category: 'timeout', retryable: true, message };
  if (/ECONN|ENOTFOUND|network|fetch failed|socket|网络|连接失败/iu.test(message)) return { category: 'network', retryable: true, message };
  if (/\b5\d\d\b|service unavailable|bad gateway|服务端/iu.test(message)) return { category: 'server', retryable: true, message };
  if (/schema|required|invalid|too short|too long|parameter|argument|output did not match|JSON|参数|格式/iu.test(message)) return { category: 'validation', retryable: false, message };
  if (/not found|missing|不存在|未配置|缺少/iu.test(message)) return { category: 'configuration', retryable: false, message };
  return { category: 'unknown', retryable: false, message };
}

export function connectorActionHasSideEffect(action = {}) {
  if (typeof action.sideEffect === 'boolean') return action.sideEffect;
  if (action.permission === 'write' || action.permission === 'admin') return true;
  if (action.permission === 'read' || action.local) return false;
  const name = String(action.mcpToolName ?? action.name ?? '');
  if (/(?:^|[_-])(?:send|publish|create|update|delete|remove|write|upload|post|notify|pay)(?:$|[_-])/iu.test(name)) return true;
  if (/(?:^|[_-])(?:search|query|get|list|read|find|inspect|test|verify)(?:$|[_-])/iu.test(name)) return false;
  return action.http?.method !== undefined && action.http.method !== 'GET';
}

function protocolEvent(stage, ok, ts, detail) {
  return { stage, ok, ts, detail: String(detail ?? '').slice(0, 300) };
}

function baseResult(input, startedAt, idempotencyKey, sideEffect) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    connectorId: String(input.connectorId ?? ''),
    connectorLabel: String(input.connectorLabel ?? input.connectorId ?? ''),
    action: String(input.actionName ?? ''),
    stage: 'validate-input',
    ok: false,
    dryRun: input.dryRunOnly === true,
    sideEffect,
    idempotencyKey: sideEffect ? idempotencyKey : undefined,
    idempotencyHit: false,
    startedAt,
    completedAt: startedAt,
    latencyMs: 0,
    input: redactConnectorValue(input.args ?? {}),
    events: [],
  };
}

function fail(result, stage, error, adapters) {
  const completedAt = nowFrom(adapters);
  const classified = classifyConnectorError(error);
  result.stage = stage;
  result.ok = false;
  result.completedAt = completedAt;
  result.latencyMs = Math.max(0, completedAt - result.startedAt);
  result.error = { ...classified, message: redactString(classified.message).slice(0, 1200) };
  result.events.push(protocolEvent(stage, false, completedAt, result.error.message));
  return result;
}

export async function executeConnectorProtocol(input, adapters = {}) {
  const startedAt = nowFrom(adapters);
  const sideEffect = connectorActionHasSideEffect(input.action);
  const idempotencyKey = input.idempotencyKey || createConnectorIdempotencyKey(input);
  const result = baseResult(input, startedAt, idempotencyKey, sideEffect);
  const inputValidation = validateConnectorSchema(input.args ?? {}, input.action?.parameters ?? { type: 'object' });
  if (!inputValidation.ok) return fail(result, 'validate-input', new Error(inputValidation.errors.join('; ')), adapters);
  result.events.push(protocolEvent('validate-input', true, nowFrom(adapters), 'input schema accepted'));

  try {
    const permission = typeof adapters.checkPermission === 'function'
      ? await adapters.checkPermission(input)
      : { allowed: input.permissionGranted === true, reason: input.permissionGranted === true ? 'client approval accepted' : 'connector permission denied: client approval missing' };
    if (permission === false || permission?.allowed === false) throw new Error(permission?.reason || 'connector permission denied');
    result.events.push(protocolEvent('permission', true, nowFrom(adapters), permission?.reason || 'permission accepted'));
  } catch (error) {
    return fail(result, 'permission', error, adapters);
  }

  const store = adapters.idempotencyStore;
  if (sideEffect && !input.dryRunOnly && store?.get) {
    const cached = await store.get(idempotencyKey);
    const ttl = Number.isFinite(input.idempotencyTtlMs) ? input.idempotencyTtlMs : DEFAULT_IDEMPOTENCY_TTL_MS;
    if (cached?.ok && startedAt - cached.completedAt <= ttl) {
      const completedAt = nowFrom(adapters);
      return {
        ...clone(cached),
        startedAt,
        completedAt,
        latencyMs: Math.max(0, completedAt - startedAt),
        idempotencyHit: true,
        events: [...result.events, protocolEvent('idempotency', true, completedAt, 'reused verified result; external side effect was not repeated')],
      };
    }
  }

  try {
    if (typeof adapters.dryRun !== 'function') throw new Error('connector dry-run adapter is unavailable');
    result.dryRunResult = redactConnectorValue(await adapters.dryRun(input));
    result.events.push(protocolEvent('dry-run', true, nowFrom(adapters), 'runtime and request preparation accepted'));
  } catch (error) {
    return fail(result, 'dry-run', error, adapters);
  }

  if (input.dryRunOnly) {
    const completedAt = nowFrom(adapters);
    result.stage = 'completed';
    result.ok = true;
    result.completedAt = completedAt;
    result.latencyMs = Math.max(0, completedAt - startedAt);
    result.events.push(protocolEvent('completed', true, completedAt, 'dry-run completed without external call'));
    return result;
  }

  let output;
  try {
    if (typeof adapters.call !== 'function') throw new Error('connector call adapter is unavailable');
    output = await adapters.call(input);
    result.events.push(protocolEvent('call', true, nowFrom(adapters), 'external call returned'));
  } catch (error) {
    return fail(result, 'call', error, adapters);
  }

  try {
    const outputSchema = input.action?.outputSchema ?? { type: 'string', minLength: 1 };
    const outputValidation = typeof adapters.validateOutput === 'function'
      ? await adapters.validateOutput(output, input)
      : validateConnectorSchema(output, outputSchema);
    if (outputValidation === false || outputValidation?.ok === false) {
      throw new Error(outputValidation?.errors?.join('; ') || 'connector output did not match its schema');
    }
    result.output = redactConnectorValue(output);
    result.events.push(protocolEvent('validate-output', true, nowFrom(adapters), 'output schema accepted'));
  } catch (error) {
    return fail(result, 'validate-output', error, adapters);
  }

  const completedAt = nowFrom(adapters);
  result.stage = 'completed';
  result.ok = true;
  result.completedAt = completedAt;
  result.latencyMs = Math.max(0, completedAt - startedAt);
  result.events.push(protocolEvent('completed', true, completedAt, 'verified connector execution completed'));
  if (sideEffect && store?.set) await store.set(idempotencyKey, clone(result));
  return result;
}

export const CONNECTOR_PROTOCOL_VERSION = PROTOCOL_VERSION;
