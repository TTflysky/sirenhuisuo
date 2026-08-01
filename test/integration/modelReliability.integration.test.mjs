import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatCompletion } from '../../src/data/hermesClient.ts';
import { getModelHealthSnapshot } from '../../src/data/modelReliability.ts';

const settings = {
  provider: 'custom',
  apiHost: 'https://example.test/v1',
  apiKey: 'test-key',
  model: 'chat-model',
};
const config = {
  provider: settings.provider,
  apiHost: settings.apiHost,
  apiKey: settings.apiKey,
  model: settings.model,
};

describe('chat model reliability integration', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('hermes_office_settings', JSON.stringify(settings));
    vi.restoreAllMocks();
  });

  it('records repeated 503 responses and stops sending requests during the protection window', async () => {
    let fetchCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      fetchCount += 1;
      return { ok: false, status: 503, text: async () => 'upstream unavailable' };
    }));
    for (let index = 0; index < 3; index += 1) {
      await expect(chatCompletion([{ role: 'user', content: 'hello' }], 'test')).rejects.toThrow(/模型响应 503/u);
    }
    const health = getModelHealthSnapshot(config)[0];
    expect(fetchCount).toBe(3);
    expect(health.circuitState).toBe('open');
    expect(health.failureClasses.server).toBe(3);
    await expect(chatCompletion([{ role: 'user', content: 'hello again' }], 'test')).rejects.toThrow(/保护窗口/u);
    expect(fetchCount).toBe(3);
  });

  it('classifies a 429 response as rate limiting instead of a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, text: async () => 'too many requests' })));
    await expect(chatCompletion([{ role: 'user', content: 'hello' }], 'test')).rejects.toThrow(/模型响应 429/u);
    const health = getModelHealthSnapshot(config)[0];
    expect(health.failureClasses.rate_limit).toBe(1);
    expect(health.circuitState).toBe('closed');
  });

  it('classifies a request timeout and preserves it as a recoverable runtime sample', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    })));
    await expect(chatCompletion(
      [{ role: 'user', content: 'hello' }], 'test', undefined, undefined, undefined,
      undefined, undefined, undefined, { timeoutMs: 5, injectUserContext: false },
    )).rejects.toThrow(/超时/u);
    expect(getModelHealthSnapshot(config)[0].failureClasses.timeout).toBe(1);
  });

  it('classifies a transport interruption as a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network fetch failed'); }));
    await expect(chatCompletion([{ role: 'user', content: 'hello' }], 'test')).rejects.toThrow(/network/u);
    expect(getModelHealthSnapshot(config)[0].failureClasses.network).toBe(1);
  });
});
