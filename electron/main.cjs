const { app, BrowserWindow, ipcMain, screen, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { exec, execFile } = require('child_process');
const officeParser = require('officeparser');
const { initAutoUpdater } = require('./autoUpdate.cjs');
const { listSkills, readSkill, deleteSkill, installSkill } = require('./skills.cjs');
const { testObsidianVault, searchObsidianVault, readObsidianNote, fetchKnowledgeUrl } = require('./knowledge.cjs');
const { version: APP_VERSION } = require('../package.json');
const APP_TITLE = `私人办公会所 v${APP_VERSION}`;
const WINDOW_PREFERENCES_PATH = path.join(app.getPath('userData'), 'window-preferences.json');

// ===== 自主代理工作区（沙箱目录，所有文件读写/命令执行都限制在此）=====
const WORKSPACE = path.join(app.getPath('userData'), 'workspace');
const TEXT_FILE_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.yaml', '.yml',
  '.xml', '.log', '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.cpp', '.h',
  '.css', '.scss', '.less', '.html', '.htm', '.sh', '.bat', '.cmd', '.ps1', '.go',
  '.rs', '.php', '.rb', '.sql', '.toml', '.ini', '.cfg', '.conf', '.svg', '.vue', '.svelte',
]);
const PARSABLE_DOCUMENT_EXTENSIONS = new Set([
  '.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods', '.pdf', '.rtf', '.epub',
]);
const MAX_READABLE_FILE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 4 * 1024 * 1024;

function decodeTextBuffer(buffer) {
  if (buffer.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}
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

function sandboxPathEscape(command) {
  const text = String(command || '');
  return /(?:^|[\s'"])[a-z]:[\\/]/i.test(text)
    || /(?:^|[\s'"])[\\/]{2}/.test(text)
    || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(text)
    || /\$(?:env:(?:userprofile|home|appdata|localappdata|temp|windir|systemroot)|home|profile)\b|%(?:userprofile|appdata|localappdata|temp|windir|systemroot)%/i.test(text);
}

const chatWindows = new Map();
const toolWindows = new Map();
const toolWindowPayloads = new Map();
const TOOL_WINDOW_TYPES = new Set(['add-employee', 'edit-employee', 'create-team', 'rename-team', 'connector-config', 'assistant-settings']);
const CHAT_WINDOW_WIDTH = 560;
const CHAT_WINDOW_HEIGHT = 700;
const CHAT_WINDOW_MIN_WIDTH = 420;
const CHAT_WINDOW_MIN_HEIGHT = 420;
const CHAT_WINDOW_OFFSET = 28;
const ASSISTANT_COMPANION_KEY = 'assistant-chat';
const ASSISTANT_COMPANION_WIDTH = 480;
const ASSISTANT_COMPANION_MIN_WIDTH = 400;
const ASSISTANT_COMPANION_GAP = 10;
const LOCKED_CHAT_WIDTH = 480;

function normalizeChatOptions(opts) {
  const type = opts?.type;
  if (!['dm-chat', 'team-chat', 'assistant-chat'].includes(type)) return null;
  if (type === 'assistant-chat') return { type, refId: '', key: 'assistant-chat' };
  const refId = typeof opts?.refId === 'string' ? opts.refId.trim() : '';
  if (!refId) return null;
  return { type, refId, key: `${type}:${refId}` };
}

function focusChatWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.moveTop();
}

function bringToFront(win) {
  // 仅作为显式打开入口保留短暂置顶，不由窗口 focus 事件调用。
  if (!win || win.isDestroyed()) return;
  focusChatWindow(win);
  win.setAlwaysOnTop(true);
  setTimeout(() => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(false);
  }, 100);
}

function getRootOwner(win) {
  if (!win || win.isDestroyed()) return null;
  let owner = win;
  let parent = owner.getParentWindow();
  while (parent && !parent.isDestroyed()) {
    owner = parent;
    parent = owner.getParentWindow();
  }
  return owner;
}

function getChatWindowBounds(sourceWindow) {
  const sourceBounds = sourceWindow && !sourceWindow.isDestroyed()
    ? sourceWindow.getBounds()
    : screen.getPrimaryDisplay().workArea;
  const workArea = screen.getDisplayMatching(sourceBounds).workArea;
  const width = Math.min(CHAT_WINDOW_WIDTH, workArea.width);
  const height = Math.min(CHAT_WINDOW_HEIGHT, workArea.height);
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - width);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - height);
  const clampX = (value) => Math.max(workArea.x, Math.min(maxX, value));
  const clampY = (value) => Math.max(workArea.y, Math.min(maxY, value));
  const baseX = clampX(sourceBounds.x);
  const baseY = clampY(sourceBounds.y);
  const candidates = [];
  const candidateKeys = new Set();
  const addCandidate = (x, y) => {
    const key = `${x},${y}`;
    if (candidateKeys.has(key)) return;
    candidateKeys.add(key);
    candidates.push({ x, y });
  };

  const xSlots = Math.floor((maxX - workArea.x) / CHAT_WINDOW_OFFSET) + 2;
  const ySlots = Math.floor((maxY - workArea.y) / CHAT_WINDOW_OFFSET) + 2;
  const diagonalSlots = Math.max(xSlots, ySlots);
  for (let index = 0; index < diagonalSlots; index += 1) {
    addCandidate(
      clampX(baseX + index * CHAT_WINDOW_OFFSET),
      clampY(baseY + index * CHAT_WINDOW_OFFSET),
    );
  }

  const xCandidates = [];
  const yCandidates = [];
  for (let x = workArea.x; x <= maxX; x += CHAT_WINDOW_OFFSET) xCandidates.push(x);
  for (let y = workArea.y; y <= maxY; y += CHAT_WINDOW_OFFSET) yCandidates.push(y);
  if (xCandidates.at(-1) !== maxX) xCandidates.push(maxX);
  if (yCandidates.at(-1) !== maxY) yCandidates.push(maxY);
  for (const y of yCandidates) {
    for (const x of xCandidates) addCandidate(x, y);
  }

  const occupied = new Set();
  for (const chatWindow of chatWindows.values()) {
    if (!chatWindow || chatWindow.isDestroyed()) continue;
    const bounds = chatWindow.getBounds();
    occupied.add(`${bounds.x},${bounds.y}`);
  }
  const position = candidates.find(({ x, y }) => !occupied.has(`${x},${y}`)) ?? candidates[0];
  return { ...position, width, height };
}

let mainWindow = null;
let lastActiveWindow = null;
let ipcHandlersRegistered = false;
let assistantCompanionWindow = null;
let assistantCompanionManuallyClosed = false;
let assistantCompanionLocked = loadAssistantCompanionLockPreference();
const lockedChatWindowKeys = loadLockedChatWindowKeys();
let settingsWindow = null;
let tray = null;
let isQuitting = false;

function loadAssistantCompanionLockPreference() {
  try {
    return JSON.parse(fs.readFileSync(WINDOW_PREFERENCES_PATH, 'utf8')).assistantCompanionLocked === true;
  } catch {
    return false;
  }
}

function loadLockedChatWindowKeys() {
  try {
    const saved = JSON.parse(fs.readFileSync(WINDOW_PREFERENCES_PATH, 'utf8'));
    return new Set(Array.isArray(saved.lockedChatWindowKeys) ? saved.lockedChatWindowKeys.filter((key) => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveAssistantCompanionLockPreference() {
  try {
    fs.writeFileSync(
      WINDOW_PREFERENCES_PATH,
      JSON.stringify({
        assistantCompanionLocked,
        lockedChatWindowKeys: [...lockedChatWindowKeys],
      }, null, 2),
      'utf8',
    );
  } catch (error) {
    console.warn('Failed to save assistant window preference:', error);
  }
}

function normalizeToolWindowOptions(opts) {
  const type = typeof opts?.type === 'string' ? opts.type : '';
  if (!TOOL_WINDOW_TYPES.has(type)) return null;
  const refId = typeof opts?.refId === 'string' ? opts.refId.trim() : '';
  if (['edit-employee', 'rename-team'].includes(type) && !refId) return null;
  return { type, refId, payload: opts?.payload ?? null, key: `${type}:${refId || 'new'}` };
}

function getToolWindowSpec(type) {
  if (type === 'edit-employee') return { width: 650, height: 820, minWidth: 560, minHeight: 620, title: `${APP_TITLE} · 编辑员工` };
  if (type === 'connector-config') return { width: 620, height: 700, minWidth: 540, minHeight: 520, title: `${APP_TITLE} · 配置连接器` };
  if (type === 'assistant-settings') return { width: 660, height: 760, minWidth: 560, minHeight: 560, title: `${APP_TITLE} · 助手设置` };
  if (type === 'create-team') return { width: 520, height: 620, minWidth: 440, minHeight: 460, title: `${APP_TITLE} · 新建团队` };
  if (type === 'rename-team') return { width: 420, height: 260, minWidth: 360, minHeight: 220, title: `${APP_TITLE} · 重命名团队` };
  return { width: 560, height: 760, minWidth: 460, minHeight: 560, title: `${APP_TITLE} · 添加员工` };
}

async function createToolWindow(opts, requester = mainWindow) {
  const normalized = normalizeToolWindowOptions(opts);
  if (!normalized) throw new Error('无效的工具窗口参数');
  const existing = toolWindows.get(normalized.key);
  if (existing && !existing.isDestroyed()) {
    focusChatWindow(existing);
    return { win: existing, reused: true };
  }
  if (existing) toolWindows.delete(normalized.key);

  const spec = getToolWindowSpec(normalized.type);
  const sourceBounds = requester && !requester.isDestroyed() ? requester.getBounds() : screen.getPrimaryDisplay().workArea;
  const workArea = screen.getDisplayMatching(sourceBounds).workArea;
  const win = new BrowserWindow({
    width: spec.width,
    height: spec.height,
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
    x: Math.min(Math.max(workArea.x, sourceBounds.x + 36), workArea.x + Math.max(0, workArea.width - spec.width)),
    y: Math.min(Math.max(workArea.y, sourceBounds.y + 36), workArea.y + Math.max(0, workArea.height - spec.height)),
    title: spec.title,
    frame: false,
    show: false,
    backgroundColor: '#f5f6fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const session = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  toolWindows.set(normalized.key, win);
  toolWindowPayloads.set(session, { windowId: win.id, payload: normalized.payload });
  trackActiveWindow(win);
  win.once('ready-to-show', () => bringToFront(win));
  win.on('closed', () => {
    if (toolWindows.get(normalized.key) === win) toolWindows.delete(normalized.key);
    toolWindowPayloads.delete(session);
  });
  const hash = `tool?type=${encodeURIComponent(normalized.type)}&id=${encodeURIComponent(normalized.refId)}&session=${encodeURIComponent(session)}`;
  try {
    if (!app.isPackaged) await win.loadURL(`http://localhost:5173/#${hash}`);
    else await win.loadFile(path.join(__dirname, '../dist/index.html'), { hash });
    return { win, reused: false };
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    throw error;
  }
}

function showMainWindow() {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (!assistantCompanionManuallyClosed) {
    createAssistantCompanion(win).catch((error) => {
      console.error('Failed to restore assistant companion window:', error);
    });
  }
}

function showAssistantCompanion() {
  showMainWindow();
  assistantCompanionManuallyClosed = false;
  createAssistantCompanion(mainWindow, { focus: true }).catch((error) => {
    console.error('Failed to open assistant companion window:', error);
  });
}

function createTray() {
  if (tray) return tray;
  // Keep the icon inside the application bundle so the installed client can
  // remain in the tray after its main window is closed.
  const iconPath = path.join(__dirname, '../public/tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 20, height: 20 }));
  tray.setToolTip('私人办公会所');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开私人办公会所', click: showMainWindow },
    { label: '打开驴狗蛋助手', click: showAssistantCompanion },
    { type: 'separator' },
    {
      label: '彻底退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
  return tray;
}

function getAssistantCompanionBounds(owner, companion) {
  const ownerBounds = owner.getBounds();
  const display = screen.getDisplayMatching(ownerBounds);
  const workArea = display.workArea;
  const currentBounds = companion && !companion.isDestroyed() ? companion.getBounds() : null;
  const width = Math.min(
    Math.max(currentBounds?.width ?? ASSISTANT_COMPANION_WIDTH, ASSISTANT_COMPANION_MIN_WIDTH),
    workArea.width,
  );
  const height = Math.min(Math.max(ownerBounds.height, CHAT_WINDOW_MIN_HEIGHT), workArea.height);
  const y = Math.max(workArea.y, Math.min(ownerBounds.y, workArea.y + workArea.height - height));
  const rightX = ownerBounds.x + ownerBounds.width + ASSISTANT_COMPANION_GAP;
  const leftX = ownerBounds.x - width - ASSISTANT_COMPANION_GAP;

  if (rightX + width <= workArea.x + workArea.width) {
    return { x: rightX, y, width, height };
  }
  if (leftX >= workArea.x) {
    return { x: leftX, y, width, height };
  }

  // A maximized or nearly full-screen owner leaves no external space. Keep the
  // companion fully visible against the right edge until external space returns.
  return { x: workArea.x + workArea.width - width, y, width, height };
}

function syncLockedAssistantCompanion() {
  if (!assistantCompanionLocked || !mainWindow || mainWindow.isDestroyed()) return;
  if (!assistantCompanionWindow || assistantCompanionWindow.isDestroyed()) return;
  if (mainWindow.isMinimized() || !mainWindow.isVisible()) return;
  assistantCompanionWindow.setBounds(getAssistantCompanionBounds(mainWindow, assistantCompanionWindow));
}

function getLockedChatWindows() {
  return [...chatWindows.entries()]
    .filter(([key, win]) => key !== ASSISTANT_COMPANION_KEY && lockedChatWindowKeys.has(key) && win && !win.isDestroyed())
    .sort(([a], [b]) => a.localeCompare(b));
}

function getLockedChatBounds(owner, chat, index, total) {
  const ownerBounds = owner.getBounds();
  const workArea = screen.getDisplayMatching(ownerBounds).workArea;
  const currentBounds = chat.getBounds();
  const width = Math.min(Math.max(Math.min(currentBounds.width, LOCKED_CHAT_WIDTH), CHAT_WINDOW_MIN_WIDTH), workArea.width);
  const availableHeight = Math.max(CHAT_WINDOW_MIN_HEIGHT, Math.floor(Math.min(ownerBounds.height, workArea.height) / total));
  const height = Math.min(availableHeight, workArea.height);
  const x = Math.max(workArea.x, ownerBounds.x - width - ASSISTANT_COMPANION_GAP);
  const maxY = workArea.y + workArea.height - height;
  const y = Math.max(workArea.y, Math.min(maxY, ownerBounds.y + index * height));
  return { x, y, width, height };
}

function syncLockedChatWindows() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible()) return;
  const lockedChats = getLockedChatWindows();
  lockedChats.forEach(([, chat], index) => {
    chat.setBounds(getLockedChatBounds(mainWindow, chat, index, lockedChats.length));
  });
}

function syncLockedCompanionWindows() {
  syncLockedAssistantCompanion();
  syncLockedChatWindows();
}

function scheduleLockedAssistantSync() {
  if (!assistantCompanionLocked && lockedChatWindowKeys.size === 0) return;
  setTimeout(syncLockedCompanionWindows, 0);
}

function getInitialWindowBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const companionWidth = Math.min(ASSISTANT_COMPANION_WIDTH, workArea.width);
  const availableMainWidth = workArea.width - companionWidth - ASSISTANT_COMPANION_GAP;
  const width = Math.min(1280, Math.max(860, availableMainWidth));
  const height = Math.min(820, workArea.height);
  const groupWidth = Math.min(workArea.width, width + ASSISTANT_COMPANION_GAP + companionWidth);
  return {
    x: workArea.x + Math.max(0, Math.floor((workArea.width - groupWidth) / 2)),
    y: workArea.y + Math.max(0, Math.floor((workArea.height - height) / 2)),
    width,
    height,
  };
}

async function createAssistantCompanion(owner = mainWindow, { focus = false } = {}) {
  if (!owner || owner.isDestroyed()) return null;
  if (assistantCompanionWindow && !assistantCompanionWindow.isDestroyed()) {
    if (focus) focusChatWindow(assistantCompanionWindow);
    return assistantCompanionWindow;
  }

  assistantCompanionManuallyClosed = false;
  const companion = new BrowserWindow({
    ...getAssistantCompanionBounds(owner, null),
    modal: false,
    minWidth: ASSISTANT_COMPANION_MIN_WIDTH,
    minHeight: CHAT_WINDOW_MIN_HEIGHT,
    title: `${APP_TITLE} · 驴狗蛋助手`,
    skipTaskbar: false,
    frame: false,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  assistantCompanionWindow = companion;
  chatWindows.set(ASSISTANT_COMPANION_KEY, companion);
  trackActiveWindow(companion);
  companion.once('ready-to-show', () => {
    if (assistantCompanionLocked) syncLockedCompanionWindows();
    if (focus) focusChatWindow(companion);
    else companion.showInactive();
  });
  companion.on('close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) assistantCompanionManuallyClosed = true;
  });
  companion.on('closed', () => {
    if (chatWindows.get(ASSISTANT_COMPANION_KEY) === companion) {
      chatWindows.delete(ASSISTANT_COMPANION_KEY);
    }
    if (assistantCompanionWindow === companion) assistantCompanionWindow = null;
  });

  const hash = 'chat?type=assistant-chat&id=';
  try {
    if (!app.isPackaged) await companion.loadURL(`http://localhost:5173/#${hash}`);
    else await companion.loadFile(path.join(__dirname, '../dist/index.html'), { hash });
    return companion;
  } catch (error) {
    if (!companion.isDestroyed()) companion.destroy();
    throw error;
  }
}

async function createSettingsWindow(sourceWindow = mainWindow) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    focusChatWindow(settingsWindow);
    return settingsWindow;
  }

  const sourceBounds = sourceWindow && !sourceWindow.isDestroyed()
    ? sourceWindow.getBounds()
    : screen.getPrimaryDisplay().workArea;
  const workArea = screen.getDisplayMatching(sourceBounds).workArea;
  const win = new BrowserWindow({
    x: workArea.x + 24,
    y: workArea.y + 24,
    width: Math.max(980, workArea.width - 48),
    height: Math.max(680, workArea.height - 48),
    minWidth: 900,
    minHeight: 620,
    title: `${APP_TITLE} · 设置`,
    frame: false,
    show: false,
    backgroundColor: '#f5f6fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow = win;
  trackActiveWindow(win);
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
    win.focus();
  });
  win.on('closed', () => {
    if (settingsWindow === win) settingsWindow = null;
  });
  try {
    if (!app.isPackaged) await win.loadURL('http://localhost:5173/#settings');
    else await win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'settings' });
    return win;
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    throw error;
  }
}

function trackActiveWindow(win) {
  lastActiveWindow = win;
  win.on('focus', () => {
    lastActiveWindow = win;
    // Keep the clicked chat window above its sibling chat windows without
    // leaving it permanently always-on-top.
    if (!win.isDestroyed()) win.moveTop();
  });
  win.on('closed', () => {
    if (lastActiveWindow === win) lastActiveWindow = null;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    ...getInitialWindowBounds(),
    minWidth: 860,
    minHeight: 600,
    title: APP_TITLE,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;
  trackActiveWindow(win);

  for (const eventName of ['move', 'resize', 'maximize', 'unmaximize', 'restore']) {
    win.on(eventName, scheduleLockedAssistantSync);
  }
  win.on('minimize', () => {
    if (assistantCompanionLocked && assistantCompanionWindow && !assistantCompanionWindow.isDestroyed()) {
      assistantCompanionWindow.minimize();
    }
    for (const [, chat] of getLockedChatWindows()) chat.minimize();
  });
  win.on('restore', () => {
    if (assistantCompanionLocked && assistantCompanionWindow && !assistantCompanionWindow.isDestroyed()) {
      assistantCompanionWindow.restore();
    }
    for (const [, chat] of getLockedChatWindows()) chat.restore();
    scheduleLockedAssistantSync();
  });

  win.once('ready-to-show', () => {
    createAssistantCompanion(win).catch((error) => {
      console.error('Failed to create assistant companion window:', error);
    });
  });
  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (assistantCompanionLocked && assistantCompanionWindow && !assistantCompanionWindow.isDestroyed()) {
      assistantCompanionWindow.hide();
    }
    for (const [, chat] of getLockedChatWindows()) chat.hide();
    win.hide();
  });

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
  ipcMain.handle('win:getAssistantLock', () => ({ locked: assistantCompanionLocked }));
  ipcMain.handle('win:setAssistantLock', async (_event, locked) => {
    assistantCompanionLocked = locked === true;
    saveAssistantCompanionLockPreference();
    if (assistantCompanionLocked) {
      const companion = await createAssistantCompanion(mainWindow, { focus: false });
      if (companion && !companion.isDestroyed()) {
        if (companion.isMinimized()) companion.restore();
        companion.showInactive();
        syncLockedAssistantCompanion();
      }
    }
    return { locked: assistantCompanionLocked };
  });
  ipcMain.handle('win:getChatLock', (_event, opts) => {
    const normalized = normalizeChatOptions(opts);
    return { locked: Boolean(normalized && normalized.type !== 'assistant-chat' && lockedChatWindowKeys.has(normalized.key)) };
  });
  ipcMain.handle('win:setChatLock', (_event, opts) => {
    const normalized = normalizeChatOptions(opts);
    if (!normalized || normalized.type === 'assistant-chat') return { locked: false };
    if (opts?.locked === true) {
      // The left-side dock is a single workspace slot. Replacing its occupant
      // keeps team and private chats from overlapping one another.
      lockedChatWindowKeys.clear();
      lockedChatWindowKeys.add(normalized.key);
    }
    else lockedChatWindowKeys.delete(normalized.key);
    saveAssistantCompanionLockPreference();
    if (lockedChatWindowKeys.has(normalized.key)) {
      const chat = chatWindows.get(normalized.key);
      if (chat && !chat.isDestroyed()) {
        if (chat.isMinimized()) chat.restore();
        chat.showInactive();
      }
      syncLockedChatWindows();
    }
    return { locked: lockedChatWindowKeys.has(normalized.key) };
  });

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
  ipcMain.handle('win:openChat', async (event, opts) => {
    const normalized = normalizeChatOptions(opts);
    if (!normalized) return { ok: false, error: '无效的聊天窗口参数' };
    const { type, refId, key } = normalized;
    if (type === 'assistant-chat') {
      try {
        const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.fromWebContents(event.sender);
        await createAssistantCompanion(owner, { focus: true });
        return { ok: true, reused: true };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    }
    const existing = chatWindows.get(key);
    if (existing && !existing.isDestroyed()) {
      focusChatWindow(existing);
      return { ok: true, reused: true };
    }
    if (existing) chatWindows.delete(key);

    const requester = BrowserWindow.fromWebContents(event.sender);
    const owner = getRootOwner(requester) ?? (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
    const bounds = getChatWindowBounds(requester ?? owner);
    const child = new BrowserWindow({
      ...bounds,
      minWidth: CHAT_WINDOW_MIN_WIDTH,
      minHeight: CHAT_WINDOW_MIN_HEIGHT,
      // Keep chat windows independent. On Windows this gives a minimized chat a
      // normal taskbar entry instead of a hard-to-restore grey child-window item.
      title: type === 'team-chat' ? `${APP_TITLE} · 团队聊天` : type === 'dm-chat' ? `${APP_TITLE} · 员工私聊` : `${APP_TITLE} · 驴狗蛋助手`,
      skipTaskbar: false,
      frame: false,
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    trackActiveWindow(child);
    chatWindows.set(key, child);
    child.once('ready-to-show', () => bringToFront(child));
    // focus 仅由 trackActiveWindow 记录，避免触发置顶/焦点循环。
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
  ipcMain.handle('skills:list', async () => {
    try { return { ok: true, skills: await listSkills(path.resolve(__dirname, '..')) }; }
    catch (e) { return { ok: false, skills: [], error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('skills:read', async (_event, id) => {
    try {
      if (typeof id !== 'string') throw new Error('无效技能 ID');
      return { ok: true, skill: await readSkill(path.resolve(__dirname, '..'), id) };
    } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('skills:delete', async (_event, id) => {
    try { return await deleteSkill(path.resolve(__dirname, '..'), id); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('skills:install', async (_event, input) => {
    try { return await installSkill(path.resolve(__dirname, '..'), input); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('sys:openExternal', async (_event, rawUrl) => {
    try {
      const url = new URL(typeof rawUrl === 'string' ? rawUrl : '');
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('仅允许打开 HTTP/HTTPS 链接');
      await shell.openExternal(url.toString());
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });

  // ===== 连接器 API 调用（主进程代理 HTTP 请求，避免渲染进程 CORS）=====
  ipcMain.handle('connector:call', async (_event, opts) => {
    const { url, method, headers, body, timeout } = opts;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout ?? 15000);
      const res = await fetch(url, {
        method: method ?? 'GET',
        headers: headers ?? { 'Content-Type': 'application/json' },
        body: body ?? undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const text = await res.text();
      return { ok: true, status: res.status, data: text };
    } catch (e) {
      return { ok: false, status: 0, data: '', error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('knowledge:pickObsidian', async () => {
    const result = await dialog.showOpenDialog({ title: '选择 Obsidian Vault', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    try { return await testObsidianVault(result.filePaths[0]); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('knowledge:testObsidian', async (_event, root) => {
    try { return await testObsidianVault(root); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('knowledge:searchObsidian', async (_event, input) => {
    try { return await searchObsidianVault(input?.root, input?.query); }
    catch (e) { return { ok: false, error: String(e?.message ?? e), results: [] }; }
  });
  ipcMain.handle('knowledge:readObsidian', async (_event, input) => {
    try { return await readObsidianNote(input?.root, input?.path); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('knowledge:fetchUrl', async (_event, url) => {
    try { return await fetchKnowledgeUrl(url); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });

  ipcMain.handle('exec:command', async (_event, payload) => {
    const cmd = typeof payload === 'string' ? payload : payload?.cmd;
    const scope = typeof payload === 'object' && typeof payload?.scope === 'string'
      ? payload.scope.replace(/[^a-zA-Z0-9_-]/g, '_')
      : 'global';
    const projectRoot = safeJoin(scope);
    const sandboxEnabled = typeof payload !== 'object' || payload?.sandboxEnabled !== false;
    await fsp.mkdir(projectRoot, { recursive: true });
    const timeoutMs = 30000;
    const maxOutput = 100 * 1024; // 100KB 截断

    if (typeof cmd !== 'string' || !cmd.trim()) {
      return { success: false, exitCode: -1, stdout: '', stderr: '命令不能为空', cwd: projectRoot };
    }
    if (sandboxEnabled && sandboxPathEscape(cmd)) {
      return {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: '命令沙盒已阻止访问工作区以外的路径。请改用相对路径，或在设置中明确关闭“命令沙盒”后再执行。',
        cwd: projectRoot,
      };
    }

    return new Promise((resolve) => {
      const options = {
        cwd: projectRoot,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: '0' },
      };
      const done = (err, stdout, stderr) => {
        resolve({
          success: !err,
          exitCode: err ? ((err.code) || -1) : 0,
          stdout: (stdout || '').slice(0, maxOutput),
          stderr: (stderr || '').slice(0, maxOutput),
          signal: err && err.killed ? 'TIMEOUT' : undefined,
          cwd: projectRoot,
        });
      };
      const child = process.platform === 'win32'
        ? execFile('powershell.exe', [
            '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
            `[Console]::OutputEncoding = [Text.UTF8Encoding]::new(); $OutputEncoding = [Text.UTF8Encoding]::new(); $ProgressPreference = 'SilentlyContinue'; & { ${cmd} }`,
          ], options, done)
        : exec(cmd, options, done);

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

  ipcMain.handle('fs:writeData', async (_event, { filePath, dataUrl }) => {
    try {
      const target = safeJoin(filePath || '');
      const match = typeof dataUrl === 'string' ? dataUrl.match(/^data:[^;]*;base64,(.+)$/s) : null;
      if (!match) throw new Error('附件不是有效的 base64 数据');
      const buffer = Buffer.from(match[1], 'base64');
      if (buffer.length > 50 * 1024 * 1024) throw new Error('单个附件不能超过 50MB');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, buffer);
      return { ok: true, path: target, size: buffer.length };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('fs:read', async (_event, { filePath }) => {
    try {
      const target = safeJoin(filePath || '');
      const stat = await fsp.stat(target);
      if (!stat.isFile()) throw new Error('目标不是文件');
      if (stat.size > MAX_READABLE_FILE_BYTES) {
        throw new Error(`文件过大（${Math.ceil(stat.size / 1024 / 1024)}MB），当前单文件读取上限为 50MB`);
      }
      const extension = path.extname(target).toLowerCase();
      if (TEXT_FILE_EXTENSIONS.has(extension)) {
        const content = await fsp.readFile(target, 'utf8');
        return { ok: true, path: target, content, format: 'text', size: stat.size };
      }
      if (PARSABLE_DOCUMENT_EXTENSIONS.has(extension)) {
        try {
          const ast = await officeParser.parseOffice(target, { extractAttachments: false, ocr: false });
          const extracted = ast.toText();
          const truncated = extracted.length > MAX_EXTRACTED_TEXT_CHARS;
          const content = truncated
            ? `${extracted.slice(0, MAX_EXTRACTED_TEXT_CHARS)}\n\n[内容过长，已在 ${MAX_EXTRACTED_TEXT_CHARS} 字符处截断]`
            : extracted;
          return {
            ok: true,
            path: target,
            content,
            format: ast.type || extension.slice(1),
            size: stat.size,
            truncated,
            warnings: Array.isArray(ast.warnings) ? ast.warnings.map((warning) => String(warning?.message ?? warning)).slice(0, 10) : [],
          };
        } catch (parseError) {
          throw new Error(`无法解析 ${extension || '该'} 文件：${String(parseError?.message ?? parseError)}`);
        }
      }
      const possibleText = decodeTextBuffer(await fsp.readFile(target));
      if (possibleText !== null) {
        return { ok: true, path: target, content: possibleText, format: 'text', size: stat.size };
      }
      return {
        ok: false,
        path: target,
        size: stat.size,
        error: `文件已真实保存，但 ${extension || '该二进制格式'} 不支持直接提取文本。请使用匹配的 Skill 或 run_command 工具处理。`,
      };
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
            let modifiedAt = 0;
            try {
              const stat = await fsp.stat(full);
              size = stat.size;
              modifiedAt = stat.mtimeMs;
            } catch {}
            out.push({ name: rel, type: 'file', size, modifiedAt });
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
    mainWindow = null;
    for (const child of [...chatWindows.values()]) {
      try { child.close(); } catch {}
    }
    chatWindows.clear();
    assistantCompanionWindow = null;
  });

  ipcMain.handle('win:openSettings', async (event) => {
    try {
      const existing = settingsWindow && !settingsWindow.isDestroyed();
      await createSettingsWindow(BrowserWindow.fromWebContents(event.sender) ?? mainWindow);
      return { ok: true, reused: existing };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });

  ipcMain.handle('win:openTool', async (event, opts) => {
    try {
      const result = await createToolWindow(opts, BrowserWindow.fromWebContents(event.sender) ?? mainWindow);
      return { ok: true, reused: result.reused };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });
  ipcMain.handle('win:getToolPayload', (event, session) => {
    const record = toolWindowPayloads.get(String(session ?? ''));
    const sender = BrowserWindow.fromWebContents(event.sender);
    return record && sender?.id === record.windowId ? record.payload : null;
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    createTray();
    createWindow();
    app.on('activate', () => {
      if (!mainWindow || mainWindow.isDestroyed()) createWindow();
      else showMainWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (isQuitting && process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
});
