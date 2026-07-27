const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const DEFAULT_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_HEADER_TIMEOUT_MS = 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function fileSize(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile() ? stat.size : -1;
  } catch {
    return -1;
  }
}

function expectedSha256(digest) {
  return typeof digest === 'string' && /^sha256:[a-f0-9]{64}$/iu.test(digest)
    ? digest.slice(7).toLowerCase()
    : '';
}

async function isVerifiedFile(filePath, expectedSize, digest) {
  const size = await fileSize(filePath);
  if (size < 0 || (Number.isFinite(expectedSize) && size !== expectedSize)) return false;
  const expected = expectedSha256(digest);
  return !expected || await sha256(filePath) === expected;
}

function downloadError(error, attempt, maxAttempts) {
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(`回滚安装包下载失败（第 ${attempt}/${maxAttempts} 次）：${reason}`);
}

async function downloadAssetWithResume({
  url,
  targetPath,
  expectedSize,
  digest,
  fetchImpl = globalThis.fetch,
  inactivityTimeoutMs = DEFAULT_INACTIVITY_TIMEOUT_MS,
  headerTimeoutMs = DEFAULT_HEADER_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMs = 3000,
  headers = {},
  onProgress,
}) {
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持网络下载');
  if (!/^https?:\/\//iu.test(String(url || ''))) throw new Error('回滚安装包地址无效');
  if (!path.isAbsolute(targetPath)) throw new Error('回滚安装包目标路径无效');
  const declaredSize = Number(expectedSize);
  const hasDeclaredSize = Number.isSafeInteger(declaredSize) && declaredSize > 0;
  const partPath = `${targetPath}.part`;
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });

  if (await isVerifiedFile(targetPath, hasDeclaredSize ? declaredSize : undefined, digest)) return targetPath;
  await fsp.rm(targetPath, { force: true });
  if (hasDeclaredSize) {
    const stagedSize = await fileSize(partPath);
    if (stagedSize === declaredSize) {
      if (await isVerifiedFile(partPath, declaredSize, digest)) {
        await fsp.rename(partPath, targetPath);
        return targetPath;
      }
      await fsp.rm(partPath, { force: true });
    } else if (stagedSize > declaredSize) {
      await fsp.rm(partPath, { force: true });
    }
  }

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let inactivityTimer;
    let headerTimer;
    const controller = new AbortController();
    try {
      let offset = Math.max(0, await fileSize(partPath));
      const requestHeaders = { ...headers };
      if (offset > 0) requestHeaders.Range = `bytes=${offset}-`;
      headerTimer = setTimeout(() => controller.abort(new Error('连接服务器超时')), headerTimeoutMs);
      const response = await fetchImpl(url, { headers: requestHeaders, redirect: 'follow', signal: controller.signal });
      clearTimeout(headerTimer);

      if (offset > 0 && response.status === 416) {
        if (!hasDeclaredSize || offset === declaredSize) break;
        await fsp.rm(partPath, { force: true });
        throw new Error('服务器拒绝当前断点，已从头重新下载');
      }
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const append = offset > 0 && response.status === 206;
      if (append) {
        const rangeStart = Number(/^bytes\s+(\d+)-/iu.exec(response.headers.get('content-range') || '')?.[1]);
        if (rangeStart !== offset) {
          await fsp.rm(partPath, { force: true });
          throw new Error('服务器返回的断点位置不一致，已从头重新下载');
        }
      } else if (offset > 0) {
        offset = 0;
      }

      let transferred = offset;
      const resetInactivityTimer = () => {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => controller.abort(new Error('连续 5 分钟没有收到下载数据')), inactivityTimeoutMs);
      };
      resetInactivityTimer();
      const progress = new Transform({
        transform(chunk, _encoding, callback) {
          transferred += chunk.length;
          resetInactivityTimer();
          onProgress?.({ transferred, total: hasDeclaredSize ? declaredSize : undefined, attempt });
          callback(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body),
        progress,
        fs.createWriteStream(partPath, { flags: append ? 'a' : 'w' }),
      );
      clearTimeout(inactivityTimer);

      const downloadedSize = await fileSize(partPath);
      if (hasDeclaredSize && downloadedSize < declaredSize) throw new Error(`连接提前结束（${downloadedSize}/${declaredSize} 字节）`);
      if (hasDeclaredSize && downloadedSize > declaredSize) {
        await fsp.rm(partPath, { force: true });
        throw new Error('下载数据超过 Release 记录大小，已丢弃异常缓存');
      }
      break;
    } catch (error) {
      clearTimeout(headerTimer);
      clearTimeout(inactivityTimer);
      lastError = downloadError(error, attempt, maxAttempts);
      if (attempt === maxAttempts) throw lastError;
      await wait(retryDelayMs * attempt);
    }
  }

  const finalSize = await fileSize(partPath);
  if (finalSize < 0 || (hasDeclaredSize && finalSize !== declaredSize)) {
    throw lastError || new Error('回滚安装包下载不完整');
  }
  const expected = expectedSha256(digest);
  if (expected && await sha256(partPath) !== expected) {
    await fsp.rm(partPath, { force: true });
    throw new Error('回滚安装包校验失败，已拒绝启动');
  }
  await fsp.rm(targetPath, { force: true });
  await fsp.rename(partPath, targetPath);
  return targetPath;
}

async function downloadGitHubReleaseInstaller({ owner, repo, version, directory, fetchImpl = globalThis.fetch, onProgress }) {
  if (!/^[0-9A-Za-z.-]{1,64}$/u.test(String(version || ''))) throw new Error('回滚版本号无效');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('读取 Release 信息超时')), DEFAULT_HEADER_TIMEOUT_MS);
  let releaseResponse;
  try {
    releaseResponse = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tags/v${encodeURIComponent(version)}`, {
      headers: { 'User-Agent': 'Taiji-Rollback/2.0', Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!releaseResponse.ok) throw new Error(`无法读取 v${version} 回滚版本：HTTP ${releaseResponse.status}`);
  const release = await releaseResponse.json();
  const asset = (release.assets || []).find((item) => /\.exe$/iu.test(item.name) && /setup/iu.test(item.name));
  if (!asset?.browser_download_url) throw new Error(`v${version} Release 中没有找到安装包`);
  return downloadAssetWithResume({
    url: asset.browser_download_url,
    targetPath: path.join(directory, `rollback-${version}.exe`),
    expectedSize: Number(asset.size),
    digest: asset.digest,
    fetchImpl,
    headers: { 'User-Agent': 'Taiji-Rollback/2.0' },
    onProgress,
  });
}

module.exports = {
  downloadAssetWithResume,
  downloadGitHubReleaseInstaller,
  sha256,
};
