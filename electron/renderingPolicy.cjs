function resolveRenderingPolicy({ platform = process.platform, env = process.env } = {}) {
  if (env.TAIJI_FORCE_HARDWARE_ACCELERATION === '1') {
    return { disableHardwareAcceleration: false, reason: 'forced-hardware' };
  }
  if (env.TAIJI_DISABLE_HARDWARE_ACCELERATION === '1') {
    return { disableHardwareAcceleration: true, reason: 'environment' };
  }
  if (platform === 'win32') {
    return { disableHardwareAcceleration: true, reason: 'windows-stability-default' };
  }
  return { disableHardwareAcceleration: false, reason: 'platform-default' };
}

function applyRenderingPolicy(app, options) {
  const policy = resolveRenderingPolicy(options);
  if (policy.disableHardwareAcceleration) app.disableHardwareAcceleration();
  return policy;
}

function attachRendererDiagnostics(win, { log, label = 'window' } = {}) {
  const logger = log || console;
  const prefix = `[renderer:${label}]`;
  win.webContents.on('did-finish-load', () => logger.info(`${prefix} content loaded`));
  win.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (isMainFrame === false) return;
    logger.error(`${prefix} load failed`, { code, description, url: validatedURL });
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`${prefix} process gone`, details);
  });
  win.on('unresponsive', () => logger.error(`${prefix} window unresponsive`));
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (Number(level) < 2) return;
    logger.warn(`${prefix} console`, { level, message, line, sourceId });
  });
}

function revealWindowAfterLoad(win, {
  log,
  label = 'window',
  timeoutMs = 10000,
  showWindow,
  onReveal,
} = {}) {
  const logger = log || console;
  let revealed = false;
  let finishTimer = null;
  const reveal = (source) => {
    if (revealed || win.isDestroyed()) return false;
    revealed = true;
    clearTimeout(timeout);
    if (finishTimer) clearTimeout(finishTimer);
    if (showWindow) showWindow(win);
    else win.show();
    logger.info(`[renderer:${label}] window revealed`, { source });
    onReveal?.(source);
    return true;
  };
  const timeout = setTimeout(() => reveal('startup-timeout'), timeoutMs);
  win.once('ready-to-show', () => reveal('ready-to-show'));
  win.webContents.once('did-finish-load', () => {
    // Give Chromium one paint turn before exposing the native window.
    finishTimer = setTimeout(() => reveal('did-finish-load'), 120);
  });
  win.once('closed', () => {
    clearTimeout(timeout);
    if (finishTimer) clearTimeout(finishTimer);
  });
  return { reveal };
}

module.exports = {
  applyRenderingPolicy,
  attachRendererDiagnostics,
  revealWindowAfterLoad,
  resolveRenderingPolicy,
};
