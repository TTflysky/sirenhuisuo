import { spawnSync } from 'node:child_process';

const checks = [
  'scripts/verify-task-retry-policy.mjs',
  'scripts/verify-task-approval-metrics.mjs',
  'scripts/verify-task-worker.cjs',
  'scripts/verify-task-recovery-gate.mjs',
  'scripts/verify-unified-tool-evidence.mjs',
  'scripts/verify-skill-activation-evidence.cjs',
  'scripts/verify-native-execution-adapter.cjs',
];

for (const script of checks) {
  console.log(`\n[v1-fault-injection] ${script}`);
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    console.error(`[v1-fault-injection] FAILED: ${script}${result.error ? ` (${result.error.message})` : ''}`);
    process.exit(result.status || 1);
  }
}

console.log('\n[v1-fault-injection] PASS');
