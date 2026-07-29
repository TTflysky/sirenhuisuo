const PROTOCOL_VERSION = 1;

function text(value, max = 300) { return String(value ?? '').trim().slice(0, max); }

function valueType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function validateValue(value, schema, path = '$') {
  if (!schema || typeof schema !== 'object') return [];
  const errors = [];
  const actual = valueType(value);
  if (schema.type && !(schema.type === actual || (schema.type === 'number' && actual === 'integer'))) errors.push(`${path} 应为 ${schema.type}，实际为 ${actual}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path} 不在允许值范围内`);
  if (typeof value === 'string') {
    if (Number.isFinite(schema.minLength) && value.length < schema.minLength) errors.push(`${path} 长度不足`);
    if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) errors.push(`${path} 长度超限`);
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, index) => errors.push(...validateValue(item, schema.items, `${path}[${index}]`)));
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (value[key] === undefined || value[key] === null || value[key] === '') errors.push(`${path}.${key} 缺少必填值`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (value[key] !== undefined) errors.push(...validateValue(value[key], child, `${path}.${key}`));
  }
  return errors;
}

export function createExecutionProtocol(input = {}) {
  const definition = input.definition?.function ?? input.definition ?? {};
  const risk = text(input.risk || 'read', 40);
  const sideEffect = input.sideEffect === true || ['write', 'system', 'external'].includes(risk);
  return {
    protocolVersion: PROTOCOL_VERSION,
    name: text(input.name || definition.name, 128),
    stages: ['discover', 'validate-input', 'dry-run', 'approval', 'call', 'validate-output', 'record'],
    inputSchema: definition.parameters ?? input.inputSchema ?? { type: 'object', properties: {} },
    outputSchema: input.outputSchema ?? {},
    sideEffect,
    dryRunSupported: input.dryRunSupported !== false,
    approvalRequired: input.approvalRequired === true || sideEffect,
    idempotencyRequired: input.idempotencyRequired === true || sideEffect,
    retryPolicy: { maxRetries: Number.isInteger(input.maxRetries) ? Math.max(0, input.maxRetries) : sideEffect ? 2 : 1, backoffMs: Number.isFinite(input.backoffMs) ? input.backoffMs : 1000 },
  };
}

export function validateExecutionInput(protocol, input) {
  const errors = validateValue(input, protocol?.inputSchema, '$input');
  return { ok: errors.length === 0, errors };
}

export function validateExecutionOutput(protocol, output) {
  const errors = validateValue(output, protocol?.outputSchema, '$output');
  return { ok: errors.length === 0, errors };
}

export function classifyExecutionFailure(error, stage = 'call') {
  const message = text(error?.message ?? error, 1200);
  const category = /401|403|unauthorized|forbidden|鉴权|权限|密钥|凭据/iu.test(message) ? 'permission'
    : /timeout|timed out|aborted|超时/iu.test(message) ? 'network'
      : /ECONN|ENOTFOUND|fetch failed|网络|连接失败/iu.test(message) ? 'network'
        : /429|rate.?limit|限流/iu.test(message) ? 'rate-limit'
          : /schema|required|invalid|参数|格式|校验/iu.test(message) ? 'validation'
            : /not found|missing|不存在|缺少|未配置/iu.test(message) ? 'configuration' : 'unknown';
  return { category, stage: text(stage, 60), message, retryable: ['network', 'rate-limit'].includes(category) };
}

export function shouldRetryExecution(failure, attempt, protocol) {
  const maxRetries = Number(protocol?.retryPolicy?.maxRetries) || 0;
  return failure?.retryable === true && Number(attempt) <= maxRetries;
}

export const EXECUTION_PROTOCOL_VERSION = PROTOCOL_VERSION;
