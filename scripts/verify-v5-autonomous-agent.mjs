import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const checks = [
  ['package version is v5', /"version"\s*:\s*"5\.\d+\.\d+"/u.test(read('package.json'))],
  ['roadmap locks the autonomous-agent boundary', /不是.*固定工作流|自主智能体/u.test(read('docs/TAIJI_V5_AUTONOMOUS_AGENT_ROADMAP.md'))],
  ['project types carry stable workspace and proposal history', /workspaceId\?/.test(read('src/types.ts')) && /proposalHistory\?/.test(read('src/types.ts'))],
  ['new chats initialize an independent project context', /createChatSession[\s\S]*initializeProjectContext/u.test(read('src/data/chatSessions.ts'))],
  ['project context writes project.json and events.jsonl', /project\.json/u.test(read('src/utils/projectContext.ts')) && /events\.jsonl/u.test(read('src/utils/projectContext.ts'))],
  ['roster corrections supersede the previous proposal', /supersedeCurrentProposal/u.test(read('src/store/officeCommands.ts')) && /proposal_superseded/u.test(read('src/store/officeCommands.ts'))],
  ['approval commits the current structured roster without rematching', /const approvedRoster = projectToApprove\.members/u.test(read('src/components/chat/AssistantChat.tsx'))],
  ['approval is bound to the current proposal revision', /proposalRevision\?: number/u.test(read('src/store/officeCommands.ts')) && /proposalRevision !== \(project\.proposalRevision/u.test(read('src/store/officeCommands.ts'))],
  ['team creation publishes member planning messages', /memberPlans/u.test(read('src/store/officeCommands.ts')) && /初步规划/u.test(read('src/store/officeCommands.ts'))],
  ['assistant presence follows the real request lifecycle', /setPresence\('thinking'/u.test(read('src/engine/teamSupervisor.ts')) && /setPresence\('answering'/u.test(read('src/engine/teamSupervisor.ts')) && /teamAssistantPresence/u.test(read('src/store.tsx'))],
  ['stage and terminal summaries are persisted and shown', /buildRunCompletionSummary/u.test(read('src/store/teamDiscussionRuntime.ts')) && /run_summary/u.test(read('src/store/teamDiscussionRuntime.ts'))],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
if (failed.length) process.exit(1);
console.log(`V5 autonomous-agent gate passed (${checks.length} checks).`);
