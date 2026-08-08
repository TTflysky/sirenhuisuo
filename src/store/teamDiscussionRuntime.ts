import type { AppState, ChatMessage, DiscussionProgress, OpcRoleId, TaskRun, Team } from '../types';
import type { AppStateAction } from './appStateReducer';
import { runTeamDiscussion } from '../engine/teamDiscussion';
import { appendTaskRunContext, formalPlanStepForRun, getExecutionSessionId, updateTaskRun } from '../data/taskRuns';
import { executionControllerStatus, type ExecutionControllerSnapshot } from '../engine/executionController.mjs';
import { appendTaskRunnerSteps, beginTaskStep, recordTaskReviewDecision, recordTaskStepResult } from '../engine/taskRunner.mjs';
import { retrieveLayeredMemoryContext } from '../data/layeredMemory';
import { cleanExecutionDisplay } from '../engine/executionDisplay.mjs';
import { ensureActiveChatSession, messageBelongsToConversation } from '../data/chatSessions';
import { buildReviewStageSummary, buildRunCompletionSummary, buildWorkStageSummary } from '../engine/teamStageHandoff';
import { appendProjectEvent } from '../utils/projectContext';
import * as client from '../data/hermesClient';
import { finalizeTeamRun } from './teamRunFinalization';
import { createTeamWorkerLease } from './teamWorkerLease';
import { createTeamAutonomousDecisionRecorder } from './teamAutonomousDecision';
import { recordTeamToolEvidence } from './teamToolEvidence';

export type DiscussionOpts = Parameters<typeof runTeamDiscussion>[2];
export interface DiscussionScheduler {
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
  queued?: DiscussionOpts;
  scheduled?: DiscussionOpts;
  steering?: string[];
  modelRequestController?: AbortController;
  lastStartedAt?: number;
  keys: Set<string>;
}

interface TeamDiscussionRuntimeDependencies {
  getState: () => AppState;
  dispatch: (action: AppStateAction) => void;
  discussing: Set<string>;
  schedulers: Map<string, DiscussionScheduler>;
  pausedRunIds: Set<string>;
  stoppedRunIds: Set<string>;
}

export function createTeamDiscussionRuntime({
  getState,
  dispatch,
  discussing,
  schedulers,
  pausedRunIds,
  stoppedRunIds,
}: TeamDiscussionRuntimeDependencies) {
  const runDiscussion = (teamId: string, opts?: DiscussionOpts): boolean => {
    if (discussing.has(teamId)) return false;
    const team = getState().teams.find((t) => t.id === teamId);
    if (!team) return false;
    const runConversationId = opts?.runId
      ? getState().taskRuns.find((item) => item.id === opts?.runId)?.conversationId
      : undefined;
    const conversationId = opts?.conversationId ?? runConversationId ?? ensureActiveChatSession(`team:${teamId}`);
    opts = { ...(opts ?? {}), conversationId };
    const conversationTeam: Team = {
      ...team,
      chatMessages: team.chatMessages.filter((message) => messageBelongsToConversation(message, conversationId, `team:${teamId}`)),
    };
    discussing.add(teamId);
    const activeScheduler = schedulers.get(teamId) ?? { running: true, keys: new Set<string>() };
    activeScheduler.modelRequestController?.abort();
    activeScheduler.modelRequestController = new AbortController();
    schedulers.set(teamId, activeScheduler);

    // Prefer the actual scheduled participants over generic role counts.
    const roleCount = ['pm', 'planner', 'coder', 'checker'].filter(
      (r) => team.memberIds.some((id) => getState().employees.find((e) => e.id === id)?.role === r)
    ).length;
    const scheduledMemberIds = [...new Set([
      ...(opts?.forcedMemberIds ?? []),
      ...(opts?.participantPlan ?? []).map((plan) => plan.memberId),
    ])];
    let totalSteps = Math.max(1, opts?.runSteps?.length || scheduledMemberIds.length || (opts?.task ? roleCount + 1 : roleCount));
    const startedAt = Date.now();
    const estimatedMs = totalSteps * 4000; // 每步预估 4s（API 调用）

    const updateProgress = (step: number, empId?: string, empName?: string, role?: OpcRoleId, model?: string) => {
      const s = client.loadSettings();
      const progress: DiscussionProgress = {
        teamId,
        teamName: team.name,
        step,
        totalSteps,
        currentEmpId: empId,
        currentEmpName: empName,
        currentRole: role,
        model: model ?? s.model ?? undefined,
        scene: opts?.task ? 'task' : 'discussion',
        startedAt,
        estimatedMs,
        lastUpdate: Date.now(),
      };
      dispatch({ type: 'SET_PROGRESS', progress });
    };
    const updateMemberPlan = (employeeId: string, status: 'acknowledged' | 'working' | 'submitted' | 'blocked') => {
      const currentTeam = getState().teams.find((item) => item.id === teamId);
      if (!currentTeam?.memberPlans?.length) return;
      dispatch({ type: 'UPDATE_TEAM', id: teamId, partial: {
        memberPlans: currentTeam.memberPlans.map((plan) => plan.employeeId === employeeId ? { ...plan, status, updatedAt: Date.now() } : plan),
      } });
    };
    updateProgress(0, undefined, undefined, undefined, undefined);

    dispatch({ type: 'SET_STATUS', partial: { demoRunning: true, activeDemoTeamId: teamId } });

    let stepCounter = 0;
    let liveRun = opts?.runId ? getState().taskRuns.find((item) => item.id === opts.runId) : undefined;
    let latestExecutionState: ExecutionControllerSnapshot | undefined = liveRun?.recoveryContext?.controller;
    const updateRun = (mutate: (run: TaskRun) => void) => {
      if (!liveRun) return;
      liveRun = updateTaskRun(liveRun, mutate);
      const projectedWorker = getState().taskRuns.find((item) => item.id === liveRun?.id)?.worker;
      const protectedWorkerState = projectedWorker?.state === 'paused' || projectedWorker?.state === 'stopped' || projectedWorker?.state === 'expired' || projectedWorker?.state === 'released';
      if (projectedWorker && (protectedWorkerState || (projectedWorker.heartbeatAt ?? 0) > (liveRun.worker?.heartbeatAt ?? 0))) {
        liveRun.worker = projectedWorker;
      }
      dispatch({ type: 'UPDATE_TASK_RUN', run: liveRun });
    };
    const recordAutonomousDecision = createTeamAutonomousDecisionRecorder({ getRun: () => liveRun, updateRun });
    const workerLease = createTeamWorkerLease({
      getRun: () => liveRun,
      acceptRun: (run, publish) => {
        liveRun = run;
        if (publish) dispatch({ type: 'UPDATE_TASK_RUN', run });
      },
    });
    const reportAdapterCheckpoint = workerLease.reportCheckpoint;
    const markRunExecuting = () => updateRun((run) => {
      run.status = 'running'; run.phase = 'executing'; run.lastError = undefined; run.executionSessionId = getExecutionSessionId();
      if (run.recoveryContext) {
        run.recoveryContext.summary = '任务正在执行，已完成内容会持续写入恢复记录。';
        run.recoveryContext.interruptedAt = undefined;
        run.recoveryContext.interruptionReason = undefined;
        run.recoveryContext.budget.updatedAt = Date.now();
      }
      run.preflight = (run.preflight ?? []).map((item) => item.label === '检查参与成员与模型'
        ? { ...item, status: 'passed', detail: '参与成员与模型配置已通过启动检查' }
        : item);
    });
    Promise.resolve().then(async () => {
      await workerLease.claim();
      markRunExecuting();
      const layeredMemory = await retrieveLayeredMemoryContext({
        query: opts?.userText || opts?.task?.title || '',
        projectId: liveRun?.projectId,
        taskId: liveRun?.id,
        conversationId,
        teamId,
        limit: 18,
      });
      if (layeredMemory.retrievalId && liveRun) updateRun((run) => {
        appendTaskRunContext(run, {
          type: 'history', source: 'system', verified: true,
          summary: `本轮团队讨论引用 ${layeredMemory.references?.length ?? 0} 条记忆事实。`,
          data: { retrievalId: layeredMemory.retrievalId, references: layeredMemory.references },
        });
      });
      const layeredMemoryContext = layeredMemory.ok ? layeredMemory.context ?? '' : '';
      return runTeamDiscussion(
      conversationTeam,
      getState().employees,
      { ...(opts ?? {}), extraSystemContext: [opts?.extraSystemContext, layeredMemoryContext].filter(Boolean).join('\n\n'), initialExecutionState: liveRun?.recoveryContext?.controller },
      {
        onExecutionState(controller, emp, stepId) {
          latestExecutionState = controller;
          const statusText = executionControllerStatus(controller);
          if (emp) {
            dispatch({ type: 'UPDATE_EMPLOYEE', id: emp.id, partial: { isWorking: controller.status === 'running', currentTask: statusText } });
            updateMemberPlan(emp.id, controller.status === 'running' ? 'working' : controller.status === 'blocked' || controller.status === 'awaiting_user' ? 'blocked' : 'acknowledged');
          }
          updateRun((run) => {
            if (!run.recoveryContext) return;
            run.recoveryContext.controller = controller;
            run.recoveryContext.summary = statusText;
            run.recoveryContext.budget.toolAttempts = controller.attemptCount;
            run.recoveryContext.budget.updatedAt = Date.now();
            const step = run.steps.find((item) => item.id === stepId);
            if (step && step.events.at(-1)?.detail !== statusText) {
              step.events.push({ ts: Date.now(), type: controller.status === 'blocked' || controller.status === 'awaiting_user' ? 'error' : 'status', detail: statusText });
            }
          });
        },
        onAutonomousDecision(emp, stepId, toolName) {
          return recordAutonomousDecision(emp.id, stepId, toolName);
        },
        onMessage(emp, content, mentions, tokens, discussionRound, inReplyToMessageId, stepId, contextUsage) {
          stepCounter += 1;
          const s = client.loadSettings();
          updateProgress(stepCounter, emp.id, emp.name, emp.role, s.model ?? undefined);
          const msg: ChatMessage = {
            id: `msg-ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            authorId: emp.id,
            roleId: emp.role,
            content,
            mentions,
            timestamp: Date.now(),
            kind: 'text',
            tokens,
            contextUsage,
            discussionId: opts?.discussionId,
            discussionRound,
            triggeredBy: opts?.task ? 'task' : 'message',
            inReplyToMessageId,
            conversationId,
          };
          const stepSnapshot = stepId ? liveRun?.steps.find((item) => item.id === stepId) : undefined;
          const toolEvents = stepSnapshot?.events
            .filter((event) => event.type === 'tool')
            .slice(-8) ?? [];
          const executionSummary: ChatMessage | undefined = toolEvents.length > 0
            ? {
              id: `msg-execution-summary-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              authorId: emp.id,
              authorName: emp.name,
              roleId: emp.role,
              content: `执行过程 · ${emp.name} · ${stepSnapshot?.title ?? '当前步骤'} · ${toolEvents.length} 项工具动作\n${toolEvents.map((event) => `- ${cleanExecutionDisplay(event.detail, 320)}`).join('\n')}`,
              mentions: [], timestamp: Date.now(), kind: 'execution', discussionId: opts?.discussionId, conversationId,
            }
            : undefined;
          // Keep the chat readable: one expandable summary per completed step.
          // Full tool evidence remains in the task run and replay panels.
          let reportedStepId: string | undefined;
          let reportedStepStatus: 'completed' | 'failed' | undefined;
          updateRun((run) => {
            const step = run.steps.find((item) => item.id === stepId) ?? run.steps.find((item) => item.employeeId === emp.id && item.status === 'running');
            if (!step) return;
            const controllerCheckpointed = latestExecutionState?.status === 'checkpointed';
            const controllerFailed = latestExecutionState?.status === 'awaiting_user'
              || latestExecutionState?.status === 'blocked'
              || latestExecutionState?.status === 'stopped';
            const awaitingReviewDecision = step.kind === 'review' && !controllerFailed;
            step.status = controllerCheckpointed ? 'paused' : controllerFailed ? 'failed' : awaitingReviewDecision ? 'running' : 'completed';
            if (stepId && run.runner && !awaitingReviewDecision && !controllerCheckpointed) {
              run.runner = recordTaskStepResult(run.runner, {
                stepId,
                success: !controllerFailed,
                output: { summary: content.slice(0, 1200) },
                error: controllerFailed ? content : undefined,
              });
            }
            if (!awaitingReviewDecision && !controllerCheckpointed) step.completedAt = Date.now();
            if (controllerCheckpointed) {
              run.status = 'paused';
              run.phase = 'blocked';
              run.handoff = {
                ts: Date.now(),
                completed: run.steps.filter((item) => item.status === 'completed').map((item) => item.title),
                blocked: `${emp.name}：本轮达到容量检查点，已保存现有证据`,
                nextAction: '从保存的检查点继续，不重复已经留下证据的步骤。',
              };
            }
            if (step.status === 'failed') {
              step.lastError = content;
              run.phase = 'blocked';
              run.handoff = {
                ts: Date.now(),
                completed: run.steps.filter((item) => item.status === 'completed').map((item) => item.title),
                blocked: `${emp.name}：${content.slice(0, 240)}`,
                nextAction: '检查提示中的账号、模型或外部条件后点击继续执行。',
              };
            } else {
              const evidence = { ts: Date.now(), source: 'member' as const, summary: awaitingReviewDecision ? `${emp.name} 已返回审查说明，等待结构化结论` : `${emp.name} 完成：${content.slice(0, 220)}`, verified: false };
              step.evidence = [...(step.evidence ?? []), evidence].slice(-12);
              run.evidence = [...(run.evidence ?? []), evidence].slice(-40);
            }
            if (run.recoveryContext) {
              run.recoveryContext.summary = step.status === 'failed'
                ? `${emp.name} 的步骤被阻塞，等待处理后恢复。`
                : awaitingReviewDecision ? `${emp.name} 已完成检查，正在提交结构化审查结论。` : `${emp.name} 已完成“${step.title}”，继续执行后续步骤。`;
              if (step.status === 'failed') {
                run.recoveryContext.unresolvedIssues = [...run.recoveryContext.unresolvedIssues, content.slice(0, 320)].slice(-12);
              } else {
                run.recoveryContext.completedEvidence = [...run.recoveryContext.completedEvidence, `${emp.name}：${content.slice(0, 220)}`].slice(-20);
              }
              if (contextUsage) {
                run.recoveryContext.budget.promptTokens = contextUsage.promptTokens;
                run.recoveryContext.budget.contextWindowTokens = contextUsage.contextWindowTokens;
              }
              run.recoveryContext.budget.updatedAt = Date.now();
            }
            step.events.push({ ts: Date.now(), type: step.status === 'failed' ? 'error' : 'result', detail: content.slice(0, 360) });
            appendTaskRunContext(run, {
              type: step.status === 'failed' ? 'error' : 'progress', source: 'member', stepId,
              summary: `${emp.name}：${content.slice(0, 420)}`, verified: false,
            });
            if (step.kind !== 'review' && (step.status === 'completed' || step.status === 'failed')) {
              reportedStepId = step.id;
              reportedStepStatus = step.status;
            }
          });
          if (!stepId || (reportedStepId && reportedStepStatus)) {
            dispatch({ type: 'UPDATE_EMPLOYEE', id: emp.id, partial: { isWorking: false, currentTask: undefined } });
            updateMemberPlan(emp.id, reportedStepStatus === 'failed' ? 'blocked' : 'submitted');
            void reportAdapterCheckpoint({
              kind: reportedStepStatus === 'failed' ? 'step_failed' : 'step_completed',
              stepId: reportedStepId,
              summary: content.slice(0, 500),
            });
          }
          if (reportedStepId && reportedStepStatus && liveRun) {
            const completedStep = liveRun.steps.find((item) => item.id === reportedStepId);
            if (completedStep) {
              const summary = buildWorkStageSummary({ run: liveRun, step: completedStep, owner: emp, content, status: reportedStepStatus, employees: getState().employees });
              updateRun((run) => {
                run.stageSummaries = [...(run.stageSummaries ?? []).filter((item) => item.stepId !== completedStep.id), summary].slice(-80);
              });
              dispatch({
                type: 'APPEND_CHAT', teamId, conversationId,
                msgs: [{
                  id: `msg-${summary.id}`,
                  authorId: 'assistant', authorName: '章北海助理', roleId: 'custom',
                  content: `${emp.name}已完成阶段“${completedStep.title}”。${summary.nextAction}`,
                  mentions: summary.nextOwnerId ? [summary.nextOwnerId] : [], timestamp: summary.createdAt,
                  kind: 'stage_summary', stepId: completedStep.id, stageSummary: summary,
                  discussionId: opts?.discussionId, triggeredBy: 'task', conversationId,
                }],
              });
              if (liveRun.projectId) void appendProjectEvent(liveRun.projectId, { type: 'stage_summary', projectId: liveRun.projectId, taskId: liveRun.id, stepId: completedStep.id, status: summary.status, completed: summary.completed, evidence: summary.evidence, remaining: summary.remaining, nextAction: summary.nextAction });
            }
          } else if (stepSnapshot?.kind !== 'review') {
            dispatch({ type: 'APPEND_CHAT', teamId, msgs: executionSummary ? [executionSummary, msg] : [msg], conversationId });
          }
        },
        onSteeringReply(emp, content, tokens, contextUsage, stepId) {
          dispatch({
            type: 'APPEND_CHAT', teamId, conversationId,
            msgs: [{
              id: `msg-steering-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              authorId: emp.id, roleId: emp.role, content, mentions: [], timestamp: Date.now(), kind: 'text',
              tokens, contextUsage, discussionId: opts?.discussionId, triggeredBy: 'message', conversationId,
            }],
          });
          updateRun((run) => {
            const step = run.steps.find((item) => item.id === stepId);
            if (step) step.events.push({ ts: Date.now(), type: 'status', detail: `已回应运行中新增要求：${content.slice(0, 220)}` });
          });
        },
        onTextDelta(emp, accumulated, stepId) {
          dispatch({ type: 'UPDATE_EMPLOYEE', id: emp.id, partial: { isWorking: true, currentTask: '正在生成回复' } });
          updateRun((run) => {
            const step = run.steps.find((item) => item.id === stepId)
              ?? run.steps.find((item) => item.employeeId === emp.id && item.status === 'running');
            if (!step) return;
            const detail = `正在生成回复：${accumulated.slice(-900)}`;
            const last = step.events.at(-1);
            if (last?.type === 'status' && last.detail.startsWith('正在生成回复：')) last.detail = detail;
            else step.events.push({ ts: Date.now(), type: 'status', detail });
          });
        },
        onTaskAdvance(taskId, lane) {
          dispatch({ type: 'ADVANCE_TASK', teamId, taskId, lane });
        },
        onToolCall(emp, toolName, toolArgs, result, stepId, success, protocolEvidence, structuredEvidence) {
          recordTeamToolEvidence({ dispatch, updateRun, employee: emp, toolName, toolArgs, result, stepId, success, protocolEvidence, structuredEvidence });
        },
        onStatus(statusText) {
          const emp = getState().employees.find((employee) => statusText.startsWith(employee.name));
          if (emp) {
            updateProgress(Math.min(totalSteps, stepCounter + 1), emp.id, emp.name, emp.role);
            dispatch({ type: 'UPDATE_EMPLOYEE', id: emp.id, partial: { isWorking: true } });
          }
        },
        onStepStart(stepId, emp) {
          updateProgress(Math.min(totalSteps, stepCounter + 1), emp.id, emp.name, emp.role, client.getEmployeeModel(emp).model);
          dispatch({ type: 'UPDATE_EMPLOYEE', id: emp.id, partial: { isWorking: true } });
          updateMemberPlan(emp.id, 'working');
          updateRun((run) => {
            if (run.runner) {
              try { run.runner = beginTaskStep(run.runner, stepId); } catch (error) {
                run.lastError = error instanceof Error ? error.message : String(error);
              }
            }
            const step = run.steps.find((item) => item.id === stepId);
            if (step) {
              step.status = 'running'; step.startedAt = Date.now(); step.attempts += 1;
              step.events.push({ ts: Date.now(), type: 'status', detail: `开始第 ${step.order} 步：${step.assignment}` });
            }
            appendTaskRunContext(run, { type: 'progress', source: 'system', stepId, summary: `${emp.name} 开始执行第 ${step?.order ?? '?'} 步：${step?.assignment ?? '未命名步骤'}` });
            if (run.recoveryContext) {
              run.recoveryContext.summary = `${emp.name} 正在执行“${step?.title ?? '当前步骤'}”。`;
              run.recoveryContext.budget.updatedAt = Date.now();
            }
          });
          void reportAdapterCheckpoint({ kind: 'step_started', stepId, summary: `${emp.name} 开始执行步骤` });
        },
        onStepAdded(step) {
          totalSteps += 1;
          updateRun((run) => {
            if (run.steps.some((item) => item.id === step.id)) return;
            run.steps.push({ ...step, status: 'queued', attempts: 0, events: [{ ts: Date.now(), type: 'status', detail: '审查退回后新增步骤' }] });
            if (run.runner) {
              run.runner = appendTaskRunnerSteps(run.runner, [formalPlanStepForRun(run.id, step)], `审查退回后新增“${step.title}”`);
              run.plan = run.runner.plan;
            }
            run.revisionCount = (run.revisionCount ?? 0) + (step.kind === 'revision' ? 1 : 0);
          });
        },
        onReviewDecision(stepId, approved, reason, responsibleEmployeeId, responsibleStepId, review) {
          updateRun((run) => {
            const step = run.steps.find((item) => item.id === stepId);
            if (!step) return;
            step.status = 'completed';
            step.completedAt = Date.now();
            step.reviewDecision = approved ? 'pass' : 'reject';
            step.reviewReason = reason;
            step.responsibleEmployeeId = responsibleEmployeeId;
            step.events.push({ ts: Date.now(), type: approved ? 'result' : 'error', detail: approved ? '审查通过' : `审查退回：${reason ?? '未说明原因'}` });
            const evidence = { ts: Date.now(), source: 'review' as const, kind: 'review' as const, summary: approved ? `审查通过：${reason ?? '符合验收要求'}` : `审查退回：${reason ?? '需要修改'}`, verified: approved };
            step.evidence = [...(step.evidence ?? []), evidence].slice(-12);
            run.evidence = [...(run.evidence ?? []), evidence].slice(-40);
            if (run.runner) {
              run.runner = recordTaskReviewDecision(run.runner, {
                stepId, approved, reason, responsibleEmployeeId, responsibleStepId,
                checkedArtifacts: review?.checkedArtifacts,
              });
              run.plan = run.runner.plan;
            }
            appendTaskRunContext(run, { type: approved ? 'resolved' : 'blocked', source: 'review', stepId, summary: evidence.summary, verified: approved });
          });
          const reviewStep = liveRun?.steps.find((item) => item.id === stepId);
          if (liveRun && reviewStep) {
            const summary = buildReviewStageSummary({
              run: liveRun, step: reviewStep, approved, reason, responsibleEmployeeId, responsibleStepId,
              checkedArtifacts: review?.checkedArtifacts, employees: getState().employees,
            });
            updateRun((run) => {
              run.stageSummaries = [...(run.stageSummaries ?? []).filter((item) => item.stepId !== stepId), summary].slice(-80);
            });
            dispatch({
              type: 'APPEND_CHAT', teamId, conversationId,
              msgs: [{
                id: `msg-${summary.id}`, authorId: 'assistant', authorName: '章北海助理', roleId: 'custom',
                content: `${summary.ownerName}已完成“${summary.stageTitle}”。${summary.nextAction}`,
                mentions: summary.nextOwnerId ? [summary.nextOwnerId] : [], timestamp: summary.createdAt,
                kind: 'stage_summary', stepId, stageSummary: summary,
                discussionId: opts?.discussionId, triggeredBy: 'task', conversationId,
              }],
            });
            if (liveRun.projectId) void appendProjectEvent(liveRun.projectId, { type: 'review_summary', projectId: liveRun.projectId, taskId: liveRun.id, stepId, status: summary.status, evidence: summary.evidence, nextAction: summary.nextAction });
          }
          void reportAdapterCheckpoint({
            kind: 'step_completed',
            stepId,
            summary: approved ? `审查通过：${reason ?? '符合验收要求'}` : `审查已完成并退回：${reason ?? '需要修改'}`,
          });
        },
        onRunFailed(error) {
          updateRun((run) => {
            run.status = 'failed'; run.phase = 'blocked'; run.lastError = error;
            run.handoff = {
              ts: Date.now(),
              completed: run.steps.filter((step) => step.status === 'completed').map((step) => step.title),
              blocked: error.slice(0, 320),
              nextAction: '处理阻塞提示后点击“继续执行”，太极会保留已经完成的步骤。',
            };
            if (run.recoveryContext) {
              run.recoveryContext.summary = '任务遇到阻塞，已保存当前上下文。';
              run.recoveryContext.unresolvedIssues = [...run.recoveryContext.unresolvedIssues, error.slice(0, 320)].slice(-12);
              run.recoveryContext.budget.updatedAt = Date.now();
            }
            const activeReview = [...run.steps].reverse().find((step) => step.kind === 'review' && step.reviewDecision === 'reject');
            if (activeReview) { activeReview.status = 'failed'; activeReview.lastError = error; }
            appendTaskRunContext(run, { type: 'blocked', source: 'system', summary: error.slice(0, 420), verified: false });
          });
          void reportAdapterCheckpoint({ kind: 'run_failed', summary: error.slice(0, 700) });
        },
        onRunCheckpointed(reason) {
          updateRun((run) => {
            run.status = 'paused'; run.phase = 'blocked'; run.lastError = undefined;
            run.handoff = {
              ts: Date.now(),
              completed: run.steps.filter((step) => step.status === 'completed').map((step) => step.title),
              blocked: reason.slice(0, 320),
              nextAction: '任务现场已保存，不是失败；从恢复点继续时只处理未完成的验收项。',
            };
            if (run.recoveryContext) {
              run.recoveryContext.summary = '任务达到容量检查点，现场已保存。';
              run.recoveryContext.interruptionReason = reason.slice(0, 320);
              run.recoveryContext.autoResume = false;
              run.recoveryContext.budget.updatedAt = Date.now();
            }
            appendTaskRunContext(run, { type: 'checkpoint', source: 'system', summary: reason.slice(0, 420), verified: true });
          });
        },
        onDone() {
          dispatch({ type: 'SET_PROGRESS', progress: null });
          dispatch({ type: 'SET_STATUS', partial: { demoRunning: false, activeDemoTeamId: undefined } });
          for (const memberId of team.memberIds) {
            dispatch({ type: 'UPDATE_EMPLOYEE', id: memberId, partial: { isWorking: false } });
          }
          let completionSummary: NonNullable<TaskRun['completionSummary']> | undefined;
          let shouldPublishSummary = false;
          updateRun((run) => {
            finalizeTeamRun(run, pausedRunIds.has(run.id), stoppedRunIds.has(run.id));
            if (!run.completionSummary || run.completionSummary.status !== run.status) {
              completionSummary = buildRunCompletionSummary(run);
              run.completionSummary = completionSummary;
              shouldPublishSummary = true;
            } else {
              completionSummary = run.completionSummary;
            }
          });
          if (liveRun && completionSummary && shouldPublishSummary) {
            const summary = completionSummary;
            const lines = [
              `阶段汇报：任务“${liveRun.title}”已进入${summary.status === 'completed' ? '完成' : summary.status === 'paused' ? '暂停' : summary.status === 'stopped' ? '停止' : '阻塞'}状态。`,
              `已完成：${summary.completed.length ? summary.completed.join('、') : '暂无可确认完成的步骤'}`,
              `尚未完成：${summary.unfinished.length ? summary.unfinished.join('、') : '无'}`,
              `证据：${summary.evidence.length ? summary.evidence.join('；') : '暂无已验证证据'}`,
              summary.blockers.length ? `阻塞：${summary.blockers.join('；')}` : '阻塞：无',
              `下一步：${summary.nextAction}`,
            ].join('\n');
            dispatch({ type: 'APPEND_CHAT', teamId, conversationId, msgs: [{
              id: `msg-run-summary-${liveRun.id}-${summary.publishedAt}`,
              authorId: 'assistant', authorName: '章北海助理', roleId: 'custom', content: lines,
              mentions: [], timestamp: summary.publishedAt, kind: 'text', triggeredBy: 'task', conversationId,
            }] });
            if (liveRun.projectId) void appendProjectEvent(liveRun.projectId, {
              type: 'run_summary', projectId: liveRun.projectId, taskId: liveRun.id, status: summary.status,
              completed: summary.completed, unfinished: summary.unfinished, evidence: summary.evidence,
              blockers: summary.blockers, nextAction: summary.nextAction,
            });
          }
          if (liveRun) void reportAdapterCheckpoint({
            kind: 'run_finished',
            finalStatus: liveRun.status,
            summary: liveRun.status === 'completed' ? '执行适配器已完成并通过验收' : (liveRun.lastError || `任务状态：${liveRun.status}`),
          });
        },
      }, {
        shouldStop: () => !!opts?.runId && (pausedRunIds.has(opts.runId) || stoppedRunIds.has(opts.runId)),
        consumeSteeringMessages: () => {
          const scheduler = schedulers.get(teamId);
          const messages = scheduler?.steering?.splice(0) ?? [];
          if (messages.length) updateRun((run) => {
            if (!run.recoveryContext) return;
            run.recoveryContext.steeringMessages = [...run.recoveryContext.steeringMessages, ...messages.map((message) => message.slice(0, 500))].slice(-12);
            run.recoveryContext.summary = '已收到运行中新增要求，正在结合当前进度调整。';
            run.recoveryContext.budget.updatedAt = Date.now();
          });
          return messages;
        },
        getModelRequestSignal: () => {
          const scheduler = schedulers.get(teamId);
          if (!scheduler) return new AbortController().signal;
          if (!scheduler.modelRequestController || scheduler.modelRequestController.signal.aborted) scheduler.modelRequestController = new AbortController();
          return scheduler.modelRequestController.signal;
        },
      }
    );
    }).catch((error) => {
      updateRun((run) => { run.status = 'failed'; run.lastError = error instanceof Error ? error.message : String(error); });
    }).finally(async () => {
      const shouldReleaseWorker = !!liveRun && !pausedRunIds.has(liveRun.id) && !stoppedRunIds.has(liveRun.id);
      const adapterCheckpointError = await workerLease.close(shouldReleaseWorker);
      if (adapterCheckpointError) updateRun((run) => {
        run.status = 'failed';
        run.phase = 'blocked';
        run.lastError = `后台执行检查点写入失败：${adapterCheckpointError}`;
        run.handoff = {
          ts: Date.now(),
          completed: run.steps.filter((step) => step.status === 'completed').map((step) => step.title),
          blocked: run.lastError,
          nextAction: '保留当前窗口与工作区，检查任务账本后点击“继续执行”。',
        };
        appendTaskRunContext(run, { type: 'blocked', source: 'system', summary: run.lastError, verified: false });
      });
      for (const memberId of team.memberIds) {
        dispatch({ type: 'UPDATE_EMPLOYEE', id: memberId, partial: { isWorking: false } });
      }
      discussing.delete(teamId);
      const scheduler = schedulers.get(teamId);
      if (scheduler) {
        scheduler.modelRequestController?.abort();
        scheduler.modelRequestController = undefined;
        const completedKey = opts?.discussionId ?? opts?.triggerMessageId ?? opts?.task?.id;
        if (completedKey) scheduler.keys.delete(completedKey);
        scheduler.running = false;
        const queued = scheduler.queued;
        scheduler.queued = undefined;
        if (queued) {
          scheduler.lastStartedAt = Date.now();
          scheduler.running = runDiscussion(teamId, queued);
        }
      }
      dispatch({ type: 'SET_PROGRESS', progress: null });
      dispatch({ type: 'SET_STATUS', partial: { demoRunning: false, activeDemoTeamId: undefined } });
    });
    return true;
  };


  return runDiscussion;
}
