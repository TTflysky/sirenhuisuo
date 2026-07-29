const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const { invokeIma, verifyConnectorAdapter, verifyIma, IMA_ENDPOINT } = require('../electron/connectorAdapters.cjs');
const { buildPowerShellCommand } = require('../electron/commandShell.cjs');

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

async function run() {
  let request;
  const success = await verifyIma({ clientId: 'client-secret-value', apiKey: 'api-secret-value' }, {
    retryDelaysMs: [0],
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response(200, { code: 0, msg: 'success', data: { private: 'must-not-leak' } });
    },
  });
  assert.equal(success.ok, true);
  assert.equal(success.stage, 'complete');
  assert.equal(success.attempts, 1);
  assert.equal(request.url, IMA_ENDPOINT);
  assert.deepEqual(JSON.parse(request.options.body), { query: '', cursor: '', limit: 1 });
  assert.equal(request.options.headers['ima-openapi-clientid'], 'client-secret-value');
  assert.equal(request.options.headers['ima-openapi-apikey'], 'api-secret-value');
  assert.equal(JSON.stringify(success).includes('client-secret-value'), false);
  assert.equal(JSON.stringify(success).includes('api-secret-value'), false);
  assert.equal(JSON.stringify(success).includes('must-not-leak'), false);

  let actionRequest;
  const action = await invokeIma('search_knowledge', { query: '项目规范', knowledgeBaseId: 'kb-1' }, { clientId: 'client-secret-value', apiKey: 'api-secret-value' }, {
    retryDelaysMs: [0],
    fetchImpl: async (url, options) => {
      actionRequest = { url, options };
      return response(200, { code: 0, msg: 'success', data: { info_list: [{ media_id: 'm-1', title: '规范', headers: { Authorization: 'private' } }] } });
    },
  });
  assert.equal(action.ok, true);
  assert.equal(action.action, 'search_knowledge');
  assert.equal(actionRequest.url, 'https://ima.qq.com/openapi/wiki/v1/search_knowledge');
  assert.deepEqual(JSON.parse(actionRequest.options.body), { query: '项目规范', cursor: '', knowledge_base_id: 'kb-1' });
  assert.equal(action.data.info_list[0].headers, '[已脱敏]');
  assert.equal(JSON.stringify(action).includes('api-secret-value'), false);

  const missingActionArg = await invokeIma('search_knowledge', { query: '项目规范' }, { clientId: 'client', apiKey: 'secret' }, { retryDelaysMs: [0] });
  assert.equal(missingActionArg.stage, 'configuration');
  assert.match(missingActionArg.error, /知识库 ID/u);

  let attempts = 0;
  const retried = await verifyIma({ clientId: 'client', apiKey: 'secret' }, {
    retryDelaysMs: [0, 0, 0],
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('temporary network failure');
      return response(200, { code: '0', msg: 'success' });
    },
  });
  assert.equal(retried.ok, true);
  assert.equal(retried.attempts, 3);

  const rejected = await verifyIma({ clientId: 'client', apiKey: 'secret' }, {
    retryDelaysMs: [0, 0, 0],
    fetchImpl: async () => response(200, { code: 110001, msg: '凭据无效' }),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.stage, 'business');
  assert.equal(rejected.code, 110001);
  assert.equal(rejected.attempts, 1, 'business errors must not be retried');

  const malformed = await verifyIma({ clientId: 'client', apiKey: 'secret' }, {
    retryDelaysMs: [0],
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>bad gateway</html>' }),
  });
  assert.equal(malformed.stage, 'response');
  assert.equal(malformed.error, '接口返回的不是合法 JSON');

  const unknown = await verifyConnectorAdapter({ adapter: 'missing', credentials: {} });
  assert.equal(unknown.stage, 'adapter');

  if (process.platform === 'win32') {
    const failed = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', buildPowerShellCommand('cmd.exe /c exit 7')], { windowsHide: true });
    assert.equal(failed.status, 7, 'PowerShell must propagate a native command exit code');
    const passed = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', buildPowerShellCommand('cmd.exe /c exit 0')], { windowsHide: true });
    assert.equal(passed.status, 0);
  }

  console.log(JSON.stringify({ passed: true, nativeAdapter: 'ima', networkRetries: retried.attempts, businessStage: rejected.stage, shellExitPropagation: process.platform === 'win32' }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
