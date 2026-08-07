import fs from 'node:fs';
import process from 'node:process';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const checks = [
  ['message stores skill evidence', read('src/types.ts').includes('skillEvidence?: SkillUsageEvidence[]')],
  ['explicit skill read is observable', read('src/engine/skillContext.ts').includes('resolveSkillContextWithEvidence') && read('src/engine/skillContext.ts').includes("action: 'read-failed'")],
  ['assistant receives selected skill before routing', read('src/components/chat/AssistantChat.tsx').includes('selectedSkillGuide') && read('src/components/chat/AssistantChat.tsx').includes('extraSystemContext')],
  ['assistant records actual skill tool calls', read('src/components/chat/AssistantChat.tsx').includes('已按当前 Skill 规则执行真实工具')],
  ['chat renders five-stage skill evidence', read('src/components/chat/AssistantChat.tsx').includes('MessageSkillEvidence') && read('src/components/chat/MessageSkillEvidence.tsx').includes('已产出') && read('src/components/chat/MessageSkillEvidence.tsx').includes('已验收')],
  ['team and dm chats share evidence renderer', read('src/components/chat/TeamChatApp.tsx').includes('MessageSkillEvidence') && read('src/components/chat/DmChatApp.tsx').includes('MessageSkillEvidence')],
];
checks.push(
  ['employee dm records actual skill calls', read('src/components/chat/DmChatApp.tsx').includes('resolveSkillContextWithEvidence') && read('src/components/chat/DmChatApp.tsx').includes("stage: 'invocation'")],
  ['persona matches runtime protocol', read('src/components/settings/AssistantSettingsModal.tsx').includes('## 运行时执行协议')
    && Number(read('src/components/settings/AssistantSettingsModal.tsx').match(/DEFAULT_PROMPT_VERSION = '(\d+)'/u)?.[1]) >= 28
    && read('src/components/settings/AssistantSettingsModal.tsx').includes('## v3.3 团队主持、插话与阶段交接协议')],
);
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) process.exit(1);
console.log('skill evidence UI verification passed');
