import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createReleaseGate, RELEASE_GATE_CHECKS, validateReleaseGate } from '../src/engine/releaseGate.mjs';

const root = process.cwd();
const expectedVersion = '0.39.0';
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lockText = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
const lockVersion = lockText.match(/"version"\s*:\s*"([^"]+)"/)?.[1] ?? '';

function runCheck(name) {
  const startedAt = Date.now();
  const command = `npm.cmd run ${name}`;
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { cwd: root, stdio: 'inherit', shell: false, windowsHide: true });
  return { name, passed: result.status === 0, durationMs: Date.now() - startedAt, detail: result.status === 0 ? undefined : `exit=${result.status}` };
}

const checks = RELEASE_GATE_CHECKS.map(runCheck);
const requiredFiles = [
  'src/engine/taskPlan.mjs',
  'src/engine/taskHandoff.mjs',
  'src/engine/taskStateMachine.mjs',
  'src/engine/executionProtocol.mjs',
  'src/engine/skillEvidence.mjs',
  'src/engine/taskDelegation.mjs',
  'src/engine/taskContextRouter.mjs',
  'src/engine/releaseGate.mjs',
].map((relativePath) => ({ path: relativePath, exists: fs.existsSync(path.join(root, relativePath)) }));

const gate = createReleaseGate({
  expectedVersion,
  packageVersion: packageJson.version,
  lockVersion,
  requiredFiles,
  checks,
});
const result = validateReleaseGate(gate);
assert.equal(result.valid, true, result.errors.join('; '));
console.log(JSON.stringify({ passed: true, version: expectedVersion, checks: checks.length, durationsMs: checks.reduce((sum, check) => sum + check.durationMs, 0) }, null, 2));
