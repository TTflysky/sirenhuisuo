import assert from 'node:assert/strict';
import {
  classifyConnectorError,
  createConnectorIdempotencyKey,
  executeConnectorProtocol,
  validateConnectorSchema,
} from '../src/engine/connectorProtocol.mjs';

const readAction = {
  name: 'search_records', permission: 'read', sideEffect: false,
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  outputSchema: { type: 'string', minLength: 1 },
};
const writeAction = {
  name: 'send_notice', permission: 'write', sideEffect: true,
  parameters: {
    type: 'object',
    properties: { recipient: { type: 'string' }, apiKey: { type: 'string' } },
    required: ['recipient', 'apiKey'],
  },
  outputSchema: { type: 'string', minLength: 1 },
};
const makeInput = (action, args, extra = {}) => ({
  connectorId: 'test-connector', connectorLabel: 'Test Connector', actionName: action.name,
  action, args, permissionGranted: true, ...extra,
});

let clock = 1000;
const now = () => ++clock;
let calls = 0;
const success = await executeConnectorProtocol(makeInput(readAction, { query: 'status' }), {
  now,
  dryRun: () => ({ runtime: 'test' }),
  call: () => { calls += 1; return 'verified result'; },
});
assert.equal(success.ok, true);
assert.equal(success.stage, 'completed');
assert.equal(calls, 1);
assert.deepEqual(success.events.map((event) => event.stage), ['validate-input', 'permission', 'dry-run', 'call', 'validate-output', 'completed']);

let blockedCalls = 0;
const invalidInput = await executeConnectorProtocol(makeInput(readAction, {}), {
  now,
  dryRun: () => { throw new Error('must not run'); },
  call: () => { blockedCalls += 1; return 'unexpected'; },
});
assert.equal(invalidInput.ok, false);
assert.equal(invalidInput.stage, 'validate-input');
assert.equal(invalidInput.error?.category, 'validation');
assert.equal(blockedCalls, 0);

const denied = await executeConnectorProtocol(makeInput(readAction, { query: 'status' }, { permissionGranted: false }), {
  now,
  dryRun: () => ({ runtime: 'test' }),
  call: () => 'unexpected',
});
assert.equal(denied.stage, 'permission');
assert.equal(denied.error?.category, 'permission');

const invalidOutput = await executeConnectorProtocol(makeInput(readAction, { query: 'status' }), {
  now,
  dryRun: () => ({ runtime: 'test' }),
  call: () => '',
});
assert.equal(invalidOutput.stage, 'validate-output');
assert.equal(invalidOutput.error?.category, 'validation');

const networkFailure = await executeConnectorProtocol(makeInput(readAction, { query: 'status' }), {
  now,
  dryRun: () => ({ runtime: 'test' }),
  call: () => { throw new Error('fetch failed: ECONNRESET'); },
});
assert.equal(networkFailure.stage, 'call');
assert.equal(networkFailure.error?.category, 'network');
assert.equal(networkFailure.error?.retryable, true);

const cache = new Map();
let sideEffectCalls = 0;
const adapters = {
  now,
  dryRun: () => ({ runtime: 'test' }),
  call: () => {
    sideEffectCalls += 1;
    return JSON.stringify({ ok: true, token: 'server-secret-value' });
  },
  idempotencyStore: {
    get: (key) => cache.get(key),
    set: (key, value) => cache.set(key, value),
  },
};
const writeInput = makeInput(writeAction, { recipient: 'owner@example.com', apiKey: 'local-secret-value' });
const firstWrite = await executeConnectorProtocol(writeInput, adapters);
const repeatedWrite = await executeConnectorProtocol(writeInput, adapters);
assert.equal(firstWrite.ok, true);
assert.equal(repeatedWrite.ok, true);
assert.equal(repeatedWrite.idempotencyHit, true);
assert.equal(sideEffectCalls, 1);
assert.equal(firstWrite.input.apiKey, '[REDACTED]');
assert.equal(JSON.stringify(firstWrite).includes('local-secret-value'), false);
assert.equal(JSON.stringify(firstWrite).includes('server-secret-value'), false);

assert.equal(createConnectorIdempotencyKey(writeInput), createConnectorIdempotencyKey({ ...writeInput, args: { apiKey: 'local-secret-value', recipient: 'owner@example.com' } }));
assert.deepEqual(validateConnectorSchema({ query: 'ok' }, readAction.parameters), { ok: true, errors: [] });
assert.equal(classifyConnectorError('HTTP 429').category, 'rate-limit');

console.log(JSON.stringify({ passed: true, stages: success.events.length, sideEffectCalls, idempotencyHit: repeatedWrite.idempotencyHit }, null, 2));
