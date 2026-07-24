/**
 * Hermes 主动协作办公室 · 自动更新模块
 *
 * 基于 electron-updater 实现：
 * - 启动后延迟检查更新（让窗口先加载）
 * - 发现新版本→后台静默下载→通知用户重启安装
 * - IPC 桥接给 renderer 显示更新状态
 *
 * === 使用方式 ===
 * 1. 构建发布版：npm run release:win
 * 2. 产出在 release/ 目录：
 *    - Hermes 主动协作办公室 Setup x.x.x.exe
 *    - latest.yml          ← 更新清单（告诉客户端最新版本）
 *    - latest.yml.blockmap ← 块差分映射（增量更新用）
 * 3. 把 release/ 下所有文件上传到更新服务器（任意静态文件托管）
 * 4. 更新服务器 URL 在 package.json -> build.publish[0].url 中配置
 * 5. 已安装的客户端启动后自动检测更新
 */
const { autoUpdater } = require('electron-updater');
const { ipcMain } = require('electron');
const log = require('electron-log');

// ---- 日志 ----
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';

// ---- 基础配置 ----
autoUpdater.autoDownload = true;          // 发现新版本自动下载
autoUpdater.autoInstallOnAppQuit = true;  // 退出时自动安装（用户触发重启）
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
ipcMain.handle('update:install', async () => {
  autoUpdater.quitAndInstall(true, true);
  return { ok: true };
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
    mainWindow.webContents.send('update:status', {
      status: 'downloaded',
      version: info.version,
      message: `v${info.version} 已下载就绪。点击重启安装更新。`,
    });
  });

  autoUpdater.on('error', (err) => {
    mainWindow.webContents.send('update:status', {
      status: 'error',
      message: `更新出错：${err?.message ?? '未知错误'}`,
    });
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
