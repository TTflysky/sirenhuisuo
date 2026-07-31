import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
const required = ['scripts/generate-sbom.mjs', 'scripts/generate-release-provenance.mjs', 'scripts/verify-release-governance.mjs', 'electron/updateTransaction.cjs', 'electron/credentialVault.cjs', 'electron/skillRuntime.cjs', 'src/engine/modelCompatibility.mjs'];
const errors = [];
for (const file of required) { try { await fs.access(path.join(root, file)); } catch { errors.push(`缺少发布治理文件：${file}`); } }
if (lock.version !== pkg.version) errors.push(`package-lock 版本 ${lock.version} 与 package.json ${pkg.version} 不一致`);
if (lock.packages?.['']?.version !== pkg.version) errors.push('package-lock 根包版本不一致');
const scanRoots = ['src', 'electron', 'scripts'];
const suspicious = /(sk-[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{20,})/u;
async function walk(dir) {
  let entries = []; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (['node_modules', 'dist', 'release'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (/\.(?:js|cjs|mjs|ts|tsx|json|ps1)$/u.test(entry.name)) {
      // Generated expert prompts contain security-training examples such as
      // PEM markers; the catalog itself is reproduced from reviewed sources.
      if (entry.name === 'generatedExpertCatalog.ts') continue;
      const content = await fs.readFile(file, 'utf8');
      if (suspicious.test(content)) errors.push(`疑似密钥：${path.relative(root, file)}`);
    }
  }
}
for (const dir of scanRoots) await walk(path.join(root, dir));
const sbom = path.join(root, 'docs', `sbom-v${pkg.version}.json`);
const provenance = path.join(root, 'docs', `release-provenance-v${pkg.version}.json`);
for (const file of [sbom, provenance]) { try { JSON.parse(await fs.readFile(file, 'utf8')); } catch { errors.push(`发布证明文件无效或缺失：${path.relative(root, file)}`); } }
const result = { passed: errors.length === 0, version: pkg.version, lockVersion: lock.version, requiredFiles: required.length, errors, sbomSha256: await fs.readFile(sbom).then((data) => createHash('sha256').update(data).digest('hex')).catch(() => undefined) };
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
