import assert from 'node:assert/strict';
import {
  V4_RELEASE_VERSION,
  createV4ReleaseChecklist,
  validateV4ReleaseChecklist,
} from '../src/engine/v4ReleaseReadiness.mjs';

const artifacts = { source: true, lockfile: true, sbom: true, provenance: true, migration: true, rollback: true, health: true };
const ready = createV4ReleaseChecklist({
  version: V4_RELEASE_VERSION,
  lockVersion: V4_RELEASE_VERSION,
  unifiedHost: { singleHost: true, mode: 'adaptive', entrypoints: ['assistant', 'employee', 'team', 'worker', 'background'] },
  migrationReady: true, rollbackEvidence: true, healthReady: true, artifacts,
  signature: { required: false, signed: false },
});
const result = validateV4ReleaseChecklist(ready);
assert.equal(result.valid, true);
assert.equal(result.warnings.length, 1);
assert.equal(validateV4ReleaseChecklist(ready, { requireSignature: true }).valid, false);
const broken = validateV4ReleaseChecklist(createV4ReleaseChecklist({ version: V4_RELEASE_VERSION, lockVersion: '3.18.0' }));
assert.equal(broken.valid, false);
assert.ok(broken.errors.length >= 5);
console.log(JSON.stringify({ passed: true, version: V4_RELEASE_VERSION, artifacts: Object.keys(artifacts).length, unsignedWarning: true }, null, 2));
