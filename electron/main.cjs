const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const { initAutoUpdater } = require('./autoUpdate.cjs');

// 子窗口集合（原生聊天窗口），主窗口关闭时一并关闭
const childWindows = new Set();

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 600,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // ===== 窗口控制：始终作用于发起事件的窗口（支持原生聊天子窗口）=====
  const senderWin = (event) => BrowserWindow.fromWebContents(event.sender) || win;
  ipcMain.on('win:minimize', (event) => senderWin(event).minimize());
  ipcMain.on('win:toggle-max', (event) => {
    const w = senderWin(event);
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.on('win:close', (event) => senderWin(event).close());

  // ===== 窗口间广播（renderer 任意窗口发出，转发给除发送者外的所有窗口）=====
  // 用于主办公室窗口与原生聊天子窗口之间实时同步状态（聊天消息、任务、产出物等）
  ipcMain.on('win:broadcast', (event, data) => {
    const sender = BrowserWindow.fromWebContents(event.sender);
    for (const w of BrowserWindow.getAllWindows()) {
      if (w !== sender && !w.isDestroyed()) {
        try { w.webContents.send('win:broadcast', data); } catch {}
      }
    }
  });

  // ===== 打开原生聊天窗口（真实桌面窗口，可在屏幕上自由拖动）=====
  ipcMain.handle('win:openChat', async (_event, opts) => {
    const { type, refId } = opts || {};
    if (!type) return { ok: false };
    const child = new BrowserWindow({
      width: 520,
      height: 640,
      minWidth: 360,
      minHeight: 320,
      frame: false,                 // 无边框：由 React 绘制标题栏，CSS app-region:drag 实现拖动
      backgroundColor: '#ffffff',
      // 注意：不设置 parent，保持为独立窗口，可拖到屏幕任意位置
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const hash = `chat?type=${encodeURIComponent(type)}&id=${encodeURIComponent(refId || '')}`;
    if (!app.isPackaged) {
      child.loadURL(`http://localhost:5173/#${hash}`);
    } else {
      child.loadFile(path.join(__dirname, '../dist/index.html'), { hash });
    }
    childWindows.add(child);
    child.on('closed', () => childWindows.delete(child));
    return { ok: true };
  });

  // ===== 命令执行 IPC（handle 模式，支持 async/await）=====
  ipcMain.handle('exec:command', async (_event, cmd) => {
    const projectRoot = app.isPackaged
      ? path.dirname(app.getPath('exe'))
      : path.join(__dirname, '..');
    const timeoutMs = 30000;
    const maxOutput = 100 * 1024; // 100KB 截断

    return new Promise((resolve) => {
      const child = exec(cmd, {
        cwd: projectRoot,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: '0' },
      }, (err, stdout, stderr) => {
        resolve({
          success: !err,
          exitCode: err ? ((err.code) || -1) : 0,
          stdout: (stdout || '').slice(0, maxOutput),
          stderr: (stderr || '').slice(0, maxOutput),
          signal: err && err.killed ? 'TIMEOUT' : undefined,
          cwd: projectRoot,
        });
      });

      // 超时强制 kill
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch {}
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000);
      }, timeoutMs);
      child.on('close', () => clearTimeout(timer));
    });
  });

  // ===== 自动更新（仅打包后生效）=====
  initAutoUpdater(win);

  // 主窗口关闭时，关闭所有原生聊天子窗口
  win.on('closed', () => {
    for (const c of childWindows) {
      try { c.close(); } catch {}
    }
    childWindows.clear();
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
