const crypto = require('crypto');
const zlib = require('zlib');

const BACKUP_FORMAT = 'gzip+base64-chunks-v1';
const BACKUP_PART_BYTES = 4 * 1024 * 1024;

function serializeUpgradeSnapshot(snapshot) {
  const raw = Buffer.from(JSON.stringify(snapshot ?? {}), 'utf8');
  const payload = zlib.gzipSync(raw, { level: 6 });
  return {
    format: BACKUP_FORMAT,
    payload,
    rawBytes: raw.length,
    compressedBytes: payload.length,
    digest: crypto.createHash('sha256').update(payload).digest('hex'),
  };
}

function splitBackupPayload(payload, maxBytes = BACKUP_PART_BYTES) {
  if (!Buffer.isBuffer(payload)) throw new TypeError('Backup payload must be a Buffer');
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new RangeError('Backup part size must be positive');
  const parts = [];
  for (let offset = 0; offset < payload.length; offset += maxBytes) {
    parts.push(payload.subarray(offset, Math.min(offset + maxBytes, payload.length)));
  }
  return parts.length ? parts : [Buffer.alloc(0)];
}

function restoreUpgradeSnapshot(payload, format = BACKUP_FORMAT) {
  if (format !== BACKUP_FORMAT) throw new Error(`Unsupported upgrade backup format: ${format}`);
  const raw = zlib.gunzipSync(Buffer.isBuffer(payload) ? payload : Buffer.from(payload));
  return JSON.parse(raw.toString('utf8'));
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_PART_BYTES,
  serializeUpgradeSnapshot,
  splitBackupPayload,
  restoreUpgradeSnapshot,
};
