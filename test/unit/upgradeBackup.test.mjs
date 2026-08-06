import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_PART_BYTES,
  restoreUpgradeSnapshot,
  serializeUpgradeSnapshot,
  splitBackupPayload,
} from '../../electron/upgradeBackup.cjs';

describe('upgrade backup', () => {
  it('compresses, splits, and restores snapshots over the old 24 MB limit', () => {
    const snapshot = {
      schema: 1,
      localStorage: {
        hermes_office_assistant_chat: crypto.randomBytes(18 * 1024 * 1024).toString('base64'),
        hermes_office_settings: JSON.stringify({ modelLibrary: [{ id: 'image' }] }),
      },
    };
    const serialized = serializeUpgradeSnapshot(snapshot);
    const parts = splitBackupPayload(serialized.payload);
    const restored = restoreUpgradeSnapshot(Buffer.concat(parts));

    expect(serialized.format).toBe('gzip+base64-chunks-v1');
    expect(serialized.rawBytes).toBeGreaterThan(24 * 1024 * 1024);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= BACKUP_PART_BYTES)).toBe(true);
    expect(restored).toEqual(snapshot);
  });
});
