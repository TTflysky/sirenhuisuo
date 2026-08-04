import type { TaskRun } from '../types';
import { sendTaskWorkerCommand } from '../data/taskRuns';

export interface TeamWorkerCheckpoint {
  kind: 'step_started' | 'step_completed' | 'step_failed' | 'run_failed' | 'run_finished';
  stepId?: string;
  summary?: string;
  finalStatus?: string;
}

interface TeamWorkerLeaseDependencies {
  getRun: () => TaskRun | undefined;
  acceptRun: (run: TaskRun, publish: boolean) => void;
}

export function createTeamWorkerLease({ getRun, acceptRun }: TeamWorkerLeaseDependencies) {
  let leaseId: string | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let checkpointSequence = 0;
  let checkpointQueue = Promise.resolve();
  let checkpointError: string | undefined;

  const reportCheckpoint = (checkpoint: TeamWorkerCheckpoint): Promise<void> => {
    const run = getRun();
    if (!run || !leaseId) return Promise.resolve();
    const sequence = ++checkpointSequence;
    const runId = run.id;
    const activeLeaseId = leaseId;
    checkpointQueue = checkpointQueue.then(async () => {
      const result = await sendTaskWorkerCommand({
        commandId: `adapter-checkpoint-${runId}-${sequence}`,
        taskId: runId,
        type: 'checkpoint',
        requestedBy: 'renderer-team-discussion-adapter',
        payload: {
          leaseId: activeLeaseId,
          checkpoint: {
            protocolVersion: 1,
            checkpointId: `adapter-${runId}-${sequence}`,
            sequence,
            occurredAt: Date.now(),
            ...checkpoint,
          },
        },
      });
      if (result && !result.ok) throw new Error(result.error || `执行检查点 #${sequence} 写入失败`);
      if (result?.run?.worker && getRun()?.id === runId) acceptRun(result.run, true);
    }).catch((error) => {
      checkpointError = error instanceof Error ? error.message : String(error);
      console.error('[execution-adapter] checkpoint failed:', checkpointError);
    });
    return checkpointQueue;
  };

  const claim = async () => {
    const run = getRun();
    if (!run) return;
    const claimed = await sendTaskWorkerCommand({
      taskId: run.id,
      type: 'claim',
      requestedBy: 'renderer-team-discussion',
      payload: { adapter: 'renderer-team-discussion', adapterProtocolVersion: 1, jobId: `team-job-${run.id}` },
    });
    if (claimed && !claimed.ok) throw new Error(claimed.error || 'Worker 无法领取任务');
    if (!claimed?.run) return;
    acceptRun(claimed.run, true);
    leaseId = claimed.run.worker?.leaseId;
    checkpointSequence = claimed.run.worker?.checkpointSequence ?? 0;
    if (!leaseId) return;
    heartbeatTimer = setInterval(() => {
      const currentRun = getRun();
      if (!currentRun || !leaseId) return;
      void sendTaskWorkerCommand({ taskId: currentRun.id, type: 'heartbeat', requestedBy: 'renderer-team-discussion', payload: { leaseId } })
        .then((heartbeat) => { if (heartbeat?.ok && heartbeat.run) acceptRun(heartbeat.run, false); });
    }, 5_000);
  };

  const close = async (release: boolean): Promise<string | undefined> => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    await checkpointQueue;
    const run = getRun();
    if (release && run && leaseId) {
      const released = await sendTaskWorkerCommand({ taskId: run.id, type: 'release', requestedBy: 'renderer-team-discussion', payload: { leaseId } });
      if (released?.ok && released.run) acceptRun(released.run, true);
    }
    leaseId = undefined;
    return checkpointError;
  };

  return { claim, reportCheckpoint, close };
}
