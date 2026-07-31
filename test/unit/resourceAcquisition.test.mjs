import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { classifyAcquisitionFailure, createWebResourceAcquirer } = require('../../electron/resourceAcquisition.cjs');

describe('web resource acquisition', () => {
  it('returns direct evidence without opening the browser', async () => {
    const browserReader = vi.fn();
    const acquire = createWebResourceAcquirer({
      directReader: async (url) => ({ ok: true, url, content: 'direct article body' }),
      browserReader,
    });
    const result = await acquire('https://example.com/article');
    expect(result.acquisition.strategy).toBe('direct-http');
    expect(browserReader).not.toHaveBeenCalled();
  });

  it('switches to a browser session after a blocked direct response', async () => {
    const acquire = createWebResourceAcquirer({
      directReader: async () => { throw new Error('网页返回了访问验证或拦截页面'); },
      browserReader: async (url) => ({ ok: true, url, title: '文章', content: 'browser session article body' }),
    });
    const result = await acquire('https://mp.weixin.qq.com/s/example');
    expect(result.acquisition.strategy).toBe('browser-session');
    expect(result.acquisition.attempts).toHaveLength(2);
    expect(result.acquisition.attempts[0].failure.category).toBe('blocked');
  });

  it('does not search or retry unrelated strategies after a definitive 404', async () => {
    const browserReader = vi.fn();
    const acquire = createWebResourceAcquirer({
      directReader: async () => { throw new Error('知识库返回 HTTP 404'); },
      browserReader,
    });
    await expect(acquire('https://example.com/missing')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(browserReader).not.toHaveBeenCalled();
  });

  it('classifies failures for the controller', () => {
    expect(classifyAcquisitionFailure(new Error('连接超时')).category).toBe('timeout');
    expect(classifyAcquisitionFailure(new Error('需要登录授权')).category).toBe('authentication');
  });
});
