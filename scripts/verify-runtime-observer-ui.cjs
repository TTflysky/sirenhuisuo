const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/components/chat/TeamChatApp.tsx'), 'utf8');
const evidence = fs.readFileSync(path.join(root, 'src/components/chat/MessageSkillEvidence.tsx'), 'utf8');

const required = [
  ['observer tabs', "runtime-observer-tabs"],
  ['observer tab state', "type ObserverTab = 'observer' | 'outputs' | 'skills' | 'replay'"],
  ['all replay export function', 'exportAllTaskReplays'],
  ['all replay export control', '导出全部'],
  ['task replay export control', 'exportTaskReplay'],
  ['outputs panel', 'ChatOutputsPanel'],
  ['skill evidence component', 'MessageSkillEvidence'],
  ['skill picker', 'SkillPickerButton'],
  ['chat input', 'SkillMentionInput'],
  ['pause control', 'pauseTaskRun'],
  ['resume control', 'resumeTaskRun'],
  ['stop control', 'stopTaskRun'],
];

for (const [label, marker] of required) {
  if (!app.includes(marker)) throw new Error(`Missing ${label}: ${marker}`);
}
for (const marker of ['技能使用证据', '发现、规则、调用、产出和验收分开记录']) {
  if (!evidence.includes(marker)) throw new Error(`Skill evidence copy is missing: ${marker}`);
}
if (app.includes('showOutputs') || app.includes('setShowOutputs')) {
  throw new Error('Outputs must use the unified observer workspace, not a second mutually-exclusive panel.');
}

console.log(`Runtime observer UI contract passed: ${required.length} capability markers + unified outputs/skills/replay workspace.`);
