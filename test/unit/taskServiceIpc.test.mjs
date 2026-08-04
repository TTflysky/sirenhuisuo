import { describe, expect, it } from 'vitest';
import taskServiceIpcModule from '../../electron/taskServiceIpc.cjs';

const { registerTaskServiceIpc } = taskServiceIpcModule;

describe('TaskService IPC', () => {
  it('keeps command error shape stable', async () => {
    const handlers = new Map();
    const ipcMain = { handle(channel, handler) { handlers.set(channel, handler); } };
    const taskService = {
      read: async () => ({ ok: true, runs: [] }),
      create: async () => { throw new Error('missing goal'); },
    };
    registerTaskServiceIpc(ipcMain, taskService);
    expect(handlers.size).toBe(24);
    await expect(handlers.get('task-service:read')({}, {})).resolves.toEqual({ ok: true, runs: [] });
    await expect(handlers.get('task-service:create')({}, {})).resolves.toEqual({ ok: false, error: 'missing goal' });
  });
});
