import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import renderingPolicy from '../../electron/renderingPolicy.cjs';

const {
  applyRenderingPolicy,
  attachRendererDiagnostics,
  revealWindowAfterLoad,
  resolveRenderingPolicy,
} = renderingPolicy;

function fakeWindow() {
  const win = new EventEmitter();
  win.webContents = new EventEmitter();
  win.show = vi.fn();
  win.isDestroyed = vi.fn(() => false);
  return win;
}

describe('Electron rendering policy', () => {
  it('uses software rendering by default on Windows', () => {
    expect(resolveRenderingPolicy({ platform: 'win32', env: {} })).toEqual({
      disableHardwareAcceleration: true,
      reason: 'windows-stability-default',
    });
  });

  it('allows an explicit hardware acceleration diagnostic override', () => {
    const app = { disableHardwareAcceleration: vi.fn() };
    expect(applyRenderingPolicy(app, {
      platform: 'win32',
      env: { TAIJI_FORCE_HARDWARE_ACCELERATION: '1' },
    }).disableHardwareAcceleration).toBe(false);
    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled();
  });

  it('reveals a hidden window only once after renderer readiness', () => {
    vi.useFakeTimers();
    const win = fakeWindow();
    revealWindowAfterLoad(win, { timeoutMs: 5000 });
    win.webContents.emit('did-finish-load');
    vi.advanceTimersByTime(120);
    win.emit('ready-to-show');
    expect(win.show).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('records renderer failures and ignores low-severity console chatter', () => {
    const win = fakeWindow();
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    attachRendererDiagnostics(win, { log, label: 'main' });
    win.webContents.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'file:///index.html', true);
    win.webContents.emit('console-message', {}, 1, 'note', 1, 'app.js');
    win.webContents.emit('console-message', {}, 3, 'boom', 2, 'app.js');
    win.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(log.error).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
