const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  APP_DATA_NAME,
  LEGACY_APP_DATA_NAME,
  MIGRATION_MARKER,
  configureAppUserData,
  migrateAppIdentityData,
} = require('../electron/appIdentityMigration.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taiji-identity-migration-'));
try {
  const legacy = path.join(root, LEGACY_APP_DATA_NAME);
  const target = path.join(root, APP_DATA_NAME);
  fs.mkdirSync(path.join(legacy, 'Local Storage', 'leveldb'), { recursive: true });
  fs.mkdirSync(path.join(legacy, 'task-runtime'), { recursive: true });
  fs.mkdirSync(path.join(legacy, 'workspace'), { recursive: true });
  fs.mkdirSync(path.join(legacy, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'Local Storage', 'leveldb', '000001.log'), 'employees-and-teams');
  fs.writeFileSync(path.join(legacy, 'task-runtime', 'events.jsonl'), 'task-event');
  fs.writeFileSync(path.join(legacy, 'workspace', 'delivery.md'), 'legacy-delivery');
  fs.writeFileSync(path.join(legacy, 'Cache', 'discard.bin'), 'cache');
  fs.mkdirSync(path.join(target, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(target, 'workspace', 'delivery.md'), 'newer-delivery');

  const migrated = migrateAppIdentityData({ appDataRoot: root, now: () => new Date('2026-07-31T00:00:00.000Z') });
  assert.equal(migrated.status, 'migrated');
  assert.equal(fs.readFileSync(path.join(target, 'Local Storage', 'leveldb', '000001.log'), 'utf8'), 'employees-and-teams');
  assert.equal(fs.readFileSync(path.join(target, 'task-runtime', 'events.jsonl'), 'utf8'), 'task-event');
  assert.equal(fs.readFileSync(path.join(target, 'workspace', 'delivery.md'), 'utf8'), 'newer-delivery');
  assert.equal(fs.existsSync(path.join(target, 'Cache')), false);
  assert.equal(fs.existsSync(path.join(target, MIGRATION_MARKER)), true);

  fs.writeFileSync(path.join(legacy, 'workspace', 'late-file.md'), 'should-not-run-after-marker');
  assert.equal(migrateAppIdentityData({ appDataRoot: root }).status, 'already-complete');
  assert.equal(fs.existsSync(path.join(target, 'workspace', 'late-file.md')), false);

  let configuredPath = '';
  const isolated = configureAppUserData({ setPath(_name, value) { configuredPath = value; } }, { testUserData: path.join(root, 'test-user-data') });
  assert.equal(isolated.status, 'test-isolation');
  assert.equal(configuredPath, path.join(root, 'test-user-data'));

  console.log(JSON.stringify({ passed: true, status: migrated.status, copied: migrated.copied, preserved: migrated.preserved, skipped: migrated.skipped }, null, 2));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
