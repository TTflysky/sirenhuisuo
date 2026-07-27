/**
 * 太极 AI 办公会所 · 自动更新模块
 *
 * 基于 electron-updater 实现：
 * - 启动后延迟检查更新（让窗口先加载）
 * - 发现新版本→后台静默下载→通知用户重启安装
 * - IPC 桥接给 renderer 显示更新状态
 *
 * === 使用方式 ===
 * 1. 构建发布版：npm run release:win
 * 2. 产出在 release/ 目录：
 *    - taiji-office-setup-x.x.x.exe
 *    - latest.yml          ← 更新清单（告诉客户端最新版本）
 *    - latest.yml.blockmap ← 块差分映射（增量更新用）
 * 3. 把 release/ 下所有文件上传到更新服务器（任意静态文件托管）
 * 4. 更新服务器 URL 在 package.json -> build.publish[0].url 中配置
 * 5. 已安装的客户端启动后自动检测更新
 */
const { autoUpdater } = require('electron-updater');
const { app, ipcMain, safeStorage } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');
const { version: APP_VERSION } = require('../package.json');
const log = require('electron-log');

// ---- 日志 ----
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// ---- 基础配置 ----
autoUpdater.autoDownload = true;          // 发现新版本自动下载
autoUpdater.autoInstallOnAppQuit = false; // 必须先完成本机备份，再由用户明确安装
autoUpdater.allowDowngrade = false;
autoUpdater.allowPrerelease = false;

// ---- IPC：供 renderer 调用检查更新 ----
ipcMain.handle('update:check', async () => {
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---- IPC：供 renderer 调用立即重启安装 ----
let downloadedVersion = '';

function upgradeDir() {
  return path.join(app.getPath('userData'), 'upgrade-backups');
}
function journalPath() {
  return path.join(upgradeDir(), 'upgrade-journal.json');
}
async function readJournal() {
  try { return JSON.parse(await fsp.readFile(journalPath(), 'utf8')); } catch { return null; }
}
async function writeJournal(value) {
  await fsp.mkdir(upgradeDir(), { recursive: true });
  await fsp.writeFile(journalPath(), JSON.stringify(value, null, 2), 'utf8');
}
async function saveEncryptedBackup(snapshot, toVersion) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 系统加密当前不可用，已停止更新以避免明文备份配置');
  const raw = JSON.stringify(snapshot ?? {});
  if (Buffer.byteLength(raw, 'utf8') > 24 * 1024 * 1024) throw new Error('本地配置超过 24MB，无法自动备份；请先在设置中导出工作区');
  const backupPath = path.join(upgradeDir(), `pre-${APP_VERSION}-to-${toVersion || 'unknown'}-${Date.now()}.bin`);
  await fsp.mkdir(upgradeDir(), { recursive: true });
  await fsp.writeFile(backupPath, safeStorage.encryptString(raw));
  const values = snapshot?.localStorage || {};
  const arrayCount = (key) => { try { const value = JSON.parse(values[key] || '[]'); return Array.isArray(value) ? value.length : 0; } catch { return 0; } };
  const modelCount = (() => { try { const value = JSON.parse(values.hermes_office_settings || '{}'); return Array.isArray(value.modelLibrary) ? value.modelLibrary.length : value.model || value.apiHost ? 1 : 0; } catch { return 0; } })();
  const journal = {
    schema: 1, fromVersion: APP_VERSION, toVersion: toVersion || downloadedVersion || 'unknown',
    backupPath, backupCreatedAt: new Date().toISOString(), status: 'ready-to-install', validation: null,
    backupSummary: { employees: arrayCount('hermes_office_employees'), teams: arrayCount('hermes_office_teams'), models: modelCount, taskRuns: arrayCount('hermes_office_task_runs_v1') },
  };
  await writeJournal(journal);
  return journal;
}

ipcMain.handle('update:install', async (_event, snapshot) => {
  try {
    await saveEncryptedBackup(snapshot, downloadedVersion);
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 200);
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
});

ipcMain.handle('upgrade:status', async () => ({ ok: true, currentVersion: APP_VERSION, journal: await readJournal() }));

ipcMain.handle('upgrade:recordValidation', async (_event, validation) => {
  try {
    const journal = await readJournal();
    if (!journal || journal.toVersion !== APP_VERSION) return { ok: true, recorded: false };
    const expected = journal.backupSummary || {};
    const dataPreserved = ['employees', 'teams', 'models', 'taskRuns'].every((key) => Number(validation?.[key] || 0) >= Number(expected[key] || 0));
    const ok = Boolean(validation?.workspaceReady) && dataPreserved;
    journal.status = ok ? 'validated' : 'validation-failed';
    journal.validation = { ...validation, ok, dataPreserved, checkedAt: new Date().toISOString() };
    await writeJournal(journal);
    return { ok: true, recorded: true };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
});

ipcMain.handle('upgrade:readBackup', async () => {
  try {
    const journal = await readJournal();
    if (!journal?.backupPath) throw new Error('没有找到可用的更新前备份');
    const encrypted = await fsp.readFile(journal.backupPath);
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 系统加密当前不可用，无法读取备份');
    return { ok: true, snapshot: JSON.parse(safeStorage.decryptString(encrypted)), fromVersion: journal.fromVersion };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
});

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject); input.on('data', (chunk) => hash.update(chunk)); input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function downloadReleaseInstaller(version) {
  const releaseResponse = await fetch(`https://api.github.com/repos/TTflysky/sirenhuisuo/releases/tags/v${encodeURIComponent(version)}`, {
    headers: { 'User-Agent': 'Taiji-Rollback/1.0', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000),
  });
  if (!releaseResponse.ok) throw new Error(`无法读取 v${version} 回滚版本：HTTP ${releaseResponse.status}`);
  const release = await releaseResponse.json();
  const asset = (release.assets || []).find((item) => /\.exe$/i.test(item.name) && /setup/i.test(item.name));
  if (!asset?.browser_download_url) throw new Error(`v${version} Release 中没有找到安装包`);
  const installerPath = path.join(upgradeDir(), `rollback-${version}.exe`);
  const response = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Taiji-Rollback/1.0' }, signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error(`回滚安装包下载失败：HTTP ${response.status}`);
  await fsp.mkdir(upgradeDir(), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(installerPath));
  if (asset.digest && /^sha256:/i.test(asset.digest)) {
    const expected = asset.digest.slice(7).toLowerCase();
    const actual = await sha256(installerPath);
    if (actual !== expected) { await fsp.rm(installerPath, { force: true }); throw new Error('回滚安装包校验失败，已拒绝启动'); }
  }
  return installerPath;
}

ipcMain.handle('upgrade:prepareRollback', async () => {
  try {
    const journal = await readJournal();
    if (!journal?.fromVersion) throw new Error('没有记录可回滚的上一版本');
    const installerPath = await downloadReleaseInstaller(journal.fromVersion);
    journal.status = 'rollback-prepared';
    journal.rollbackInstaller = installerPath;
    journal.rollbackPreparedAt = new Date().toISOString();
    await writeJournal(journal);
    return { ok: true, installerPath, fromVersion: journal.fromVersion };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
});

ipcMain.handle('upgrade:rollback', async () => {
  try {
    const journal = await readJournal();
    if (!journal?.fromVersion || journal.status !== 'rollback-prepared' || !journal.rollbackInstaller) {
      throw new Error('旧安装包尚未下载并校验，请重新准备回滚');
    }
    const root = path.resolve(upgradeDir());
    const installerPath = path.resolve(journal.rollbackInstaller);
    const relative = path.relative(root, installerPath);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !/\.exe$/iu.test(installerPath)) {
      throw new Error('回滚安装包路径无效');
    }
    const stat = await fsp.stat(installerPath);
    if (!stat.isFile() || stat.size < 1024 * 1024) throw new Error('回滚安装包不完整，请重新准备回滚');
    journal.status = 'rolling-back';
    await writeJournal(journal);
    const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
    child.unref();
    setTimeout(() => app.quit(), 500);
    return { ok: true, installerPath };
  } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
});

// ---- 对外暴露启动函数（main.cjs 中调用） ----
function initAutoUpdater(mainWindow) {
  // 事件 → IPC 转发给 renderer
  autoUpdater.on('checking-for-update', () => {
    mainWindow.webContents.send('update:status', { status: 'checking', message: '正在检查更新…' });
  });

  autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send('update:status', {
      status: 'available',
      version: info.version,
      message: `发现新版本 v${info.version}，正在下载…`,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    mainWindow.webContents.send('update:status', {
      status: 'not-available',
      version: info?.version,
      message: `已是最新版本 v${info?.version ?? '?'}`,
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    mainWindow.webContents.send('update:status', {
      status: 'downloading',
      percent: progressObj.percent,
      bytesPerSecond: progressObj.bytesPerSecond,
      total: progressObj.total,
      transferred: progressObj.transferred,
      message: `下载中 ${Math.round(progressObj.percent)}%`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = info.version;
    mainWindow.webContents.send('update:status', {
      status: 'downloaded',
      version: info.version,
      message: `v${info.version} 已下载就绪。点击重启安装更新。`,
    });
  });

  autoUpdater.on('error', (err) => {
    // Background update errors are diagnostic only. They are not application
    // or model-network errors and should not be displayed as such.
    log.warn('[autoUpdate] update check failed:', err?.message ?? err);
  });

  // 启动后延迟 3 秒检查更新（让窗口先加载完成）
  setTimeout(() => {
    if (process.env.NODE_ENV === 'development' || !process.resourcesPath) {
      log.info('[autoUpdate] 开发模式/未打包，跳过自动更新检查');
      return;
    }
    log.info('[autoUpdate] 开始检查更新…');
    autoUpdater.checkForUpdates().catch((e) => {
      log.warn('[autoUpdate] 检查更新失败（静默忽略）:', e.message);
    });
  }, 3000);
}

module.exports = { initAutoUpdater, autoUpdater };
