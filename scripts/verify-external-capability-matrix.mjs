import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  EXTERNAL_CAPABILITY_KINDS,
  applyExternalCapabilityProbe,
  classifyExternalCapabilityProbe,
  createExternalCapabilityMatrix,
  sanitizeResourceIdentity,
  summarizeExternalCapabilityMatrix,
} from '../src/engine/externalCapabilityMatrix.mjs';
import { appendSkillEvidence, buildSkillLifecycle } from '../src/engine/skillEvidence.mjs';

assert.deepEqual(EXTERNAL_CAPABILITY_KINDS, [
  'chat_model', 'image_generation', 'web_page', 'skillhub', 'knowledge_base', 'email', 'github', 'generic_http', 'mcp',
]);
assert.equal(classifyExternalCapabilityProbe({ configured: false }), 'missing_config');
assert.equal(classifyExternalCapabilityProbe({ configured: true }), 'not_tested');
assert.equal(classifyExternalCapabilityProbe({ configured: true, actualCall: true, status: 401 }), 'authentication_failed');
assert.equal(classifyExternalCapabilityProbe({ configured: true, actualCall: true, status: 429 }), 'rate_limited');
assert.equal(classifyExternalCapabilityProbe({ configured: true, actualCall: true, protocolError: true }), 'protocol_error');
assert.equal(classifyExternalCapabilityProbe({ configured: true, actualCall: true, invalidContent: true }), 'invalid_content');

const profile = { id: 'web', kind: 'web_page', label: 'Specified URL', configured: true, resourceIdentity: 'https://example.com/article?token=secret' };
let matrix = createExternalCapabilityMatrix([profile]);
matrix = applyExternalCapabilityProbe(matrix, { profile, actualCall: true, status: 503, error: 'upstream unavailable' });
matrix = applyExternalCapabilityProbe(matrix, { profile, actualCall: true, ok: true, validated: true, responseReceived: true });
assert.equal(matrix.entries.web.recoveryCount, 1);
assert.equal(summarizeExternalCapabilityMatrix(matrix).available, 1);
assert.doesNotMatch(sanitizeResourceIdentity(profile.resourceIdentity), /secret/u);

let skill = [];
for (const action of ['matched', 'read', 'called', 'produced', 'accepted']) skill = appendSkillEvidence(skill, { skillId: 's1', action, verified: true });
assert.equal(buildSkillLifecycle(skill, 's1').usable, true);

const read = (file) => fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const [diagnostics, ui, tools, persona] = await Promise.all([
  read('src/diagnostics/systemDiagnostics.ts'),
  read('src/components/settings/DiagnosticsTab.tsx'),
  read('src/engine/tools.ts'),
  read('src/components/settings/AssistantSettingsModal.tsx'),
]);
assert.match(diagnostics, /externalCapabilities/u, '诊断报告必须携带统一能力矩阵');
assert.match(ui, /只认真实调用和有效响应/u, '诊断中心必须解释真实证据边界');
assert.match(tools, /recordExternalToolResult/u, '真实工具调用必须回写能力矩阵');
assert.match(persona, /v3\.1 外部能力真实验证协议/u, '内置人格必须同步阶段 B 协议');

console.log(JSON.stringify({ passed: true, kinds: EXTERNAL_CAPABILITY_KINDS.length, states: 8, skillStages: 5, recovered: 1 }, null, 2));
