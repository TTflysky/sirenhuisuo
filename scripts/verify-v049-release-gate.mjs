import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createReleaseGate, RELEASE_GATE_CHECKS, validateReleaseGate } from '../src/engine/releaseGate.mjs';

const root = process.cwd();
const expectedVersion = '0.49.0';
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lockJson = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const lockVersion = lockJson.version ?? lockJson.packages?.['']?.version ?? '';

function runCheck(name) {
  const startedAt = Date.now();
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run ${name}`], { cwd: root, stdio: 'inherit', windowsHide: true });
  return { name, passed: result.status === 0, durationMs: Date.now() - startedAt, detail: result.status === 0 ? undefined : `exit=${result.status}` };
}

const checks = RELEASE_GATE_CHECKS.map(runCheck);
const requiredFiles = [
  'src/engine/teamExecutionProtocol.mjs',
  'src/engine/taskPlan.mjs',
  'src/engine/taskRunner.mjs',
  'src/engine/executionController.mjs',
  'src/engine/executionEvidence.mjs',
  'src/engine/releaseGate.mjs',
].map((relativePath) => ({ path: relativePath, exists: fs.existsSync(path.join(root, relativePath)) }));
const gate = createReleaseGate({ expectedVersion, packageVersion: packageJson.version, lockVersion, requiredFiles, checks });
const result = validateReleaseGate(gate);
assert.equal(result.valid, true, result.errors.join('; '));
console.log(JSON.stringify({ passed: true, version: expectedVersion, checks: checks.length, durationsMs: checks.reduce((sum, check) => sum + check.durationMs, 0) }, null, 2));
