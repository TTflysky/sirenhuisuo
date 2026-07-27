const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const { downloadAssetWithResume, sha256 } = require('../electron/releaseDownload.cjs');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-update-download-'));
  const payload = Buffer.allocUnsafe(768 * 1024);
  for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251;
  const digest = `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;
  let interruptedOnce = false;
  let injectedFetchCalls = 0;
  const ranges = [];

  const server = http.createServer((request, response) => {
    const range = request.headers.range || '';
    ranges.push(range);
    if (request.url === '/resume' && !interruptedOnce) {
      interruptedOnce = true;
      response.writeHead(200, { 'Content-Length': payload.length });
      response.write(payload.subarray(0, 192 * 1024));
      setTimeout(() => response.destroy(), 10);
      return;
    }
    const requestedStart = Number(/^bytes=(\d+)-$/u.exec(range)?.[1] || 0);
    if (request.url === '/resume' && requestedStart > 0) {
      response.writeHead(206, {
        'Content-Length': payload.length - requestedStart,
        'Content-Range': `bytes ${requestedStart}-${payload.length - 1}/${payload.length}`,
      });
      response.end(payload.subarray(requestedStart));
      return;
    }
    response.writeHead(200, { 'Content-Length': payload.length });
    response.end(payload);
  });

  try {
    const port = await listen(server);
    const resumedTarget = path.join(root, 'resumed.exe');
    await downloadAssetWithResume({
      url: `http://127.0.0.1:${port}/resume`,
      targetPath: resumedTarget,
      expectedSize: payload.length,
      digest,
      inactivityTimeoutMs: 1000,
      headerTimeoutMs: 1000,
      retryDelayMs: 10,
      maxAttempts: 3,
      fetchImpl: (...args) => {
        injectedFetchCalls += 1;
        return fetch(...args);
      },
    });
    assert.equal(await sha256(resumedTarget), digest.slice(7));
    assert.equal(ranges.some((value) => /^bytes=\d+-$/u.test(value)), true, '断线后没有发送 Range 请求');
    assert.equal(injectedFetchCalls >= 2, true, '没有通过可注入网络实现完成重试');
    await assert.rejects(fs.stat(`${resumedTarget}.part`), /ENOENT/u);

    const restartTarget = path.join(root, 'range-ignored.exe');
    await fs.writeFile(`${restartTarget}.part`, payload.subarray(0, 73 * 1024));
    await downloadAssetWithResume({
      url: `http://127.0.0.1:${port}/ignore-range`,
      targetPath: restartTarget,
      expectedSize: payload.length,
      digest,
      inactivityTimeoutMs: 1000,
      headerTimeoutMs: 1000,
      retryDelayMs: 10,
      maxAttempts: 2,
    });
    assert.equal((await fs.stat(restartTarget)).size, payload.length, '服务器忽略 Range 时没有从头覆盖');
    assert.equal(await sha256(restartTarget), digest.slice(7));

    const corruptPartTarget = path.join(root, 'corrupt-complete-part.exe');
    await fs.writeFile(`${corruptPartTarget}.part`, Buffer.alloc(payload.length, 255));
    await downloadAssetWithResume({
      url: `http://127.0.0.1:${port}/replace-corrupt-part`,
      targetPath: corruptPartTarget,
      expectedSize: payload.length,
      digest,
      inactivityTimeoutMs: 1000,
      headerTimeoutMs: 1000,
      retryDelayMs: 10,
      maxAttempts: 2,
    });
    assert.equal(await sha256(corruptPartTarget), digest.slice(7), '等长损坏缓存没有自动重新下载');

    const corruptTarget = path.join(root, 'corrupt.exe');
    await assert.rejects(downloadAssetWithResume({
      url: `http://127.0.0.1:${port}/corrupt`,
      targetPath: corruptTarget,
      expectedSize: payload.length,
      digest: `sha256:${'0'.repeat(64)}`,
      inactivityTimeoutMs: 1000,
      headerTimeoutMs: 1000,
      retryDelayMs: 10,
      maxAttempts: 2,
    }), /校验失败/u);
    await assert.rejects(fs.stat(corruptTarget), /ENOENT/u);
    await assert.rejects(fs.stat(`${corruptTarget}.part`), /ENOENT/u);

    console.log(JSON.stringify({ passed: true, resumedRequests: ranges.filter((value) => value).length, injectedFetchCalls, bytes: payload.length }, null, 2));
  } finally {
    await close(server).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
