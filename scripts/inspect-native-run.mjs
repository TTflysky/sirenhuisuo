import fs from 'node:fs/promises';
import path from 'node:path';

const runId = process.argv[2];
if (!runId) throw new Error('用法：node scripts/inspect-native-run.mjs <runId>');
const runtimeRoot = path.join(process.env.APPDATA || '', 'taiji-office', 'task-runtime');
const runsFile = path.join(runtimeRoot, 'task-runs.json');

async function readStableJson(filename, attempts = 20) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return JSON.parse(await fs.readFile(filename, 'utf8'));
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  throw lastError;
}

const ledger = await readStableJson(runsFile);
const run = (Array.isArray(ledger) ? ledger : ledger.runs || []).find((item) => item.id === runId);
if (!run) throw new Error(`没有找到运行 ${runId}`);

const toolAttempts = (run.toolAttempts || []).map((attempt) => ({
  stepId: attempt.stepId,
  name: attempt.name || attempt.toolName,
  success: attempt.success,
}));
console.log(JSON.stringify({
  id: run.id,
  teamId: run.teamId,
  status: run.status,
  failure: run.failure,
  waitingFor: run.waitingFor,
  nextAction: run.nextAction,
  workspaceId: run.workspaceId || run.workspace?.id,
  workspacePath: run.workspace?.path || run.workspacePath,
  worker: run.worker,
  codingProjectVersion: run.codingProject?.codingProjectVersion,
  steps: (run.steps || []).map((step) => ({
    id: step.id,
    title: step.title,
    kind: step.kind,
    status: step.status,
    attempts: step.attempts,
    employeeId: step.employeeId,
    dependsOnStepIds: step.dependsOnStepIds || [],
    lastEvents: (step.events || []).slice(-5),
  })),
  artifacts: (run.artifacts || []).map((artifact) => ({ name: artifact.name, path: artifact.path, verified: artifact.verified })),
  toolsByStep: Object.groupBy(toolAttempts, (attempt) => attempt.stepId || 'unknown'),
  recentLifecycle: (run.turnLifecycle?.timeline || []).slice(-16).map((event) => ({
    sequence: event.sequence,
    type: event.type,
    activity: event.activity,
    at: event.at,
    detail: event.detail,
  })),
  lifecycleKeys: Object.keys(run.turnLifecycle || {}),
  lifecycleState: run.turnLifecycle ? {
    phase: run.turnLifecycle.phase,
    sequence: run.turnLifecycle.sequence,
    progressAt: run.turnLifecycle.progressAt,
    updatedAt: run.turnLifecycle.updatedAt,
    activity: run.turnLifecycle.activity,
  } : null,
  recentLifecycleEvents: (run.turnLifecycle?.events || []).slice(-20),
  recovery: run.turnLifecycle?.recovery,
  exit: run.turnLifecycle?.exit,
  recentServiceEvents: (run.serviceEvents || []).slice(-12),
}, null, 2));
