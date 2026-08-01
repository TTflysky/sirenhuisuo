import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const persona = await fs.readFile(new URL('../src/components/settings/AssistantSettingsModal.tsx', import.meta.url), 'utf8');
const assistant = await fs.readFile(new URL('../src/components/chat/AssistantChat.tsx', import.meta.url), 'utf8');
const settings = await fs.readFile(new URL('../src/components/settings/SettingsModal.tsx', import.meta.url), 'utf8');

assert.match(persona, /DEFAULT_PROMPT_VERSION = '21'/u);
assert.match(persona, /v3\.2 长任务与客户端性能协议/u);
assert.match(persona, /负责人、已验证证据、耗时、等待条件和下一步/u);
assert.match(assistant, /PERSONA_MIGRATION_APPENDIX_V21/u);
assert.doesNotMatch(assistant, /PERSONA_MIGRATION_APPENDIX\}/u, 'assistant chat must not migrate with only the legacy appendix');
assert.match(settings, /PERSONA_MIGRATION_APPENDIX_V21/u);

console.log(JSON.stringify({ passed: true, promptVersion: 21, protocol: 'v3.2' }));
