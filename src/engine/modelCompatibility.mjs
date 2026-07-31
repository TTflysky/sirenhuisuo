/**
 * Versioned compatibility contract for OpenAI-compatible text and image APIs.
 * This module is deliberately side-effect free so it can be used by the
 * renderer, Electron diagnostics and release gates alike.
 */
export const MODEL_COMPATIBILITY_SCHEMA = 1;

export const COMPATIBILITY_CAPABILITIES = Object.freeze([
  'chat', 'streaming', 'tool_calls', 'image_generation', 'legacy_image', 'custom_base_url',
]);

const CAPABILITY_LABELS = {
  chat: '聊天',
  streaming: '流式输出',
  tool_calls: '工具调用',
  image_generation: 'GPT Image 2 生图',
  legacy_image: '兼容图片接口',
  custom_base_url: '自定义地址',
};

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function endpoint(base, path) {
  const clean = text(base, 1000).replace(/\/+$/u, '');
  if (!clean) return '';
  return /\/v\d+(?:\/|$)/u.test(clean) ? `${clean}${path}` : `${clean}/v1${path}`;
}

function parseBody(body) {
  if (body && typeof body === 'object') return body;
  try { return JSON.parse(String(body ?? '')); } catch { return {}; }
}

export function classifyModelProbe(input = {}) {
  const status = Number(input.httpStatus ?? input.status ?? 0);
  const body = parseBody(input.body);
  const rawError = text(input.error || body?.error?.message || body?.message, 300);
  const capability = COMPATIBILITY_CAPABILITIES.includes(input.capability) ? input.capability : 'chat';
  if (input.missingConfig === true) return { state: 'missing_config', recoverable: true, capability, nextAction: '填写 API 地址、模型名称和所需密钥。' };
  if (input.timeout === true || input.errorName === 'AbortError') return { state: 'timeout', recoverable: true, capability, nextAction: '检查代理和服务负载，或适当延长超时时间。' };
  if (status === 401 || status === 403) return { state: 'authentication', recoverable: true, capability, nextAction: '检查 API Key、权限范围和账号所属项目。' };
  if (status === 429) return { state: 'rate_limited', recoverable: true, capability, nextAction: '等待限流窗口恢复，或切换备用模型。' };
  if (status >= 500) return { state: 'upstream_error', recoverable: true, capability, nextAction: '服务商暂时异常，稍后重试或切换备用模型。' };
  if (status === 404) return { state: 'endpoint_not_found', recoverable: true, capability, nextAction: '检查 Base URL 是否已经包含正确的 /v1 或服务商版本路径。' };
  if (status >= 400) {
    const filtered = /content|safety|moderation|policy|敏感|过滤/iu.test(rawError);
    return { state: filtered ? 'content_filtered' : 'protocol_error', recoverable: !filtered, capability, error: rawError, nextAction: filtered ? '调整请求内容后重试，不要重复发送同一内容。' : '核对接口版本、请求字段和模型名称。' };
  }
  if (input.ok === false || input.networkError === true) return { state: 'network_error', recoverable: true, capability, error: rawError, nextAction: '检查网络、代理和服务地址。' };
  const valid = capability === 'image_generation'
    ? Array.isArray(body?.data) || typeof body?.url === 'string'
    : capability === 'streaming'
      ? input.streamObserved === true || input.sseObserved === true
      : capability === 'tool_calls'
        ? Array.isArray(body?.choices) && (body?.choices?.[0]?.message?.tool_calls !== undefined || input.toolsAccepted === true)
        : Array.isArray(body?.choices) || typeof body?.output_text === 'string' || typeof body?.output === 'object';
  return valid
    ? { state: 'supported', recoverable: false, capability, nextAction: '该能力已通过真实响应检查。' }
    : { state: 'protocol_error', recoverable: true, capability, nextAction: `接口返回了响应，但缺少${CAPABILITY_LABELS[capability] || capability}需要的字段。` };
}

export function createCompatibilityReport(input = {}) {
  const config = input.modelConfig || {};
  const probes = Array.isArray(input.probes) ? input.probes : [];
  const baseUrl = text(config.apiHost, 1000).replace(/\/+$/u, '');
  const model = text(config.model || config.refModelId, 160);
  const results = Object.fromEntries(COMPATIBILITY_CAPABILITIES.map((capability) => [capability, {
    capability,
    label: CAPABILITY_LABELS[capability],
    state: baseUrl ? 'not_tested' : 'missing_config',
    recoverable: true,
  }]));
  if (baseUrl) results.custom_base_url = { capability: 'custom_base_url', label: CAPABILITY_LABELS.custom_base_url, state: 'supported', recoverable: false };
  for (const probe of probes) {
    const classified = classifyModelProbe(probe);
    results[classified.capability] = { ...classified, label: CAPABILITY_LABELS[classified.capability] };
  }
  const failed = Object.values(results).filter((item) => !['supported', 'not_tested'].includes(item.state));
  const unsupported = Object.values(results).filter((item) => item.state === 'protocol_error' || item.state === 'content_filtered');
  const untested = Object.values(results).filter((item) => item.state === 'not_tested');
  return {
    schema: MODEL_COMPATIBILITY_SCHEMA,
    generatedAt: Number.isFinite(input.generatedAt) ? input.generatedAt : Date.now(),
    provider: text(config.provider, 80) || 'custom',
    model: model || '未指定',
    baseUrl: baseUrl || undefined,
    capabilities: results,
    probes: probes.map((probe) => ({ capability: probe.capability, endpoint: text(probe.endpoint, 1000), httpStatus: probe.httpStatus ?? probe.status, state: classifyModelProbe(probe).state })),
    status: failed.length === 0 && untested.length === 0 ? 'compatible' : unsupported.length > 0 || untested.length > 0 ? 'partial' : 'blocked',
    nextActions: [...new Set(failed.map((item) => item.nextAction).filter(Boolean))],
  };
}

export function buildModelProbePlan(modelConfig = {}) {
  const base = text(modelConfig.apiHost, 1000);
  const image = /image|dall-e|flux|qwen-image|gpt-image/iu.test(text(modelConfig.model, 160));
  return [
    { capability: 'chat', method: 'POST', endpoint: endpoint(base, '/chat/completions'), required: true },
    { capability: 'streaming', method: 'POST', endpoint: endpoint(base, '/chat/completions'), required: false },
    { capability: 'tool_calls', method: 'POST', endpoint: endpoint(base, '/chat/completions'), required: false },
    { capability: image ? 'image_generation' : 'legacy_image', method: 'POST', endpoint: endpoint(base, '/images/generations'), required: false },
  ];
}

export async function probeModelCompatibility(modelConfig = {}, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 20000;
  const base = text(modelConfig.apiHost, 1000);
  if (!base || !text(modelConfig.model || modelConfig.refModelId, 160)) return createCompatibilityReport({ modelConfig, probes: [{ capability: 'chat', missingConfig: true }] });
  if (typeof fetchImpl !== 'function') return createCompatibilityReport({ modelConfig, probes: [{ capability: 'chat', networkError: true, error: 'fetch 不可用' }] });
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (modelConfig.apiKey) headers.Authorization = `Bearer ${modelConfig.apiKey}`;
  const plan = buildModelProbePlan(modelConfig);
  const probes = [];
  const chat = plan[0];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(chat.endpoint, { method: chat.method, headers, signal: controller.signal, body: JSON.stringify({ model: text(modelConfig.model || modelConfig.refModelId, 160), messages: [{ role: 'user', content: 'compatibility probe: reply OK' }], stream: false }) });
    const body = await response.text().catch(() => '');
    probes.push({ capability: 'chat', endpoint: chat.endpoint, httpStatus: response.status, body, ok: response.ok });
    const parsed = parseBody(body);
    if (response.ok && Array.isArray(parsed?.choices)) {
      probes.push({ capability: 'tool_calls', endpoint: chat.endpoint, httpStatus: response.status, body: parsed, ok: true, toolsAccepted: parsed.choices?.[0]?.message?.tool_calls !== undefined });
    }
  } catch (error) {
    probes.push({ capability: 'chat', endpoint: chat.endpoint, timeout: error?.name === 'AbortError', errorName: error?.name, error: error?.message });
  } finally { clearTimeout(timer); }
  return createCompatibilityReport({ modelConfig, probes });
}
