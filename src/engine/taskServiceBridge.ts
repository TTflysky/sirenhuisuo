import type { TaskDecision } from './taskDecisionKernel.mjs';
import type { ExecutionControllerSnapshot } from './executionController.mjs';
import type { ToolExecutionEvidence } from './executionEvidence.mjs';

type Reference = { kind?: string; id?: string; label?: string; sourceUrl?: string; state?: string };
type Usage = { promptTokens?: number; completionTokens?: number; totalTokens?: number };

function failureClass(value: string): string {
  if (/timeout|timed out|aborted|超时/i.test(value)) return 'timeout';
  if (/network|fetch failed|ECONN|ENOTFOUND|网络/i.test(value)) return 'network';
  if (/401|403|unauthorized|forbidden|权限|密钥/i.test(value)) return 'authentication';
  if (/429|rate.?limit|限流/i.test(value)) return 'rate-limit';
  return 'unknown';
}

export function createChatTaskBridge(input: {
  taskType: 'assistant' | 'dm'; ownerId: string; title: string; goal: string; workspaceId: string;
  idempotencyKey: string; references?: Reference[];
}) {
  let taskId: string | undefined;
  let workerLeaseId: string | undefined;
  let heartbeatTimer: number | undefined;
  const attempts = new Map<string, string>();
  const pendingWrites: Array<Promise<unknown>> = [];
  const stepId = 'execution';
  const api = () => window.electronAPI;
  const schedule = (operation: Promise<unknown>) => {
    pendingWrites.push(operation.catch(() => undefined));
  };
  const renewWorkerLease = () => {
    const electron = api();
    const currentTaskId = taskId;
    if (!electron || !currentTaskId || !workerLeaseId) return;
    schedule(electron.taskWorkerCommand({
      taskId: currentTaskId,
      type: 'heartbeat',
      requestedBy: 'renderer-chat-task-service',
      payload: { leaseId: workerLeaseId },
    }));
  };
  const releaseWorkerLease = async () => {
    const electron = api();
    const currentTaskId = taskId;
    if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    if (!electron || !currentTaskId || !workerLeaseId) return;
    const leaseId = workerLeaseId;
    workerLeaseId = undefined;
    await electron.taskWorkerCommand({
      taskId: currentTaskId,
      type: 'release',
      requestedBy: 'renderer-chat-task-service',
      payload: { leaseId },
    });
  };

  return {
    get taskId() { return taskId; },
    async prepare(decision: TaskDecision) {
      const electron = api();
      if (decision.mode !== 'execute' || !electron?.taskServiceCreate) return;
      const created = await electron.taskServiceCreate({
        taskType: input.taskType, ownerId: input.ownerId, title: input.title,
        goal: decision.goal || input.goal, request: input.goal,
        acceptanceCriteria: decision.acceptanceCriteria, constraints: decision.requiredConstraints,
        idempotencyKey: input.idempotencyKey,
        steps: [{ id: stepId, title: 'Execute task route', assignment: decision.goal || input.goal }],
      });
      const createdTask = created as { ok?: boolean; task?: { id?: string } };
      taskId = createdTask.ok ? createdTask.task?.id : undefined;
      const currentTaskId = taskId;
      if (!currentTaskId) return;
      await electron.taskServiceStatus({ taskId: currentTaskId, status: 'running', detail: 'Chat execution started' });
      const claimed = await electron.taskWorkerCommand({
        taskId: currentTaskId,
        type: 'claim',
        requestedBy: 'renderer-chat-task-service',
        payload: { adapter: 'renderer-chat-task-service', jobId: input.idempotencyKey },
      }) as { ok?: boolean; run?: { worker?: { leaseId?: string } } };
      workerLeaseId = claimed.ok ? claimed.run?.worker?.leaseId : undefined;
      if (workerLeaseId && heartbeatTimer === undefined) heartbeatTimer = window.setInterval(renewWorkerLease, 10000);
      await Promise.all((input.references ?? []).filter((reference) => reference.label).map((reference) => electron.taskServiceReference({
        taskId: currentTaskId, kind: reference.kind || 'conversation', id: reference.id, label: reference.label!,
        sourceUrl: reference.sourceUrl, state: reference.state || 'bound',
      })));
    },
    toolStarted(name: string, args: string) {
      const electron = api();
      const currentTaskId = taskId;
      if (!currentTaskId || !electron) return;
      const key = `${name}:${args}`;
      const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      attempts.set(key, id);
      schedule(electron.taskServiceToolAttempt({ taskId: currentTaskId, id, stepId, toolName: name, status: 'started', inputSummary: args }));
    },
    toolFinished(name: string, args: string, output: string, success: boolean) {
      const electron = api();
      const currentTaskId = taskId;
      if (!currentTaskId || !electron) return;
      const key = `${name}:${args}`;
      const id = attempts.get(key) || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      schedule(electron.taskServiceToolAttempt({ taskId: currentTaskId, id, stepId, toolName: name, status: success ? 'succeeded' : 'failed',
        errorClass: success ? undefined : failureClass(output), inputSummary: args, outputSummary: output, finishedAt: Date.now() }));
    },
    artifacts(evidence?: ToolExecutionEvidence) {
      const electron = api();
      const currentTaskId = taskId;
      if (!currentTaskId || !electron) return;
      for (const artifact of evidence?.artifacts ?? []) {
        const path = String(artifact.path || artifact.filename || '').trim();
        if (!path) continue;
        schedule(electron.taskServiceArtifact({
          taskId: currentTaskId,
          name: String(artifact.filename || path),
          path,
          diskPath: artifact.diskPath,
          workspaceId: artifact.workspaceId,
          bytes: artifact.bytes,
          contentType: artifact.contentType,
          verification: artifact.verification,
          category: artifact.category,
          verified: artifact.verified === true,
          source: 'tool-evidence',
        }));
      }
    },
    heartbeat(state: ExecutionControllerSnapshot) {
      const electron = api();
      const currentTaskId = taskId;
      if (!currentTaskId || !electron) return;
      schedule(electron.taskServiceHeartbeat({
        taskId: currentTaskId,
        state: state.status,
        detail: state.phase,
        workspaceId: input.workspaceId,
        observedAt: Date.now(),
      }));
      renewWorkerLease();
    },
    async finish(result: { executionState: ExecutionControllerSnapshot; usage: Usage; model?: string; output: string }) {
      const electron = api();
      const currentTaskId = taskId;
      if (!currentTaskId || !electron) return;
      try {
        await Promise.allSettled(pendingWrites.splice(0));
        await electron.taskServiceUsage({ taskId: currentTaskId, modelRounds: 1, promptTokens: result.usage.promptTokens || 0,
        completionTokens: result.usage.completionTokens || 0, estimatedTokens: result.usage.totalTokens || 0 });
      if (result.executionState.status === 'completed') {
        await electron.taskServiceCompleteStep({ taskId: currentTaskId, stepId, summary: result.output.slice(0, 1000), output: { model: result.model, summary: result.output.slice(0, 3000) } });
        const validation = await electron.taskServiceValidateCompletion(currentTaskId);
        if (validation.passed) await electron.taskServiceStatus({ taskId: currentTaskId, status: 'completed', detail: 'Execution evidence and completion gate passed' });
        else await electron.taskServiceStatus({ taskId: currentTaskId, status: 'awaiting_user', detail: 'Execution returned, but the completion gate still needs evidence' });
      } else if (result.executionState.status === 'stopped') {
        await electron.taskServiceStatus({ taskId: currentTaskId, status: 'stopped', detail: 'Stopped by execution controller' });
      } else {
        await electron.taskServiceFailStep({ taskId: currentTaskId, stepId, error: result.output.slice(0, 1200), errorClass: failureClass(result.output) });
      }
      } finally {
        await releaseWorkerLease();
      }
    },
    async fail(error: unknown) {
      const electron = api();
      const currentTaskId = taskId;
      if (!currentTaskId || !electron) return;
      try {
        const message = error instanceof Error ? error.message : String(error);
        await electron.taskServiceFailStep({ taskId: currentTaskId, stepId, error: message, errorClass: failureClass(message) });
      } finally {
        await releaseWorkerLease();
      }
    },
  };
}
