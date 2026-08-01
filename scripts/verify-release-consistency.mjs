import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
const version = pkg.version;
const required = ['README.md', 'CHANGELOG.md', 'handoff.md', `docs/sbom-v${version}.json`, `docs/release-provenance-v${version}.json`, 'electron/updateTransaction.cjs', 'electron/credentialVault.cjs'];
const missing = [];
for (const file of required) { try { await fs.access(path.join(root, file)); } catch { missing.push(file); } }
const errors = [];
if (lock.version !== version || lock.packages?.['']?.version !== version) errors.push('lockfile version mismatch');
const changelog = await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8').catch(() => '');
if (!changelog.includes(version)) errors.push('changelog does not mention current version');
const result = { passed: missing.length === 0 && errors.length === 0, version, missing, errors, checkedAt: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
