const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
const { ADAPTER_PROTOCOL_VERSION } = require('./executionAdapterProtocol.cjs');

const NATIVE_ADAPTER_VERSION = 1;
const MAX_TOOL_CALLS_PER_STEP = 36;
const MAX_MODEL_ROUNDS_PER_STEP = 36;
const MODEL_ROUNDS_PER_STAGE = 12;
const MAX_PREPARATION_STREAK = 4;
const ACTIVE_JOB_STATES = new Set(['queued', 'running']);

const ROLE_DUTY = {
  pm: '你是团队协调者。把目标拆解成可执行、可验收的结果，必须将当前步骤写成真实文件。',
  planner: '你是规划者和架构师。先读取前续产出，再形成可交接的真实方案文件。',
  coder: '你是实现工程师。读取上游方案，写入完整可运行代码，并在需要时用命令验证。',
  checker: '你是审查者。必须读取或运行真实产出，然后调用 submit_review 提交 PASS 或 REJECT。',
  custom: '你是团队成员。使用真实工具完成当前责任步骤，并留下可验收结果。',
};

class ExecutionControlSignal extends Error {
  constructor(kind, message) { super(message || kind); this.name = 'ExecutionControlSignal'; this.kind = kind; }
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function text(value, limit = 12000) { return String(value ?? '').trim().slice(0, limit); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function toolKey(name, args) { return `${name}:${JSON.stringify(stable(args || {}))}`.toLowerCase(); }
function isPreparationTool(name) { return ['inspect_connectors', 'list_files', 'read_file', 'read_skill', 'read_web_page', 'search_skills', 'web_search'].includes(name); }

function resolveEndpoint(model) {
  const base = String(model?.apiHost || '').trim().replace(/\/+$/u, '');
  if (!base) throw new Error('未配置 API 地址');
  if (/\/chat\/completions$/iu.test(base)) return base;
  if (/\/(?:v1|v2|v3|v4|compatible-mode\/v1|api\/paas\/v4)$/iu.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function modelName(model) { return String(model?.model || '').trim() || 'gpt-4o-mini'; }
function publicMember(member) {
  return { id: member.id, name: member.name, title: member.title, role: member.role, model: modelName(member.modelConfig) };
}

function safeJob(job) {
  return {
    protocolVersion: NATIVE_ADAPTER_VERSION,
    jobId: job.jobId,
    taskId: job.taskId,
    state: job.state,
    queuePosition: job.queuePosition,
    waitingFor: job.waitingFor,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
    currentStepId: job.currentStepId,
    currentMember: job.currentMember ? publicMember(job.currentMember) : undefined,
    modelRounds: job.modelRounds,
    toolCalls: job.toolCalls,
    lastError: job.lastError,
    eventSequence: job.eventSequence,
  };
}

function createNativeExecutionAdapter(options) {
  const jobs = new Map();
  const queue = [];
  let drainingQueue = false;
  let activeJob;
  const projectRoot = path.resolve(options.projectRoot);
  const retryDelays = options.retryDelays ?? [0, 1000, 3000, 6000, 10000];
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

  async function drainQueue() {
    if (drainingQueue) return;
    drainingQueue = true;
    try {
      while (queue.length) {
        const job = queue.shift();
        refreshQueuePositions();
        if (!job || job.state !== 'queued') continue;
        job.queuePosition = undefined;
        activeJob = job;
        try { await execute(job); }
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
    try { options.onChanged?.(clone(event)); } catch {}
    return event;
  }

  async function loadEngineModules() {
    if (!engineModulesPromise) {
      engineModulesPromise = Promise.all([
        import(pathToFileURL(path.join(projectRoot, 'src/engine/taskFidelity.mjs')).href),
        import(pathToFileURL(path.join(projectRoot, 'src/engine/taskRunner.mjs')).href),
        import(pathToFileURL(path.join(projectRoot, 'src/engine/toolRegistry.mjs')).href),
        import(pathToFileURL(path.join(projectRoot, 'src/engine/taskContextRouter.mjs')).href),
      ]).then(([fidelity, runner, toolRegistry, contextRouter]) => ({ fidelity, runner, toolRegistry, contextRouter }));
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
    if (!result.ok) throw new Error(result.error || '任务投影更新失败');
    return result.run;
  }

  async function assertCanContinue(job) {
    if (job.control === 'stop') throw new ExecutionControlSignal('stop', '任务已停止');
    if (job.control === 'pause') throw new ExecutionControlSignal('pause', '任务已暂停');
    const run = await readRun(job.taskId);
    if (!run) throw new ExecutionControlSignal('close', '任务已关闭');
    if (run.status === 'stopped') throw new ExecutionControlSignal('stop', '任务已停止');
    if (run.status === 'paused') throw new ExecutionControlSignal('pause', '任务已暂停');
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
      payload: { adapter: 'main-native-execution-adapter', adapterProtocolVersion: ADAPTER_PROTOCOL_VERSION, jobId: job.jobId },
    });
    if (!result.ok || !result.run?.worker?.leaseId) throw new Error(result.error || '原生 Adapter 无法领取 Worker 租约');
    job.leaseId = result.run.worker.leaseId;
    job.checkpointSequence = Number(result.run.worker.checkpointSequence) || 0;
    job.heartbeat = setInterval(() => {
      if (!job.leaseId || job.state !== 'running') return;
      void options.worker.dispatch({
        commandId: `native-heartbeat-${job.taskId}-${Date.now()}`,
        taskId: job.taskId, type: 'heartbeat', requestedBy: 'main-native-execution-adapter', sessionId: options.sessionId,
        payload: { leaseId: job.leaseId },
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

  function buildSystem(run, step, member, job) {
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
      '工作步骤在最终回答前必须用 write_file 产生并校验真实文件。审查步骤必须调用 submit_review。',
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
    const config = member.modelConfig || {};
    const endpoint = resolveEndpoint(config);
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    let lastError;
    for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
      await assertCanContinue(job);
      if (retryDelays[attempt]) await sleep(retryDelays[attempt]);
      const controller = new AbortController();
      job.abortController = controller;
      const timer = setTimeout(() => controller.abort(), 120000);
      try {
        const response = await options.fetchImpl(endpoint, {
          method: 'POST', headers, signal: controller.signal,
          body: JSON.stringify({ model: modelName(config), messages, tools, tool_choice: 'auto', stream: false }),
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
      } catch (error) {
        if (job.interruptReason === 'steer') {
          throw new ExecutionControlSignal('steer', '已收到新的要求，正在根据最新内容调整当前步骤。');
        }
        if (job.control) throw new ExecutionControlSignal(job.control, error?.message);
        lastError = error;
        emit(job, 'model_retry', { stepId: job.currentStepId, attempt: attempt + 1, maxAttempts: retryDelays.length, error: text(error?.message || error, 500) });
        if (error?.retryable === false || /(?:401|403|invalid.?key|unauthorized|forbidden)/iu.test(String(error?.message))) break;
      } finally {
        clearTimeout(timer);
        if (job.abortController === controller) job.abortController = undefined;
      }
    }
    throw lastError || new Error('模型请求失败');
  }

  async function appendExecutionMessage(job, run, member, content, kind = 'text', tool) {
    const id = `native-message-${job.taskId}-${++job.messageSequence}`;
    const message = {
      id, authorId: member.id, authorName: member.name, roleId: member.role || 'custom', content: text(content, 20000), mentions: [],
      timestamp: Date.now(), kind, discussionId: job.taskId, triggeredBy: 'task', ...(tool ? { tool } : {}),
    };
    await updateRun(job.taskId, (next) => {
      if (!Array.isArray(next.executionMessages)) next.executionMessages = [];
      if (!next.executionMessages.some((item) => item.id === id)) next.executionMessages.push(message);
      if (next.executionMessages.length > 300) next.executionMessages = next.executionMessages.slice(-300);
    }, `${member.name}写入原生执行消息`);
    emit(job, 'message', { stepId: job.currentStepId, member: publicMember(member), message });
    return message;
  }

  function evidenceFromTool(result, member, name) {
    const now = Date.now();
    const evidence = [];
    for (const artifact of result.structuredEvidence?.artifacts || []) {
      evidence.push({ ts: now, source: 'tool', kind: 'file', summary: `${artifact.filename || artifact.path} · ${artifact.bytes || 0} 字节 · ${artifact.verified ? '已验证' : '未验证'}`, verified: artifact.verified === true, artifact });
    }
    if (result.structuredEvidence?.command) evidence.push({ ts: now, source: 'tool', kind: 'run', summary: `${name}：退出码 ${result.structuredEvidence.command.exitCode}`, verified: result.success === true });
    if (result.structuredEvidence?.connection) evidence.push({ ts: now, source: 'connector', kind: 'connection', summary: `${result.structuredEvidence.connection.connectorLabel}：${result.output.slice(0, 240)}`, verified: result.structuredEvidence.connection.verified === true });
    if (result.structuredEvidence?.review) evidence.push({ ts: now, source: 'review', kind: 'review', summary: `${result.structuredEvidence.review.decision === 'pass' ? '审查通过' : '审查退回'}：${result.structuredEvidence.review.reason}`, verified: result.structuredEvidence.review.decision === 'pass', review: result.structuredEvidence.review });
    if (!evidence.length) evidence.push({ ts: now, source: 'tool', kind: 'progress', summary: `${member.name} 调用 ${name}：${result.output.slice(0, 240)}`, verified: result.success === true });
    return evidence;
  }

  async function recordTool(job, run, step, member, name, args, result) {
    const { contextRouter } = await loadEngineModules();
    const safeArgs = options.toolRuntime.redact(args);
    const safeResult = { ...result, output: String(options.toolRuntime.redact(result.output)) };
    const evidence = evidenceFromTool(safeResult, member, name);
    job.toolCalls += 1;
    await updateRun(job.taskId, (next) => {
      const current = next.steps.find((item) => item.id === step.id);
      if (!current) return;
      current.events ||= [];
      current.events.push({ ts: Date.now(), type: result.success ? 'tool' : 'error', detail: `${name} ${JSON.stringify(safeArgs).slice(0, 500)} → ${safeResult.output.slice(0, 800)}` });
      current.evidence = [...(current.evidence || []), ...evidence].slice(-30);
      next.evidence = [...(next.evidence || []), ...evidence].slice(-120);
      if (next.recoveryContext) {
        next.recoveryContext.budget = contextRouter.recordContextUsage(next.recoveryContext.budget, { toolAttempts: 1, progress: result.success === true });
        if (result.success) next.recoveryContext.completedEvidence = [...next.recoveryContext.completedEvidence, evidence.map((item) => item.summary).join('；')].slice(-30);
        else next.recoveryContext.unresolvedIssues = [...next.recoveryContext.unresolvedIssues, `${name}：${safeResult.output.slice(0, 320)}`].slice(-20);
      }
      next.recoveryCapsule = contextRouter.createRecoveryCapsule(next, { reason: `工具 ${name} 执行后检查点` });
    }, `${member.name}原生调用 ${name}`);
    const report = `**${member.name}** 调用 **${name}**\n${JSON.stringify(safeArgs)}\n\n${result.success ? '成功' : '失败'}：${safeResult.output}`;
    await appendExecutionMessage(job, run, member, report, 'execution', { name, args: safeArgs, success: result.success });
    emit(job, 'tool_result', { stepId: step.id, member: publicMember(member), toolName: name, arguments: safeArgs, success: result.success, output: safeResult.output.slice(0, 1200) });
  }

  async function executeStep(job, run, step, member) {
    const { fidelity, toolRegistry, contextRouter } = await loadEngineModules();
    const stepRecoveryPrompt = contextRouter.buildRecoveryPrompt({
      ...run,
      steps: run.steps.filter((item) => item.status === 'completed' || item.id === step.id),
    });
    const messages = [
      { role: 'system', content: `${buildSystem(run, step, member, job)}\n\n${stepRecoveryPrompt}` },
      buildUserTurn(run, step, job),
    ];
    const registry = toolRegistry.buildToolRegistry([...options.toolRuntime.definitions, ...(job.connectorTools || [])]);
    const tools = registry.definitions;
    emit(job, 'tool_registry_ready', {
      stepId: step.id,
      protocolVersion: registry.protocolVersion,
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
        messages.push({ role: 'system', content: `老板在执行中补充了要求。先结合原目标判断影响，再调整当前路线：\n${updates.join('\n')}` });
        appliedSteering = job.steering.length;
      }
      job.modelRounds += 1;
      const response = await callModel(job, member, messages, tools);
      const message = response.message;
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      liveBudget = contextRouter.recordContextUsage({
        ...liveBudget,
        contextWindowTokens: Number(member.modelConfig?.contextWindowTokens) || liveBudget.contextWindowTokens,
      }, {
        promptTokens: Number(response.usage.prompt_tokens) || 0,
          completionTokens: Number(response.usage.completion_tokens) || 0,
          estimatedTokens: currentPromptTokens,
          modelRounds: 1,
          progress: toolCalls.length > 0,
      });
      await updateRun(job.taskId, (next) => {
        if (!next.recoveryContext) return;
        next.recoveryContext.budget = liveBudget;
        next.recoveryCapsule = contextRouter.createRecoveryCapsule(next, { reason: '模型轮次用量检查点' });
      }, '记录原生模型上下文用量');
      if (toolCalls.length) {
        messages.push({ role: 'assistant', content: message.content || null, tool_calls: toolCalls });
        for (const call of toolCalls) {
          await assertCanContinue(job);
          if (callLog.length >= MAX_TOOL_CALLS_PER_STEP) throw new Error(`当前步骤达到 ${MAX_TOOL_CALLS_PER_STEP} 次工具预算，已停止重复路线`);
          const name = String(call?.function?.name || '');
          let args = {};
          try { args = JSON.parse(call?.function?.arguments || '{}'); } catch {}
          if (name === 'web_search') args.query = run.goal || run.request;
          const gate = fidelity.validateToolCallAgainstGoal(run.goal || run.request, name, JSON.stringify(args));
          let result;
          const key = toolKey(name, args);
          const preflight = toolRegistry.preflightToolCall(registry, name, args, { approvalGranted: true });
          if (!preflight.ok) result = { name, success: false, output: `工具预检未通过：${preflight.message}` };
          else if (!gate.allowed) result = { name, success: false, output: `${gate.reason}当前调用与原始目标不一致，已在主进程拦截。` };
          else if (cache.has(key)) result = { name, success: false, output: '完全相同的工具调用已执行，不能重复消耗算力，必须更换路线。' };
          else result = await options.toolRuntime.execute(name, args, {
            taskId: job.taskId, scope: `team:${run.teamId}`, workspaceId: run.workspaceId,
            executionPolicy: job.executionPolicy, connectors: job.connectors, connectorActions: job.connectorActions,
          });
          cache.set(key, { success: result.success, output: result.output });
          callLog.push({ name, args: JSON.stringify(args), result: result.output, success: result.success });
          if (result.structuredEvidence?.review) review = result.structuredEvidence.review;
          preparationStreak = result.success && isPreparationTool(name) ? preparationStreak + 1 : result.success ? 0 : preparationStreak;
          await recordTool(job, run, step, member, name, args, result);
          messages.push({ role: 'tool', tool_call_id: call.id, content: result.output.slice(0, 12000) });
          if (result.awaitingUser || result.awaitingApproval) throw new ExecutionControlSignal('awaiting_user', result.output);
          if (preparationStreak >= MAX_PREPARATION_STREAK) {
            messages.push({ role: 'system', content: `已连续 ${preparationStreak} 次只读取或检查，没有产生可验收结果。必须立即执行真实写入、运行、连接验证或明确交接唯一外部阻塞。` });
          }
        }
        continue;
      }
      finalContent = text(message.content, 20000);
      const latestRun = await readRun(job.taskId);
      const currentStep = latestRun.steps.find((item) => item.id === step.id);
      const hasFile = currentStep?.evidence?.some((item) => item.kind === 'file' && item.verified);
      if (step.kind !== 'review' && !hasFile) {
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
      const acceptance = fidelity.assessTaskCompletion(run.goal || run.request, finalContent, callLog);
      if (!acceptance.passed) {
        forceActionCount += 1;
        messages.push({ role: 'assistant', content: finalContent });
        messages.push({ role: 'system', content: forceActionCount <= 2
          ? `原始目标验收未通过：${acceptance.issues.join('；')}。请换路线补齐真实证据，不得宣布完成。`
          : `原始目标仍未验收：${acceptance.issues.join('；')}。必须改走本质不同的路线、补齐证据或明确唯一外部阻塞，禁止以普通文本结束。` });
        continue;
      }
      if (!finalContent) finalContent = '当前步骤已完成工具执行与真实结果验证。';
      return { content: finalContent, review, callLog, usageModel: response.model };
    }
    await options.store.createRecoveryPoint({ taskId: job.taskId, label: '模型轮次预算恢复点' }).catch(() => {});
    throw new ExecutionControlSignal('checkpoint', `当前步骤经过 ${MAX_MODEL_ROUNDS_PER_STEP} 轮仍未形成可验收结果。系统已保存目标、证据、未决问题和当前步骤，没有判定失败；可从恢复点继续或更换模型后继续。`);
  }

  function formalStep(runId, step) {
    const review = step.kind === 'review';
    return {
      stepId: step.id, type: review ? 'review' : 'tool', connector: `team-member:${step.employeeId}`,
      input: { assignment: step.assignment, employeeId: step.employeeId }, expectedOutputSchema: { type: 'object' },
      dependsOn: step.dependsOnStepIds || [], retryPolicy: { maxRetries: 3, backoffMs: 1000, maxBackoffMs: 30000 },
      idempotencyKey: review ? '' : `run-${runId}-${step.id}`, sideEffect: !review, compensateStepId: '', approvalRequired: false,
      metadata: { legacyStepId: step.id, employeeId: step.employeeId, kind: step.kind, revisionOfStepId: step.revisionOfStepId },
    };
  }

  async function beginStep(job, run, step, member) {
    const { runner } = await loadEngineModules();
    await checkpoint(job, { kind: 'step_started', stepId: step.id, summary: `${member.name}开始执行“${step.title}”` });
    await updateRun(job.taskId, (next) => {
      next.executionSessionId = options.sessionId;
      next.phase = 'executing';
      next.queuePosition = undefined;
      next.lastError = undefined;
      if (next.runner) {
        try { next.runner = runner.beginTaskStep(next.runner, step.id); } catch {}
      }
      if (next.recoveryContext) {
        next.recoveryContext.summary = `${member.name}正在执行“${step.title}”。`;
        next.recoveryContext.interruptedAt = undefined;
        next.recoveryContext.interruptionReason = undefined;
      }
    }, `原生 Adapter 开始步骤 ${step.id}`);
    emit(job, 'step_started', { stepId: step.id, member: publicMember(member), title: step.title });
  }

  async function completeStep(job, run, step, member, result) {
    const { runner } = await loadEngineModules();
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
      if (review.decision === 'reject') await appendRevisionSteps(job, step, review);
    } else {
      await checkpoint(job, { kind: 'step_completed', stepId: step.id, summary: result.content.slice(0, 700) });
      await updateRun(job.taskId, (next) => {
        if (next.runner) {
          try { next.runner = runner.recordTaskStepResult(next.runner, { stepId: step.id, success: true, output: { summary: result.content.slice(0, 1200) } }); next.plan = next.runner.plan; } catch {}
        }
      }, `原生 Adapter 完成步骤 ${step.id}`);
    }
    await appendExecutionMessage(job, run, member, result.content, 'text');
    emit(job, 'step_completed', { stepId: step.id, member: publicMember(member), summary: result.content.slice(0, 700) });
  }

  async function appendRevisionSteps(job, reviewStep, review) {
    const { runner } = await loadEngineModules();
    await updateRun(job.taskId, (run) => {
      const revisionCount = Number(run.revisionCount) || 0;
      const maxRevisions = Number(run.maxRevisions) || 2;
      if (revisionCount >= maxRevisions) throw new Error(`审查已连续退回 ${maxRevisions} 次，需要人工确认`);
      const target = (review.responsibleStepId ? run.steps.find((item) => item.id === review.responsibleStepId) : undefined)
        || [...run.steps].reverse().find((item) => item.status === 'completed' && item.kind !== 'review');
      const employeeId = review.responsibleEmployeeId || target?.employeeId;
      if (!employeeId) throw new Error('审查退回无法定位责任步骤');
      const count = revisionCount + 1;
      const now = Date.now();
      const member = job.members.get(employeeId);
      const reviewer = job.members.get(reviewStep.employeeId);
      const revision = {
        id: `revision-${job.taskId}-${count}-${employeeId}`, employeeId, order: run.steps.length + 1, kind: 'revision',
        title: `${member?.name || employeeId} · 第 ${count} 次修订`, assignment: `审查未通过：${review.reason}。只修复责任范围问题，不重做无关步骤。`,
        dependsOnStepIds: [reviewStep.id], revisionOfStepId: target?.id, status: 'queued', attempts: 0,
        evidence: [], events: [{ ts: now, type: 'status', detail: '审查退回后新增修订步骤' }],
      };
      const recheck = {
        id: `review-${job.taskId}-${count}-${reviewStep.employeeId}`, employeeId: reviewStep.employeeId, order: run.steps.length + 2, kind: 'review',
        title: `${reviewer?.name || reviewStep.employeeId} · 修订后复审`, assignment: `读取修订产出，验证“${review.reason}”是否已解决，再提交结构化审查。`,
        dependsOnStepIds: [revision.id], status: 'queued', attempts: 0, evidence: [], events: [{ ts: now, type: 'status', detail: '等待修订后复审' }],
      };
      run.steps.push(revision, recheck);
      run.revisionCount = count;
      if (run.runner) {
        try { run.runner = runner.appendTaskRunnerSteps(run.runner, [formalStep(run.id, revision), formalStep(run.id, recheck)], '原生 Adapter 审查退回'); run.plan = run.runner.plan; } catch {}
      }
    }, '原生 Adapter 根据审查退回追加修订与复审');
    emit(job, 'plan_extended', { stepId: reviewStep.id, reason: review.reason });
  }

  async function failStep(job, step, member, error) {
    const { runner } = await loadEngineModules();
    const reason = text(error?.message || error, 1200);
    try { await checkpoint(job, { kind: 'step_failed', stepId: step.id, summary: reason }); } catch {}
    await updateRun(job.taskId, (run) => {
      run.status = 'failed'; run.phase = 'blocked'; run.lastError = reason;
      run.handoff = { ts: Date.now(), completed: run.steps.filter((item) => item.status === 'completed').map((item) => item.title), blocked: reason,
        nextAction: '修复提示中的模型、授权、配置或工作区问题后继续，已完成内容不会重做。' };
      if (run.runner) {
        try { run.runner = runner.recordTaskStepResult(run.runner, { stepId: step.id, success: false, retryable: false, error: reason }); run.plan = run.runner.plan; } catch {}
      }
      if (run.recoveryContext) {
        run.recoveryContext.summary = `${member.name}的步骤被阻塞，主进程已保留上下文。`;
        run.recoveryContext.unresolvedIssues = [...run.recoveryContext.unresolvedIssues, reason].slice(-20);
        run.recoveryContext.interruptedAt = Date.now();
        run.recoveryContext.interruptionReason = reason;
      }
    }, `原生 Adapter 步骤失败 ${step.id}`);
    emit(job, 'step_failed', { stepId: step.id, member: publicMember(member), error: reason });
  }

  async function finishRun(job) {
    const run = await readRun(job.taskId);
    const unfinished = run.steps.filter((step) => step.status !== 'completed');
    const needsCommand = /代码|程序|安装|部署|构建|编译|运行|测试/iu.test(run.request);
    const needsConnection = /连接器|知识库|mcp|obsidian|ima/iu.test(run.request);
    const evidence = run.evidence || [];
    const checks = [
      { kind: 'file', label: '真实产出', passed: evidence.some((item) => item.kind === 'file' && item.verified), detail: '至少一个文件写入并校验成功' },
      ...(needsCommand ? [{ kind: 'run', label: '运行结果', passed: evidence.some((item) => item.kind === 'run' && item.verified), detail: '任务涉及代码或安装，必须有成功运行证据' }] : []),
      ...(needsConnection ? [{ kind: 'connection', label: '连接验证', passed: evidence.some((item) => item.kind === 'connection' && item.verified), detail: '任务涉及外部连接，必须有最小真实调用证据' }] : []),
      ...(run.steps.some((step) => step.kind === 'review') ? [{ kind: 'review', label: '责任审查', passed: evidence.some((item) => item.kind === 'review' && item.verified), detail: '审查步骤必须明确通过' }] : []),
    ];
    const blocked = checks.filter((item) => !item.passed);
    if (unfinished.length || blocked.length) throw new Error(unfinished.length ? `仍有 ${unfinished.length} 个步骤未完成` : `验收未通过：${blocked.map((item) => item.detail).join('；')}`);
    await updateRun(job.taskId, (next) => {
      next.verification = checks.map((item) => ({ kind: item.kind, label: item.label, status: item.passed ? 'passed' : 'blocked', detail: item.detail }));
      next.status = 'completed'; next.phase = 'completed'; next.lastError = undefined;
      next.handoff = undefined;
      if (next.recoveryContext) next.recoveryContext.summary = '任务已由主进程原生 Adapter 完成并通过验收。';
    }, '原生 Adapter 完成最终验收');
    await checkpoint(job, { kind: 'run_finished', finalStatus: 'completed', summary: '主进程原生 Adapter 已完成任务并通过验收' });
  }

  async function execute(job) {
    job.state = 'running';
    job.startedAt = job.startedAt || Date.now();
    emit(job, 'job_started');
    try {
      await claim(job);
      while (true) {
        const run = await assertCanContinue(job);
        const pending = run.steps.filter((step) => ['queued', 'paused', 'failed'].includes(step.status));
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
      job.state = 'completed';
      job.finishedAt = Date.now();
      emit(job, 'job_completed');
    } catch (error) {
      if (error instanceof ExecutionControlSignal) {
        job.state = error.kind === 'stop' || error.kind === 'close' ? 'stopped' : error.kind === 'awaiting_user' ? 'awaiting_user' : 'paused';
        job.lastError = error.message;
        emit(job, 'job_controlled', { control: error.kind, error: error.message });
        if (error.kind === 'steer') {
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
        } else if (error.kind === 'awaiting_user') {
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
        } else if (error.kind === 'checkpoint') {
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
      } else {
        job.state = 'failed';
        job.lastError = text(error?.message || error, 1200);
        try { await checkpoint(job, { kind: 'run_failed', summary: job.lastError }); } catch {}
        emit(job, 'job_failed', { error: job.lastError });
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
    try { await ensureRun({ ...input, taskId }); }
    catch (error) { return { ok: false, error: error?.message || String(error) }; }
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
      taskId, state: 'queued', createdAt: Date.now(), updatedAt: Date.now(),
      members, attachments: clone(input.attachments || []), extraSystemContext: text(input.extraSystemContext, 80000),
      executionPolicy: clone(input.executionPolicy || { sandboxEnabled: true, approvalMode: 'delegate', connectorApprovalMode: 'delegate' }),
      connectors: clone(input.connectors || []), connectorActions,
      connectorTools: clone(input.connectorTools || []), steering: [], events: [], eventSequence: 0, messageSequence: 0,
      checkpointSequence: 0, modelRounds: 0, toolCalls: 0,
      claimSequence: 0,
    };
    jobs.set(taskId, job);
    enqueueJob(job, 'submitted');
    return { ok: true, job: safeJob(job) };
  }

  function handleControl(command, result) {
    const job = jobs.get(String(command?.taskId || ''));
    if (!job || !result?.ok) return;
    if (command.type === 'pause') { job.control = 'pause'; job.abortController?.abort(); emit(job, 'control_received', { control: 'pause' }); }
    if (command.type === 'stop' || command.type === 'close') { job.control = command.type; job.abortController?.abort(); emit(job, 'control_received', { control: command.type }); }
  }

  async function steer(taskId, message) {
    const job = jobs.get(String(taskId || ''));
    const value = text(message, 2000);
    if (!job || !ACTIVE_JOB_STATES.has(job.state)) return { ok: false, error: '任务当前没有由原生 Adapter 执行' };
    if (!value) return { ok: false, error: '插话内容不能为空' };
    const { contextRouter } = await loadEngineModules();
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

  function stopAll() {
    for (const job of jobs.values()) {
      if (!ACTIVE_JOB_STATES.has(job.state)) continue;
      job.control = 'pause';
      job.abortController?.abort();
      if (job.heartbeat) clearInterval(job.heartbeat);
    }
  }

  return { start, steer, status, events, handleControl, stopAll };
}

module.exports = {
  NATIVE_ADAPTER_VERSION,
  MAX_TOOL_CALLS_PER_STEP,
  MAX_MODEL_ROUNDS_PER_STEP,
  ExecutionControlSignal,
  createNativeExecutionAdapter,
  resolveEndpoint,
};
