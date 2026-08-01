const crypto = require('crypto');
const path = require('path');
const { createExecutionObservability } = require('./executionObservability.cjs');
const { projectNativeJob } = require('./nativeExecutionProjection.cjs');
const { createNativeCollaborationProtocol } = require('./nativeCollaborationProtocol.cjs');
const { pathToFileURL } = require('url');
const { ADAPTER_PROTOCOL_VERSION } = require('./executionAdapterProtocol.cjs');
const {
  ROLE_DUTY,
  toolKey,
  isPreparationTool,
  isVerifiedArtifact,
  inferStepDeliverableType,
  compensationNeedsApproval,
  summarizeChildTask,
  buildChildTaskContext,
  buildInheritedTaskContext,
  resolveEndpoint,
  modelName,
  publicMember,
} = require('./nativeExecutionPolicy.cjs');

const NATIVE_ADAPTER_VERSION = 2;
const MAX_TOOL_CALLS_PER_STEP = 24;
const MAX_MODEL_ROUNDS_PER_STEP = 12;
const MODEL_ROUNDS_PER_STAGE = 6;
const MAX_PREPARATION_STREAK = 4;
const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 120_000;
const DEFAULT_PROGRESS_STALL_MS = 150_000;
const ACTIVE_JOB_STATES = new Set(['queued', 'running', 'waiting_children']);

class ExecutionControlSignal extends Error {
  constructor(kind, message) { super(message || kind); this.name = 'ExecutionControlSignal'; this.kind = kind; }
}

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function text(value, limit = 12000) { return String(value ?? '').trim().slice(0, limit); }
function safeJob(job) { return projectNativeJob(job, NATIVE_ADAPTER_VERSION); }

function createNativeExecutionAdapter(options) {
  const jobs = new Map();
  const queue = [];
  const observability = options.observability || createExecutionObservability();
  const diagnostics = options.diagnostics;
  let drainingQueue = false;
  let activeJob;
  const projectRoot = path.resolve(options.projectRoot);
  const retryDelays = options.retryDelays ?? [0, 1000, 3000, 6000, 10000];
  const modelRequestTimeoutMs = Math.max(100, Number(options.modelRequestTimeoutMs) || DEFAULT_MODEL_REQUEST_TIMEOUT_MS);
  const toolCallTimeoutMs = Math.max(100, Number(options.toolCallTimeoutMs) || DEFAULT_TOOL_CALL_TIMEOUT_MS);
  const progressStallMs = Math.max(modelRequestTimeoutMs + 5_000, Number(options.progressStallMs) || DEFAULT_PROGRESS_STALL_MS);
  let engineModulesPromise;

  function refreshQueuePositions() {
    queue.forEach((job, index) => { job.queuePosition = index + 1; });
  }

  function enqueueJob(job, reason = 'queued') {
    if (job.state === 'completed' || job.state === 'failed' || job.state === 'stopped') return;
    if (!queue.includes(job)) queue.push(job);
    job.state = 'queued';
    refreshQueuePositions();
    void updateRun(job.taskId, (run) => {
      if (run.status !== 'queued') return;
      run.status = 'queued';
      run.phase = 'preflight';
      run.queuePosition = job.queuePosition;
      if (run.recoveryContext) {
        run.recoveryContext.summary = `任务正在后台队列中等待执行，前面还有 ${Math.max(0, (job.queuePosition || 1) - 1)} 项任务。`;
        run.recoveryContext.autoResume = true;
      }
    }, '原生 Adapter 更新后台排队位置').catch(() => {});
    emit(job, 'job_queued', { reason, queuePosition: job.queuePosition });
    void drainQueue();
  }

  function enqueueCompensation(job, reason) {
    if (!job || job.compensationQueued === true || job.compensating === true) return;
    job.compensationQueued = true;
    job.compensationReason = text(reason, 1200) || '任务已停止，需要处理已声明补偿';
    job.state = 'compensating_queue';
    if (!queue.includes(job)) queue.push(job);
    refreshQueuePositions();
    emit(job, 'compensation_queued', { reason: job.compensationReason, queuePosition: job.queuePosition });
    void drainQueue();
  }

  async function drainQueue() {
    if (drainingQueue) return;
    drainingQueue = true;
    try {
      while (queue.length) {
        const job = queue.shift();
        refreshQueuePositions();
        if (!job || !['queued', 'compensating_queue'].includes(job.state)) continue;
        job.queuePosition = undefined;
        activeJob = job;
        try {
          if (job.state === 'compensating_queue') {
            await runCompensations(job, job.compensationReason);
            job.compensationQueued = false;
            job.state = 'stopped';
            job.finishedAt = Date.now();
            emit(job, 'queued_task_compensation_finished', { reason: job.compensationReason });
          } else await execute(job);
        }
        finally { activeJob = undefined; }
        if (job.requeueAfterExecution) {
          job.requeueAfterExecution = false;
          enqueueJob(job, 'steering-preempted');
        }
      }
    } finally {
      drainingQueue = false;
      if (queue.length) void drainQueue();
    }
  }

  function emit(job, type, detail = {}) {
    job.updatedAt = Date.now();
    job.lastProgressAt = job.updatedAt;
    job.eventSequence += 1;
    const event = {
      protocolVersion: NATIVE_ADAPTER_VERSION,
      sequence: job.eventSequence,
      eventId: `native-event-${job.taskId}-${job.eventSequence}`,
      occurredAt: job.updatedAt,
      taskId: job.taskId,
      jobId: job.jobId,
      type,
      ...detail,
      job: safeJob(job),
    };
    job.events.push(event);
    if (job.events.length > 500) job.events.splice(0, job.events.length - 500);
    observability.record(event);
    if (detail.success === false || /failed|stalled|timeout|error/u.test(type)) {
      void diagnostics?.record({
        scope: 'native-execution-adapter', operation: type, taskId: job.taskId,
        teamId: detail.teamId, message: detail.error || job.lastError || type,
        errorCode: detail.errorCode, failureClass: detail.failureClass,
        context: { stepId: detail.stepId, toolName: detail.toolName, member: detail.member, activity: job.currentActivity },
      });
    }
    try { options.onChanged?.(clone(event)); } catch {}
    return event;
  }

  async function reportActivity(job, type, activity, detail = {}) {
    const value = text(activity, 500) || '后台任务正在推进';
    job.currentActivity = value;
    const event = emit(job, type, { ...detail, activity: value });
    const { turnLifecycle } = await loadEngineModules();
    await updateRun(job.taskId, (run) => {
      if (run.worker) {
        run.worker.progressAt = event.occurredAt;
        run.worker.activity = value;
      }
      const step = run.steps?.find((item) => item.id === job.currentStepId);
      if (step) {
        step.events ||= [];
        if (step.events.at(-1)?.detail !== value) {
          step.events.push({ ts: event.occurredAt, type: 'status', detail: value });
          if (step.events.length > 120) step.events = step.events.slice(-120);
        }
      }
      if (run.recoveryContext) run.recoveryContext.summary = value;
      run.turnLifecycle = turnLifecycle.recordLifecycleProgress(
        turnLifecycle.restoreTurnLifecycle(run.turnLifecycle, {
          taskId: run.id,
          conversationId: run.conversationId,
          scope: `team:${run.teamId}`,
          goal: run.goal || run.request,
          deliverableType: run.contract?.deliverableType,
        }),
        {
          type,
          phase: run.phase || 'executing',
          activity: value,
          detail: { stepId: detail.stepId, toolName: detail.toolName, attempt: detail.attempt },
          at: event.occurredAt,
        },
      );
      run.lifecycleRecovery = turnLifecycle.createLifecycleRecoveryCapsule(run.turnLifecycle);
    }, `原生 Adapter 进展：${value}`).catch(() => {});
    return event;
  }

  function timeoutPromise(ms, message, onTimeout) {
    let timer;
    const promise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { onTimeout?.(); } catch {}
        const error = new Error(message);
        error.code = 'TAIJI_OPERATION_TIMEOUT';
        error.retryable = true;
        reject(error);
      }, ms);
    });
    return { promise, clear: () => clearTimeout(timer) };
  }

  async function loadEngineModules() {
    if (!engineModulesPromise) {
      engineModulesPromise = Promise.all([
        import(pathToFileURL(path.join(projectRoot, 'src/engine/taskFidelity.mjs')).href),
        import(pathToFileURL(path.join(projectRoot, 'src/engine/taskRunner.mjs')).href),
        import(pathToFileURL(path.join(projectRoot, 'src/engine/toolRegistry.mjs')).href),
        import(pathToFileURL(path.join(projectRoot, 'src/engine/taskContextRouter.mjs')).href),
        import(pathToFileURL(path.join(projectRoot, 'src/engine/taskDelegation.mjs')).href),
        import(pathToFileURL(path.join(projectRoot, 'src/engine/teamExecutionProtocol.mjs')).href),
        import(pathToFileURL(path.join(projectRoot, 'src/engine/turnRuntime.mjs')).href),
        import(pathToFileURL(path.join(projectRoot, 'src/engine/turnLifecycle.mjs')).href),
        import(pathToFileURL(path.join(projectRoot, 'src/engine/moaRuntime.mjs')).href),
        import(pathToFileURL(path.join(projectRoot, 'src/engine/capabilityGraph.mjs')).href),
        import(pathToFileURL(path.join(projectRoot, 'src/engine/explicitResourceContract.mjs')).href),
      ]).then(([fidelity, runner, toolRegistry, contextRouter, taskDelegation, teamExecutionProtocol, turnRuntime, turnLifecycle, moaRuntime, capabilityGraph, explicitResource]) => ({
        fidelity, runner, toolRegistry, contextRouter, taskDelegation, teamExecutionProtocol, turnRuntime, turnLifecycle, moaRuntime, capabilityGraph, explicitResource,
      }));
    }
    return engineModulesPromise;
  }

  async function ensureRun(input) {
    const snapshot = await options.store.read();
    if (!snapshot.ok) throw new Error(snapshot.error || '无法读取任务投影');
    const existing = snapshot.runs.find((run) => run.id === input.taskId);
    if (existing) return existing;
    if (!input.run || input.run.id !== input.taskId) throw new Error('主进程没有找到待执行任务');
    const written = await options.store.write([...snapshot.runs, clone(input.run)], {
      source: 'native-execution-adapter', sessionId: options.sessionId, detail: '原生 Adapter 已接收任务定义',
    });
    if (!written.ok) throw new Error(written.error || '任务入库失败');
    const refreshed = await options.store.read();
    if (!refreshed.ok) throw new Error(refreshed.error || '任务入库后读取失败');
    const stored = refreshed.runs.find((run) => run.id === input.taskId);
    if (!stored) throw new Error('任务入库后没有出现在主进程投影中');
    return stored;
  }

  async function readRun(taskId) {
    const snapshot = await options.store.read();
    if (!snapshot.ok) throw new Error(snapshot.error || '无法读取任务');
    return snapshot.runs.find((run) => run.id === taskId);
  }

  async function updateRun(taskId, mutate, detail) {
    const result = await options.store.updateTask(taskId, mutate, {
      source: 'native-execution-adapter', sessionId: options.sessionId, detail,
    });
    if (!result.ok) {
      const error = new Error(result.error || '任务投影更新失败');
      void diagnostics?.record({ scope: 'native-execution-adapter', operation: 'update-run', taskId, message: error.message, error, context: { detail } });
      throw error;
    }
    return result.run;
  }

  const collaboration = createNativeCollaborationProtocol({
    updateRun,
    readRun,
    emit,
    loadEngineModules,
    toolRuntime: options.toolRuntime,
    taskService: options.taskService,
    jobs,
    enqueueJob,
    safeJob,
  });
  const { recordTool, requestToolApproval, appendStageSummary, decideApproval } = collaboration;

  async function assertCanContinue(job) {
    if (!job.compensating && job.control === 'stop') throw new ExecutionControlSignal('stop', '任务已停止');
    if (!job.compensating && job.control === 'pause') throw new ExecutionControlSignal('pause', '任务已暂停');
    if (!job.compensating && job.control === 'stall') throw new ExecutionControlSignal('stall', job.lastError || '任务长时间没有产生新进展，已安全暂停。');
    const run = await readRun(job.taskId);
    if (!run) throw new ExecutionControlSignal('close', '任务已关闭');
    if (!job.compensating && run.status === 'stopped') throw new ExecutionControlSignal('stop', '任务已停止');
    if (!job.compensating && run.status === 'paused') throw new ExecutionControlSignal('pause', '任务已暂停');
    return run;
  }

  async function checkpoint(job, checkpointInput) {
    job.checkpointSequence += 1;
    const result = await options.worker.dispatch({
      commandId: `native-checkpoint-${job.taskId}-${job.checkpointSequence}`,
      taskId: job.taskId,
      type: 'checkpoint',
      requestedBy: 'main-native-execution-adapter',
      sessionId: options.sessionId,
      payload: {
        leaseId: job.leaseId,
        checkpoint: {
          protocolVersion: ADAPTER_PROTOCOL_VERSION,
          checkpointId: `native-${job.taskId}-${job.checkpointSequence}`,
          sequence: job.checkpointSequence,
          occurredAt: Date.now(),
          ...checkpointInput,
        },
      },
    });
    if (!result.ok) throw new Error(result.error || `检查点 #${job.checkpointSequence} 写入失败`);
    return result.run;
  }

  async function claim(job) {
    job.claimSequence = (job.claimSequence || 0) + 1;
    const result = await options.worker.dispatch({
      commandId: `native-claim-${job.jobId}-${job.claimSequence}`,
      taskId: job.taskId,
      type: 'claim',
      requestedBy: 'main-native-execution-adapter',
      sessionId: options.sessionId,
      payload: {
        adapter: 'main-native-execution-adapter', adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION, jobId: job.jobId,
        progressAt: job.lastProgressAt, activity: job.currentActivity,
      },
    });
    if (!result.ok || !result.run?.worker?.leaseId) throw new Error(result.error || '原生 Adapter 无法领取 Worker 租约');
    job.leaseId = result.run.worker.leaseId;
    job.checkpointSequence = Number(result.run.worker.checkpointSequence) || 0;
    job.heartbeat = setInterval(() => {
      if (!job.leaseId || job.state !== 'running') return;
      const silentFor = Date.now() - Number(job.lastProgressAt || job.startedAt || job.createdAt || Date.now());
      if (silentFor >= progressStallMs) {
        job.lastError = `当前动作超过 ${Math.ceil(progressStallMs / 1000)} 秒没有产生新结果。系统已保留现场并暂停，避免继续空转。`;
        job.control = 'stall';
        job.abortController?.abort();
        emit(job, 'execution_stalled', { silentForMs: silentFor, activity: job.currentActivity, error: job.lastError });
        return;
      }
      void options.worker.dispatch({
        commandId: `native-heartbeat-${job.taskId}-${Date.now()}`,
        taskId: job.taskId, type: 'heartbeat', requestedBy: 'main-native-execution-adapter', sessionId: options.sessionId,
        payload: { leaseId: job.leaseId, progressAt: job.lastProgressAt, activity: job.currentActivity },
      }).then((heartbeat) => {
        if (!heartbeat.ok) { job.lastError = heartbeat.error; job.control = 'pause'; job.abortController?.abort(); }
      });
    }, 5000);
  }

  async function release(job) {
    if (job.heartbeat) clearInterval(job.heartbeat);
    job.heartbeat = undefined;
    if (!job.leaseId) return;
    await options.worker.dispatch({
      commandId: `native-release-${job.jobId}-${Date.now()}`, taskId: job.taskId, type: 'release',
      requestedBy: 'main-native-execution-adapter', sessionId: options.sessionId, payload: { leaseId: job.leaseId },
    });
    job.leaseId = undefined;
  }

  function buildSystem(run, step, member, job, runtimeGuidance = '', advisorGuidance = '') {
    const prior = (run.executionMessages || []).filter((message) => message.kind === 'text').slice(-8)
      .map((message) => `${message.authorName || message.authorId}：${text(message.content, 2000)}`).join('\n\n');
    const dependencies = run.steps.filter((item) => step.dependsOnStepIds.includes(item.id))
      .map((item) => `- ${item.title}：${item.events?.at(-1)?.detail || item.status}`).join('\n');
    const reviewTargets = step.kind === 'review' ? run.steps.filter((item) => item.status === 'completed' && item.kind !== 'review')
      .map((item) => `- 步骤 ${item.id}；员工 ${item.employeeId}；${item.title}`).join('\n') : '';
    return [
      member.prompt || `你是「${member.name}」，${member.title || '团队成员'}。`,
      member.soul,
      ROLE_DUTY[member.role] || ROLE_DUTY.custom,
      '你正在太极主进程原生执行 Adapter 中工作。必须自主判断、调用真实工具、读取结果、更换失败路线并核对验收条件。工具有返回值不等于目标完成。',
      '只在任务合同要求文件交付时使用 write_file 并校验磁盘文件；回答、连接、操作和决策任务使用各自对应的真实证据。审查步骤必须调用 submit_review。',
      runtimeGuidance,
      advisorGuidance,
      job.compensating ? '当前处于补偿阶段：只执行当前补偿责任以撤销或降低已发生副作用，留下真实工具证据；不要继续原任务或虚构补偿完成。' : '',
      `用户原始目标：\n${run.goal || run.request}`,
      `当前步骤：${step.title}\n责任：${step.assignment}`,
      dependencies && `前置步骤摘要：\n${dependencies}`,
      reviewTargets && `审查可退回的责任步骤：\n${reviewTargets}`,
      prior && `团队最近结构化交接：\n${prior}`,
      job.extraSystemContext,
      job.steering.length ? `用户运行中新增约束（必须与原目标合并）：\n${job.steering.join('\n')}` : '',
    ].filter(Boolean).join('\n\n').slice(0, 80000);
  }

  function buildUserTurn(run, step, job) {
    const prompt = `请直接执行当前步骤，不要只描述计划。\n\n老板原始要求：\n${run.request}\n\n当前责任：\n${step.assignment}`;
    const images = (job.attachments || []).filter((item) => item.kind === 'image' && item.dataUrl).slice(0, 8);
    if (!images.length) return { role: 'user', content: prompt };
    return { role: 'user', content: [{ type: 'text', text: prompt }, ...images.map((item) => ({ type: 'image_url', image_url: { url: item.dataUrl } }))] };
  }

  async function callModel(job, member, messages, tools) {
    const { turnRuntime } = await loadEngineModules();
    const config = member.modelConfig || {};
    const endpoint = resolveEndpoint(config);
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    let lastError;
    const recoveryAttempts = new Map();
    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
      await assertCanContinue(job);
      if (retryDelays[attempt]) await sleep(retryDelays[attempt]);
      const controller = new AbortController();
      job.abortController = controller;
      await reportActivity(job, 'model_request_started', `${member.name} 正在请求模型 ${modelName(config)}（第 ${attempt + 1} 次）`, {
        stepId: job.currentStepId, member: publicMember(member), attempt: attempt + 1, timeoutMs: modelRequestTimeoutMs,
      });
      const deadline = timeoutPromise(modelRequestTimeoutMs, `模型在 ${Math.ceil(modelRequestTimeoutMs / 1000)} 秒内没有返回`, () => controller.abort());
      try {
        const operation = (async () => {
          const response = await options.fetchImpl(endpoint, {
            method: 'POST', headers, signal: controller.signal,
            body: JSON.stringify({
              model: modelName(config),
              messages,
              ...(Array.isArray(tools) && tools.length ? { tools, tool_choice: 'auto' } : {}),
              stream: false,
            }),
          });
          const raw = await response.text();
          if (!response.ok) {
            const error = new Error(`模型 HTTP ${response.status}：${raw.slice(0, 1000)}`);
            error.retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
            throw error;
          }
          let data;
          try { data = JSON.parse(raw); } catch { throw new Error('模型返回了无效 JSON'); }
          const message = data?.choices?.[0]?.message;
          if (!message) throw new Error('模型没有返回可用消息');
          return { message, usage: data.usage || {}, model: data.model || modelName(config) };
        })();
        const result = await Promise.race([operation, deadline.promise]);
        await reportActivity(job, 'model_response_received', `${member.name} 已收到模型回复，正在检查下一步动作`, {
          stepId: job.currentStepId, member: publicMember(member), attempt: attempt + 1,
        });
        return result;
      } catch (error) {
        if (job.interruptReason === 'steer') {
          throw new ExecutionControlSignal('steer', '已收到新的要求，正在根据最新内容调整当前步骤。');
        }
        if (job.control) throw new ExecutionControlSignal(job.control, error?.message);
        lastError = error;
        const classified = turnRuntime.classifyExecutionError(error);
        const used = recoveryAttempts.get(classified.type) || 0;
        const limit = Number(turnRuntime.TAIJI_RECOVERY_LIMITS[classified.type] ?? 1);
        await reportActivity(job, 'model_retry', `${member.name} 的模型请求未成功，正在按恢复策略重试`, {
          stepId: job.currentStepId,
          attempt: used + 1,
          maxAttempts: limit + 1,
          errorType: classified.type,
          error: text(error?.message || error, 500),
        });
        if (error?.retryable === false || !classified.retryable || classified.needsUser || used >= limit) break;
        recoveryAttempts.set(classified.type, used + 1);
      } finally {
        deadline.clear();
        if (job.abortController === controller) job.abortController = undefined;
      }
    }
    throw lastError || new Error('模型请求失败');
  }

  function completeOutstandingToolMessages(messages, toolCalls, completedIds, reason) {
    for (const pendingCall of toolCalls) {
      const callId = String(pendingCall?.id || '');
      if (!callId || completedIds.has(callId)) continue;
      messages.push({
        role: 'tool',
        tool_call_id: callId,
        content: `未执行：同一批次中的前置动作已暂停。${text(reason, 500)}`,
      });
      completedIds.add(callId);
    }
  }

  function sanitizedRuntime(runtime) {
    const safe = clone(runtime);
    for (const evidence of safe?.evidence || []) evidence.arguments = options.toolRuntime.redact(evidence.arguments);
    for (const decision of safe?.decisions || []) {
      for (const call of decision.toolCalls || []) call.args = options.toolRuntime.redact(call.args);
    }
    return safe;
  }

  async function persistTurnRuntime(job, runtime, finalization, detail) {
    const safe = sanitizedRuntime(runtime);
    const { turnLifecycle } = await loadEngineModules();
    await updateRun(job.taskId, (next) => {
      next.turnRuntime = safe;
      if (finalization) next.turnFinalization = clone(finalization);
      next.turnLifecycle = turnLifecycle.synchronizeTurnLifecycle(next.turnLifecycle, safe, finalization, {
        taskId: next.id,
        conversationId: next.conversationId,
        scope: `team:${next.teamId}`,
        goal: next.goal || next.request,
        deliverableType: next.contract?.deliverableType,
        reason: finalization?.status,
      });
      next.lifecycleRecovery = turnLifecycle.createLifecycleRecoveryCapsule(next.turnLifecycle);
      if (next.recoveryContext) {
        next.recoveryContext.summary = finalization?.summary
          || `Turn Runtime 已记录 ${safe.round} 轮决策和 ${safe.evidence.length} 条结构化证据。`;
      }
    }, detail);
  }

  async function persistControlledLifecycle(job, status, reason) {
    const { turnLifecycle } = await loadEngineModules();
    await updateRun(job.taskId, (run) => {
      const current = turnLifecycle.restoreTurnLifecycle(run.turnLifecycle, {
        taskId: run.id,
        conversationId: run.conversationId,
        scope: `team:${run.teamId}`,
        goal: run.goal || run.request,
        deliverableType: run.contract?.deliverableType,
      });
      run.turnLifecycle = turnLifecycle.finalizeTurnLifecycle(current, {
        status,
        summary: reason,
        waitingFor: status === 'waiting_user' ? reason : '',
        reason,
      });
      run.lifecycleRecovery = turnLifecycle.createLifecycleRecoveryCapsule(run.turnLifecycle, {
        reason,
        nextAction: run.turnLifecycle.recovery?.nextAction,
      });
    }, `原生 Adapter 保存 ${status} 生命周期`).catch(() => {});
  }

  async function consultStepAdvisors(job, run, step, actingMember, moaRuntime, currentEvidence) {
    const contract = run.contract || {};
    const advisors = [...job.members.values()].filter((member) => member.id !== actingMember.id && member.modelConfig?.apiHost).slice(0, 2);
    if (!moaRuntime.shouldConsultAdvisors({
      memberCount: job.members.size,
      riskLevel: contract.riskLevel,
      stepKind: step.kind,
      requiredCapabilities: contract.requiredCapabilities,
    }) || !advisors.length) return '';
    const messages = moaRuntime.buildAdvisorMessages({
      goal: run.goal || run.request,
      assignment: step.assignment,
      evidence: currentEvidence,
    });
    const results = [];
    for (const advisor of advisors) {
      try {
        const response = await callModel(job, advisor, messages, undefined);
        results.push({ label: advisor.name, content: response.message?.content, success: true });
      } catch (error) {
        results.push({ label: advisor.name, content: '', success: false, error: text(error?.message || error, 500) });
      }
    }
    const aggregate = moaRuntime.aggregateAdvisorGuidance(results);
    emit(job, 'moa_consulted', {
      stepId: step.id,
      advisorCount: aggregate.used,
      failedAdvisorCount: results.filter((item) => item.success === false).length,
    });
    return aggregate.guidance;
  }

  async function delegateSubtask(job, run, step, args) {
    const { runner, taskDelegation } = await loadEngineModules();
    const current = await readRun(job.taskId);
    if (!current) return { name: 'delegate_subtask', success: false, output: '找不到当前任务，无法创建子任务。' };
    try {
      const appended = taskDelegation.appendDelegation(current, {
        parentStepId: step.id,
        employeeId: args.employeeId,
        title: args.title,
        assignment: args.assignment,
        acceptanceCriteria: args.acceptanceCriteria,
        deliverableType: args.deliverableType,
      });
      const child = options.taskService
        ? await options.taskService.createChild(job.taskId, {
          employeeId: appended.delegation.employeeId,
          title: appended.delegation.title,
          assignment: appended.delegation.assignment,
          goal: appended.delegation.assignment,
          acceptanceCriteria: appended.delegation.acceptanceCriteria,
          deliverableType: appended.delegation.deliverableType,
        })
        : undefined;
      if (child?.task?.id && current.conversationId) {
        await updateRun(child.task.id, (next) => {
          next.conversationId = current.conversationId;
          next.teamId = current.teamId;
        }, `继承父任务 ${current.id} 的聊天会话`);
      }
      await updateRun(job.taskId, (next) => {
        next.delegations = appended.run.delegations;
        next.steps = appended.run.steps;
        if (child?.task?.id) {
          const delegation = next.delegations.find((item) => item.id === appended.delegation.id);
          if (delegation) delegation.childTaskId = child.task.id;
          const delegatedStep = next.steps.find((item) => item.id === appended.step.id);
          if (delegatedStep) {
            // The parent waits on this durable child-task node; it must not execute it itself.
            delegatedStep.childTaskId = child.task.id;
            delegatedStep.externalChild = true;
          }
        }
        if (next.runner) {
          try { next.runner = runner.appendTaskRunnerSteps(next.runner, [formalStep(next.id, appended.step)], `动态委派子任务：${appended.delegation.title}`); next.plan = next.runner.plan; } catch {}
        }
      }, `原生 Adapter 动态委派 ${appended.delegation.employeeName}`);
      const childStart = child?.task?.id
        ? await start({
          taskId: child.task.id,
          members: [...job.members.values()],
          attachments: job.attachments,
          extraSystemContext: `Parent task ${job.taskId}; delegated by ${appended.delegation.employeeName}.`,
          reviewModelConfig: job.reviewModelConfig,
          memoryWriteApproval: job.memoryWriteApproval,
          executionPolicy: job.executionPolicy,
          connectors: job.connectors,
          connectorTools: job.connectorTools,
        })
        : undefined;
      if (child && !childStart?.ok) throw new Error(childStart?.error || 'Child task could not enter the native execution queue');
      emit(job, 'subtask_delegated', { parentStepId: step.id, delegation: appended.delegation, childJob: childStart?.job });
      return {
        name: 'delegate_subtask', success: true,
        output: `已将“${appended.delegation.title}”委派给 ${appended.delegation.employeeName}。子任务会在当前步骤完成后进入队列，验收标准：${appended.delegation.acceptanceCriteria.join('；')}`,
        structuredEvidence: { delegation: { id: appended.delegation.id, delegatedStepId: appended.delegation.delegatedStepId, childTaskId: child?.task?.id } },
      };
    } catch (error) {
      return { name: 'delegate_subtask', success: false, output: `无法创建子任务：${text(error?.message || error, 600)}` };
    }
  }

  async function executeWorktreeTool(job, run, name, args) {
    if (!options.worktreeManager) return { name, success: false, output: '当前客户端没有启用 Git Worktree 管理器。' };
    if (name === 'prepare_git_worktree') {
      const created = await options.worktreeManager.create({ taskId: job.taskId, sourceRepo: args.sourceRepo, baseRef: args.baseRef });
      if (!created.ok) return { name, success: false, output: created.error || '创建 Git 工作树失败' };
      run.workspaceId = created.worktree.workspaceId;
      run.worktree = created.worktree;
      await updateRun(job.taskId, (next) => {
        next.workspaceId = created.worktree.workspaceId;
        next.worktree = created.worktree;
        if (next.recoveryContext) next.recoveryContext.summary = `代码任务已切换到独立 Git Worktree：${created.worktree.branch}`;
      }, '原生 Adapter 启用 Git Worktree 隔离');
      emit(job, 'worktree_ready', { worktree: created.worktree, idempotencyHit: created.idempotencyHit === true });
      return { name, success: true, output: `独立代码工作树已就绪。分支：${created.worktree.branch}；任务工作区：${created.worktree.workspaceId}`,
        structuredEvidence: { worktree: { branch: created.worktree.branch, head: created.worktree.head, workspaceId: created.worktree.workspaceId } } };
    }
    const checkpoint = await options.worktreeManager.checkpoint(job.taskId, { label: args.label || '模型请求恢复点' });
    if (!checkpoint.ok) return { name, success: false, output: checkpoint.error || '创建 Git 工作树恢复点失败' };
    await updateRun(job.taskId, (next) => {
      if (next.worktree) { next.worktree.lastCheckpointId = checkpoint.checkpoint.checkpointId; next.worktree.updatedAt = Date.now(); }
    }, '原生 Adapter 保存 Git Worktree 恢复点');
    emit(job, 'worktree_checkpointed', { checkpoint: checkpoint.checkpoint });
    return { name, success: true, output: `代码恢复点已保存：${checkpoint.checkpoint.checkpointId}；差异补丁 SHA-256：${checkpoint.checkpoint.patchSha256}`,
      structuredEvidence: { worktreeCheckpoint: checkpoint.checkpoint } };
  }

  async function executeStep(job, run, step, member, executionOptions = {}) {
    const { fidelity, toolRegistry, contextRouter, turnRuntime, turnLifecycle, moaRuntime, explicitResource } = await loadEngineModules();
    const stepDeliverableType = inferStepDeliverableType(step, run);
    let runtime = turnRuntime.createTurnRuntime({
      taskId: job.taskId,
      scope: `team:${run.teamId}`,
      // Each team member is verified against its own contractual stage. The
      // full project goal remains in the system prompt and final run checks.
      goal: step.assignment || run.goal || run.request,
      contract: { ...(run.contract || {}), goal: step.assignment || run.goal || run.request, deliverableType: stepDeliverableType },
    });
    const layeredMemory = options.memoryManager
      ? await options.memoryManager.context({ query: run.goal || run.request, teamId: run.teamId, employeeId: member.id, limit: 16 }).catch(() => ({ context: '' }))
      : { context: '' };
    const stepRecoveryPrompt = contextRouter.buildRecoveryPrompt({
      ...run,
      steps: run.steps.filter((item) => item.status === 'completed' || item.id === step.id),
    });
    const advisorGuidance = executionOptions.compensation
      ? ''
      : await consultStepAdvisors(job, run, step, member, moaRuntime, run.evidence || []);
    const explicitResourceContract = explicitResource.createExplicitResourceContract(run.goal || run.request);
    const explicitResourceGuidance = explicitResource.buildExplicitResourceGuidance(explicitResourceContract);
    const messages = [
      { role: 'system', content: `${buildSystem(run, step, member, job, turnRuntime.buildTurnGuidance(runtime), advisorGuidance)}${explicitResourceGuidance ? `\n\n${explicitResourceGuidance}` : ''}${layeredMemory.context ? `\n\n## 太极分层热记忆\n${layeredMemory.context}\n\n以上记忆只作为可复用背景；与老板当前明确要求冲突时，以当前要求为准。` : ''}${buildInheritedTaskContext(run)}${buildChildTaskContext(run)}\n\n${stepRecoveryPrompt}` },
      buildUserTurn(run, step, job),
    ];
    const registry = toolRegistry.buildToolRegistry([...options.toolRuntime.definitions, ...(job.connectorTools || [])]);
    const tools = registry.definitions;
    emit(job, 'tool_registry_ready', {
      stepId: step.id,
      registryProtocolVersion: registry.protocolVersion,
      ready: registry.ready,
      blocked: registry.blocked,
      collisions: registry.collisions,
      invalid: registry.invalid,
    });
    if (!tools.length) throw new Error('统一工具注册中心没有可用工具，任务无法开始');
    const cache = new Map();
    const callLog = [];
    let preparationStreak = 0;
    let finalContent = '';
    let review;
    let forceActionCount = 0;
    let appliedSteering = job.steering.length;
    let liveBudget = contextRouter.createContextBudget(run.recoveryContext?.budget);
    for (let round = 0; round < MAX_MODEL_ROUNDS_PER_STEP; round += 1) {
      await assertCanContinue(job);
      const currentPromptTokens = contextRouter.estimateTokens(messages.map((item) => item.content || item.tool_calls || '').join('\n'));
      const budgetAssessment = contextRouter.assessContextBudget(liveBudget, { currentPromptTokens });
      const stageBoundary = round > 0 && round % MODEL_ROUNDS_PER_STAGE === 0;
      if ((budgetAssessment.action === 'compact' || budgetAssessment.action === 'checkpoint' || stageBoundary) && messages.length > 8) {
        const compacted = contextRouter.compactMessageWindow(messages, { keepRecent: 10 });
        messages.splice(0, messages.length, ...compacted.messages);
        await updateRun(job.taskId, (next) => {
          if (!next.recoveryContext) return;
          const budget = contextRouter.createContextBudget(next.recoveryContext.budget);
          budget.compactions += 1;
          if (stageBoundary) budget.stage += 1;
          budget.estimatedTokens = contextRouter.estimateTokens(messages.map((item) => item.content || '').join('\n'));
          budget.updatedAt = Date.now();
          next.recoveryContext.budget = budget;
          liveBudget = budget;
          next.recoveryContext.summary = `长任务已完成第 ${budget.stage - 1} 阶段压缩，保留原始目标、证据和未决问题后继续。`;
          next.recoveryCapsule = contextRouter.createRecoveryCapsule(next, { reason: `上下文阶段 ${budget.stage} 压缩` });
          next.turnLifecycle = turnLifecycle.recordLifecycleContext(
            turnLifecycle.restoreTurnLifecycle(next.turnLifecycle, {
              taskId: next.id,
              conversationId: next.conversationId,
              scope: `team:${next.teamId}`,
              goal: next.goal || next.request,
              deliverableType: next.contract?.deliverableType,
            }),
            {
              compacted: true,
              stage: budget.stage,
              estimatedTokens: budget.estimatedTokens,
              contextWindowTokens: budget.contextWindowTokens,
              summary: next.recoveryContext.summary,
              unresolvedIssues: next.recoveryContext.unresolvedIssues,
            },
          );
          next.lifecycleRecovery = turnLifecycle.createLifecycleRecoveryCapsule(next.turnLifecycle);
        }, '原生 Adapter 压缩长任务上下文');
        if (stageBoundary) await options.store.createRecoveryPoint({ taskId: job.taskId, label: `自动阶段 ${Math.floor(round / MODEL_ROUNDS_PER_STAGE)} 恢复点` });
        emit(job, 'context_compacted', { stepId: step.id, removedMessages: compacted.removed, round, reason: stageBoundary ? 'stage-boundary' : budgetAssessment.reason });
      }
      if (budgetAssessment.action === 'replan') {
        messages.push({ role: 'system', content: '连续多轮没有新增可验证证据。立即停止当前重复路线，说明根因并选择本质不同的工具、来源或实现方法。' });
        emit(job, 'route_replan_required', { stepId: step.id, reason: budgetAssessment.reason });
      }
      if (job.steering.length > appliedSteering) {
        const updates = job.steering.slice(appliedSteering);
        runtime = turnRuntime.applySteering(runtime, updates);
        await updateRun(job.taskId, (next) => {
          next.turnLifecycle = turnLifecycle.recordLifecycleSteering(
            turnLifecycle.restoreTurnLifecycle(next.turnLifecycle, {
              taskId: next.id,
              conversationId: next.conversationId,
              scope: `team:${next.teamId}`,
              goal: next.goal || next.request,
              deliverableType: next.contract?.deliverableType,
            }),
            updates,
          );
          next.lifecycleRecovery = turnLifecycle.createLifecycleRecoveryCapsule(next.turnLifecycle);
        }, '原生 Adapter 将用户插话写入 Turn Lifecycle');
        messages.push({ role: 'system', content: `老板在执行中补充了要求。先结合原目标判断影响，再调整当前路线：\n${updates.join('\n')}` });
        messages.push({ role: 'system', content: turnRuntime.buildTurnGuidance(runtime) });
        appliedSteering = job.steering.length;
      }
      job.modelRounds += 1;
      const modelMember = step.kind === 'review' && job.reviewModelConfig
        ? { ...member, modelConfig: job.reviewModelConfig }
        : member;
      let response;
      try {
        response = await callModel(job, modelMember, messages, tools);
      } catch (error) {
        if (error instanceof ExecutionControlSignal) throw error;
        const observed = turnRuntime.observeToolResult(runtime, {
          toolCallId: `model-${job.taskId}-${step.id}-${round + 1}`,
          name: 'model_request',
          args: { model: modelName(modelMember.modelConfig), round: round + 1 },
          success: false,
          useful: false,
          output: error?.message || String(error),
          kind: 'model',
        });
        runtime = observed.runtime;
        const recovery = turnRuntime.decideRecovery(runtime, observed.error || error);
        runtime = recovery.runtime;
        const terminalStatus = recovery.decision.action === 'waiting_user' ? 'waiting_user' : 'failed';
        const finalContent = recovery.decision.userMessage || recovery.decision.message || '模型请求失败';
        const finalized = turnRuntime.finalizeTurn(runtime, {
          status: terminalStatus,
          content: finalContent,
          waitingFor: terminalStatus === 'waiting_user' ? finalContent : '',
        });
        runtime = finalized.runtime;
        await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 收尾模型请求异常');
        if (terminalStatus === 'waiting_user') throw new ExecutionControlSignal('awaiting_user', finalContent);
        throw error;
      }
      const message = response.message;
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      const observedDecision = turnRuntime.observeModelDecision(runtime, {
        content: message.content,
        toolCalls: toolCalls.map((call) => ({
          name: call?.function?.name,
          arguments: call?.function?.arguments,
        })),
      });
      runtime = observedDecision.runtime;
      await updateRun(job.taskId, (next) => {
        next.turnLifecycle = turnLifecycle.recordLifecycleDecision(
          turnLifecycle.restoreTurnLifecycle(next.turnLifecycle, {
            taskId: next.id,
            conversationId: next.conversationId,
            scope: `team:${next.teamId}`,
            goal: next.goal || next.request,
            deliverableType: next.contract?.deliverableType,
          }),
          observedDecision.decision,
        );
        next.lifecycleRecovery = turnLifecycle.createLifecycleRecoveryCapsule(next.turnLifecycle);
      }, '原生 Adapter 保存模型公开决策');
      liveBudget = contextRouter.recordContextUsage({
        ...liveBudget,
        contextWindowTokens: Number(modelMember.modelConfig?.contextWindowTokens) || liveBudget.contextWindowTokens,
      }, {
        promptTokens: Number(response.usage.prompt_tokens) || 0,
          completionTokens: Number(response.usage.completion_tokens) || 0,
          estimatedTokens: currentPromptTokens,
          modelRounds: 1,
          progress: toolCalls.length > 0,
      });
      if (toolCalls.length > 0 || (round + 1) % 3 === 0 || round === MAX_MODEL_ROUNDS_PER_STEP - 1) {
        await updateRun(job.taskId, (next) => {
          if (!next.recoveryContext) return;
          next.recoveryContext.budget = liveBudget;
          next.recoveryCapsule = contextRouter.createRecoveryCapsule(next, { reason: '模型轮次用量检查点' });
        }, '记录原生模型上下文用量');
      }
      if (toolCalls.length) {
        messages.push({ role: 'assistant', content: message.content || null, tool_calls: toolCalls });
        const completedToolCallIds = new Set();
        try {
          for (const call of toolCalls) {
          await assertCanContinue(job);
          if (callLog.length >= MAX_TOOL_CALLS_PER_STEP) throw new Error(`当前步骤达到 ${MAX_TOOL_CALLS_PER_STEP} 次工具预算，已停止重复路线`);
          const rawName = String(call?.function?.name || '');
          const normalizedCall = turnRuntime.normalizeToolCall(rawName, call?.function?.arguments || '{}');
          const name = normalizedCall.name || rawName;
          const args = normalizedCall.args || {};
          let result;
          const key = toolKey(name, args);
          const preflight = toolRegistry.preflightToolCall(registry, name, args, { approvalGranted: true });
          const explicitResourceGate = explicitResource.validateExplicitResourceToolCall(explicitResourceContract, name, args, callLog);
          if (!normalizedCall.ok) result = { name, success: false, output: normalizedCall.error || '工具参数无效' };
          else if (!explicitResourceGate.allowed) result = { name, success: false, output: explicitResourceGate.reason };
          else if (!preflight.ok) result = { name, success: false, output: `工具预检未通过：${preflight.message}` };
          else if (job.approvalDenials?.has(key)) result = { name, success: false, output: '用户已经拒绝这项完全相同的操作，不得重复申请；必须改用不需要该权限的路线。' };
          else if (cache.has(key)) result = { name, success: false, output: '完全相同的工具调用已执行，不能重复消耗算力，必须更换路线。' };
          else {
            await reportActivity(job, 'tool_started', `${member.name} 正在调用 ${name}`, {
              stepId: step.id, member: publicMember(member), toolName: name,
            });
            const deadline = timeoutPromise(toolCallTimeoutMs, `工具 ${name} 在 ${Math.ceil(toolCallTimeoutMs / 1000)} 秒内没有返回`, () => {});
            try {
              const execution = name === 'delegate_subtask'
                ? delegateSubtask(job, run, step, args)
                : name === 'prepare_git_worktree' || name === 'checkpoint_git_worktree'
                  ? executeWorktreeTool(job, run, name, args)
                  : options.toolRuntime.execute(name, args, {
                    taskId: job.taskId, scope: `team:${run.teamId}`, workspaceId: run.workspaceId, worktreePath: run.worktree?.path,
                    goal: run.goal || run.request,
                    executionPolicy: job.executionPolicy, connectors: job.connectors, connectorActions: job.connectorActions,
                    approvalGranted: job.approvalGrants?.has(key) === true,
                  });
              result = await Promise.race([execution, deadline.promise]);
            } catch (error) {
              if (error?.code === 'TAIJI_OPERATION_TIMEOUT') {
                job.lastError = `${error.message}。结果是否已产生尚未确认，为避免重复执行，任务已安全暂停。`;
                throw new ExecutionControlSignal('stall', job.lastError);
              }
              throw error;
            } finally {
              deadline.clear();
            }
          }
          cache.set(key, { success: result.success, output: result.output });
          callLog.push({ name, args: JSON.stringify(args), result: result.output, success: result.success });
          if (result.structuredEvidence?.review) review = result.structuredEvidence.review;
          preparationStreak = result.success && isPreparationTool(name) ? preparationStreak + 1 : result.success ? 0 : preparationStreak;
          await recordTool(job, run, step, member, name, args, result);
          const resultReference = result.structuredEvidence?.artifacts?.[0]?.diskPath
            || result.structuredEvidence?.artifacts?.[0]?.path
            || '';
          const observed = turnRuntime.observeToolResult(runtime, {
            toolCallId: call.id,
            name,
            args,
            success: result.success === true,
            useful: result.success === true,
            output: result.output,
            resultRef: resultReference,
            kind: result.structuredEvidence?.artifacts?.length
              ? 'file'
              : result.structuredEvidence?.connection ? 'connection'
                : result.structuredEvidence?.review ? 'review' : 'tool',
          });
          runtime = observed.runtime;
          await persistTurnRuntime(job, runtime, undefined, `${member.name}记录 Turn Runtime 工具证据`);
          messages.push({ role: 'tool', tool_call_id: call.id, content: result.output.slice(0, 12000) });
          completedToolCallIds.add(String(call.id || ''));
          if (result.awaitingUser || result.awaitingApproval) {
            if (result.awaitingApproval) await requestToolApproval(job, run, step, member, name, args, result);
            const finalized = turnRuntime.finalizeTurn(runtime, { status: 'waiting_user', content: result.output, waitingFor: result.output });
            runtime = finalized.runtime;
            await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 等待用户条件');
            throw new ExecutionControlSignal('awaiting_user', result.output);
          }
          if (observed.error) {
            const recovery = turnRuntime.decideRecovery(runtime, observed.error);
            runtime = recovery.runtime;
            if (recovery.decision.action === 'retry') cache.delete(key);
            messages.push({ role: 'system', content: `${turnRuntime.buildTurnGuidance(runtime)}\n\n失败类型：${recovery.decision.errorType}；下一恢复动作：${recovery.decision.action}。不要原样重复无效路线。` });
            if (recovery.decision.action === 'waiting_user') {
              const finalized = turnRuntime.finalizeTurn(runtime, { status: 'waiting_user', content: recovery.decision.userMessage, waitingFor: recovery.decision.message });
              runtime = finalized.runtime;
              await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 等待用户条件');
              throw new ExecutionControlSignal('awaiting_user', recovery.decision.userMessage);
            }
            if (recovery.decision.action === 'checkpoint') {
              const finalized = turnRuntime.finalizeTurn(runtime, { status: 'checkpointed', content: recovery.decision.message });
              runtime = finalized.runtime;
              await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 失败恢复检查点');
              throw new ExecutionControlSignal('checkpoint', recovery.decision.message || '同类恢复已经达到上限');
            }
          }
          if (preparationStreak >= MAX_PREPARATION_STREAK) {
            messages.push({ role: 'system', content: `已连续 ${preparationStreak} 次只读取或检查，没有产生可验收结果。必须立即执行真实写入、运行、连接验证或明确交接唯一外部阻塞。` });
          }
          }
        } catch (error) {
          completeOutstandingToolMessages(messages, toolCalls, completedToolCallIds, error?.message || error);
          throw error;
        }
        continue;
      }
      finalContent = text(message.content, 20000);
      const latestRun = await readRun(job.taskId);
      const currentStep = latestRun.steps.find((item) => item.id === step.id);
      const hasFile = currentStep?.evidence?.some((item) => item.kind === 'file' && item.verified);
      const hasSuccessfulTool = callLog.some((call) => call.success);
      if (executionOptions.compensation && !hasSuccessfulTool) {
        forceActionCount += 1;
        messages.push({ role: 'assistant', content: finalContent || '补偿步骤说明' });
        messages.push({ role: 'system', content: '补偿步骤尚未形成真实工具执行证据。必须调用已注册工具完成声明的补偿动作，不能只用文字说明。' });
        continue;
      }
      const fileEvidenceRequired = runtime.deliverableType === 'file'
        || turnRuntime.requiresFileEvidence(run.contract || { goal: run.goal || run.request }, step);
      if (!executionOptions.compensation && step.kind !== 'review' && fileEvidenceRequired && !hasFile) {
        forceActionCount += 1;
        messages.push({ role: 'assistant', content: finalContent || '当前步骤说明' });
        messages.push({ role: 'system', content: forceActionCount <= 2
          ? '当前是交付步骤，但还没有经过磁盘校验的文件证据。下一步必须调用 write_file 形成可交接文件，然后再总结。'
          : '仍然没有经过磁盘校验的文件证据，禁止宣布完成。立即改用可行的真实写入路线；若缺少外部条件，只能明确交接该唯一条件。' });
        continue;
      }
      if (step.kind === 'review' && !review) {
        forceActionCount += 1;
        messages.push({ role: 'assistant', content: finalContent || '审查说明' });
        messages.push({ role: 'system', content: forceActionCount <= 2
          ? '审查步骤没有 submit_review 证据。必须先检查真实文件或运行结果，再调用 submit_review 提交 PASS 或 REJECT。'
          : '仍然没有结构化审查证据，禁止宣布完成。立即读取或运行真实产出并提交 PASS/REJECT；无法继续时只交接具体阻塞。' });
        continue;
      }
      if (executionOptions.compensation) {
        const finalized = turnRuntime.finalizeTurn(runtime, { status: 'completed', content: finalContent || '补偿步骤已完成真实工具执行。' });
        runtime = finalized.runtime;
        await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 完成补偿步骤');
        return { content: finalContent || '补偿步骤已完成真实工具执行。', review, callLog, usageModel: response.model, turnRuntime: runtime, turnFinalization: finalized.finalization };
      }
      const acceptance = fidelity.assessTaskCompletion(runtime.goal, finalContent, callLog);
      const explicitAcceptance = explicitResource.assessExplicitResourceCompletion(explicitResourceContract, callLog);
      acceptance.issues.push(...explicitAcceptance.issues);
      acceptance.passed = acceptance.passed && explicitAcceptance.passed;
      if (!acceptance.passed) {
        forceActionCount += 1;
        messages.push({ role: 'assistant', content: finalContent });
        messages.push({ role: 'system', content: forceActionCount <= 2
          ? `原始目标验收未通过：${acceptance.issues.join('；')}。请换路线补齐真实证据，不得宣布完成。`
          : `原始目标仍未验收：${acceptance.issues.join('；')}。必须改走本质不同的路线、补齐证据或明确唯一外部阻塞，禁止以普通文本结束。` });
        continue;
      }
      if (!finalContent) finalContent = '当前步骤已完成工具执行与真实结果验证。';
      const finalized = turnRuntime.finalizeTurn(runtime, { status: 'completed', content: finalContent });
      runtime = finalized.runtime;
      await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 完成团队步骤');
      return { content: finalContent, review, callLog, usageModel: response.model, turnRuntime: runtime, turnFinalization: finalized.finalization };
    }
    await options.store.createRecoveryPoint({ taskId: job.taskId, label: '模型轮次预算恢复点' }).catch(() => {});
    if (run.worktree && options.worktreeManager) await options.worktreeManager.checkpoint(job.taskId, { label: '模型轮次预算恢复点' }).catch(() => {});
    const finalized = turnRuntime.finalizeTurn(runtime, { status: 'checkpointed', content: `当前步骤经过 ${MAX_MODEL_ROUNDS_PER_STEP} 轮仍未形成可验收结果。` });
    runtime = finalized.runtime;
    await persistTurnRuntime(job, runtime, finalized.finalization, 'Turn Runtime 模型轮次预算检查点');
    throw new ExecutionControlSignal('checkpoint', `当前步骤经过 ${MAX_MODEL_ROUNDS_PER_STEP} 轮仍未形成可验收结果。系统已保存目标、证据、未决问题和当前步骤，没有判定失败；可从恢复点继续或更换模型后继续。`);
  }

  function formalStep(runId, step) {
    const review = step.kind === 'review';
    return {
      stepId: step.id, type: review ? 'review' : 'tool', connector: `team-member:${step.employeeId}`,
      input: { assignment: step.assignment, employeeId: step.employeeId }, expectedOutputSchema: { type: 'object' },
      dependsOn: step.dependsOnStepIds || [], retryPolicy: { maxRetries: 3, backoffMs: 1000, maxBackoffMs: 30000 },
      idempotencyKey: review ? '' : `run-${runId}-${step.id}`, sideEffect: step.sideEffect !== false && !review, compensateStepId: step.compensateStepId || '', approvalRequired: false,
      metadata: { legacyStepId: step.id, employeeId: step.employeeId, kind: step.kind, deliverableType: step.deliverableType, revisionOfStepId: step.revisionOfStepId, compensationOnly: step.compensationOnly === true },
    };
  }

  async function beginStep(job, run, step, member) {
    const { runner, teamExecutionProtocol } = await loadEngineModules();
    try {
      await checkpoint(job, { kind: 'step_started', stepId: step.id, summary: `${member.name}开始执行“${step.title}”` });
    } catch (error) {
      if (job.control === 'stop' || job.control === 'pause' || job.control === 'close') {
        throw new ExecutionControlSignal(job.control, `Task control arrived while beginning ${step.id}`);
      }
      throw error;
    }
    await updateRun(job.taskId, (next) => {
      next.executionSessionId = options.sessionId;
      next.phase = 'executing';
      next.queuePosition = undefined;
      next.lastError = undefined;
      if (next.runner) {
        try { next.runner = runner.beginTaskStep(next.runner, step.id); } catch {}
      }
      if (next.executionProtocol) next.executionProtocol = teamExecutionProtocol.projectTeamExecutionEvent(next.executionProtocol, { type: 'step_started', stepId: step.id, employeeId: member.id, detail: `${member.name} 开始执行 ${step.title}` });
      const delegated = next.delegations?.find((item) => item.id === step.delegationId);
      if (delegated) { delegated.status = 'running'; delegated.updatedAt = Date.now(); }
      if (next.recoveryContext) {
        next.recoveryContext.summary = `${member.name}正在执行“${step.title}”。`;
        next.recoveryContext.interruptedAt = undefined;
        next.recoveryContext.interruptionReason = undefined;
      }
    }, `原生 Adapter 开始步骤 ${step.id}`);
    const delegated = run.delegations?.find((item) => item.id === step.delegationId);
    if (delegated?.childTaskId && options.taskService) await options.taskService.setStatus(delegated.childTaskId, 'running', `${member.name} 已领取员工子任务`).catch(() => {});
    emit(job, 'step_started', { stepId: step.id, member: publicMember(member), title: step.title });
  }

  async function completeStep(job, run, step, member, result) {
    const { runner, teamExecutionProtocol } = await loadEngineModules();
    if (step.kind === 'review') {
      const review = result.review;
      if (!review) throw new Error('审查步骤没有结构化审查证据');
      await checkpoint(job, { kind: 'step_completed', stepId: step.id, summary: review.decision === 'pass' ? `审查通过：${review.reason}` : `审查退回：${review.reason}` });
      await updateRun(job.taskId, (next) => {
        const current = next.steps.find((item) => item.id === step.id);
        if (current) {
          current.reviewDecision = review.decision;
          current.reviewReason = review.reason;
          current.responsibleEmployeeId = review.responsibleEmployeeId;
        }
        if (next.runner) {
          try {
            next.runner = runner.recordTaskReviewDecision(next.runner, {
              stepId: step.id, approved: review.decision === 'pass', reason: review.reason,
              responsibleEmployeeId: review.responsibleEmployeeId, responsibleStepId: review.responsibleStepId,
              checkedArtifacts: review.checkedArtifacts,
            });
            next.plan = next.runner.plan;
          } catch {}
        }
      }, `原生 Adapter 记录审查 ${step.id}`);
      await updateRun(job.taskId, (next) => {
        if (next.executionProtocol) next.executionProtocol = teamExecutionProtocol.projectTeamExecutionEvent(next.executionProtocol, { type: review.decision === 'pass' ? 'review_passed' : 'review_rejected', stepId: step.id, employeeId: member.id, reason: review.reason, responsibleStepId: review.responsibleStepId, detail: review.reason });
      }, `团队协议记录审查 ${step.id}`);
      if (review.decision === 'reject') {
        const revisionOutcome = await appendRevisionSteps(job, step, review);
        if (revisionOutcome?.waitingForUser) {
          throw new ExecutionControlSignal('awaiting_user', revisionOutcome.waitingForUser);
        }
      }
    } else {
      await checkpoint(job, { kind: 'step_completed', stepId: step.id, summary: result.content.slice(0, 700) });
      await updateRun(job.taskId, (next) => {
        const current = next.steps.find((item) => item.id === step.id);
        if (current) current.output = { summary: result.content.slice(0, 1200) };
        if (next.runner) {
          try { next.runner = runner.recordTaskStepResult(next.runner, { stepId: step.id, success: true, output: { summary: result.content.slice(0, 1200) } }); next.plan = next.runner.plan; } catch {}
        }
        const delegated = next.delegations?.find((item) => item.id === step.delegationId);
        if (delegated) {
          delegated.status = 'completed'; delegated.updatedAt = Date.now(); delegated.completedAt = Date.now();
          delegated.output = { summary: result.content.slice(0, 1200) };
          delegated.evidence = (next.steps.find((item) => item.id === step.id)?.evidence || []).slice(-30);
        }
      }, `原生 Adapter 完成步骤 ${step.id}`);
    }
    if (step.kind !== 'review') {
      await updateRun(job.taskId, (next) => {
        if (next.executionProtocol) next.executionProtocol = teamExecutionProtocol.projectTeamExecutionEvent(next.executionProtocol, { type: 'step_completed', stepId: step.id, employeeId: member.id, detail: result.content.slice(0, 700) });
      }, `团队协议完成步骤 ${step.id}`);
    }
    const delegated = run.delegations?.find((item) => item.id === step.delegationId);
    if (delegated?.childTaskId && options.taskService) {
      await options.taskService.completeStep(delegated.childTaskId, { stepId: 'step-1', summary: result.content.slice(0, 1200), output: { summary: result.content.slice(0, 1200) } }).catch(() => {});
      await options.taskService.setStatus(delegated.childTaskId, 'completed', `${member.name} 已提交子任务结果`).catch(() => {});
    }
    await appendStageSummary(job, run, step, member, result);
    emit(job, 'step_completed', { stepId: step.id, member: publicMember(member), summary: result.content.slice(0, 700) });
  }

  async function appendRevisionSteps(job, reviewStep, review) {
    const { runner, taskDelegation, teamExecutionProtocol } = await loadEngineModules();
    let waitingForUser = '';
    await updateRun(job.taskId, (run) => {
      const revisionCount = Number(run.revisionCount) || 0;
      const maxRevisions = Number(run.maxRevisions) || 2;
      if (revisionCount >= maxRevisions) {
        waitingForUser = `“${reviewStep.title}”已连续退回 ${maxRevisions} 次。请你决定：允许按当前结果通过、要求从本阶段重新做，或停止该项目。`;
        run.status = 'awaiting_user';
        run.phase = 'blocked';
        run.handoff = {
          ts: Date.now(),
          completed: run.steps.filter((step) => step.status === 'completed').map((step) => step.title),
          blocked: waitingForUser,
          nextAction: '请在聊天中选择“允许通过”“本阶段重做”或“停止项目”；系统会保留已完成证据，不会自行越过审查。',
        };
        if (run.recoveryContext) {
          run.recoveryContext.summary = '审查多次未通过，正在等待老板决定是否通过、重做或停止。';
          run.recoveryContext.waitingFor = waitingForUser;
          run.recoveryContext.autoResume = false;
        }
        run.steps.forEach((step) => {
          if (step.status === 'queued') {
            step.status = 'paused';
            step.events ||= [];
            step.events.push({ ts: Date.now(), type: 'status', detail: '审查未通过，等待老板决定后再继续。' });
          }
        });
        return;
      }
      const target = (review.responsibleStepId ? run.steps.find((item) => item.id === review.responsibleStepId) : undefined)
        || [...run.steps].reverse().find((item) => item.status === 'completed' && item.kind !== 'review');
      const employeeId = review.responsibleEmployeeId || target?.employeeId;
      if (!employeeId) throw new Error('审查退回无法定位责任步骤');
      const count = revisionCount + 1;
      const now = Date.now();
      const member = job.members.get(employeeId);
      const reviewer = job.members.get(reviewStep.employeeId);
      let revision;
      if (target?.delegationId) {
        const delegated = taskDelegation.createDelegationRevision(run, target.delegationId, {
          reviewStepId: reviewStep.id, responsibleEmployeeId: employeeId, reason: review.reason,
        });
        run.delegations = delegated.run.delegations;
        revision = { ...delegated.step, kind: 'revision', revisionOfStepId: target.id };
      } else {
        revision = {
          id: `revision-${job.taskId}-${count}-${employeeId}`, employeeId, order: run.steps.length + 1, kind: 'revision',
          title: `${member?.name || employeeId} · 第 ${count} 次修订`, assignment: `审查未通过：${review.reason}。只修复责任范围问题，不重做无关步骤。`,
          dependsOnStepIds: [reviewStep.id], revisionOfStepId: target?.id, status: 'queued', attempts: 0,
          evidence: [], events: [{ ts: now, type: 'status', detail: '审查退回后新增修订步骤' }],
        };
      }
      const recheck = {
        id: `review-${job.taskId}-${count}-${reviewStep.employeeId}`, employeeId: reviewStep.employeeId, order: run.steps.length + 2, kind: 'review',
        title: `${reviewer?.name || reviewStep.employeeId} · 修订后复审`, assignment: `读取修订产出，验证“${review.reason}”是否已解决，再提交结构化审查。`,
        dependsOnStepIds: [revision.id], status: 'queued', attempts: 0, evidence: [], events: [{ ts: now, type: 'status', detail: '等待修订后复审' }],
      };
      run.steps.push(revision, recheck);
      // A rejection is a gate, not a note. The next original stage must wait
      // for the correction and its recheck instead of racing ahead.
      for (const pending of run.steps) {
        if (pending.id === revision.id || pending.id === recheck.id || !['queued', 'paused'].includes(pending.status)) continue;
        if (!(pending.dependsOnStepIds || []).includes(reviewStep.id)) continue;
        pending.dependsOnStepIds = [...new Set((pending.dependsOnStepIds || []).filter((id) => id !== reviewStep.id).concat(recheck.id))];
        pending.events ||= [];
        pending.events.push({ ts: now, type: 'status', detail: '前置审查退回，等待修订和复审通过。' });
        const runnerStep = run.runner?.plan?.steps?.find((item) => item.stepId === pending.id);
        if (runnerStep) runnerStep.dependsOn = [...pending.dependsOnStepIds];
        const formalStep = run.plan?.steps?.find((item) => item.stepId === pending.id);
        if (formalStep) formalStep.dependsOn = [...pending.dependsOnStepIds];
      }
      if (run.executionProtocol) run.executionProtocol = teamExecutionProtocol.reconcileTeamExecutionProtocol(run.executionProtocol, { members: run.memberSnapshot, steps: run.steps });
      run.revisionCount = count;
      if (run.runner) {
        try { run.runner = runner.appendTaskRunnerSteps(run.runner, [formalStep(run.id, revision), formalStep(run.id, recheck)], '原生 Adapter 审查退回'); run.plan = run.runner.plan; } catch {}
      }
    }, '原生 Adapter 根据审查退回追加修订与复审');
    if (waitingForUser) {
      emit(job, 'review_waiting_user', { stepId: reviewStep.id, reason: waitingForUser });
      return { waitingForUser };
    }
    emit(job, 'plan_extended', { stepId: reviewStep.id, reason: review.reason });
    return { waitingForUser: '' };
  }

  async function failStep(job, step, member, error) {
    const { runner, teamExecutionProtocol } = await loadEngineModules();
    const reason = text(error?.message || error, 1200);
    const failedRun = await readRun(job.taskId).catch(() => undefined);
    if (failedRun?.worktree && options.worktreeManager) {
      await options.worktreeManager.checkpoint(job.taskId, { label: `步骤失败：${step.title}` }).catch(() => {});
    }
    try { await checkpoint(job, { kind: 'step_failed', stepId: step.id, summary: reason }); } catch {}
    await updateRun(job.taskId, (run) => {
      run.status = 'failed'; run.phase = 'blocked'; run.lastError = reason;
      run.handoff = { ts: Date.now(), completed: run.steps.filter((item) => item.status === 'completed').map((item) => item.title), blocked: reason,
        nextAction: '修复提示中的模型、授权、配置或工作区问题后继续，已完成内容不会重做。' };
      if (run.runner) {
        try { run.runner = runner.recordTaskStepResult(run.runner, { stepId: step.id, success: false, retryable: false, error: reason }); run.plan = run.runner.plan; } catch {}
      }
      const delegated = run.delegations?.find((item) => item.id === step.delegationId);
      if (delegated) { delegated.status = 'failed'; delegated.updatedAt = Date.now(); delegated.completedAt = Date.now(); delegated.error = reason; }
      if (run.executionProtocol) run.executionProtocol = teamExecutionProtocol.projectTeamExecutionEvent(run.executionProtocol, { type: 'step_failed', stepId: step.id, employeeId: member.id, detail: reason, error: reason });
      if (run.recoveryContext) {
        run.recoveryContext.summary = `${member.name}的步骤被阻塞，主进程已保留上下文。`;
        run.recoveryContext.unresolvedIssues = [...run.recoveryContext.unresolvedIssues, reason].slice(-20);
        run.recoveryContext.interruptedAt = Date.now();
        run.recoveryContext.interruptionReason = reason;
      }
    }, `原生 Adapter 步骤失败 ${step.id}`);
    const delegated = failedRun?.delegations?.find((item) => item.id === step.delegationId);
    if (delegated?.childTaskId && options.taskService) await options.taskService.failStep(delegated.childTaskId, { stepId: 'step-1', error: reason, retryable: false }).catch(() => {});
    emit(job, 'step_failed', { stepId: step.id, member: publicMember(member), error: reason });
  }

  async function finishRun(job) {
    const run = await readRun(job.taskId);
    const unfinished = run.steps.filter((step) => step.status !== 'completed' && step.compensationOnly !== true);
    const needsCommand = /代码|程序|安装|部署|构建|编译|运行|测试/iu.test(run.request);
    const needsConnection = /连接器|知识库|mcp|obsidian|ima/iu.test(run.request);
    const evidence = run.evidence || [];
    const checks = [
      { kind: 'file', label: '真实产出', passed: evidence.some((item) => item.kind === 'file' && item.verified && isVerifiedArtifact(item.artifact)), detail: '至少一个文件真实落盘并通过回读校验' },
      ...(needsCommand ? [{ kind: 'run', label: '运行结果', passed: evidence.some((item) => item.kind === 'run' && item.verified), detail: '任务涉及代码或安装，必须有成功运行证据' }] : []),
      ...(needsConnection ? [{ kind: 'connection', label: '连接验证', passed: evidence.some((item) => item.kind === 'connection' && item.verified), detail: '任务涉及外部连接，必须有最小真实调用证据' }] : []),
      ...(run.steps.some((step) => step.kind === 'review') ? [{ kind: 'review', label: '责任审查', passed: evidence.some((item) => item.kind === 'review' && item.verified), detail: '审查步骤必须明确通过' }] : []),
    ];
    const completedWork = run.steps.filter((step) => step.status === 'completed' && step.compensationOnly !== true && step.kind !== 'review');
    const typedChecks = new Map();
    for (const step of completedWork) {
      const type = inferStepDeliverableType(step, run);
      const stepEvidence = step.evidence || [];
      const childArtifacts = step.output?.childTask?.artifacts || [];
      const hasFile = stepEvidence.some((item) => item.kind === 'file' && item.verified && isVerifiedArtifact(item.artifact))
        || evidence.some((item) => item.kind === 'file' && item.verified && isVerifiedArtifact(item.artifact))
        || childArtifacts.length > 0;
      const hasConnection = stepEvidence.some((item) => item.kind === 'connection' && item.verified)
        || evidence.some((item) => item.kind === 'connection' && item.verified);
      const hasOperation = stepEvidence.some((item) => ['run', 'connection', 'operation'].includes(item.kind) && item.verified)
        || evidence.some((item) => ['run', 'connection', 'operation'].includes(item.kind) && item.verified);
      const hasResult = Boolean(text(step.output?.summary || step.output?.childTask?.summary, 1600))
        || stepEvidence.some((item) => item.verified && ['child_task', 'progress', 'review'].includes(item.kind));
      if (type === 'file') typedChecks.set('file', { kind: 'file', label: 'file deliverable', passed: hasFile, detail: 'A file deliverable needs a verified disk artifact.' });
      else if (type === 'connection') typedChecks.set('connection', { kind: 'connection', label: 'connection deliverable', passed: hasConnection, detail: 'A connection deliverable needs a verified live call.' });
      else if (type === 'operation') typedChecks.set('operation', { kind: 'operation', label: 'operation deliverable', passed: hasOperation, detail: 'An operation deliverable needs a verified runtime result.' });
      else if (type === 'mixed') typedChecks.set('mixed', { kind: 'mixed', label: 'mixed deliverable', passed: hasResult || hasFile || hasConnection || hasOperation, detail: 'A mixed deliverable needs at least one verified result.' });
      else typedChecks.set(type, { kind: type, label: `${type} deliverable`, passed: hasResult, detail: 'An answer or decision deliverable needs a persisted real result.' });
    }
    if (typedChecks.size) checks.splice(0, checks.length, ...typedChecks.values(), ...(run.steps.some((step) => step.kind === 'review')
      ? [{ kind: 'review', label: 'review decision', passed: evidence.some((item) => item.kind === 'review' && item.verified), detail: 'A review step needs an explicit PASS result.' }]
      : []));
    const blocked = checks.filter((item) => !item.passed);
    if (unfinished.length || blocked.length) throw new Error(unfinished.length ? `仍有 ${unfinished.length} 个步骤未完成` : `验收未通过：${blocked.map((item) => item.detail).join('；')}`);
    const beforeFinish = await readRun(job.taskId);
    if (beforeFinish?.worktree && options.worktreeManager) {
      const checkpoint = await options.worktreeManager.checkpoint(job.taskId, { label: '任务完成恢复点' });
      if (!checkpoint.ok) throw new Error(checkpoint.error || '最终 Git 工作树恢复点创建失败');
    }
    await updateRun(job.taskId, (next) => {
      next.verification = checks.map((item) => ({ kind: item.kind, label: item.label, status: item.passed ? 'passed' : 'blocked', detail: item.detail }));
      next.status = 'completed'; next.phase = 'completed'; next.lastError = undefined;
      next.handoff = undefined;
      if (next.recoveryContext) next.recoveryContext.summary = '任务已由主进程原生 Adapter 完成并通过验收。';
    }, '原生 Adapter 完成最终验收');
    await checkpoint(job, { kind: 'run_finished', finalStatus: 'completed', summary: '主进程原生 Adapter 已完成任务并通过验收' });
    if (options.learningReviewQueue) {
      const completedRun = await readRun(job.taskId);
      void options.learningReviewQueue.enqueue(completedRun, {
        reviewModelConfig: job.reviewModelConfig,
        memoryWriteApproval: job.memoryWriteApproval,
      }).then(() => emit(job, 'learning_review_queued', { taskId: job.taskId })).catch(() => {});
    }
  }

  async function syncChildTaskTerminal(childTaskId, status, detail = '') {
    const child = await readRun(childTaskId).catch(() => undefined);
    if (!child?.parentTaskId) return;
    const { runner, teamExecutionProtocol, contextRouter } = await loadEngineModules();
    const childResult = status === 'completed' ? summarizeChildTask(child) : undefined;
    await updateRun(child.parentTaskId, (parent) => {
      const delegation = (parent.delegations || []).find((item) => item.childTaskId === childTaskId);
      if (!delegation) return;
      const parentStep = parent.steps.find((item) => item.delegationId === delegation.id);
      delegation.status = status === 'completed' ? 'completed' : 'failed';
      delegation.updatedAt = Date.now();
      delegation.completedAt = Date.now();
      delegation.output = status === 'completed' ? childResult : undefined;
      delegation.error = status === 'completed' ? undefined : detail || child.lastError || 'Child task failed';
      if (parentStep) {
        parentStep.status = status === 'completed' ? 'completed' : 'failed';
        parentStep.completedAt = Date.now();
        parentStep.lastError = delegation.error;
        if (childResult) {
          parentStep.output = { childTask: childResult };
          parentStep.evidence = [...(parentStep.evidence || []), {
            ts: Date.now(), source: 'child_task', kind: 'child_task', verified: true,
            summary: `子任务“${childResult.title || childTaskId}”已完成：${childResult.summary}`.slice(0, 1800),
            childTaskId,
            artifacts: childResult.artifacts,
          }].slice(-30);
          parent.childTaskResults = { ...(parent.childTaskResults || {}), [childTaskId]: childResult };
          const inheritedChildEvidence = (childResult.artifacts || []).map((artifact) => ({
            ts: Date.now(), source: 'child_task', kind: 'file', verified: true,
            summary: `Child task artifact: ${artifact.path || artifact.name || childTaskId}`,
            artifact: { path: artifact.path || artifact.name, filename: artifact.name || artifact.path, diskPath: artifact.path || '', persistence: 'disk', verified: true },
          }));
          parent.evidence = [...(parent.evidence || []), ...inheritedChildEvidence].slice(-120);
          if (parent.recoveryContext) parent.recoveryContext.completedEvidence = [
            ...(parent.recoveryContext.completedEvidence || []),
            `子任务 ${childResult.title || childTaskId} 已验收：${childResult.summary}`.slice(0, 1800),
          ].slice(-30);
        }
        parentStep.events = [...(parentStep.events || []), { ts: Date.now(), type: `child_${status}`, detail: detail || `Child task ${childTaskId} ${status}` }].slice(-30);
        if (parent.runner) {
          try {
            parent.runner = runner.recordTaskStepResult(parent.runner, {
              stepId: parentStep.id,
              success: status === 'completed',
              retryable: false,
              detail: detail || `Child task ${childTaskId} ${status}`,
              error: delegation.error,
            });
            parent.plan = parent.runner.plan;
          } catch {}
        }
        if (parent.executionProtocol) parent.executionProtocol = teamExecutionProtocol.projectTeamExecutionEvent(parent.executionProtocol, {
          type: status === 'completed' ? 'step_completed' : 'step_failed',
          stepId: parentStep.id,
          employeeId: parentStep.employeeId,
          detail: detail || `Child task ${childTaskId} ${status}`,
          error: delegation.error,
        });
      }
      parent.recoveryCapsule = contextRouter.createRecoveryCapsule(parent, { reason: `子任务 ${childTaskId} 状态同步` });
    }, `Synchronize child task ${childTaskId} terminal state`);
    const parentJob = jobs.get(child.parentTaskId);
    if (parentJob?.state === 'waiting_children') {
      parentJob.waitingFor = undefined;
      parentJob.requeueAfterExecution = false;
      enqueueJob(parentJob, 'child-task-terminal');
      emit(parentJob, 'parent_resumed_after_child_terminal', { childTaskId, status });
    }
  }

  async function runCompensations(job, reason) {
    const initial = await readRun(job.taskId).catch(() => undefined);
    if (!initial) return [];
    const targets = initial.steps.filter((step) => step.status === 'completed' && step.sideEffect !== false && step.compensateStepId)
      .reverse();
    if (!targets.length) return [];
    const { runner, contextRouter } = await loadEngineModules();
    const results = [];
    const recordNonExecutableOutcome = async (outcome) => {
      const detail = text(outcome.error || outcome.summary || outcome.status, 1200);
      const needsHandoff = !['completed', 'already_completed'].includes(outcome.status);
      await updateRun(job.taskId, (next) => {
        next.compensation = [...(next.compensation || []), { ts: Date.now(), ...outcome, detail }].slice(-60);
        if (needsHandoff) {
          const targetTitle = next.steps.find((item) => item.id === outcome.targetStepId)?.title || outcome.targetStepId;
          const nextAction = outcome.status === 'missing'
            ? '补齐该步骤的补偿定义，或明确确认接受已发生的外部状态后再继续。'
            : outcome.status === 'awaiting_approval'
              ? '在审批记录中批准或拒绝该补偿；批准后点击继续即可只恢复补偿步骤。'
            : outcome.error?.includes('Child-task')
              ? '恢复对应子任务的补偿路线，或由负责人明确接管后再继续。'
              : '恢复可执行负责人或补齐必要配置后，再继续处理补偿。';
          const summary = `补偿未完成：${targetTitle}（${detail}）`;
          if (next.recoveryContext) next.recoveryContext.unresolvedIssues = [...(next.recoveryContext.unresolvedIssues || []), summary].slice(-20);
          next.handoff = {
            ts: Date.now(),
            completed: next.steps.filter((item) => item.status === 'completed' && item.compensationOnly !== true).map((item) => item.title),
            blocked: summary,
            nextAction,
            compensation: { ...outcome, detail },
          };
          next.recoveryCapsule = contextRouter.createRecoveryCapsule(next, { reason: summary });
        }
      }, `Record compensation ${outcome.status} for ${outcome.targetStepId}`);
    };
    job.compensating = true;
    emit(job, 'compensation_started', { reason: text(reason, 800), targetStepIds: targets.map((step) => step.id) });
    try {
      for (const target of targets) {
        const run = await readRun(job.taskId);
        const step = run?.steps.find((item) => item.id === target.compensateStepId);
        if (!step) {
          const outcome = { targetStepId: target.id, compensateStepId: target.compensateStepId, status: 'missing', error: 'Declared compensation step is missing' };
          await recordNonExecutableOutcome(outcome);
          results.push(outcome);
          continue;
        }
        if (step.status === 'completed') {
          const outcome = { targetStepId: target.id, compensateStepId: step.id, status: 'already_completed', summary: 'Compensation step was already completed' };
          await recordNonExecutableOutcome(outcome);
          results.push(outcome);
          continue;
        }
        const member = job.members.get(step.employeeId);
        if (!member || step.childTaskId) {
          const outcome = { targetStepId: target.id, compensateStepId: step.id, status: 'blocked', error: member ? 'Child-task compensation requires an explicit child recovery route' : 'Compensation owner is unavailable' };
          await recordNonExecutableOutcome(outcome);
          results.push(outcome);
          continue;
        }
        if (compensationNeedsApproval(step, job) && options.taskService) {
          const latest = await readRun(job.taskId);
          const approvals = latest?.approvals || [];
          const pending = approvals.find((approval) => approval.stepId === step.id && approval.scope === 'compensation' && approval.status === 'pending');
          const approved = approvals.some((approval) => approval.stepId === step.id && approval.scope === 'compensation' && approval.status === 'approved');
          const rejected = approvals.find((approval) => approval.stepId === step.id && approval.scope === 'compensation' && approval.status === 'rejected');
          if (rejected) {
            const outcome = { targetStepId: target.id, compensateStepId: step.id, status: 'blocked', error: `Compensation was rejected: ${text(rejected.note, 800) || 'user rejected approval'}` };
            await recordNonExecutableOutcome(outcome);
            results.push(outcome);
            continue;
          }
          if (!approved) {
            if (!pending) await options.taskService.requestApproval(job.taskId, {
              stepId: step.id, scope: 'compensation', requestedBy: member.name || member.id,
              reason: `补偿“${step.title}”可能影响外部状态，需确认后执行。原步骤：${target.title}`,
            });
            const outcome = { targetStepId: target.id, compensateStepId: step.id, status: 'awaiting_approval', error: 'Compensation requires user approval' };
            await recordNonExecutableOutcome(outcome);
            results.push(outcome);
            emit(job, 'compensation_approval_requested', { stepId: step.id, compensatesStepId: target.id });
            continue;
          }
        }
        job.currentStepId = step.id;
        job.currentMember = member;
        await updateRun(job.taskId, (next) => {
          const current = next.steps.find((item) => item.id === step.id);
          if (!current) return;
          current.status = 'running';
          current.attempts = (Number(current.attempts) || 0) + 1;
          current.events = [...(current.events || []), { ts: Date.now(), type: 'compensation_started', detail: `Compensating ${target.id}: ${text(reason, 600)}` }].slice(-30);
        }, `Start compensation ${step.id}`);
        emit(job, 'compensation_step_started', { stepId: step.id, compensatesStepId: target.id, member: publicMember(member) });
        try {
          const result = await executeStep(job, await readRun(job.taskId), step, member, { compensation: true });
          await updateRun(job.taskId, (next) => {
            const current = next.steps.find((item) => item.id === step.id);
            if (!current) return;
            current.status = 'completed'; current.completedAt = Date.now(); current.lastError = undefined;
            current.output = { summary: result.content.slice(0, 1200), compensationForStepId: target.id };
            current.events = [...(current.events || []), { ts: Date.now(), type: 'compensation_completed', detail: result.content.slice(0, 800) }].slice(-30);
            if (next.runner) {
              try { next.runner = runner.recordTaskStepResult(next.runner, { stepId: step.id, success: true, output: current.output, detail: 'Compensation completed' }); next.plan = next.runner.plan; } catch {}
            }
            next.compensation = [...(next.compensation || []), { ts: Date.now(), targetStepId: target.id, compensateStepId: step.id, status: 'completed', summary: current.output.summary }].slice(-60);
            if (next.recoveryContext) next.recoveryContext.completedEvidence = [...(next.recoveryContext.completedEvidence || []), `Compensation ${step.title}: ${current.output.summary}`].slice(-30);
            next.recoveryCapsule = contextRouter.createRecoveryCapsule(next, { reason: `Compensation completed for ${target.id}` });
          }, `Complete compensation ${step.id}`);
          results.push({ targetStepId: target.id, compensateStepId: step.id, status: 'completed', summary: result.content.slice(0, 1200) });
          emit(job, 'compensation_step_completed', { stepId: step.id, compensatesStepId: target.id, summary: result.content.slice(0, 700) });
        } catch (error) {
          const errorText = text(error?.message || error, 1200);
          await updateRun(job.taskId, (next) => {
            const current = next.steps.find((item) => item.id === step.id);
            if (current) {
              current.status = 'failed'; current.lastError = errorText;
              current.events = [...(current.events || []), { ts: Date.now(), type: 'compensation_failed', detail: errorText }].slice(-30);
            }
            next.compensation = [...(next.compensation || []), { ts: Date.now(), targetStepId: target.id, compensateStepId: step.id, status: 'failed', error: errorText }].slice(-60);
            if (next.recoveryContext) next.recoveryContext.unresolvedIssues = [...(next.recoveryContext.unresolvedIssues || []), `Compensation ${step.title} failed: ${errorText}`].slice(-20);
            next.recoveryCapsule = contextRouter.createRecoveryCapsule(next, { reason: `Compensation failed for ${target.id}` });
          }, `Fail compensation ${step.id}`).catch(() => {});
          results.push({ targetStepId: target.id, compensateStepId: step.id, status: 'failed', error: errorText });
          emit(job, 'compensation_step_failed', { stepId: step.id, compensatesStepId: target.id, error: errorText });
        }
      }
    } finally {
      job.compensating = false;
      job.currentStepId = undefined;
      job.currentMember = undefined;
      emit(job, 'compensation_finished', { results });
    }
    return results;
  }

  async function resolveChildSteps(job, run) {
    const childSteps = run.steps.filter((step) => step.childTaskId && !['completed', 'failed'].includes(step.status));
    for (const step of childSteps) {
      const child = await readRun(step.childTaskId);
      if (!child) throw new Error(`Child task ${step.childTaskId} is missing from the durable task store`);
      if (child?.status === 'completed') {
        await syncChildTaskTerminal(step.childTaskId, 'completed', 'Child task reached a terminal state');
        return { refreshed: true };
      }
      if (child?.status === 'failed' || child?.status === 'stopped') {
        const reason = child.lastError || `Child task ${step.childTaskId} did not complete`;
        await syncChildTaskTerminal(step.childTaskId, 'failed', reason);
        throw new Error(reason);
      }
      if (child.status === 'awaiting_user' || child.status === 'paused') {
        throw new ExecutionControlSignal('awaiting_user', `Child task ${step.childTaskId} is ${child.status} and requires user action before the parent can continue`);
      }
      const existingChildJob = jobs.get(child.id);
      if (child.status === 'queued' && (!existingChildJob || !ACTIVE_JOB_STATES.has(existingChildJob.state))) {
        const childMembers = child.memberSnapshot?.some((member) => member?.modelConfig?.apiHost)
          ? child.memberSnapshot
          : [...job.members.values()];
        const resumed = await start({
          taskId: child.id,
          members: childMembers,
          attachments: job.attachments,
          extraSystemContext: `Parent task ${job.taskId}; resumed child task ${child.id}.`,
          reviewModelConfig: job.reviewModelConfig,
          memoryWriteApproval: job.memoryWriteApproval,
          executionPolicy: job.executionPolicy,
          connectors: job.connectors,
          connectorTools: job.connectorTools,
        });
        if (!resumed.ok) throw new Error(resumed.error || `Child task ${child.id} could not resume`);
        emit(job, 'child_task_resumed', { childTaskId: child.id, childJob: resumed.job, reason: 'durable child task was queued without an active native job' });
      }
      throw new ExecutionControlSignal('delegate_wait', `Waiting for child task ${step.childTaskId}`);
    }
    return { refreshed: false };
  }

  async function execute(job) {
    job.state = 'running';
    job.startedAt = job.startedAt || Date.now();
    emit(job, 'job_started');
    try {
      await claim(job);
      while (true) {
        const run = await assertCanContinue(job);
        const childResolution = await resolveChildSteps(job, run);
        if (childResolution.refreshed) continue;
        const pending = run.steps.filter((step) => ['queued', 'paused', 'failed'].includes(step.status) && !step.childTaskId && step.compensationOnly !== true);
        if (!pending.length) break;
        const runnable = pending.find((step) => (step.dependsOnStepIds || []).every((dependency) => run.steps.find((item) => item.id === dependency)?.status === 'completed'));
        if (!runnable) throw new Error('任务步骤存在未完成依赖，原生 Adapter 拒绝跳步执行');
        const member = job.members.get(runnable.employeeId);
        if (!member) throw new Error(`找不到步骤负责人：${runnable.employeeId}`);
        job.currentStepId = runnable.id;
        job.currentMember = member;
        await beginStep(job, run, runnable, member);
        try {
          const result = await executeStep(job, await readRun(job.taskId), runnable, member);
          await completeStep(job, await readRun(job.taskId), runnable, member, result);
        } catch (error) {
          if (error instanceof ExecutionControlSignal) throw error;
          await failStep(job, runnable, member, error);
          throw error;
        }
      }
      await finishRun(job);
      await syncChildTaskTerminal(job.taskId, 'completed', 'Child task completed and passed its gate');
      job.state = 'completed';
      job.finishedAt = Date.now();
      emit(job, 'job_completed');
    } catch (error) {
      if (error instanceof ExecutionControlSignal) {
        let controlKind = job.control === 'stop' ? 'stop' : error.kind;
        job.lastError = error.message;
        let lifecycleStatus = controlKind === 'stop' || controlKind === 'close' ? 'stopped'
          : controlKind === 'awaiting_user' ? 'waiting_user'
            : controlKind === 'checkpoint' ? 'checkpointed'
              : controlKind === 'steer' || controlKind === 'delegate_wait' ? '' : 'paused';
        let compensationHandled = false;
        if (controlKind === 'stop' || controlKind === 'close') {
          await runCompensations(job, `${controlKind}: ${error.message}`).catch(() => {});
          compensationHandled = true;
        }
        if (controlKind === 'stall') {
          emit(job, 'execution_paused_after_stall', { error: error.message });
          try {
            await updateRun(job.taskId, (run) => {
              run.status = 'paused';
              run.phase = 'blocked';
              run.lastError = undefined;
              run.steps.forEach((step) => {
                if (step.status === 'running' || step.status === 'queued') {
                  step.status = 'paused';
                  step.events ||= [];
                  step.events.push({ ts: Date.now(), type: 'error', detail: error.message });
                }
              });
              if (run.worker) {
                run.worker.state = 'paused';
                run.worker.activity = '已检测到停滞并暂停';
              }
              run.handoff = {
                ts: Date.now(),
                completed: run.steps.filter((step) => step.status === 'completed').map((step) => step.title),
                blocked: error.message,
                nextAction: '先检查网络、模型或外部工具是否可用；确认后点击“继续执行”，系统会从未完成步骤恢复。',
              };
              if (run.recoveryContext) {
                run.recoveryContext.summary = '任务长时间没有新结果，系统已停止空转并保存现场。';
                run.recoveryContext.interruptedAt = Date.now();
                run.recoveryContext.interruptionReason = error.message;
                run.recoveryContext.autoResume = false;
                run.recoveryContext.waitingFor = undefined;
              }
            }, '原生 Adapter 停滞保护已写入完整恢复交接');
          } catch {}
          await options.worker.dispatch({
            commandId: `native-stall-${job.jobId}-${Date.now()}`,
            taskId: job.taskId,
            type: 'pause',
            requestedBy: 'main-native-execution-watchdog',
            sessionId: options.sessionId,
            payload: { reason: error.message },
          }).catch(() => undefined);
        } else if (controlKind === 'delegate_wait') {
          // A parent must yield while its child runs, but it must not spin in
          // the queue. The child terminal event is the sole wake-up source.
          job.state = 'waiting_children';
          job.waitingFor = error.message;
          job.requeueAfterExecution = false;
          await updateRun(job.taskId, (run) => {
            run.status = 'queued';
            run.phase = 'awaiting_child';
            run.lastError = undefined;
            if (run.recoveryContext) {
              run.recoveryContext.summary = '父任务正在等待子任务完成；不会重复排队或重复调用模型。';
              run.recoveryContext.waitingFor = error.message;
              run.recoveryContext.autoResume = true;
            }
          }, 'Parent task yielded its queue slot while waiting for a child task').catch(() => {});
          emit(job, 'child_task_waiting', { error: error.message });
        } else if (controlKind === 'steer') {
          job.state = 'queued';
          job.requeueAfterExecution = true;
          job.interruptReason = undefined;
          try {
            await updateRun(job.taskId, (run) => {
              run.status = 'queued';
              run.phase = 'executing';
              run.lastError = undefined;
              run.steps.forEach((step) => {
                if (step.status === 'running') {
                  step.status = 'queued';
                  step.events.push({ ts: Date.now(), type: 'status', detail: '收到用户插话，正在按最新要求重新执行当前步骤' });
                }
              });
              if (run.recoveryContext) {
                run.recoveryContext.summary = '已收到新的要求，正在合并原目标与最新约束后继续执行。';
                run.recoveryContext.steeringMessages = [...(run.recoveryContext.steeringMessages || []), ...job.steering].slice(-20);
                run.recoveryContext.autoResume = true;
                run.recoveryContext.waitingFor = undefined;
              }
            }, '原生 Adapter 收到插话后抢占并重新排队');
          } catch {}
          emit(job, 'steering_preempted', { message: error.message });
        } else if (controlKind === 'awaiting_user') {
          job.waitingFor = error.message;
          try {
            await updateRun(job.taskId, (run) => {
              run.status = 'awaiting_user'; run.phase = 'awaiting_user'; run.lastError = undefined;
              run.handoff = { ts: Date.now(), completed: run.steps.filter((item) => item.status === 'completed').map((item) => item.title), blocked: error.message,
                nextAction: '完成提示中唯一的授权或配置后点击继续，已完成步骤不会重做。' };
              if (run.recoveryContext) {
                run.recoveryContext.summary = '任务需要你补充一项授权、配置或业务选择，收到后会从当前步骤继续。';
                run.recoveryContext.waitingFor = error.message;
                run.recoveryContext.autoResume = false;
                run.recoveryContext.interruptedAt = Date.now();
                run.recoveryContext.interruptionReason = error.message;
              }
            }, '原生 Adapter 等待用户条件');
          } catch {}
        } else if (controlKind === 'checkpoint') {
          try {
            const { contextRouter } = await loadEngineModules();
            await updateRun(job.taskId, (run) => {
              run.status = 'paused'; run.phase = 'blocked'; run.lastError = undefined;
              run.steps.forEach((step) => { if (step.status === 'running') step.status = 'paused'; });
              run.handoff = { ts: Date.now(), completed: run.steps.filter((item) => item.status === 'completed').map((item) => item.title), blocked: error.message,
                nextAction: '点击继续会从当前未完成步骤恢复；也可以先更换模型或补充一条新要求。' };
              if (run.recoveryContext) {
                run.recoveryContext.summary = '执行预算达到阶段上限，任务已安全保存为可恢复状态，不是失败。';
                run.recoveryContext.autoResume = false;
                run.recoveryContext.interruptedAt = Date.now();
                run.recoveryContext.interruptionReason = error.message;
              }
              run.recoveryCapsule = contextRouter.createRecoveryCapsule(run, { reason: '执行预算阶段交接' });
            }, '原生 Adapter 达到预算后写入可恢复交接');
          } catch {}
        }
        if (job.control === 'stop' && controlKind !== 'stop') {
          controlKind = 'stop';
          lifecycleStatus = 'stopped';
        }
        if ((controlKind === 'stop' || controlKind === 'close') && !compensationHandled) {
          await runCompensations(job, `${controlKind}: ${error.message}`).catch(() => {});
          compensationHandled = true;
        }
        if (lifecycleStatus) await persistControlledLifecycle(job, lifecycleStatus, error.message);
        if (job.control === 'stop' && controlKind !== 'stop') {
          controlKind = 'stop';
          await runCompensations(job, `stop: ${error.message}`).catch(() => {});
          await persistControlledLifecycle(job, 'stopped', error.message);
        }
        const controlledJobState = controlKind === 'stop' || controlKind === 'close' ? 'stopped' : controlKind === 'awaiting_user' ? 'awaiting_user' : 'paused';
        if (controlKind !== 'steer' && controlKind !== 'delegate_wait') job.state = controlledJobState;
        emit(job, 'job_controlled', { control: controlKind, error: error.message });
      } else {
        job.lastError = text(error?.message || error, 1200);
        await persistControlledLifecycle(job, 'failed', job.lastError);
        await runCompensations(job, job.lastError).catch(() => {});
        await syncChildTaskTerminal(job.taskId, 'failed', job.lastError).catch(() => {});
        try { await checkpoint(job, { kind: 'run_failed', summary: job.lastError }); } catch {}
        job.state = 'failed';
        emit(job, 'job_failed', { error: job.lastError });
        if (options.learningReviewQueue) {
          void readRun(job.taskId).then((failedRun) => failedRun && options.learningReviewQueue.enqueue(failedRun, {
            reviewModelConfig: job.reviewModelConfig,
            memoryWriteApproval: job.memoryWriteApproval,
          })).catch(() => {});
        }
      }
      job.finishedAt = Date.now();
    } finally {
      if (job.heartbeat) clearInterval(job.heartbeat);
      if (!['paused', 'stopped'].includes(job.state)) await release(job).catch(() => {});
      job.abortController = undefined;
      job.currentStepId = undefined;
      job.currentMember = undefined;
    }
  }

  async function start(input) {
    const taskId = String(input?.taskId || input?.run?.id || '');
    if (!taskId) return { ok: false, error: '原生 Adapter 缺少 taskId' };
    const existing = jobs.get(taskId);
    if (existing && ACTIVE_JOB_STATES.has(existing.state)) return { ok: true, idempotencyHit: true, job: safeJob(existing) };
    let storedRun;
    try { storedRun = await ensureRun({ ...input, taskId }); }
    catch (error) { return { ok: false, error: error?.message || String(error) }; }
    if (storedRun?.worktree && options.worktreeManager) {
      const recovered = await options.worktreeManager.recover(taskId);
      if (!recovered.ok) return { ok: false, error: recovered.error || '任务 Git Worktree 无法恢复' };
      await updateRun(taskId, (next) => { next.workspaceId = recovered.worktree.workspaceId; next.worktree = { ...next.worktree, ...recovered.worktree }; }, '原生 Adapter 恢复 Git Worktree');
    }
    const members = new Map((input.members || []).map((member) => [String(member.id), { ...member, id: String(member.id) }]));
    if (!members.size) return { ok: false, error: '原生 Adapter 没有收到可执行成员与模型配置' };
    const connectorActions = [];
    for (const connector of input.connectors || []) {
      for (const action of connector.discoveredActions || connector.actions || []) {
        connectorActions.push({ name: `connector_${connector.id}_${action.mcpToolName || action.name}`, connectorId: connector.id, action });
      }
    }
    const job = {
      protocolVersion: NATIVE_ADAPTER_VERSION,
      jobId: `native-job-${taskId}-${crypto.randomUUID()}`,
      taskId, state: 'queued', createdAt: Date.now(), updatedAt: Date.now(), lastProgressAt: Date.now(), currentActivity: '等待进入后台队列',
      members, attachments: clone(input.attachments || []), extraSystemContext: text(input.extraSystemContext, 80000),
      reviewModelConfig: clone(input.reviewModelConfig || undefined),
      memoryWriteApproval: input.memoryWriteApproval !== false,
      executionPolicy: clone(input.executionPolicy || { sandboxEnabled: true, approvalMode: 'delegate', connectorApprovalMode: 'delegate' }),
      connectors: clone(input.connectors || []), connectorActions,
      connectorTools: clone(input.connectorTools || []), steering: [], events: [], eventSequence: 0, messageSequence: 0,
      approvalGrants: new Set((storedRun?.approvals || []).filter((item) => item.status === 'approved' || item.status === 'consumed').map((item) => item.approvalKey).filter(Boolean)),
      approvalDenials: new Set((storedRun?.approvals || []).filter((item) => item.status === 'rejected').map((item) => item.approvalKey).filter(Boolean)),
      checkpointSequence: 0, modelRounds: 0, toolCalls: 0,
      claimSequence: 0,
    };
    jobs.set(taskId, job);
    enqueueJob(job, 'submitted');
    return { ok: true, job: safeJob(job) };
  }

  function removeQueuedJob(job) {
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
    refreshQueuePositions();
  }

  function applyJobControl(job, type) {
    if (!job) return false;
    const wasQueued = job.state === 'queued';
    if (type === 'resume') {
      job.control = undefined;
      // The durable worker has already moved a failed/paused run back to
      // queued before this control reaches the in-memory adapter. A failed
      // job is therefore resumable; keeping it terminal here made the UI's
      // "continue" button appear to work while no job was ever re-enqueued.
      if (!['completed', 'stopped'].includes(job.state)) {
        job.state = 'queued';
        job.finishedAt = undefined;
        job.lastError = undefined;
        enqueueJob(job, 'resumed');
      }
      emit(job, 'control_received', { control: 'resume' });
      return false;
    }
    const effectiveType = type === 'close' ? 'stop' : type;
    job.control = effectiveType;
    job.abortController?.abort();
    if (effectiveType === 'pause') job.state = 'paused';
    if (effectiveType === 'stop') job.state = 'stopped';
    removeQueuedJob(job);
    emit(job, 'control_received', { control: type });
    return wasQueued;
  }

  async function cascadeChildControl(parentTaskId, type) {
    if (!['pause', 'resume', 'stop', 'close'].includes(type)) return;
    const snapshot = await options.store.read();
    if (!snapshot.ok) return;
    const descendants = [];
    const pending = [String(parentTaskId)];
    while (pending.length) {
      const ancestorId = pending.shift();
      for (const candidate of snapshot.runs.filter((run) => run.parentTaskId === ancestorId)) {
        if (descendants.some((item) => item.id === candidate.id)) continue;
        descendants.push(candidate);
        pending.push(candidate.id);
      }
    }
    const forwardedType = type === 'close' ? 'stop' : type;
    const controllableDescendants = type === 'resume'
      ? descendants.filter((item) => ['paused', 'failed', 'awaiting_user'].includes(item.status))
      : descendants.filter((item) => !['completed', 'failed', 'stopped'].includes(item.status));
    for (const child of controllableDescendants) {
      const childJob = jobs.get(child.id);
      const queuedBeforeControl = applyJobControl(childJob, forwardedType);
      const result = await options.worker.dispatch({
        commandId: `native-cascade-${forwardedType}-${parentTaskId}-${child.id}-${crypto.randomUUID()}`,
        taskId: child.id,
        type: forwardedType,
        requestedBy: `parent-task:${parentTaskId}`,
        sessionId: options.sessionId,
        payload: {},
      });
      if (result?.ok) {
        // A queued child has no active execute() catch block to initiate rollback.
        // Complete its declared compensation before the active parent may compensate shared state.
        if (queuedBeforeControl && forwardedType === 'stop' && childJob) {
          await runCompensations(childJob, `Parent task ${parentTaskId} stopped before queued child ${child.id} could run`).catch(() => {});
          emit(childJob, 'queued_child_compensation_finished', { parentTaskId });
        }
      }
    }
    const parentJob = jobs.get(String(parentTaskId));
    if (parentJob && descendants.length) emit(parentJob, 'child_task_control_cascaded', {
      control: type,
      childTaskIds: descendants.map((item) => item.id),
    });
  }

  async function handleControl(command, result) {
    if (!result?.ok) return;
    const taskId = String(command?.taskId || '');
    const type = String(command?.type || '');
    if (!['pause', 'resume', 'stop', 'close'].includes(type)) return;
    const job = jobs.get(taskId);
    if (type === 'resume' && job?.state === 'stopped') {
      void readRun(taskId).then((run) => {
        if ((run?.compensation || []).some((item) => item.status === 'awaiting_approval')) {
          job.control = undefined;
          enqueueCompensation(job, 'User approved a previously blocked compensation');
        }
      }).catch(() => {});
    }
    if (type === 'resume') {
      // Resume descendants first. Otherwise the parent can re-enter execute(),
      // observe a still-paused child and immediately fall back to awaiting_user.
      if (job && !['completed', 'stopped'].includes(job.state)) {
        job.control = undefined;
        job.state = 'queued';
        emit(job, 'resume_waiting_for_children');
      }
      try {
        await cascadeChildControl(taskId, type);
        applyJobControl(job, type);
      } catch (error) {
        emit(job, 'child_task_control_failed', { control: type, error: text(error?.message || error, 600) });
      }
      return;
    }
    const queuedBeforeControl = applyJobControl(job, type);
    const cascade = cascadeChildControl(taskId, type).catch(() => {});
    if (queuedBeforeControl && (type === 'stop' || type === 'close') && job) {
      // The parent is not inside execute(), so queue compensation after child control
      // rather than running a second tool loop in parallel with the active descendant.
      void cascade.then(() => enqueueCompensation(job, `Queued task ${taskId} was ${type === 'close' ? 'closed' : 'stopped'} while a descendant was active`));
    }
  }

  async function steer(taskId, message) {
    const job = jobs.get(String(taskId || ''));
    const value = text(message, 2000);
    if (!job || !ACTIVE_JOB_STATES.has(job.state)) return { ok: false, error: '任务当前没有由原生 Adapter 执行' };
    if (!value) return { ok: false, error: '插话内容不能为空' };
    const { contextRouter, turnLifecycle } = await loadEngineModules();
    const current = await readRun(job.taskId);
    const routed = current ? contextRouter.routeTaskInput(current, value) : { route: contextRouter.classifyTaskInput(value, { status: job.state }) };
    job.steering.push(value);
    if (job.steering.length > 20) job.steering.splice(0, job.steering.length - 20);
    job.steeringRoutes ||= [];
    job.steeringRoutes.push(routed.route);
    if (job.steeringRoutes.length > 20) job.steeringRoutes.splice(0, job.steeringRoutes.length - 20);
    if (routed.run) {
      await updateRun(job.taskId, (next) => {
        next.context = routed.run.context;
        next.recoveryContext = routed.run.recoveryContext;
        next.recoveryCapsule = routed.run.recoveryCapsule;
        next.turnLifecycle = turnLifecycle.recordLifecycleSteering(
          turnLifecycle.restoreTurnLifecycle(next.turnLifecycle, {
            taskId: next.id,
            conversationId: next.conversationId,
            scope: `team:${next.teamId}`,
            goal: next.goal || next.request,
            deliverableType: next.contract?.deliverableType,
          }),
          value,
        );
        next.lifecycleRecovery = turnLifecycle.createLifecycleRecoveryCapsule(next.turnLifecycle);
      }, `上下文路由：${routed.route.kind} -> ${routed.route.action}`);
    }
    if (routed.route.action === 'pause') {
      job.control = 'pause';
      job.abortController?.abort();
    } else if (routed.route.action === 'stop') {
      job.control = 'stop';
      job.abortController?.abort();
    } else if (job.state === 'running' && routed.route.shouldPreempt) {
      job.interruptReason = 'steer';
      job.abortController?.abort();
    }
    emit(job, 'steering_received', { message: value, route: routed.route });
    return { ok: true, job: safeJob(job) };
  }

  async function delegate(taskId, input = {}) {
    const current = await readRun(String(taskId || '')).catch(() => undefined);
    if (!current) return { ok: false, error: '找不到要委派子任务的父任务' };
    const job = jobs.get(current.id);
    const { runner, taskDelegation } = await loadEngineModules();
    try {
      const appended = taskDelegation.appendDelegation(current, input);
      if (job && !job.members.has(appended.delegation.employeeId)) {
        return { ok: false, error: `员工 ${appended.delegation.employeeName} 不在当前执行器成员列表中，请先把员工加入团队后再委派` };
      }
      const child = options.taskService
        ? await options.taskService.createChild(current.id, {
          employeeId: appended.delegation.employeeId,
          title: appended.delegation.title,
          assignment: appended.delegation.assignment,
          goal: appended.delegation.assignment,
          acceptanceCriteria: appended.delegation.acceptanceCriteria,
        })
        : undefined;
      if (child?.task?.id && current.conversationId) {
        await updateRun(child.task.id, (next) => {
          next.conversationId = current.conversationId;
          next.teamId = current.teamId;
        }, `继承父任务 ${current.id} 的聊天会话`);
      }
      await updateRun(current.id, (next) => {
        next.delegations = appended.run.delegations;
        next.steps = appended.run.steps;
        if (child?.task?.id) {
          const delegation = next.delegations.find((item) => item.id === appended.delegation.id);
          if (delegation) delegation.childTaskId = child.task.id;
          const delegatedStep = next.steps.find((item) => item.id === appended.step.id);
          if (delegatedStep) {
            delegatedStep.childTaskId = child.task.id;
            delegatedStep.externalChild = true;
          }
        }
        if (next.runner) {
          try { next.runner = runner.appendTaskRunnerSteps(next.runner, [formalStep(next.id, appended.step)], `手动添加子任务：${appended.delegation.title}`); next.plan = next.runner.plan; } catch {}
        }
      }, `手动动态委派 ${appended.delegation.employeeName}`);
      const childStart = child?.task?.id && job
        ? await start({
          taskId: child.task.id,
          members: [...job.members.values()],
          attachments: job.attachments,
          extraSystemContext: `Parent task ${current.id}; manually delegated by ${appended.delegation.employeeName}.`,
          reviewModelConfig: job.reviewModelConfig,
          memoryWriteApproval: job.memoryWriteApproval,
          executionPolicy: job.executionPolicy,
          connectors: job.connectors,
          connectorTools: job.connectorTools,
        })
        : undefined;
      if (child && job && !childStart?.ok) throw new Error(childStart?.error || 'Child task could not enter the native execution queue');
      const delegation = { ...appended.delegation, childTaskId: child?.task?.id };
      const step = { ...appended.step, childTaskId: child?.task?.id, externalChild: Boolean(child?.task?.id) };
      if (job) emit(job, 'subtask_delegated', { parentStepId: input.parentStepId, delegation, childJob: childStart?.job, source: 'manual' });
      return { ok: true, delegation, step, childTask: child?.task, childJob: childStart?.job, job: job ? safeJob(job) : undefined };
    } catch (error) {
      return { ok: false, error: text(error?.message || error, 1000) };
    }
  }

  // Team membership is allowed to grow while a project is running. Keep the
  // durable member snapshot and in-memory execution roster in lockstep before
  // a new expert can receive delegated work.
  async function syncMembers(taskId, input = {}) {
    const current = await readRun(String(taskId || '')).catch(() => undefined);
    if (!current) return { ok: false, error: '找不到需要同步成员的任务' };
    const incoming = Array.isArray(input.members) ? input.members
      .filter((member) => member && text(member.id, 180))
      .map((member) => ({ ...member, id: text(member.id, 180) })) : [];
    if (!incoming.length) return { ok: false, error: '没有提供有效的团队成员名单' };
    const job = jobs.get(current.id);
    const known = new Map((current.memberSnapshot || []).map((member) => [String(member.id), member]));
    const additions = incoming.filter((member) => !known.has(member.id));
    if (!additions.length) return { ok: true, changed: false, job: job ? safeJob(job) : undefined };
    if (job) {
      for (const member of additions) job.members.set(member.id, { ...member });
    }
    const { teamExecutionProtocol } = await loadEngineModules();
    await updateRun(current.id, (next) => {
      const snapshots = incoming.map((member) => {
        const snapshot = { ...member };
        delete snapshot.modelConfig;
        return snapshot;
      });
      const snapshotById = new Map((next.memberSnapshot || []).map((member) => [String(member.id), member]));
      for (const member of snapshots) snapshotById.set(String(member.id), { ...snapshotById.get(String(member.id)), ...member });
      next.memberSnapshot = [...snapshotById.values()];
      next.memberRosterVersion = Number(next.memberRosterVersion || 0) + 1;
      if (next.executionProtocol) {
        next.executionProtocol = teamExecutionProtocol.reconcileTeamExecutionProtocol(next.executionProtocol, {
          members: next.memberSnapshot,
          steps: next.steps,
        });
      }
    }, `团队执行名单已扩充：${additions.map((member) => text(member.name || member.id, 120)).join('、')}`);
    if (job) emit(job, 'member_roster_updated', { additions: additions.map((member) => ({ id: member.id, name: text(member.name, 120) })), rosterSize: job.members.size });
    return { ok: true, changed: true, additions: additions.map((member) => ({ id: member.id, name: text(member.name, 120) })), job: job ? safeJob(job) : undefined };
  }

  async function delegationStatus(taskId) {
    const run = await readRun(String(taskId || '')).catch(() => undefined);
    if (!run) return { ok: false, error: '找不到任务' };
    const { taskDelegation } = await loadEngineModules();
    return { ok: true, ...taskDelegation.delegationSummary(run), delegations: clone(run.delegations || []) };
  }

  function status(taskId) {
    if (taskId) {
      const job = jobs.get(String(taskId));
      return { ok: true, job: job ? safeJob(job) : undefined, queue: { activeTaskId: activeJob?.taskId, queuedTaskIds: queue.map((item) => item.taskId), total: queue.length } };
    }
    return { ok: true, jobs: [...jobs.values()].map(safeJob), queue: { activeTaskId: activeJob?.taskId, queuedTaskIds: queue.map((item) => item.taskId), total: queue.length } };
  }

  function events(taskId, afterSequence = 0) {
    const job = jobs.get(String(taskId || ''));
    return { ok: true, events: job ? job.events.filter((event) => event.sequence > Number(afterSequence || 0)).map(clone) : [] };
  }

  function observabilityStatus(taskId) {
    const queueState = { activeTaskId: activeJob?.taskId, queuedTaskIds: queue.map((item) => item.taskId), total: queue.length };
    return taskId
      ? { ok: true, task: observability.get(taskId), queue: queueState }
      : { ok: true, tasks: observability.list(), queue: queueState };
  }

  function stopAll() {
    for (const job of jobs.values()) {
      if (!ACTIVE_JOB_STATES.has(job.state)) continue;
      job.control = 'pause';
      job.abortController?.abort();
      if (job.heartbeat) clearInterval(job.heartbeat);
    }
  }

  return { start, steer, decideApproval, delegate, syncMembers, delegationStatus, status, events, observability: observabilityStatus, handleControl, stopAll };
}

module.exports = {
  NATIVE_ADAPTER_VERSION,
  MAX_TOOL_CALLS_PER_STEP,
  MAX_MODEL_ROUNDS_PER_STEP,
  ExecutionControlSignal,
  createNativeExecutionAdapter,
  resolveEndpoint,
};
