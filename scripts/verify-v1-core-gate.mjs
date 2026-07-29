import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const checks = [
  ['run', 'lint'],
  ['run', 'build'],
  ['run', 'verify:foundation'],
  ['run', 'verify:agent-kernel'],
  ['run', 'verify:execution-controller'],
  ['run', 'verify:task-service'],
  ['run', 'verify:task-recovery-gate'],
  ['run', 'verify:task-plan'],
  ['run', 'verify:task-runner'],
  ['run', 'verify:child-task-dispatch'],
  ['run', 'verify:native-execution'],
  ['run', 'verify:v1-fault-injection'],
  ['run', 'verify:ecosystem-health'],
];

for (const args of checks) {
  const label = `${npm} ${args.join(' ')}`;
  console.log(`\n[v1-core-gate] ${label}`);
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${npm} ${args.join(' ')}`], { cwd: process.cwd(), stdio: 'inherit', shell: false })
    : spawnSync(npm, args, { cwd: process.cwd(), stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    console.error(`[v1-core-gate] FAILED: ${label}${result.error ? ` (${result.error.message})` : ''}`);
    process.exit(result.status || 1);
  }
}

console.log('\n[v1-core-gate] PASS');
