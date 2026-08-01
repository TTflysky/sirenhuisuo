const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createUpdateTransaction, PHASES } = require('../electron/updateTransaction.cjs');
const { createCredentialVault } = require('../electron/credentialVault.cjs');

;(async () => {
  const tx = createUpdateTransaction({ root: await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-stage-e-tx-')) });
  const rehearsal = await tx.simulateFailure({ fromVersion: '3.3.0', toVersion: '3.4.0', failAt: 'migrate' });
  assert.equal(rehearsal.passed, true);
  assert.equal(rehearsal.failedAt, 'migrate');
  const vault = createCredentialVault({ root: await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-stage-e-vault-')), safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (buffer) => Buffer.from(buffer).toString().replace(/^encrypted:/u, ''),
  } });
  await vault.save('connector-ima', { apiKey: 'secret' }, { scopes: ['knowledge.read'], expiresAt: new Date(Date.now() + 86400000).toISOString() });
  const audit = await vault.audit('connector-ima', { requiredScopes: ['knowledge.read'] });
  assert.equal(audit.leastPrivilege, true);
  const rotated = await vault.rotate('connector-ima', { apiKey: 'new-secret' }, { scopes: ['knowledge.read'], expiresAt: new Date(Date.now() + 86400000).toISOString() });
  assert.equal(rotated.rotated, true);
  console.log(JSON.stringify({ passed: true, phases: PHASES, rollback: rehearsal.failedAt, credentialRotation: true }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
