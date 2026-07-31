import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd();
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const git = (args) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return ''; } };
const tracked = git(['ls-files']).split(/\r?\n/u).filter(Boolean);
const sourceDigest = createHash('sha256').update(tracked.join('\n')).digest('hex');
// Release evidence must be reproducible; wall-clock timestamps dirty the
// worktree every time the release gate runs.
const sourceCommit = git(['log', '-1', '--format=%H', '--', 'src', 'electron', 'scripts', 'public', 'skills', 'package.json', 'package-lock.json']);
const generatedAt = git(['show', '-s', '--format=%cI', sourceCommit || 'HEAD']) || '1970-01-01T00:00:00.000Z';
const provenance = {
  schema: 1, product: '太极 AI 办公会所', package: pkg.name, version: pkg.version,
  commit: sourceCommit || git(['rev-parse', 'HEAD']) || 'uncommitted', branch: git(['branch', '--show-current']),
  sourceFileCount: tracked.length, sourceFileListDigest: sourceDigest, generatedAt,
  build: { platform: process.platform, node: process.version, electron: pkg.devDependencies?.electron || '' },
  releaseInputs: ['package.json', 'package-lock.json', 'docs/sbom-v' + pkg.version + '.json', 'scripts/verify-release-governance.mjs'],
};
const output = path.join(root, 'docs', `release-provenance-v${pkg.version}.json`);
await fs.writeFile(output, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output, commit: provenance.commit, sourceFileCount: tracked.length }, null, 2));
