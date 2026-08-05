const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  REQUIRED_MIGRATION_DOMAINS,
  createMigrationMatrix,
  validateMigrationMatrix,
  summarizeMigrationMatrix,
} = require('../electron/upgradeGovernance.cjs');
const { createUpdateTransaction } = require('../electron/updateTransaction.cjs');

(async () => {
  const pending = validateMigrationMatrix(createMigrationMatrix(), REQUIRED_MIGRATION_DOMAINS);
  assert.equal(pending.ready, false);
  assert.equal(pending.missing.length, REQUIRED_MIGRATION_DOMAINS.length);
  const complete = createMigrationMatrix();
  for (const domain of REQUIRED_MIGRATION_DOMAINS) complete[domain] = { domain, status: 'ready', checkedAt: Date.now(), detail: 'verified' };
  assert.equal(validateMigrationMatrix(complete).ready, true);
  assert.equal(summarizeMigrationMatrix(complete).ready, REQUIRED_MIGRATION_DOMAINS.length);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-v318-upgrade-'));
  try {
    const tx = createUpdateTransaction({ root });
    await tx.begin({ fromVersion: '3.17.0', toVersion: '3.18.0' });
    for (const domain of REQUIRED_MIGRATION_DOMAINS) await tx.recordDomainValidation(domain, { ok: true, detail: `verified:${domain}` });
    assert.equal((await tx.validateReadiness()).ready, true);
    await tx.transition('health', { requireDomainValidation: true, detail: 'health gate' });
    const committed = await tx.transition('commit', { requireDomainValidation: true, detail: 'commit gate' });
    assert.equal(committed.status, 'committed');

    const blockedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-v318-blocked-'));
    try {
      const blocked = createUpdateTransaction({ root: blockedRoot });
      await blocked.begin({ fromVersion: '3.17.0', toVersion: '3.18.0' });
      await blocked.recordDomainValidation('workspace', { ok: false, detail: 'disk unavailable' });
      const rejected = await blocked.transition('health', { requireDomainValidation: true });
      assert.equal(rejected.status, 'failed');
      assert.match(rejected.failure, /workspace/u);
    } finally {
      await fs.rm(blockedRoot, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }

  const updater = await fs.readFile(path.join(__dirname, '..', 'electron', 'autoUpdate.cjs'), 'utf8');
  assert.match(updater, /recordDomainValidation/u);
  assert.match(updater, /domainReadiness/u);
  console.log(JSON.stringify({ passed: true, governanceVersion: 1, domains: REQUIRED_MIGRATION_DOMAINS.length, rollbackEvidence: true }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
