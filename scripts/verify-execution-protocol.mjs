import assert from 'node:assert/strict';
import { buildToolRegistry, preflightToolCall } from '../src/engine/toolRegistry.mjs';
import { classifyExecutionFailure, createExecutionProtocol, shouldRetryExecution, validateExecutionInput, validateExecutionOutput } from '../src/engine/executionProtocol.mjs';

const protocol = createExecutionProtocol({ name: 'demo', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } }, outputSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }, maxRetries: 2 });
assert.equal(validateExecutionInput(protocol, { query: 'x' }).ok, true);
assert.equal(validateExecutionInput(protocol, {}).ok, false);
assert.equal(validateExecutionOutput(protocol, { ok: true }).ok, true);
assert.equal(validateExecutionOutput(protocol, {}).ok, false);
const failure = classifyExecutionFailure(new Error('network timeout'), 'call');
assert.equal(failure.retryable, true);
assert.equal(shouldRetryExecution(failure, 1, protocol), true);
assert.equal(shouldRetryExecution(failure, 3, protocol), false);
const registry = buildToolRegistry([{ type: 'function', function: { name: 'demo_tool', description: 'demo', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }]);
const preflight = preflightToolCall(registry, 'demo_tool', { query: 'x' });
assert.equal(preflight.ok, true);
assert.equal(preflight.executionProtocol?.protocolVersion, 1);
console.log(JSON.stringify({ passed: true, protocolVersion: protocol.protocolVersion, stages: protocol.stages.length }));
