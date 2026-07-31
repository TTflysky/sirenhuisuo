import fs from 'node:fs';
import process from 'node:process';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const theme = ['core', 'collaboration', 'appearance', 'settings', 'workspace']
  .map((name) => read(`src/styles/${name}.css`)).join('\n');
const checks = [
  ['version', read('package.json').includes('"version": "0.50.0"')],
  ['team hall route', read('src/App.tsx').includes("value: 'team-hall'") && read('src/App.tsx').includes('TeamHallPanel')],
  ['old autopilot route removed', !read('src/App.tsx').includes("value: 'autopilot'") && !read('src/App.tsx').includes('AutopilotPanel')],
  ['in-chat approval card', read('src/components/chat/AssistantChat.tsx').includes('ProjectApprovalCard') && read('src/components/chat/AssistantChat.tsx').includes("status === 'awaiting_approval'")],
  ['approval actions', read('src/components/chat/ProjectApprovalCard.tsx').includes('onApprove') && read('src/components/chat/ProjectApprovalCard.tsx').includes('onReject')],
  ['team hall member scroll', theme.includes('.team-hall-members') && theme.includes('overflow-y: auto')],
  ['team lifecycle actions', read('src/components/team/TeamHallPanel.tsx').includes('REMOVE_TEAM') && read('src/components/team/TeamHallPanel.tsx').includes('重命名') && read('src/components/team/TeamHallPanel.tsx').includes('归档')],
  ['reject persistence', read('src/store.tsx').includes('const rejectProject') && read('src/types.ts').includes('rejectionReason?: string')],
  ['delete cleanup', read('src/store.tsx').includes('currentTeamId: undefined') && read('src/store.tsx').includes('client.saveProjects(projects)')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`v0.50.0 team hall verification failed: ${failed.length} check(s)`);
  process.exit(1);
}
console.log('v0.50.0 team hall verification passed');
