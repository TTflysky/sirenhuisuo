const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { exec, execFile } = require('child_process');
const { initAutoUpdater } = require('./autoUpdate.cjs');

// ===== 自主代理工作区（沙箱目录，所有文件读写/命令执行都限制在此）=====
const WORKSPACE = path.join(app.getPath('userData'), 'workspace');
function ensureWorkspace() {
  try { fs.mkdirSync(WORKSPACE, { recursive: true }); } catch {}
  return WORKSPACE;
}
ensureWorkspace();

// 路径安全：限制在 WORKSPACE 内，禁止 .. 穿越
function safeJoin(...parts) {
  const target = path.resolve(WORKSPACE, path.join(...parts));
  const rel = path.relative(WORKSPACE, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径越界：不允许访问工作区以外的文件');
  }
  return target;
}

const chatWindows = new Map();
const CHAT_WINDOW_WIDTH = 560;
const CHAT_WINDOW_HEIGHT = 700;
const CHAT_WINDOW_MIN_WIDTH = 420;
const CHAT_WINDOW_MIN_HEIGHT = 420;
const CHAT_WINDOW_OFFSET = 28;

function normalizeChatOptions(opts) {
  const type = opts?.type;
  if (!['dm-chat', 'team-chat', 'assistant-chat'].includes(type)) return null;
  if (type === 'assistant-chat') return { type, refId: '', key: 'assistant-chat' };
  const refId = typeof opts?.refId === 'string' ? opts.refId.trim() : '';
  if (!refId) return null;
  return { type, refId, key: `${type}:${refId}` };
}

function bringToFront(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.setAlwaysOnTop(true);
  win.focus();
  win.moveTop();
  setTimeout(() => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(false);
  }, 300);
}

function getChatWindowBounds() {
  const sourceBounds = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow.getBounds()
    : screen.getPrimaryDisplay().workArea;
  const workArea = screen.getDisplayMatching(sourceBounds).workArea;
  const width = CHAT_WINDOW_WIDTH;
  const height = CHAT_WINDOW_HEIGHT;
  const offset = chatWindows.size * CHAT_WINDOW_OFFSET;
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - width);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - height);
  return {
    x: Math.max(workArea.x, Math.min(maxX, sourceBounds.x + offset)),
    y: Math.max(workArea.y, Math.min(maxY, sourceBounds.y + offset)),
    width,
    height,
  };
}

let mainWindow = null;
let ipcHandlersRegistered = false;

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

  mainWindow = win;

  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  if (!ipcHandlersRegistered) {
    ipcHandlersRegistered = true;

  // ===== 窗口控制：始终作用于发起事件的窗口（支持原生聊天子窗口）=====
  const senderWin = (event) => BrowserWindow.fromWebContents(event.sender);
  ipcMain.on('win:minimize', (event) => senderWin(event)?.minimize());
  ipcMain.on('win:toggle-max', (event) => {
    const w = senderWin(event);
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.on('win:close', (event) => senderWin(event)?.close());

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
    const normalized = normalizeChatOptions(opts);
    if (!normalized) return { ok: false, error: '无效的聊天窗口参数' };
    const { type, refId, key } = normalized;
    const existing = chatWindows.get(key);
    if (existing && !existing.isDestroyed()) {
      bringToFront(existing);
      return { ok: true, reused: true };
    }
    if (existing) chatWindows.delete(key);

    const bounds = getChatWindowBounds();
    const child = new BrowserWindow({
      ...bounds,
      minWidth: CHAT_WINDOW_MIN_WIDTH,
      minHeight: CHAT_WINDOW_MIN_HEIGHT,
      frame: false,
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    chatWindows.set(key, child);
    child.once('ready-to-show', () => bringToFront(child));
    child.on('closed', () => {
      if (chatWindows.get(key) === child) chatWindows.delete(key);
    });

    const hash = `chat?type=${encodeURIComponent(type)}&id=${encodeURIComponent(refId)}`;
    try {
      if (!app.isPackaged) {
        await child.loadURL(`http://localhost:5173/#${hash}`);
      } else {
        await child.loadFile(path.join(__dirname, '../dist/index.html'), { hash });
      }
      return { ok: true, reused: false };
    } catch (error) {
      if (!child.isDestroyed()) child.destroy();
      return { ok: false, error: String(error?.message ?? error) };
    }
  });

  // ===== 命令执行 IPC（handle 模式，支持 async/await）=====
  // 命令在自主代理工作区（WORKSPACE）内执行，便于写码-构建-运行闭环
  ipcMain.handle('exec:command', async (_event, cmd) => {
    const projectRoot = WORKSPACE;
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

  // ===== 文件系统 IPC（自主代理工作区，沙箱到 WORKSPACE）=====
  ipcMain.handle('fs:getWorkspace', async () => WORKSPACE);

  ipcMain.handle('fs:write', async (_event, { filePath, content }) => {
    try {
      const target = safeJoin(filePath || '');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content ?? '', 'utf8');
      const stat = await fsp.stat(target);
      return { ok: true, path: target, size: stat.size };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('fs:read', async (_event, { filePath }) => {
    try {
      const target = safeJoin(filePath || '');
      const content = await fsp.readFile(target, 'utf8');
      return { ok: true, path: target, content };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('fs:mkdir', async (_event, { dirPath }) => {
    try {
      const target = safeJoin(dirPath || '');
      await fsp.mkdir(target, { recursive: true });
      return { ok: true, path: target };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('fs:list', async (_event, { dirPath, recursive } = {}) => {
    try {
      const root = safeJoin(dirPath || '');
      const out = [];
      const walk = async (dir, prefix) => {
        let entries;
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const ent of entries) {
          if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
          const full = path.join(dir, ent.name);
          const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
          if (ent.isDirectory()) {
            out.push({ name: rel, type: 'dir', size: 0 });
            if (recursive) await walk(full, rel);
          } else {
            let size = 0;
            try { size = (await fsp.stat(full)).size; } catch {}
            out.push({ name: rel, type: 'file', size });
          }
        }
      };
      await walk(root, '');
      out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
      return { ok: true, path: root, items: out };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e), items: [] };
    }
  });

  // ===== 在文件管理器中打开路径（如工作区目录）=====
  ipcMain.handle('sys:openPath', async (_event, p) => {
    try {
      if (typeof p !== 'string' || !p.trim()) throw new Error('路径不能为空');
      const target = path.resolve(p);
      const rel = path.relative(WORKSPACE, target);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error('路径越界：不允许打开工作区以外的路径');
      }
      const realWorkspace = await fsp.realpath(WORKSPACE);
      const realTarget = await fsp.realpath(target);
      const realRel = path.relative(realWorkspace, realTarget);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw new Error('路径越界：不允许打开工作区以外的路径');
      }
      const error = await shell.openPath(realTarget);
      if (error) return { ok: false, error };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  // ===== 导出工作区为 zip（方便交付，仅 Windows 打包目标可用）=====
  ipcMain.handle('fs:exportZip', async () => {
    try {
      const outPath = path.join(app.getPath('userData'), `workspace-export-${Date.now()}.zip`);
      try { fs.unlinkSync(outPath); } catch {}
      // 单引号在 PowerShell 中为字面量，路径中的反斜杠/中文均安全
      const script = `Compress-Archive -Path '${WORKSPACE}' -DestinationPath '${outPath}' -Force`;
      await new Promise((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
          (err, _stdout, stderr) => {
            if (err) reject(new Error((stderr || err.message || '').toString()));
            else resolve(undefined);
          });
      });
      return { ok: true, path: outPath };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  // ===== 自动更新（仅打包后生效）=====
  initAutoUpdater(win);
  }

  // 主窗口关闭时，关闭所有原生聊天子窗口
  win.on('closed', () => {
    for (const child of [...chatWindows.values()]) {
      try { child.close(); } catch {}
    }
    chatWindows.clear();
    if (mainWindow === win) mainWindow = null;
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
