import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('npm_execpath unavailable; run through npm run verify:phase3');
const checks = ['verify:model-compatibility', 'verify:skill-runtime', 'verify:credential-vault', 'verify:update-transaction'];
const run = (script) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [npm, 'run', script], { cwd: process.cwd(), stdio: 'inherit', shell: false, windowsHide: true });
  child.on('error', reject); child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${script} failed (${code})`)));
});
for (const check of checks) { console.log(`[phase3] ${check}`); await run(check); }
await run('generate:sbom');
await run('generate:provenance');
await run('verify:release-governance');
console.log(JSON.stringify({ passed: true, checks, evidenceDigest: createHash('sha256').update(checks.join('|')).digest('hex') }, null, 2));
