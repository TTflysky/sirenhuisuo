import { spawn } from 'node:child_process';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('npm_execpath unavailable; run through npm run verify:phase-c');
const checks = [
  'verify:project-board',
  'verify:phase-c-persona',
  'verify:module-boundaries',
  'verify:phase3-performance',
  'verify:phase2-soak:smoke',
  'build',
  'verify:renderer-bundles',
];
const run = (script) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [npm, 'run', script], { cwd: process.cwd(), stdio: 'inherit', shell: false, windowsHide: true });
  child.on('error', reject);
  child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${script} failed (${code})`)));
});
for (const check of checks) {
  console.log(`[phase-c] ${check}`);
  await run(check);
}
console.log(JSON.stringify({ passed: true, checks, formalSoak: 'not-run-by-short-gate', formalSoakCommand: 'npm run verify:phase2-soak:8h' }, null, 2));
