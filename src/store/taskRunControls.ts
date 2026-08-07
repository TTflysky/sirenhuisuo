import type { AppState } from '../types';
import type { AppStateAction } from './appStateReducer';
import { appendTaskRunContext, getExecutionSessionId, sendTaskWorkerCommand, taskRunContextPrompt, updateTaskRun } from '../data/taskRuns';
import { initializeTaskWorkspace } from '../utils/attachments';
import { applyExecutionSteering } from '../engine/executionController.mjs';
import { buildSkillContextWithEvidence } from '../data/skills';
import { retrieveLayeredMemoryContext } from '../data/layeredMemory';

interface TaskRunControlDependencies {
  getState: () => AppState;
  dispatch: (action: AppStateAction) => void;
  pausedRunIds: Set<string>;
  stoppedRunIds: Set<string>;
  abortTeamModelRequest: (teamId: string) => void;
  startNativeTaskExecution: (...args: any[]) => Promise<any>;
  enqueueDiscussion: (...args: any[]) => void;
}

export function createTaskRunControls({
  getState,
  dispatch,
  pausedRunIds,
  stoppedRunIds,
  abortTeamModelRequest,
  startNativeTaskExecution,
  enqueueDiscussion,
}: TaskRunControlDependencies) {
  const markPausedLocally = (run: AppState['taskRuns'][number], detail: string) => updateTaskRun(run, (next) => {
    next.status = 'paused';
    next.phase = 'blocked';
    next.steps.forEach((step) => {
      if (step.status === 'queued' || step.status === 'running') {
        step.status = 'paused';
        step.events.push({ ts: Date.now(), type: 'status', detail });
      }
    });
    if (next.worker) next.worker = { ...next.worker, state: 'paused', activity: detail, releasedAt: Date.now(), expiresAt: undefined };
    if (next.recoveryContext) next.recoveryContext.summary = '任务已暂停，等待后台确认；工作区、产物和检查点均已保留。';
  });

  const pauseTaskRun = async (runId: string): Promise<boolean> => {
    pausedRunIds.add(runId);
    const run = getState().taskRuns.find((item) => item.id === runId);
    if (run) abortTeamModelRequest(run.teamId);
    if (!run) return false;
    // Reflect the user control before Worker persistence/model abort finishes.
    dispatch({ type: 'UPDATE_TASK_RUN', run: markPausedLocally(run, '正在暂停当前模型、工具和子任务…') });
    const fallback = () => dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(run, (next) => {
      next.status = 'paused'; next.steps.forEach((step) => { if (step.status === 'queued' || step.status === 'running') step.status = 'paused'; });
      if (next.recoveryContext) next.recoveryContext.summary = '任务已暂停，工作区和上下文均已保留。';
    }) });
    const result = await sendTaskWorkerCommand({ taskId: runId, type: 'pause', requestedBy: 'task-control' });
    if (result?.ok && result.run?.status === 'paused') {
      dispatch({ type: 'UPDATE_TASK_RUN', run: result.run });
      return true;
    }
    if (result && !result.ok) {
      pausedRunIds.delete(runId);
      dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(run, (next) => {
        next.lastError = `暂停命令未被后台确认：${result.error || '未知错误'}`;
        if (next.recoveryContext) next.recoveryContext.summary = next.lastError;
      }) });
      return false;
    }
    fallback();
    return true;
  };

  const resumeTaskRun = async (runId: string): Promise<void> => {
    const run = getState().taskRuns.find((item) => item.id === runId);
    if (!run) return;
    const pendingSteps = run.status === 'awaiting_user'
      ? run.steps.filter((step) => step.status !== 'completed' && step.status !== 'stopped')
      : run.steps.filter((step) => step.status === 'paused' || step.status === 'failed' || step.status === 'queued');
    const pending = pendingSteps.map((step) => step.employeeId);
    const pendingStepIds = new Set(pendingSteps.map((step) => step.id));
    if (!pendingSteps.length) return;
    const reportResumeFailure = (message: string) => {
      const latest = getState().taskRuns.find((item) => item.id === runId) ?? run;
      dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(latest, (next) => {
        const reason = message.slice(0, 900);
        next.status = ['paused', 'failed', 'awaiting_user'].includes(next.status) ? next.status : 'failed';
        next.phase = next.status === 'awaiting_user' ? 'awaiting_user' : 'blocked';
        next.lastError = reason;
        next.handoff = {
          ts: Date.now(),
          completed: next.steps.filter((step) => step.status === 'completed').map((step) => step.title),
          blocked: reason,
          nextAction: '恢复命令没有生效。请查看本条真实错误；修复后可再次点击“继续执行”，已完成步骤不会重做。',
        };
        if (next.recoveryContext) {
          next.recoveryContext.summary = `恢复未启动：${reason}`;
          next.recoveryContext.unresolvedIssues = [...next.recoveryContext.unresolvedIssues, reason].slice(-12);
          next.recoveryContext.waitingFor = reason;
        }
      }) });
    };
    try {
      const preparing = updateTaskRun(run, (next) => {
        if (!next.recoveryContext) return;
        next.recoveryContext.summary = '正在校验恢复条件，并按子任务到父任务的顺序重新入队。';
        next.recoveryContext.waitingFor = undefined;
      });
      dispatch({ type: 'UPDATE_TASK_RUN', run: preparing });
      const resumedByWorker = await sendTaskWorkerCommand({ taskId: runId, type: 'resume', requestedBy: 'task-control' });
      if (resumedByWorker && !resumedByWorker.ok) {
        reportResumeFailure(resumedByWorker.error || '后台 Worker 拒绝了恢复命令。');
        return;
      }
      pausedRunIds.delete(runId);
      stoppedRunIds.delete(runId);
      const workerRun = resumedByWorker?.run ?? updateTaskRun(run, (next) => {
        next.status = 'queued'; next.phase = 'preflight'; next.lastError = undefined; next.handoff = undefined;
        next.steps.forEach((step) => { if (pendingStepIds.has(step.id)) step.status = 'queued'; });
      });
      try {
        await initializeTaskWorkspace(workerRun.workspaceId!, { kind: 'team', label: `恢复任务 / ${workerRun.title}`, taskId: workerRun.id });
      } catch (error) {
        dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(workerRun, (next) => {
          next.status = 'failed'; next.phase = 'blocked'; next.lastError = error instanceof Error ? error.message : String(error);
          next.handoff = { ts: Date.now(), completed: next.steps.filter((step) => step.status === 'completed').map((step) => step.title), blocked: next.lastError, nextAction: '到“设置 → 诊断中心”修复工作区后再次继续。' };
          if (next.recoveryContext) next.recoveryContext.unresolvedIssues = [...next.recoveryContext.unresolvedIssues, next.lastError!].slice(-12);
        }) });
        return;
      }
      const resumedRun = updateTaskRun(workerRun, (next) => {
        next.executionSessionId = getExecutionSessionId();
        if (next.recoveryContext) {
          next.recoveryContext.summary = '恢复检查已通过，准备从未完成步骤继续。';
          next.recoveryContext.interruptedAt = undefined;
          next.recoveryContext.interruptionReason = undefined;
          if (next.recoveryContext.controller) {
            next.recoveryContext.controller = applyExecutionSteering(next.recoveryContext.controller, '用户已要求继续执行；重新验证上次阻塞条件，再从未完成步骤推进。');
          }
        }
      });
      dispatch({ type: 'UPDATE_TASK_RUN', run: resumedRun });
      const skillBundle = await buildSkillContextWithEvidence(workerRun.skillRefs ?? []);
      const resumedWithSkills = updateTaskRun(resumedRun, (next) => {
        next.skillEvidence = [...(next.skillEvidence ?? []), ...skillBundle.evidence].slice(-60);
        appendTaskRunContext(next, { type: 'progress', source: 'system', summary: '恢复任务时重新读取已选 Skill，并沿用原任务上下文。', verified: true });
      });
      dispatch({ type: 'UPDATE_TASK_RUN', run: resumedWithSkills });
      const workerPendingSteps = resumedWithSkills.steps.filter((step) => pendingStepIds.has(step.id));
      const layeredMemory = await retrieveLayeredMemoryContext({ query: workerRun.goal || workerRun.request, projectId: workerRun.projectId, taskId: workerRun.id, conversationId: workerRun.conversationId, teamId: workerRun.teamId, limit: 18 });
      const layeredMemoryContext = layeredMemory.ok ? layeredMemory.context ?? '' : '';
      const extraSystemContext = [layeredMemoryContext, skillBundle.context, taskRunContextPrompt(resumedWithSkills)].filter(Boolean).join('\n\n');
      const nativeResult = await startNativeTaskExecution(resumedWithSkills, extraSystemContext);
      if (!nativeResult) {
        enqueueDiscussion(workerRun.teamId, { userText: workerRun.request, triggerMessageId: workerRun.sourceMessageId, discussionId: workerRun.id, conversationId: workerRun.conversationId, forcedMemberIds: pending, runSteps: workerPendingSteps, maxRounds: workerPendingSteps.length, runId, workspaceId: workerRun.workspaceId, extraSystemContext }, 50);
      } else if (!nativeResult.ok) {
        reportResumeFailure(nativeResult.error || '主进程执行器恢复失败。');
      }
    } catch (error) {
      reportResumeFailure(error instanceof Error ? error.message : String(error));
    }
  };

  const stopTaskRun = async (runId: string): Promise<boolean> => {
    stoppedRunIds.add(runId);
    pausedRunIds.delete(runId);
    const run = getState().taskRuns.find((item) => item.id === runId);
    if (run) abortTeamModelRequest(run.teamId);
    if (!run) return false;
    // Stop is intentionally optimistic: once the user clicks it, no new work
    // should be presented as active while the durable command is being written.
    dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(run, (next) => {
      next.status = 'stopped';
      next.phase = 'blocked';
      next.steps.forEach((step) => {
        if (step.status === 'queued' || step.status === 'running' || step.status === 'paused') {
          step.status = 'stopped';
          step.events.push({ ts: Date.now(), type: 'status', detail: '正在停止当前任务和子任务…' });
        }
      });
      if (next.worker) next.worker = { ...next.worker, state: 'stopped', activity: '正在停止任务', releasedAt: Date.now(), expiresAt: undefined };
    }) });
    const fallback = () => dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(run, (next) => {
      next.status = 'stopped';
      next.phase = 'blocked';
      next.lastError = undefined;
      next.steps.forEach((step) => {
        if (step.status === 'queued' || step.status === 'running' || step.status === 'paused') {
          step.status = 'stopped';
          step.events.push({ ts: Date.now(), type: 'status', detail: '用户已停止任务' });
        }
      });
      next.handoff = {
        ts: Date.now(),
        completed: next.steps.filter((step) => step.status === 'completed').map((step) => step.title),
        blocked: '任务已由用户停止。',
        nextAction: '已完成内容会保留；需要继续时请重新发起任务。',
      };
    }) });
    const result = await sendTaskWorkerCommand({ taskId: runId, type: 'stop', requestedBy: 'task-control' });
    if (result?.ok && result.run?.status === 'stopped') {
      dispatch({ type: 'UPDATE_TASK_RUN', run: result.run });
      return true;
    }
    if (result && !result.ok) {
      stoppedRunIds.delete(runId);
      dispatch({ type: 'UPDATE_TASK_RUN', run: updateTaskRun(run, (next) => {
        next.lastError = `停止命令未被后台确认：${result.error || '未知错误'}`;
        if (next.recoveryContext) next.recoveryContext.summary = next.lastError;
      }) });
      return false;
    }
    fallback();
    return true;
  };

  const closeTaskRun = (runId: string) => {
    pausedRunIds.add(runId);
    void sendTaskWorkerCommand({ taskId: runId, type: 'close', requestedBy: 'task-control' }).then(() => {
      dispatch({ type: 'REMOVE_TASK_RUN', runId });
    });
  };

  const clearTeamExecution = (targetTeamId: string) => dispatch({ type: 'CLEAR_TEAM_EXECUTION', teamId: targetTeamId });


  return { pauseTaskRun, resumeTaskRun, stopTaskRun, closeTaskRun, clearTeamExecution };
}
