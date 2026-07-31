const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createUpdateTransaction, PHASES } = require('../electron/updateTransaction.cjs');

;(async () => {
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-upgrade-'));
const tx = createUpdateTransaction({ root });
await tx.begin({ fromVersion: '2.8.4', toVersion: '2.9.4' });
for (const phase of PHASES.slice(1, 8)) await tx.transition(phase, { detail: `验证 ${phase}` });
const committed = await tx.transition('commit', { detail: '验证通过' });
assert.equal(committed.status, 'committed');
assert.equal((await tx.read()).fromVersion, '2.8.4');
const rollback = await tx.transition('rollback', { detail: '故障注入回滚' });
assert.equal(rollback.status, 'rolling_back');
assert.ok((await tx.read()).evidence.length >= 9);
console.log(JSON.stringify({ passed: true, schema: tx.schema, journalPath: tx.journalPath }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
