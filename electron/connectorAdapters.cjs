const IMA_ENDPOINT = 'https://ima.qq.com/openapi/wiki/v1/search_knowledge_base';
const IMA_SKILL_VERSION = '1.1.8';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_RETRY_DELAYS_MS = [0, 1200, 3000];

function delay(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function safeMessage(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : fallback;
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
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境没有可用的网络实现');
  const controller = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(IMA_ENDPOINT, {
      method: 'POST',
      headers: {
        'ima-openapi-clientid': credentials.clientId,
        'ima-openapi-apikey': credentials.apiKey,
        'ima-openapi-ctx': `skill_version=${IMA_SKILL_VERSION}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: '', cursor: '', limit: 1 }),
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

module.exports = { verifyConnectorAdapter, verifyIma, parseJsonEnvelope, IMA_ENDPOINT, IMA_SKILL_VERSION };
