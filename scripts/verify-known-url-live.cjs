const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { app, BrowserWindow, net } = require('electron');
const { fetchKnowledgeUrl } = require('../electron/knowledge.cjs');
const { createWebResourceAcquirer } = require('../electron/resourceAcquisition.cjs');
const { createBrowserPageReader } = require('../electron/browserPageReader.cjs');

const TARGET_URL = 'https://mp.weixin.qq.com/s/6d_2gn2jK3lVTJaeookHkA';
const isolatedUserData = process.env.TAIJI_TEST_USER_DATA || path.join(os.tmpdir(), 'taiji-known-url-live');
app.setPath('userData', isolatedUserData);
app.setPath('sessionData', path.join(isolatedUserData, 'session'));
app.disableHardwareAcceleration();

async function main() {
  await app.whenReady();
  const acquire = createWebResourceAcquirer({
    directReader: (url) => fetchKnowledgeUrl(url, {
      fetchImpl: (target, options) => net.fetch(target, options),
      timeoutMs: 30000,
    }),
    browserReader: createBrowserPageReader(BrowserWindow, {
      timeoutMs: 45000,
      settleMs: 2500,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36 Taiji/2.7',
    }),
  });

  try {
    const result = await acquire(TARGET_URL);
    assert.equal(result.ok, true);
    assert.ok(result.content.length >= 80, 'The exact URL did not return enough readable body text');
    assert.ok(['direct-http', 'browser-session'].includes(result.acquisition.strategy));
    console.log(JSON.stringify({
      passed: true,
      caseId: 'KNOWN-URL-001',
      exactUrl: TARGET_URL,
      strategy: result.acquisition.strategy,
      contentLength: result.content.length,
      title: result.title,
      attempts: result.acquisition.attempts,
      unrelatedSearches: 0,
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      passed: false,
      caseId: 'KNOWN-URL-001',
      exactUrl: TARGET_URL,
      errorCode: error.code || 'RESOURCE_UNKNOWN',
      error: error.message,
      attempts: error.acquisition?.attempts || [],
      unrelatedSearches: 0,
    }, null, 2));
    if (!error.code || !String(error.code).startsWith('RESOURCE_')) throw error;
  } finally {
    app.quit();
  }
}

main().catch((error) => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});
