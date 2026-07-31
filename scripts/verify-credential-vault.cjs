const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createCredentialVault } = require('../electron/credentialVault.cjs');

;(async () => {
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-vault-'));
const vault = createCredentialVault({ root, safeStorage: {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
  decryptString: (buffer) => Buffer.from(buffer).toString('utf8').replace(/^encrypted:/u, ''),
} });
await vault.save('connector-ima', { apiKey: 'secret', clientId: 'client' });
assert.deepEqual(await vault.read('connector-ima'), { apiKey: 'secret', clientId: 'client' });
assert.equal((await vault.status('connector-ima')).configured, true);
const rawFiles = await fs.readdir(root);
assert.equal(rawFiles.length, 1);
assert.equal((await vault.migrate('connector-ima', { apiKey: 'old' })).migrated, false);
await vault.remove('connector-ima');
assert.equal((await vault.status('connector-ima')).configured, false);
console.log(JSON.stringify({ passed: true, schema: vault.schema }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
