import { spawn } from 'node:child_process';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('npm_execpath is unavailable; run this gate through npm run verify:phase2');
const skipElectron = process.argv.includes('--skip-electron');
const formalSoak = process.argv.includes('--formal-soak');
const checks = [
  'lint',
  'verify:v2-core-gate',
  'verify:execution-controller',
  'verify:coding-runtime',
  'verify:coding-runtime-repositories',
  'verify:coding-project-v2',
  ...(!skipElectron ? ['verify:phase2-electron-e2e', formalSoak ? 'verify:phase2-soak:8h' : 'verify:phase2-soak:smoke'] : []),
  'build',
];

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli, 'run', script], { cwd: process.cwd(), windowsHide: true, stdio: 'inherit', shell: false });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${script} failed with exit code ${code}`)));
  });
}

for (const check of checks) {
  console.log(`\n[phase2] ${check}`);
  await run(check);
}

console.log(JSON.stringify({ passed: true, checks, electronE2E: !skipElectron, formalEightHourSoak: !skipElectron && formalSoak }, null, 2));
