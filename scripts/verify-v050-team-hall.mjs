import fs from 'node:fs';
import process from 'node:process';

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const theme = ['core', 'collaboration', 'appearance', 'settings', 'workspace']
  .map((name) => read(`src/styles/${name}.css`)).join('\n');
const teamHallSource = read('src/components/team/TeamHallPanel.tsx');
const officeCommandsSource = read('src/store/officeCommands.ts');
const reducerSource = read('src/store/appStateReducer.ts');

const checks = [
  ['version declared', /^\d+\.\d+\.\d+$/u.test(JSON.parse(read('package.json')).version)],
  ['team hall route', read('src/App.tsx').includes("value: 'team-hall'") && read('src/App.tsx').includes('TeamHallPanel')],
  ['old autopilot route removed', !read('src/App.tsx').includes("value: 'autopilot'") && !read('src/App.tsx').includes('AutopilotPanel')],
  ['in-chat approval card', read('src/components/chat/AssistantChat.tsx').includes('ProjectApprovalCard') && read('src/components/chat/AssistantChat.tsx').includes("status === 'awaiting_approval'")],
  ['approval actions', read('src/components/chat/ProjectApprovalCard.tsx').includes('onApprove') && read('src/components/chat/ProjectApprovalCard.tsx').includes('onReject')],
  ['team hall member scroll', theme.includes('.team-hall-members') && theme.includes('overflow-y: auto')],
  ['create team entry', teamHallSource.includes("openTool({ type: 'create-team' })") && teamHallSource.includes('CreateTeamModal')],
  ['team lifecycle actions', teamHallSource.includes('REMOVE_TEAM') && teamHallSource.includes('UPDATE_TEAM') && teamHallSource.includes('setRenamingId')],
  ['reject persistence', officeCommandsSource.includes('const rejectProject') && read('src/types.ts').includes('rejectionReason?: string')],
  ['delete cleanup', reducerSource.includes('currentTeamId: undefined') && reducerSource.includes('teamId: undefined')],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length) {
  console.error(`Team hall verification failed: ${failed.length} check(s)`);
  process.exit(1);
}
console.log('Team hall verification passed');
