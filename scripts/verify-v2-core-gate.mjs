import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const checks = [
  'build',
  'verify:unified-turn-runtime',
  'verify:turn-lifecycle',
  'verify:agent-trajectory-suite',
  'verify:native-execution',
  'verify:task-worker',
  'verify:chat-session-isolation',
  'verify:dispatch-intelligence',
  'verify:task-delegation',
  'verify:context-tool-pairs',
  'verify:context-router',
  'verify:task-plan',
  'verify:task-runner',
  'verify:execution-controller',
  'verify:execution-evidence',
  'verify:tool-registry',
  'verify:project-board',
  'verify:orchestration-control',
  'verify:skill-directory-contract',
  'verify:skill-install-e2e',
  'verify:v230-experience',
  'verify:v231-dispatch-and-brand',
];

for (const script of checks) {
  console.log(`\n[v2-core-gate] ${npm} run ${script}`);
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${npm} run ${script}`], { cwd: process.cwd(), stdio: 'inherit', shell: false, windowsHide: true })
    : spawnSync(npm, ['run', script], { cwd: process.cwd(), stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    console.error(`[v2-core-gate] FAILED: ${script}${result.error ? ` (${result.error.message})` : ''}`);
    process.exit(result.status || 1);
  }
}

console.log('\n[v2-core-gate] PASS');
