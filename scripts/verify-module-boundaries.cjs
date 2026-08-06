const assert = require('assert');
const fs = require('fs');

const limits = {
  'electron/nativeExecutionAdapter.cjs': 1500,
  'electron/nativeExecutionPrompting.cjs': 150,
  'electron/nativeExecutionControl.cjs': 450,
  'electron/nativeStepExecutor.cjs': 520,
  'electron/taskService.cjs': 520,
  'electron/taskServiceTeamExecution.cjs': 240,
  'electron/taskServiceQueries.cjs': 190,
  'electron/taskServiceContextQueries.cjs': 90,
  'electron/taskServiceEvidenceCommands.cjs': 190,
  'electron/taskServiceApprovalCommands.cjs': 90,
  'electron/taskServiceLifecycleCommands.cjs': 160,
  'electron/taskServiceRecoveryCommands.cjs': 160,
  'electron/taskServiceIpc.cjs': 70,
  'electron/windowIpc.cjs': 180,
  'electron/windowRegistry.cjs': 60,
  'src/data/hermesClient.ts': 1300,
  'src/data/agentLoopRuntime.ts': 900,
  'src/data/agentLoopPolicy.ts': 90,
  'src/data/agentLoopFinalization.ts': 220,
  'src/engine/autonomousDecisionAuthority.mjs': 180,
  'src/store.tsx': 900,
  'src/store/officeCommands.ts': 420,
  'src/store/taskRunControls.ts': 240,
  'src/store/teamMessageCommands.ts': 420,
  'src/store/teamDiscussionRuntime.ts': 820,
  'src/store/teamWorkerLease.ts': 120,
  'src/store/teamRunFinalization.ts': 120,
  'src/store/teamAutonomousDecision.ts': 70,
  'src/theme.css': 8,
  'src/styles/core.css': 500,
  'src/styles/collaboration.css': 1500,
  'src/styles/appearance.css': 500,
  'src/styles/settings.css': 400,
  'src/styles/workspace.css': 1800,
};
const lines = {};
for (const [file, maximum] of Object.entries(limits)) {
  const source = fs.readFileSync(file, 'utf8');
  const count = source.split(/\r?\n/u).length;
  lines[file] = count;
  assert.ok(count <= maximum, `${file} grew to ${count} lines; boundary is ${maximum}`);
}

const adapter = fs.readFileSync('electron/nativeExecutionAdapter.cjs', 'utf8');
assert.match(adapter, /require\('\.\/nativeExecutionPolicy\.cjs'\)/u, 'native execution policy must remain extracted');
assert.match(adapter, /require\('\.\/nativeExecutionProjection\.cjs'\)/u, 'native execution public projection must remain extracted');
assert.match(adapter, /require\('\.\/adaptiveExecutionRecovery\.cjs'\)/u, 'adaptive failure recovery must remain extracted');
assert.match(adapter, /require\('\.\/nativeExecutionControl\.cjs'\)/u, 'native execution control must remain extracted');
assert.match(adapter, /require\('\.\/nativeStepExecutor\.cjs'\)/u, 'native step execution must remain extracted');
assert.match(adapter, /require\('\.\/nativeExecutionPrompting\.cjs'\)/u, 'native execution prompting must remain extracted');
assert.doesNotMatch(adapter, /semanticState:\s*projectExecutionState/u, 'native job projection must not move back into the adapter');
assert.doesNotMatch(adapter, /function inferStepDeliverableType/u, 'deliverable policy must not move back into the adapter');
assert.doesNotMatch(adapter, /function compensationNeedsApproval/u, 'compensation policy must not move back into the adapter');
assert.doesNotMatch(adapter, /function applyAdaptiveStepFailure/u, 'adaptive failure recovery must not move back into the adapter');
assert.doesNotMatch(adapter, /async function start\(input\)/u, 'native execution control must not move back into the adapter');
assert.doesNotMatch(adapter, /async function executeStep\(/u, 'native step execution must not move back into the adapter');
assert.doesNotMatch(adapter, /function buildSystem\(/u, 'native execution prompting must not move back into the adapter');
assert.doesNotMatch(adapter, /function sanitizedRuntime\(/u, 'native execution redaction must not move back into the adapter');
const nativeControl = fs.readFileSync('electron/nativeExecutionControl.cjs', 'utf8');
assert.match(nativeControl, /function createNativeExecutionControl/u, 'native control module must expose a focused factory');
const nativeStepExecutor = fs.readFileSync('electron/nativeStepExecutor.cjs', 'utf8');
assert.match(nativeStepExecutor, /function createNativeStepExecutor/u, 'native step executor must expose a focused factory');
const nativeExecutionPrompting = fs.readFileSync('electron/nativeExecutionPrompting.cjs', 'utf8');
assert.match(nativeExecutionPrompting, /function createNativeExecutionPrompting/u, 'native execution prompting must expose a focused factory');
const taskService = fs.readFileSync('electron/taskService.cjs', 'utf8');
const taskServiceTeamExecution = fs.readFileSync('electron/taskServiceTeamExecution.cjs', 'utf8');
const taskContextQueries = fs.readFileSync('electron/taskServiceContextQueries.cjs', 'utf8');
const taskEvidenceCommands = fs.readFileSync('electron/taskServiceEvidenceCommands.cjs', 'utf8');
const taskApprovalCommands = fs.readFileSync('electron/taskServiceApprovalCommands.cjs', 'utf8');
const taskLifecycleCommands = fs.readFileSync('electron/taskServiceLifecycleCommands.cjs', 'utf8');
const taskRecoveryCommands = fs.readFileSync('electron/taskServiceRecoveryCommands.cjs', 'utf8');
const taskServiceIpc = fs.readFileSync('electron/taskServiceIpc.cjs', 'utf8');
const windowIpc = fs.readFileSync('electron/windowIpc.cjs', 'utf8');
const windowRegistry = fs.readFileSync('electron/windowRegistry.cjs', 'utf8');
assert.match(taskService, /createTaskServiceContextQueries\(store\)/u, 'task context queries must remain extracted');
assert.match(taskService, /createTaskServiceEvidenceCommands\(update\)/u, 'task evidence commands must remain extracted');
assert.match(taskService, /createTaskServiceApprovalCommands\(update\)/u, 'task approval commands must remain extracted');
assert.match(taskService, /createTaskServiceLifecycleCommands\(update\)/u, 'task lifecycle commands must remain extracted');
assert.match(taskService, /createTaskServiceRecoveryCommands\(update/u, 'task recovery commands must remain extracted');
assert.match(taskService, /createTaskServiceTeamExecution\(/u, 'team execution commands must remain extracted');
assert.doesNotMatch(taskService, /async function context\(/u, 'task context query must not move back into the service');
assert.doesNotMatch(taskService, /async function recordToolAttempt\(/u, 'task evidence commands must not move back into the service');
assert.doesNotMatch(taskService, /async function requestApproval\(/u, 'task approval commands must not move back into the service');
assert.doesNotMatch(taskService, /async function recordLifecycle\(/u, 'task lifecycle commands must not move back into the service');
assert.doesNotMatch(taskService, /async function failStep\(/u, 'task recovery commands must not move back into the service');
assert.doesNotMatch(taskService, /async function recordReviewDecision\(/u, 'review recovery must not move back into the service');
assert.doesNotMatch(taskService, /async function ensureTeamExecutionBinding\(/u, 'team execution binding must not move back into the service');
assert.doesNotMatch(taskService, /async function recordExecutionEvent\(/u, 'team execution event recording must not move back into the service');
assert.doesNotMatch(taskService, /async function recordSteering\(/u, 'team steering recording must not move back into the service');
assert.doesNotMatch(taskService, /async function repairDelegationCollisions\(/u, 'delegation collision repair must not move back into the service');
assert.match(taskContextQueries, /function createTaskServiceContextQueries/u, 'task context module must expose a focused factory');
assert.match(taskEvidenceCommands, /function createTaskServiceEvidenceCommands/u, 'task evidence module must expose a focused factory');
assert.match(taskApprovalCommands, /function createTaskServiceApprovalCommands/u, 'task approval module must expose a focused factory');
assert.match(taskLifecycleCommands, /function createTaskServiceLifecycleCommands/u, 'task lifecycle module must expose a focused factory');
assert.match(taskRecoveryCommands, /function createTaskServiceRecoveryCommands/u, 'task recovery module must expose a focused factory');
assert.match(taskServiceTeamExecution, /function createTaskServiceTeamExecution/u, 'team execution module must expose a focused factory');
assert.match(taskServiceIpc, /function registerTaskServiceIpc/u, 'TaskService IPC must remain centrally registered');
assert.match(windowIpc, /function registerWindowIpc/u, 'window IPC must remain extracted from main');
assert.match(windowRegistry, /function createWindowRegistry/u, 'window registry must expose a focused factory');
const client = fs.readFileSync('src/data/hermesClient.ts', 'utf8');
const agentLoopRuntime = fs.readFileSync('src/data/agentLoopRuntime.ts', 'utf8');
const agentLoopPolicy = fs.readFileSync('src/data/agentLoopPolicy.ts', 'utf8');
const agentLoopFinalization = fs.readFileSync('src/data/agentLoopFinalization.ts', 'utf8');
const autonomousDecisionAuthority = fs.readFileSync('src/engine/autonomousDecisionAuthority.mjs', 'utf8');
assert.match(client, /from '\.\/userMemory'/u, 'user memory persistence must remain extracted');
assert.match(client, /from '\.\.\/engine\/imageRequest\.mjs'/u, 'image request routing must remain extracted');
assert.match(client, /from '\.\/appStateStorage'/u, 'app state persistence must remain extracted');
assert.doesNotMatch(client, /function cleanChatMessages/u, 'chat persistence must not move back into the client');
assert.match(client, /from '\.\/agentLoopRuntime'/u, 'agent loop runtime must remain extracted');
assert.doesNotMatch(client, /async function runAgentLoop/u, 'agent loop runtime must not move back into the model client');
assert.match(agentLoopRuntime, /function createRunAgentLoop/u, 'agent loop runtime must expose a compatibility factory');
assert.match(agentLoopRuntime, /from '\.\/agentLoopPolicy'/u, 'agent policy must remain extracted');
assert.match(agentLoopRuntime, /from '\.\/agentLoopFinalization'/u, 'agent finalization must remain extracted');
assert.doesNotMatch(agentLoopRuntime, /function getUserActionForFailure/u, 'failure presentation policy must not move back into the loop');
assert.doesNotMatch(agentLoopRuntime, /recordTaskLearning\(/u, 'task learning finalization must not move back into the loop');
assert.match(agentLoopPolicy, /function isAllowedPinnedSkillSource/u, 'pinned Skill source policy must remain explicit');
assert.match(agentLoopFinalization, /function finalizeAgentLoopResult/u, 'agent finalization module must expose a focused function');
assert.match(autonomousDecisionAuthority, /function validateAutonomousDecisionProposal/u, 'autonomous decisions must remain goal and plan validated');
const store = fs.readFileSync('src/store.tsx', 'utf8');
const officeCommands = fs.readFileSync('src/store/officeCommands.ts', 'utf8');
const taskRunControls = fs.readFileSync('src/store/taskRunControls.ts', 'utf8');
const teamMessageCommands = fs.readFileSync('src/store/teamMessageCommands.ts', 'utf8');
const teamDiscussionRuntime = fs.readFileSync('src/store/teamDiscussionRuntime.ts', 'utf8');
const teamWorkerLease = fs.readFileSync('src/store/teamWorkerLease.ts', 'utf8');
const teamRunFinalization = fs.readFileSync('src/store/teamRunFinalization.ts', 'utf8');
const teamAutonomousDecision = fs.readFileSync('src/store/teamAutonomousDecision.ts', 'utf8');
assert.match(store, /from '\.\/store\/nativeEmployeeProjection'/u, 'native employee status projection must remain extracted');
assert.match(officeCommands, /from '\.\.\/data\/taskExecutionBridge'/u, 'task execution IPC bridge must remain extracted behind office commands');
assert.doesNotMatch(store, /for \(const step of run\.steps\)/u, 'worker presence projection must not move back into the store');
assert.doesNotMatch(store, /electronAPI\?\.taskExecutionSyncMembers/u, 'task execution IPC details must not move back into the store');
assert.match(store, /from '\.\/store\/officeCommands'/u, 'office commands must remain extracted');
assert.match(store, /from '\.\/store\/taskRunControls'/u, 'task run controls must remain extracted');
assert.match(store, /from '\.\/store\/teamMessageCommands'/u, 'team message commands must remain extracted');
assert.match(store, /from '\.\/store\/teamDiscussionRuntime'/u, 'team discussion runtime must remain extracted');
assert.doesNotMatch(store, /const runDiscussion = \(teamId/u, 'team discussion runtime must not move back into the store');
assert.doesNotMatch(store, /const resumeTaskRun = async/u, 'task run controls must not move back into the store');
assert.match(officeCommands, /function createOfficeCommands/u, 'office command module must expose a focused factory');
assert.match(taskRunControls, /function createTaskRunControls/u, 'task run controls must expose a focused factory');
assert.match(teamMessageCommands, /function createTeamMessageCommands/u, 'team message commands must expose a focused factory');
assert.match(teamDiscussionRuntime, /function createTeamDiscussionRuntime/u, 'team discussion runtime must expose a focused factory');
assert.match(teamDiscussionRuntime, /from '\.\/teamWorkerLease'/u, 'worker lease protocol must remain extracted');
assert.match(teamDiscussionRuntime, /from '\.\/teamRunFinalization'/u, 'team run finalization must remain extracted');
assert.match(teamDiscussionRuntime, /from '\.\/teamAutonomousDecision'/u, 'team autonomous decision authority must remain extracted');
assert.doesNotMatch(teamDiscussionRuntime, /type: 'heartbeat'/u, 'worker heartbeat details must not move back into the discussion runtime');
assert.doesNotMatch(teamDiscussionRuntime, /const deliveryVerification/u, 'delivery verification policy must not move back into the discussion runtime');
assert.match(teamWorkerLease, /function createTeamWorkerLease/u, 'worker lease module must expose a focused factory');
assert.match(teamRunFinalization, /function finalizeTeamRun/u, 'team finalization module must expose a focused function');
assert.match(teamAutonomousDecision, /function createTeamAutonomousDecisionRecorder/u, 'team decision recorder must expose a focused factory');

const adaptiveRecovery = fs.readFileSync('electron/adaptiveExecutionRecovery.cjs', 'utf8');
assert.ok(adaptiveRecovery.split(/\r?\n/u).length <= 120, 'adaptive recovery module must remain focused');

console.log(JSON.stringify({ passed: true, lines }, null, 2));
