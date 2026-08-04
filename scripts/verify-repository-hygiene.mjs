import { spawnSync } from 'node:child_process';

const result = spawnSync('git', ['ls-files', '-z'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});

if (result.status !== 0) {
  process.stderr.write(result.stderr || 'Unable to inspect tracked repository files.\n');
  process.exit(1);
}

const trackedFiles = result.stdout.split('\0').filter(Boolean);
const allowedReleaseFiles = new Set(['release/README.md']);
const forbiddenBinary = /\.(?:exe|msi|dmg|appimage|blockmap)$/iu;
const violations = trackedFiles.filter((file) => {
  const normalized = file.replaceAll('\\', '/');
  if (normalized.startsWith('release/') && !allowedReleaseFiles.has(normalized)) return true;
  return forbiddenBinary.test(normalized);
});

const report = {
  passed: violations.length === 0,
  trackedFiles: trackedFiles.length,
  allowedReleaseFiles: [...allowedReleaseFiles],
  violations,
};

console.log(JSON.stringify(report, null, 2));
if (violations.length > 0) process.exitCode = 1;
