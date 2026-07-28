import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildToolRegistry, discoverTools, preflightToolCall, TOOL_REGISTRY_PROTOCOL_VERSION, toolRegistrySnapshot } from '../src/engine/toolRegistry.mjs';

const require = createRequire(import.meta.url);
const { NATIVE_TOOL_DEFINITIONS } = require('../electron/nativeToolRuntime.cjs');

const registry = buildToolRegistry(NATIVE_TOOL_DEFINITIONS);
assert.equal(registry.protocolVersion, TOOL_REGISTRY_PROTOCOL_VERSION);
assert.equal(registry.invalid.length, 0);
assert.equal(registry.collisions.length, 0);
assert.ok(registry.ready >= 12);
assert.equal(preflightToolCall(registry, 'write_file', { path: 'result.md' }).category, 'missing_required');
assert.equal(preflightToolCall(registry, 'write_file', { path: 'result.md', content: 'ok', category: 'final' }).ok, true);
assert.equal(preflightToolCall(registry, 'missing_tool', {}).category, 'unavailable');
assert.equal(discoverTools(registry, '联网 搜索')[0].name, 'web_search');

const connector = {
  type: 'function',
  function: {
    name: 'connector_demo_search',
    description: '查询外部知识库',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
};
const dynamicRegistry = buildToolRegistry([...NATIVE_TOOL_DEFINITIONS, connector]);
const connectorPreflight = preflightToolCall(dynamicRegistry, 'connector_demo_search', { query: '太极' });
assert.equal(connectorPreflight.ok, true);
assert.equal(connectorPreflight.record.source, 'connector');
assert.equal(connectorPreflight.requiresApproval, true);

const collisionRegistry = buildToolRegistry([...NATIVE_TOOL_DEFINITIONS, NATIVE_TOOL_DEFINITIONS[0]]);
assert.equal(collisionRegistry.collisions.length, 1);
assert.equal(toolRegistrySnapshot(dynamicRegistry).tools.some((item) => 'definition' in item), false);

console.log(JSON.stringify({
  passed: true,
  protocolVersion: registry.protocolVersion,
  builtinTools: registry.ready,
  dynamicTools: dynamicRegistry.ready,
  schemaFingerprints: new Set(registry.records.map((record) => record.schemaFingerprint)).size,
}, null, 2));
