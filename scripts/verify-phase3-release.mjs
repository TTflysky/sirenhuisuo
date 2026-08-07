import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('npm_execpath unavailable; run through npm run verify:phase3:release');

const checks = [
  'verify:model-compatibility',
  'verify:skill-runtime',
  'verify:credential-vault',
  'verify:update-transaction',
  'verify:release-governance',
];

const run = (script) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [npm, 'run', script], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${script} failed (${code})`)));
});

for (const check of checks) await run(check);
console.log(JSON.stringify({
  passed: true,
  checks,
  mode: 'release-verification',
  evidenceDigest: createHash('sha256').update(checks.join('|')).digest('hex'),
}, null, 2));
