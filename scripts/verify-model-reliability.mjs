import assert from 'node:assert/strict';
import {
  createModelReliabilityRegistry,
  getModelAdmission,
  getModelRecoveryAdvice,
  modelKey,
  recordModelAttempt,
  startModelAttempt,
} from '../src/engine/modelReliability.mjs';

const registry = createModelReliabilityRegistry();
const key = modelKey({ provider: 'test', apiHost: 'https://example.test/v1', model: 'chat', apiKey: 'must-not-be-stored' });
assert.ok(!key.includes('must-not-be-stored'));
for (let index = 0; index < 3; index += 1) {
  startModelAttempt(registry, key, index + 1);
  recordModelAttempt(registry, { key, success: false, failureClass: 'server', status: 503, now: index + 1 });
}
const blocked = getModelAdmission(registry, key, 3);
assert.equal(blocked.allowed, false);
assert.equal(blocked.state, 'open');
assert.deepEqual(getModelRecoveryAdvice(registry, key, ['backup'], 3).alternatives, ['backup']);
console.log(JSON.stringify({ passed: true, circuit: blocked.state, retryAfterMs: blocked.retryAfterMs }, null, 2));
