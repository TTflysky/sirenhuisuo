function errorResult(error) {
  return { ok: false, error: String(error?.message ?? error) };
}

function registerWindowIpc(options) {
  const {
    ipcMain, BrowserWindow, chatWindows, toolWindowPayloads, lockedChatWindowKeys,
    normalizeChatOptions, getMainWindow, getAssistantCompanionWindow,
    isAssistantCompanionLocked, setAssistantCompanionLocked,
    saveWindowLockPreferences, createAssistantCompanion,
    syncLockedAssistantCompanion, syncLockedChatWindows,
    focusChatWindow, getRootOwner, getChatWindowBounds, createChatWindow,
    trackActiveWindow, attachRendererDiagnostics, revealWindowAfterLoad,
    bringToFront, loadRenderer, createSettingsWindow, getSettingsWindow,
    createToolWindow, log,
  } = options;

  const senderWindow = (event) => BrowserWindow.fromWebContents(event.sender);
  ipcMain.on('win:minimize', (event) => senderWindow(event)?.minimize());
  ipcMain.on('win:toggle-max', (event) => {
    const window = senderWindow(event);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.on('win:close', (event) => senderWindow(event)?.close());

  ipcMain.handle('win:getAssistantLock', () => ({ locked: isAssistantCompanionLocked() }));
  ipcMain.handle('win:setAssistantLock', async (_event, locked) => {
    setAssistantCompanionLocked(locked === true);
    saveWindowLockPreferences();
    if (isAssistantCompanionLocked()) {
      const companion = await createAssistantCompanion(getMainWindow(), { focus: false });
      if (companion && !companion.isDestroyed()) {
        if (companion.isMinimized()) companion.restore();
        companion.showInactive();
        syncLockedAssistantCompanion();
      }
    }
    return { locked: isAssistantCompanionLocked() };
  });

  ipcMain.handle('win:getChatLock', (_event, input) => {
    const normalized = normalizeChatOptions(input);
    return { locked: Boolean(normalized && normalized.type !== 'assistant-chat' && lockedChatWindowKeys.has(normalized.key)) };
  });
  ipcMain.handle('win:setChatLock', (_event, input) => {
    const normalized = normalizeChatOptions(input);
    if (!normalized || normalized.type === 'assistant-chat') return { locked: false };
    if (input?.locked === true) {
      lockedChatWindowKeys.clear();
      lockedChatWindowKeys.add(normalized.key);
    } else {
      lockedChatWindowKeys.delete(normalized.key);
    }
    saveWindowLockPreferences();
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

  ipcMain.on('win:broadcast', (event, data) => {
    const sender = senderWindow(event);
    for (const window of BrowserWindow.getAllWindows()) {
      if (window !== sender && !window.isDestroyed()) {
        try { window.webContents.send('win:broadcast', data); } catch {}
      }
    }
  });

  ipcMain.handle('win:openChat', async (event, input) => {
    const normalized = normalizeChatOptions(input);
    if (!normalized) return { ok: false, error: '无效的聊天窗口参数。' };
    const { type, refId, key } = normalized;
    if (type === 'assistant-chat') {
      try {
        const mainWindow = getMainWindow();
        const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : senderWindow(event);
        await createAssistantCompanion(owner, { focus: true });
        return { ok: true, reused: true };
      } catch (error) {
        return errorResult(error);
      }
    }

    const existing = chatWindows.get(key);
    if (existing && !existing.isDestroyed()) {
      focusChatWindow(existing);
      return { ok: true, reused: true };
    }
    if (existing) chatWindows.delete(key);

    const requester = senderWindow(event);
    const mainWindow = getMainWindow();
    const owner = getRootOwner(requester) ?? (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
    const child = createChatWindow(type, getChatWindowBounds(requester ?? owner));
    trackActiveWindow(child);
    chatWindows.register(key, child);
    attachRendererDiagnostics(child, { log, label: `chat:${type}` });
    revealWindowAfterLoad(child, { log, label: `chat:${type}`, onReveal: () => bringToFront(child) });
    child.on('closed', () => chatWindows.removeIf(key, child));

    try {
      await loadRenderer(child, `chat?type=${encodeURIComponent(type)}&id=${encodeURIComponent(refId)}`);
      return { ok: true, reused: false };
    } catch (error) {
      if (!child.isDestroyed()) child.destroy();
      return errorResult(error);
    }
  });

  ipcMain.handle('win:openSettings', async (event) => {
    try {
      const current = getSettingsWindow();
      const reused = Boolean(current && !current.isDestroyed());
      await createSettingsWindow(senderWindow(event) ?? getMainWindow());
      return { ok: true, reused };
    } catch (error) {
      return errorResult(error);
    }
  });

  ipcMain.handle('win:openTool', async (event, input) => {
    try {
      const result = await createToolWindow(input, senderWindow(event) ?? getMainWindow());
      return { ok: true, reused: result.reused };
    } catch (error) {
      return errorResult(error);
    }
  });
  ipcMain.handle('win:getToolPayload', (event, session) => {
    const record = toolWindowPayloads.get(String(session ?? ''));
    const sender = senderWindow(event);
    return record && sender?.id === record.windowId ? record.payload : null;
  });

  return { assistantWindow: getAssistantCompanionWindow };
}

module.exports = { registerWindowIpc };
