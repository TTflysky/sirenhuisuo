const fs = require('node:fs');
const path = require('node:path');

const APP_DATA_NAME = 'taiji-office';
const LEGACY_APP_DATA_NAME = 'hermes-office-pro';
const IDENTITY_MIGRATION_VERSION = 1;
const MIGRATION_MARKER = `.taiji-identity-migration-v${IDENTITY_MIGRATION_VERSION}.json`;
const SKIPPED_TOP_LEVEL_ENTRIES = new Set([
  '.updaterId',
  'Cache',
  'Code Cache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'DevToolsActivePort',
  'GPUCache',
  'logs',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
]);

function copyMissing(source, target, report) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    report.skipped += 1;
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      copyMissing(path.join(source, entry.name), path.join(target, entry.name), report);
    }
    return;
  }
  if (!stat.isFile()) {
    report.skipped += 1;
    return;
  }
  if (fs.existsSync(target)) {
    report.preserved += 1;
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  report.copied += 1;
}

function migrateAppIdentityData({ appDataRoot, now = () => new Date() }) {
  const root = path.resolve(appDataRoot);
  const legacyRoot = path.join(root, LEGACY_APP_DATA_NAME);
  const targetRoot = path.join(root, APP_DATA_NAME);
  const markerPath = path.join(targetRoot, MIGRATION_MARKER);
  const report = {
    schema: IDENTITY_MIGRATION_VERSION,
    from: LEGACY_APP_DATA_NAME,
    to: APP_DATA_NAME,
    legacyRoot,
    targetRoot,
    copied: 0,
    preserved: 0,
    skipped: 0,
    failures: [],
  };

  fs.mkdirSync(targetRoot, { recursive: true });
  if (fs.existsSync(markerPath)) return { ...report, status: 'already-complete', markerPath };
  if (!fs.existsSync(legacyRoot)) return { ...report, status: 'legacy-not-found', markerPath };

  for (const entry of fs.readdirSync(legacyRoot, { withFileTypes: true })) {
    if (SKIPPED_TOP_LEVEL_ENTRIES.has(entry.name)) {
      report.skipped += 1;
      continue;
    }
    try {
      copyMissing(path.join(legacyRoot, entry.name), path.join(targetRoot, entry.name), report);
    } catch (error) {
      report.failures.push({ entry: entry.name, message: error?.message || String(error) });
    }
  }

  const completedAt = now().toISOString();
  const status = report.failures.length === 0 ? 'migrated' : 'partial';
  const result = { ...report, status, completedAt, markerPath };
  if (status === 'migrated') fs.writeFileSync(markerPath, JSON.stringify(result, null, 2), 'utf8');
  return result;
}

function configureAppUserData(app, options = {}) {
  if (options.testUserData) {
    const targetRoot = path.resolve(options.testUserData);
    app.setPath('userData', targetRoot);
    return { status: 'test-isolation', targetRoot };
  }
  const result = migrateAppIdentityData({ appDataRoot: options.appDataRoot || app.getPath('appData') });
  app.setPath('userData', result.targetRoot);
  return result;
}

module.exports = {
  APP_DATA_NAME,
  LEGACY_APP_DATA_NAME,
  IDENTITY_MIGRATION_VERSION,
  MIGRATION_MARKER,
  configureAppUserData,
  migrateAppIdentityData,
};
