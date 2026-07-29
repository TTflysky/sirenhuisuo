import { createExecutionProtocol, validateExecutionInput } from './executionProtocol.mjs';

export const TOOL_REGISTRY_PROTOCOL_VERSION = 1;

const NAME_PATTERN = /^[a-z][a-z0-9_]{1,127}$/u;
const WRITE_TOOLS = new Set(['write_file', 'install_skill', 'run_command']);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stable(value[key])]));
}

function fingerprint(value) {
  const text = JSON.stringify(stable(value));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function sourceFor(name) {
  if (name.startsWith('connector_')) return 'connector';
  if (name.startsWith('skill_')) return 'skill';
  return 'builtin';
}

function capabilityFor(name) {
  if (name === 'write_file') return 'workspace.write';
  if (name === 'read_file' || name === 'list_files') return 'workspace.read';
  if (name === 'web_search' || name === 'read_web_page') return 'web.research';
  if (name === 'search_skills' || name === 'read_skill' || name === 'install_skill') return 'skill.manage';
  if (name === 'inspect_connectors' || name === 'prepare_connector' || name === 'test_connector' || name.startsWith('connector_')) return 'connector.use';
  if (name === 'submit_review') return 'task.review';
  if (name === 'run_command') return 'system.command';
  return 'general';
}

function riskFor(name) {
  if (name.startsWith('connector_')) return 'external';
  if (name === 'run_command') return 'system';
  if (WRITE_TOOLS.has(name)) return 'write';
  return 'read';
}

function validateDefinition(definition) {
  const errors = [];
  if (definition?.type !== 'function') errors.push('type 必须是 function');
  const fn = definition?.function;
  const name = String(fn?.name || '');
  if (!NAME_PATTERN.test(name)) errors.push('工具名称格式无效');
  if (!String(fn?.description || '').trim()) errors.push('缺少工具说明');
  const parameters = fn?.parameters;
  if (!parameters || parameters.type !== 'object' || !parameters.properties || typeof parameters.properties !== 'object') {
    errors.push('参数 Schema 必须是 object');
  } else {
    const required = Array.isArray(parameters.required) ? parameters.required : [];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(parameters.properties, key)) errors.push(`必填参数 ${key} 没有 Schema`);
    }
  }
  return { name, errors };
}

function validateValue(value, schema) {
  if (!schema || typeof schema !== 'object') return '';
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `必须是 ${schema.enum.join(' / ')}`;
  if (value === undefined || value === null) return '';
  if (schema.type === 'string' && typeof value !== 'string') return '必须是文本';
  if (schema.type === 'boolean' && typeof value !== 'boolean') return '必须是开关值';
  if (schema.type === 'number' && typeof value !== 'number') return '必须是数字';
  if (schema.type === 'array' && !Array.isArray(value)) return '必须是列表';
  if (schema.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) return '必须是对象';
  return '';
}

export function buildToolRegistry(definitions = [], options = {}) {
  const records = [];
  const invalid = [];
  const collisions = [];
  const names = new Set();
  const metadata = options.metadata || {};
  for (const definition of definitions) {
    const validation = validateDefinition(definition);
    if (validation.errors.length) {
      invalid.push({ name: validation.name || '(未命名)', errors: validation.errors });
      continue;
    }
    if (names.has(validation.name)) {
      collisions.push(validation.name);
      continue;
    }
    names.add(validation.name);
    const configured = metadata[validation.name] || {};
    const source = configured.source || sourceFor(validation.name);
    const risk = configured.risk || riskFor(validation.name);
    records.push({
      name: validation.name,
      definition,
      source,
      capability: configured.capability || capabilityFor(validation.name),
      runtime: configured.runtime || (source === 'connector' ? 'connector' : 'universal'),
      risk,
      approval: configured.approval || (risk === 'read' ? 'none' : 'policy'),
      health: configured.health || 'ready',
      healthMessage: configured.healthMessage || '',
      schemaFingerprint: fingerprint(definition.function.parameters),
      protocol: createExecutionProtocol({ name: validation.name, definition, risk, sideEffect: risk !== 'read', approvalRequired: (configured.approval || (risk === 'read' ? 'none' : 'policy')) !== 'none' }),
    });
  }
  const readyRecords = records.filter((record) => record.health === 'ready');
  return {
    protocolVersion: TOOL_REGISTRY_PROTOCOL_VERSION,
    records,
    definitions: readyRecords.map((record) => record.definition),
    invalid,
    collisions,
    ready: readyRecords.length,
    blocked: records.length - readyRecords.length + invalid.length + collisions.length,
  };
}

export function discoverTools(registry, query = '') {
  const tokens = String(query || '').toLowerCase().split(/[\s，。；、/:_-]+/u).filter(Boolean);
  return registry.records
    .map((record) => {
      const haystack = `${record.name} ${record.definition.function.description} ${record.source} ${record.capability}`.toLowerCase();
      const score = tokens.length ? tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0) : 1;
      return { ...record, score };
    })
    .filter((record) => record.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
}

export function preflightToolCall(registry, nameInput, argsInput, options = {}) {
  const name = String(nameInput || '');
  const record = registry.records.find((item) => item.name === name);
  if (!record) {
    const collision = registry.collisions.includes(name);
    return { ok: false, protocolVersion: registry.protocolVersion, name, stage: 'discovery', category: collision ? 'collision' : 'unavailable', message: collision ? `工具 ${name} 名称冲突，已隔离` : `工具 ${name} 未注册或当前不可用` };
  }
  if (record.health !== 'ready') return { ok: false, protocolVersion: registry.protocolVersion, name, stage: 'health', category: 'unhealthy', message: record.healthMessage || `工具 ${name} 健康检查未通过` };
  const args = argsInput && typeof argsInput === 'object' && !Array.isArray(argsInput) ? argsInput : {};
  const schema = record.definition.function.parameters || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const missing = required.filter((key) => args[key] === undefined || args[key] === null || (typeof args[key] === 'string' && !args[key].trim()));
  if (missing.length) return { ok: false, protocolVersion: registry.protocolVersion, name, stage: 'arguments', category: 'missing_required', message: `缺少必填参数：${missing.join('、')}` };
  for (const [key, value] of Object.entries(args)) {
    const error = validateValue(value, schema.properties?.[key]);
    if (error) return { ok: false, protocolVersion: registry.protocolVersion, name, stage: 'arguments', category: 'invalid_type', message: `参数 ${key}${error}` };
  }
  const protocolInput = validateExecutionInput(record.protocol, args);
  if (!protocolInput.ok) return { ok: false, protocolVersion: registry.protocolVersion, name, stage: 'arguments', category: 'invalid_schema', message: protocolInput.errors.join('；'), record, requiresApproval: false };
  const requiresApproval = record.approval !== 'none' && options.approvalGranted !== true;
  if (requiresApproval && options.enforceApproval === true) return { ok: false, protocolVersion: registry.protocolVersion, name, stage: 'permission', category: 'approval_required', message: `工具 ${name} 需要按当前策略审批`, record, requiresApproval };
  return { ok: true, protocolVersion: registry.protocolVersion, name, stage: 'ready', category: 'ready', message: '工具预检通过', record, requiresApproval, executionProtocol: record.protocol };
}

export function toolRegistrySnapshot(registry) {
  return {
    protocolVersion: registry.protocolVersion,
    ready: registry.ready,
    blocked: registry.blocked,
    collisions: [...registry.collisions],
    invalid: registry.invalid.map((item) => ({ name: item.name, errors: [...item.errors] })),
    tools: registry.records.map(({ definition: _definition, ...record }) => ({ ...record })),
  };
}
