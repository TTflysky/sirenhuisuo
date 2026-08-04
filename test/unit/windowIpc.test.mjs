import { describe, expect, it, vi } from 'vitest';
import windowIpcModule from '../../electron/windowIpc.cjs';
import registryModule from '../../electron/windowRegistry.cjs';

const { registerWindowIpc } = windowIpcModule;
const { createWindowRegistry } = registryModule;

function createIpcMain() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    handle(channel, handler) { handlers.set(channel, handler); },
    on(channel, handler) { listeners.set(channel, handler); },
  };
}

function createWindow(id, overrides = {}) {
  const listeners = new Map();
  return {
    id,
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isMaximized: vi.fn(() => false),
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    restore: vi.fn(),
    showInactive: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn((event, listener) => listeners.set(event, listener)),
    emit(event, ...args) { listeners.get(event)?.(...args); },
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  const ipcMain = createIpcMain();
  const sender = createWindow(1);
  const mainWindow = createWindow(2);
  const chatWindows = createWindowRegistry('chat');
  const toolWindowPayloads = createWindowRegistry('tools');
  let assistantLocked = false;
  const windowsByContents = new Map([[sender.webContents, sender]]);
  const BrowserWindow = {
    fromWebContents: vi.fn((contents) => windowsByContents.get(contents) ?? null),
    getAllWindows: vi.fn(() => [sender, mainWindow]),
  };
  const options = {
    ipcMain,
    BrowserWindow,
    chatWindows,
    toolWindowPayloads,
    lockedChatWindowKeys: new Set(),
    normalizeChatOptions: vi.fn((input) => input?.type && input?.refId
      ? { type: input.type, refId: input.refId, key: `${input.type}:${input.refId}` }
      : null),
    getMainWindow: vi.fn(() => mainWindow),
    getAssistantCompanionWindow: vi.fn(() => null),
    isAssistantCompanionLocked: vi.fn(() => assistantLocked),
    setAssistantCompanionLocked: vi.fn((locked) => { assistantLocked = locked; }),
    saveWindowLockPreferences: vi.fn(),
    createAssistantCompanion: vi.fn(async () => createWindow(3)),
    syncLockedAssistantCompanion: vi.fn(),
    syncLockedChatWindows: vi.fn(),
    focusChatWindow: vi.fn(),
    getRootOwner: vi.fn(() => null),
    getChatWindowBounds: vi.fn(() => ({ width: 480, height: 720 })),
    createChatWindow: vi.fn(() => createWindow(4)),
    trackActiveWindow: vi.fn(),
    attachRendererDiagnostics: vi.fn(),
    revealWindowAfterLoad: vi.fn(),
    bringToFront: vi.fn(),
    loadRenderer: vi.fn(async () => undefined),
    createSettingsWindow: vi.fn(async () => undefined),
    getSettingsWindow: vi.fn(() => null),
    createToolWindow: vi.fn(async () => ({ reused: false })),
    log: vi.fn(),
    ...overrides,
  };
  registerWindowIpc(options);
  return { ipcMain, sender, mainWindow, chatWindows, options };
}

describe('window IPC', () => {
  it('opens a new chat window and removes only that instance when it closes', async () => {
    const child = createWindow(4);
    const harness = createHarness({ createChatWindow: vi.fn(() => child) });
    const result = await harness.ipcMain.handlers.get('win:openChat')(
      { sender: harness.sender.webContents },
      { type: 'team-chat', refId: 'team-1' },
    );

    expect(result).toEqual({ ok: true, reused: false });
    expect(harness.options.createChatWindow).toHaveBeenCalledWith('team-chat', { width: 480, height: 720 });
    expect(harness.options.loadRenderer).toHaveBeenCalledWith(child, 'chat?type=team-chat&id=team-1');
    expect(harness.chatWindows.get('team-chat:team-1')).toBe(child);
    child.emit('closed');
    expect(harness.chatWindows.has('team-chat:team-1')).toBe(false);
  });

  it('reuses an existing chat window without creating another one', async () => {
    const harness = createHarness();
    const existing = createWindow(5);
    harness.chatWindows.register('employee-chat:employee-1', existing);

    const result = await harness.ipcMain.handlers.get('win:openChat')(
      { sender: harness.sender.webContents },
      { type: 'employee-chat', refId: 'employee-1' },
    );

    expect(result).toEqual({ ok: true, reused: true });
    expect(harness.options.focusChatWindow).toHaveBeenCalledWith(existing);
    expect(harness.options.createChatWindow).not.toHaveBeenCalled();
  });

  it('broadcasts to other live windows only', () => {
    const other = createWindow(6);
    const destroyed = createWindow(7, { isDestroyed: vi.fn(() => true) });
    const harness = createHarness();
    harness.options.BrowserWindow.getAllWindows.mockReturnValue([harness.sender, other, destroyed]);

    harness.ipcMain.listeners.get('win:broadcast')({ sender: harness.sender.webContents }, { kind: 'refresh' });

    expect(harness.sender.webContents.send).not.toHaveBeenCalled();
    expect(other.webContents.send).toHaveBeenCalledWith('win:broadcast', { kind: 'refresh' });
    expect(destroyed.webContents.send).not.toHaveBeenCalled();
  });

  it('persists assistant and chat locks and restores the locked window', async () => {
    const companion = createWindow(8, { isMinimized: vi.fn(() => true) });
    const chat = createWindow(9, { isMinimized: vi.fn(() => true) });
    const harness = createHarness({ createAssistantCompanion: vi.fn(async () => companion) });
    harness.chatWindows.register('team-chat:team-2', chat);

    await expect(harness.ipcMain.handlers.get('win:setAssistantLock')({}, true)).resolves.toEqual({ locked: true });
    expect(harness.options.setAssistantCompanionLocked).toHaveBeenCalledWith(true);
    expect(companion.restore).toHaveBeenCalled();
    expect(companion.showInactive).toHaveBeenCalled();
    expect(harness.options.syncLockedAssistantCompanion).toHaveBeenCalled();

    expect(harness.ipcMain.handlers.get('win:setChatLock')({}, {
      type: 'team-chat',
      refId: 'team-2',
      locked: true,
    })).toEqual({ locked: true });
    expect(chat.restore).toHaveBeenCalled();
    expect(chat.showInactive).toHaveBeenCalled();
    expect(harness.options.syncLockedChatWindows).toHaveBeenCalled();
    expect(harness.options.saveWindowLockPreferences).toHaveBeenCalledTimes(2);
  });
});
