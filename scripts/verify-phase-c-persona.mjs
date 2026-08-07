import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const persona = await fs.readFile(new URL('../src/components/settings/AssistantSettingsModal.tsx', import.meta.url), 'utf8');
const assistant = await fs.readFile(new URL('../src/components/chat/AssistantChat.tsx', import.meta.url), 'utf8');
const settings = await fs.readFile(new URL('../src/components/settings/SettingsModal.tsx', import.meta.url), 'utf8');

const version = Number(persona.match(/DEFAULT_PROMPT_VERSION = '(\d+)'/u)?.[1]);
assert.ok(version >= 29);
assert.match(persona, /v3\.2 长任务与客户端性能协议/u);
assert.match(persona, /负责人、已验证证据、耗时、等待条件和下一步/u);
assert.match(assistant, /PERSONA_MIGRATION_APPENDIX_V29/u);
assert.doesNotMatch(assistant, /PERSONA_MIGRATION_APPENDIX\}/u, 'assistant chat must not migrate with only the legacy appendix');
assert.match(settings, /PERSONA_MIGRATION_APPENDIX_V29/u);
assert.match(persona, /v3\.7 动态计划与自主恢复协议/u);
assert.match(persona, /v3\.11 模块化执行、检查点与真实收尾协议/u);
assert.match(persona, /v3\.12 模型协议、任务事实与恢复一致性协议/u);
assert.match(persona, /v3\.13 自主决策权与四类记忆协议/u);

console.log(JSON.stringify({ passed: true, promptVersion: version, protocol: 'v3.2+v3.7+v3.11+v3.12+v3.13+v5.8' }));
