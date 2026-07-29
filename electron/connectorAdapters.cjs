const IMA_ENDPOINT = 'https://ima.qq.com/openapi/wiki/v1/search_knowledge_base';
const IMA_BASE_URL = 'https://ima.qq.com';
const IMA_SKILL_VERSION = '1.1.8';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_RETRY_DELAYS_MS = [0, 1200, 3000];

function delay(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function safeMessage(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : fallback;
}

function sanitizeConnectorData(value, key = '') {
  if (/(?:authorization|api[-_]?key|token|secret|password|cookie|headers?)/iu.test(key)) return '[已脱敏]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeConnectorData(item));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 20000) : value;
  return Object.fromEntries(Object.entries(value).slice(0, 200).map(([name, item]) => [name, sanitizeConnectorData(item, name)]));
}

function parseJsonEnvelope(text) {
  const normalized = String(text || '').trim().replace(/^\uFEFF/, '');
  if (!normalized) return { ok: false, error: '接口返回空响应' };
  try {
    const parsed = JSON.parse(normalized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: '接口返回的 JSON 结构不是对象' };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: '接口返回的不是合法 JSON' };
  }
}

async function imaAttempt(credentials, options) {
  const result = await imaRequestAttempt(IMA_ENDPOINT, { query: '', cursor: '', limit: 1 }, credentials, options);
  if (!result.ok) return result;
  return { ...result, data: undefined };
}

async function imaRequestAttempt(endpoint, body, credentials, options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境没有可用的网络实现');
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'ima-openapi-clientid': credentials.clientId,
        'ima-openapi-apikey': credentials.apiKey,
        'ima-openapi-ctx': `skill_version=${IMA_SKILL_VERSION}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const latencyMs = Date.now() - startedAt;
    const parsed = parseJsonEnvelope(text);
    if (!response.ok) {
      return {
        ok: false, status: 'disconnected', stage: 'http', httpStatus: response.status, latencyMs,
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        error: parsed.ok ? safeMessage(parsed.value.msg || parsed.value.message, `IMA 返回 HTTP ${response.status}`) : `IMA 返回 HTTP ${response.status}`,
      };
    }
    if (!parsed.ok) return { ok: false, status: 'disconnected', stage: 'response', httpStatus: response.status, latencyMs, retryable: false, error: parsed.error };
    const code = parsed.value.code;
    if (code !== 0 && code !== '0') {
      return {
        ok: false, status: 'disconnected', stage: 'business', httpStatus: response.status, latencyMs, code, retryable: false,
        error: safeMessage(parsed.value.msg || parsed.value.message, `IMA 返回业务状态 ${String(code ?? '缺失')}`),
      };
    }
    return {
      ok: true, status: 'connected', stage: 'complete', httpStatus: response.status, latencyMs, code, retryable: false,
      message: safeMessage(parsed.value.msg, 'success'),
      data: parsed.value.data,
    };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return {
      ok: false, status: 'disconnected', stage: timedOut ? 'timeout' : 'network', latencyMs: Date.now() - startedAt, retryable: true,
      error: timedOut ? `IMA 请求超过 ${timeoutMs}ms` : safeMessage(error?.message, 'IMA 网络请求失败'),
    };
  } finally {
    clearTimeout(timer);
  }
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function requiredText(args, key, label) {
  const value = typeof args?.[key] === 'string' ? args[key].trim() : '';
  if (!value) throw new Error(`${label}不能为空`);
  return value;
}

const IMA_ACTIONS = {
  search_knowledge_base: {
    endpoint: '/openapi/wiki/v1/search_knowledge_base',
    body: (args) => ({ query: String(args?.query || '').trim(), cursor: String(args?.cursor || ''), limit: boundedInteger(args?.limit, 20, 1, 20) }),
  },
  search_knowledge: {
    endpoint: '/openapi/wiki/v1/search_knowledge',
    body: (args) => ({ query: requiredText(args, 'query', '搜索关键词'), cursor: String(args?.cursor || ''), knowledge_base_id: requiredText(args, 'knowledgeBaseId', '知识库 ID') }),
  },
  get_knowledge_list: {
    endpoint: '/openapi/wiki/v1/get_knowledge_list',
    body: (args) => {
      const body = { cursor: String(args?.cursor || ''), limit: boundedInteger(args?.limit, 20, 1, 50), knowledge_base_id: requiredText(args, 'knowledgeBaseId', '知识库 ID') };
      if (String(args?.folderId || '').trim()) body.folder_id = String(args.folderId).trim();
      return body;
    },
  },
  get_media_info: {
    endpoint: '/openapi/wiki/v1/get_media_info',
    body: (args) => ({ media_id: requiredText(args, 'mediaId', '媒体 ID') }),
  },
  search_note: {
    endpoint: '/openapi/note/v1/search_note',
    body: (args) => {
      const query = requiredText(args, 'query', '搜索关键词');
      const searchContent = String(args?.searchType || '').toLocaleLowerCase() === 'content';
      const start = boundedInteger(args?.start, 0, 0, 1000000);
      return { search_type: searchContent ? 1 : 0, sort_type: 0, query_info: searchContent ? { content: query } : { title: query }, start, end: Math.min(start + 20, 1000020) };
    },
  },
  get_note_content: {
    endpoint: '/openapi/note/v1/get_doc_content',
    body: (args) => ({ note_id: requiredText(args, 'noteId', '笔记 ID'), target_content_format: 0 }),
  },
};

async function invokeIma(action, args, credentials, options = {}) {
  if (!credentials || typeof credentials.clientId !== 'string' || !credentials.clientId.trim()) {
    return { ok: false, status: 'disconnected', stage: 'configuration', retryable: false, attempts: 0, error: '缺少 IMA Client ID' };
  }
  if (typeof credentials.apiKey !== 'string' || !credentials.apiKey.trim()) {
    return { ok: false, status: 'disconnected', stage: 'configuration', retryable: false, attempts: 0, error: '缺少 IMA API Key' };
  }
  const spec = IMA_ACTIONS[String(action || '')];
  if (!spec) return { ok: false, status: 'disconnected', stage: 'adapter', retryable: false, attempts: 0, error: `IMA 不支持操作：${String(action || '未指定')}` };
  let body;
  try { body = spec.body(args || {}); } catch (error) {
    return { ok: false, status: 'disconnected', stage: 'configuration', retryable: false, attempts: 0, error: safeMessage(error?.message, 'IMA 参数无效') };
  }
  const retryDelaysMs = options.retryDelaysMs || DEFAULT_RETRY_DELAYS_MS;
  let result;
  for (let index = 0; index < retryDelaysMs.length; index += 1) {
    await delay(retryDelaysMs[index]);
    result = await imaRequestAttempt(`${IMA_BASE_URL}${spec.endpoint}`, body, { clientId: credentials.clientId.trim(), apiKey: credentials.apiKey.trim() }, options);
    if (result.ok || !result.retryable) return { ...result, data: result.ok ? sanitizeConnectorData(result.data) : undefined, adapter: 'ima', action, attempts: index + 1 };
  }
  return { ...result, data: undefined, adapter: 'ima', action, attempts: retryDelaysMs.length };
}

async function verifyIma(credentials, options = {}) {
  if (!credentials || typeof credentials.clientId !== 'string' || !credentials.clientId.trim()) {
    return { ok: false, status: 'disconnected', stage: 'configuration', retryable: false, attempts: 0, error: '缺少 IMA Client ID' };
  }
  if (typeof credentials.apiKey !== 'string' || !credentials.apiKey.trim()) {
    return { ok: false, status: 'disconnected', stage: 'configuration', retryable: false, attempts: 0, error: '缺少 IMA API Key' };
  }
  const retryDelaysMs = options.retryDelaysMs || DEFAULT_RETRY_DELAYS_MS;
  let result;
  for (let index = 0; index < retryDelaysMs.length; index += 1) {
    await delay(retryDelaysMs[index]);
    result = await imaAttempt({ clientId: credentials.clientId.trim(), apiKey: credentials.apiKey.trim() }, options);
    if (result.ok || !result.retryable) return { ...result, adapter: 'ima', attempts: index + 1 };
  }
  return { ...result, adapter: 'ima', attempts: retryDelaysMs.length };
}

async function verifyConnectorAdapter(input, options = {}) {
  const adapter = typeof input?.adapter === 'string' ? input.adapter.trim().toLowerCase() : '';
  if (adapter === 'ima') return verifyIma(input.credentials, options);
  return { ok: false, status: 'disconnected', stage: 'adapter', retryable: false, attempts: 0, error: `没有内置连接器适配器：${adapter || '未指定'}` };
}

async function invokeConnectorAdapter(input, options = {}) {
  const adapter = typeof input?.adapter === 'string' ? input.adapter.trim().toLowerCase() : '';
  if (adapter === 'ima') return invokeIma(input.action, input.args, input.credentials, options);
  return { ok: false, status: 'disconnected', stage: 'adapter', retryable: false, attempts: 0, error: `没有内置连接器适配器：${adapter || '未指定'}` };
}

module.exports = { verifyConnectorAdapter, invokeConnectorAdapter, verifyIma, invokeIma, parseJsonEnvelope, IMA_ENDPOINT, IMA_SKILL_VERSION, IMA_ACTIONS };
