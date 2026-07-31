const FAILURE_PATTERNS = [
  ['blocked', /验证|验证码|人机|访问频繁|blocked|captcha|verify you are human|微信客户端/iu, false],
  ['authentication', /登录|认证|授权|401|403|unauthori[sz]ed|forbidden/iu, false],
  ['not_found', /404|不存在|已删除|not found/iu, false],
  ['timeout', /超时|timeout|aborted/iu, true],
  ['network', /网络|连接|fetch failed|dns|socket|econn|enotfound|err_network|network_access_denied|err_failed/iu, true],
  ['empty', /没有返回|空正文|empty/iu, true],
  ['protocol', /http \d+|协议|content-type/iu, false],
];

function classifyAcquisitionFailure(error) {
  const message = error instanceof Error ? error.message : String(error || '资源获取失败');
  const matched = FAILURE_PATTERNS.find(([, pattern]) => pattern.test(message));
  return { category: matched?.[0] ?? 'unknown', retryable: matched?.[2] ?? false, message };
}

function normalizeSuccess(result, strategy, attempts, startedAt) {
  const content = String(result?.content ?? result?.data ?? '').trim();
  if (!content) throw new Error('资源获取器没有返回正文');
  return {
    ...result,
    ok: true,
    content,
    acquisition: {
      strategy,
      attempts,
      durationMs: Date.now() - startedAt,
      contentLength: content.length,
    },
  };
}

function createWebResourceAcquirer(options = {}) {
  if (typeof options.directReader !== 'function') throw new Error('Web resource acquisition requires a direct reader');
  return async function acquireWebResource(rawUrl) {
    const url = new URL(rawUrl).toString();
    const startedAt = Date.now();
    const attempts = [];
    const strategies = [
      ['direct-http', options.directReader],
      ['browser-session', options.browserReader],
    ].filter(([, reader]) => typeof reader === 'function');

    for (const [strategy, reader] of strategies) {
      const attemptStartedAt = Date.now();
      try {
        const result = await reader(url);
        attempts.push({ strategy, ok: true, durationMs: Date.now() - attemptStartedAt });
        return normalizeSuccess(result, strategy, attempts, startedAt);
      } catch (error) {
        const failure = classifyAcquisitionFailure(error);
        attempts.push({ strategy, ok: false, durationMs: Date.now() - attemptStartedAt, failure });
        if (failure.category === 'not_found') break;
      }
    }

    const last = attempts.at(-1)?.failure ?? { category: 'unknown', retryable: false, message: '资源获取失败' };
    const error = new Error(`指定网页正文未取得（${last.category}）：${last.message}`);
    error.code = `RESOURCE_${String(last.category).toUpperCase()}`;
    error.acquisition = { attempts, durationMs: Date.now() - startedAt };
    throw error;
  };
}

module.exports = { classifyAcquisitionFailure, createWebResourceAcquirer };
