import type { TaskDecision } from './taskDecisionKernel.mjs';
import type { ExecutionControllerSnapshot } from './executionController.mjs';
import type { ToolExecutionEvidence } from './executionEvidence.mjs';
import { createLifecycleRecoveryCapsule, type TurnLifecycleState } from './turnLifecycle.mjs';
import type { TurnRuntimeState } from './turnRuntime.mjs';

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
  taskType: 'assistant' | 'dm'; ownerId: string; title: string; goal: string; request?: string; workspaceId: string;
  parentTaskId?: string;
  idempotencyKey: string; conversationId?: string; references?: Reference[];
}) {
  let taskId: string | undefined;
  let workerLeaseId: string | undefined;
  let heartbeatTimer: number | undefined;
  let heartbeatFlushTimer: number | undefined;
  let latestLifecycle: TurnLifecycleState | undefined;
  let latestExecutionState: ExecutionControllerSnapshot | undefined;
  let goalId: string | undefined;
  let planRevision = 1;
  let decisionSequence = 0;
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
      payload: {
        leaseId: workerLeaseId,
        progressAt: latestLifecycle?.progressAt,
        activity: latestLifecycle?.activity,
      },
    }));
  };
  const flushExecutionHeartbeat = () => {
    const electron = api();
    const currentTaskId = taskId;
    const state = latestExecutionState;
    if (heartbeatFlushTimer !== undefined) window.clearTimeout(heartbeatFlushTimer);
    heartbeatFlushTimer = undefined;
    latestExecutionState = undefined;
    if (!electron || !currentTaskId || !state) return;
    schedule(electron.taskServiceHeartbeat({
      taskId: currentTaskId,
      state: state.status,
      detail: state.phase,
      activity: latestLifecycle?.activity,
      workspaceId: input.workspaceId,
      observedAt: Date.now(),
      progressAt: latestLifecycle?.progressAt,
    }));
    renewWorkerLease();
  };
  const writeLifecycle = async (lifecycle: TurnLifecycleState) => {
    const electron = api();
    const currentTaskId = taskId;
    latestLifecycle = lifecycle;
    if (!electron || !currentTaskId) return;
    const recovery = createLifecycleRecoveryCapsule(lifecycle, {
      reason: lifecycle.exit?.reason || lifecycle.recovery?.reason,
      nextAction: lifecycle.recovery?.nextAction,
      resumable: lifecycle.recovery?.resumable,
    });
    await electron.taskServiceLifecycle({ taskId: currentTaskId, lifecycle, recovery });
    if (workerLeaseId) {
      await electron.taskWorkerCommand({
        taskId: currentTaskId,
        type: 'heartbeat',
        requestedBy: 'renderer-chat-task-service',
        payload: { leaseId: workerLeaseId, progressAt: lifecycle.progressAt, activity: lifecycle.activity },
      });
    }
  };
  const releaseWorkerLease = async () => {
    const electron = api();
    const currentTaskId = taskId;
    if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
    if (heartbeatFlushTimer !== undefined) window.clearTimeout(heartbeatFlushTimer);
    heartbeatTimer = undefined;
    heartbeatFlushTimer = undefined;
    latestExecutionState = undefined;
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
  const recordDecision = async (selectedAction: Record<string, unknown>, publicRationale: string, options: {
    expectedEvidence?: string[];
    riskLevel?: 'low' | 'medium' | 'high';
    approvalRequired?: boolean;
  } = {}) => {
    const electron = api();
    const currentTaskId = taskId;
    if (!electron || !currentTaskId || !goalId) return;
    decisionSequence += 1;
    const proposalId = `proposal-${currentTaskId}-${Date.now()}-${decisionSequence}`;
    const result = await electron.taskServiceUpdate({
      taskId: currentTaskId,
      patch: {
        autonomousDecisionProposal: {
          proposalVersion: 1,
          proposalId,
          source: 'model',
          goalId,
          planRevision,
          selectedAction,
          publicRationale,
          expectedEvidence: options.expectedEvidence || [],
          riskLevel: options.riskLevel || 'low',
          approvalRequired: options.approvalRequired === true,
          createdAt: Date.now(),
        },
      },
      detail: `记录自主行动提案：${String(selectedAction.kind || 'unknown')}`,
    }) as { ok?: boolean; error?: string; run?: { adaptivePlanGraph?: { revision?: number }; autonomousControl?: { decisionAuthority?: { accepted?: boolean; proposalId?: string; reason?: string } } } };
    if (!result.ok) throw new Error(result.error || '自主行动提案未能写入任务账本');
    planRevision = Number(result.run?.adaptivePlanGraph?.revision) || planRevision;
    const authority = result.run?.autonomousControl?.decisionAuthority;
    if (!authority?.accepted || authority.proposalId !== proposalId) throw new Error(authority?.reason || '自主行动没有通过当前目标与计划校验');
  };

  return {
    get taskId() { return taskId; },
    async prepare(decision: TaskDecision) {
      const electron = api();
      if (decision.mode !== 'execute' || !electron?.taskServiceCreate) return;
      const created = await electron.taskServiceCreate({
        taskType: input.taskType, ownerId: input.ownerId, title: input.title,
        goal: input.parentTaskId ? input.goal : decision.goal || input.goal, request: input.request || input.goal,
        parentTaskId: input.parentTaskId,
        acceptanceCriteria: decision.acceptanceCriteria, constraints: decision.requiredConstraints,
        taskDecision: decision,
        workspaceId: input.workspaceId,
        idempotencyKey: input.idempotencyKey,
        conversationId: input.conversationId,
        steps: [{ id: stepId, title: 'Execute task route', assignment: decision.goal || input.goal, deliverableType: decision.deliverableType }],
      });
      const createdTask = created as { ok?: boolean; task?: { id?: string; goalState?: { goalId?: string }; adaptivePlanGraph?: { revision?: number } } };
      taskId = createdTask.ok ? createdTask.task?.id : undefined;
      goalId = createdTask.ok ? createdTask.task?.goalState?.goalId : undefined;
      planRevision = Number(createdTask.task?.adaptivePlanGraph?.revision) || 1;
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
    async toolStarted(name: string, args: string) {
      const electron = api();
      const currentTaskId = taskId;
      if (!currentTaskId || !electron) return;
      const key = `${name}:${args}`;
      const id = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await recordDecision({
        kind: 'use_tool',
        toolName: name,
        toolCallId: id,
        summary: `调用 ${name} 产生下一项可验证证据。`,
      }, '该工具由模型根据当前目标、已知事实和执行现场选择；确定性内核只校验目标、计划、权限与证据边界。');
      attempts.set(key, id);
      await electron.taskServiceToolAttempt({ taskId: currentTaskId, id, stepId, toolName: name, status: 'started', inputSummary: args });
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
    lifecycle(snapshot: TurnLifecycleState) {
      schedule(writeLifecycle(snapshot));
    },
    heartbeat(state: ExecutionControllerSnapshot) {
      if (!taskId || !api()) return;
      latestExecutionState = state;
      if (heartbeatFlushTimer === undefined) heartbeatFlushTimer = window.setTimeout(flushExecutionHeartbeat, 250);
    },
    async finish(result: {
      executionState: ExecutionControllerSnapshot;
      usage: Usage;
      model?: string;
      output: string;
      turnRuntime?: TurnRuntimeState;
      turnFinalization?: Record<string, any>;
      lifecycle?: TurnLifecycleState;
    }) {
      const electron = api();
      const currentTaskId = taskId;
      if (!currentTaskId || !electron) return;
      flushExecutionHeartbeat();
      const persistCompletion = (async () => { try {
        if (result.lifecycle) await writeLifecycle(result.lifecycle);
        await Promise.allSettled(pendingWrites.splice(0));
        await electron.taskServiceUsage({ taskId: currentTaskId, modelRounds: 1, promptTokens: result.usage.promptTokens || 0,
        completionTokens: result.usage.completionTokens || 0, estimatedTokens: result.usage.totalTokens || 0 });
      if (result.turnRuntime || result.turnFinalization) {
        await electron.taskServiceUpdate({
          taskId: currentTaskId,
          patch: { turnRuntime: result.turnRuntime, turnFinalization: result.turnFinalization, executionState: result.executionState },
          detail: '保存聊天执行的 Turn Runtime 与统一收尾结果',
        });
      }
      const finalStatus = String(result.turnFinalization?.status || result.lifecycle?.status || result.executionState.status);
      if (finalStatus === 'completed' && result.executionState.status === 'completed') {
        await electron.taskServiceCompleteStep({ taskId: currentTaskId, stepId, summary: result.output.slice(0, 1000), output: { model: result.model, summary: result.output.slice(0, 3000) } });
        await recordDecision({ kind: 'verify_completion', summary: '对照原目标、成功条件和真实证据执行最终验收。' }, '执行步骤已经完成，必须由证据门禁决定任务能否关闭。');
        const validation = await electron.taskServiceValidateCompletion(currentTaskId);
        if (validation.passed) await electron.taskServiceStatus({ taskId: currentTaskId, status: 'completed', detail: 'Execution evidence and completion gate passed' });
        else await electron.taskServiceStatus({ taskId: currentTaskId, status: 'awaiting_user', detail: 'Execution returned, but the completion gate still needs evidence' });
      } else if (finalStatus === 'waiting_user') {
        await recordDecision({ kind: 'await_user', summary: '等待唯一无法由客户端自行取得的用户条件。', requiredUserInput: result.turnFinalization?.waitingFor || result.output.slice(0, 600) }, '现有路线已保留，继续前确实缺少用户专属条件。');
        await electron.taskServiceUpdate({
          taskId: currentTaskId,
          patch: { waitingFor: result.turnFinalization?.waitingFor || result.output.slice(0, 1200) },
          detail: '聊天任务等待用户补充唯一条件',
        });
        await electron.taskServiceStatus({ taskId: currentTaskId, status: 'awaiting_user', detail: 'Execution is waiting for a required user condition' });
      } else if (finalStatus === 'paused' || finalStatus === 'checkpointed') {
        await recordDecision({ kind: 'hold', summary: '保留当前现场，等待用户明确继续。' }, '暂停不会丢失目标、计划版本和已验证证据。');
        await electron.taskServiceCheckpoint({
          taskId: currentTaskId,
          kind: 'turn-lifecycle',
          label: finalStatus === 'checkpointed' ? '执行阶段恢复点' : '用户暂停恢复点',
          workspaceId: input.workspaceId,
        });
        await electron.taskServiceStatus({ taskId: currentTaskId, status: 'paused', detail: 'Execution state was saved and can be resumed' });
      } else if (finalStatus === 'stopped' || result.executionState.status === 'stopped') {
        await recordDecision({ kind: 'stop_safely', summary: '停止无效路线并保留当前成果与阻塞。' }, '执行控制器已确认继续不会产生新的有效证据。');
        await electron.taskServiceStatus({ taskId: currentTaskId, status: 'stopped', detail: 'Stopped by execution controller' });
      } else {
        await recordDecision({ kind: 'reflect', summary: '分类当前失败并只重规划受影响部分。' }, '当前执行没有通过完成门禁，先保留有效证据并分析失败。');
        await electron.taskServiceFailStep({ taskId: currentTaskId, stepId, error: result.output.slice(0, 1200), errorClass: failureClass(result.output) });
      }
      } finally {
        await releaseWorkerLease();
      } })();
      const persisted = persistCompletion.then(
        () => ({ completed: true as const }),
        (error: unknown) => ({ completed: true as const, error }),
      );
      const foreground = await Promise.race([
        persisted,
        new Promise<{ completed: false }>((resolve) => window.setTimeout(() => resolve({ completed: false }), 1500)),
      ]);
      if (foreground.completed && 'error' in foreground && foreground.error) throw foreground.error;
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
