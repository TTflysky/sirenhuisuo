import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
// Release evidence must be reproducible; wall-clock timestamps dirty the
// worktree every time the release gate runs.
const git = (args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return ''; } };
const sourceCommit = git(['log', '-1', '--format=%H', '--', '.', ':(exclude)docs/sbom-v*.json', ':(exclude)docs/release-provenance-v*.json']);
const generatedAt = git(['show', '-s', '--format=%cI', sourceCommit || 'HEAD']) || '1970-01-01T00:00:00.000Z';
const packages = Object.entries(lock.packages || {}).map(([name, value]) => ({
  name: name === '' ? pkg.name : name.replace(/^node_modules\//u, ''),
  version: value.version || (name === '' ? pkg.version : undefined),
  scope: name.includes('node_modules/') ? 'runtime' : 'root',
})).filter((item) => item.version);
const sbom = {
  bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: `urn:uuid:${createHash('sha256').update(`${pkg.name}@${pkg.version}`).digest('hex').slice(0, 32)}`,
  version: 1, metadata: { timestamp: generatedAt, component: { type: 'application', name: pkg.name, version: pkg.version } },
  components: packages.sort((a, b) => a.name.localeCompare(b.name)).map((item) => ({ type: 'library', name: item.name, version: item.version, purl: `pkg:npm/${encodeURIComponent(item.name)}@${item.version}` })),
};
const output = path.join(root, 'docs', `sbom-v${pkg.version}.json`);
await fs.writeFile(output, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, components: sbom.components.length, version: pkg.version }, null, 2));
