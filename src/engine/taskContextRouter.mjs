import { appendTaskContextEvent, buildTaskContextPrompt, restoreTaskContext } from './taskContext.mjs';

const ROUTER_VERSION = 1;
const RECOVERY_VERSION = 1;
const DEFAULT_CONTEXT_TOKENS = 128000;

function text(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stable(value[key])]));
}

function checksum(value) {
  const source = JSON.stringify(stable(value));
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
}

export function estimateTokens(value) {
  let tokens = 0;
  for (const char of String(value ?? '')) tokens += /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char) ? 0.67 : 0.25;
  return Math.max(0, Math.ceil(tokens));
}

export function classifyTaskInput(message, task = {}) {
  const value = text(message, 2000);
  const compact = value.replace(/\s+/gu, '');
  const status = String(task.status || 'running');
  let kind = 'constraint';
  let action = 'merge_and_continue';
  let priority = 60;
  let replyRequired = false;

  if (/^(?:暂停|先停|停一下|不要继续|别做了)(?:任务|工作|执行)?[。！!]?$/u.test(compact)) {
    kind = 'control_pause'; action = 'pause'; priority = 100; replyRequired = true;
  } else if (/^(?:停止|取消|终止|关闭)(?:任务|工作|执行)?[。！!]?$/u.test(compact)) {
    kind = 'control_stop'; action = 'stop'; priority = 100; replyRequired = true;
  } else if (/^(?:继续|恢复|接着)(?:任务|工作|执行)?[。！!]?$/u.test(compact)) {
    kind = 'control_resume'; action = status === 'paused' ? 'resume' : 'merge_and_continue'; priority = 95; replyRequired = true;
  } else if (/(?:不对|错了|不是这个|理解错|偏题|没有意义|别再重复|重新理解|胡说)/u.test(value)) {
    kind = 'correction'; action = 'preempt_and_replan'; priority = 95; replyRequired = true;
  } else if (/(?:现在|当前|目前|进度|做到哪|为什么|怎么回事|卡住|还在做).{0,12}(?:吗|呢|了|\?|？)?$/u.test(value) || /[?？]$/u.test(value)) {
    kind = 'question'; action = 'reply_then_continue'; priority = 90; replyRequired = true;
  } else if (/^(?:另外|新任务|先做这个|换个任务|再帮我)/u.test(compact)) {
    kind = 'new_task'; action = 'queue_separately'; priority = 85; replyRequired = true;
  } else if (/(?:改成|需要|必须|不要|同时|补充|加上|保留|去掉|按照)/u.test(value)) {
    kind = 'constraint'; action = 'preempt_and_replan'; priority = 80; replyRequired = true;
  }

  return {
    routerVersion: ROUTER_VERSION,
    kind,
    action,
    priority,
    replyRequired,
    shouldPreempt: ['pause', 'stop', 'preempt_and_replan', 'reply_then_continue'].includes(action),
    shouldMergeWithGoal: !['stop', 'queue_separately'].includes(action),
    message: value,
  };
}

export function createContextBudget(input = {}) {
  const contextWindowTokens = Math.max(8000, Number(input.contextWindowTokens) || DEFAULT_CONTEXT_TOKENS);
  return {
    budgetVersion: 1,
    contextWindowTokens,
    reserveTokens: Math.max(2000, Number(input.reserveTokens) || Math.min(16000, Math.round(contextWindowTokens * 0.12))),
    promptTokens: Math.max(0, Number(input.promptTokens) || 0),
    completionTokens: Math.max(0, Number(input.completionTokens) || 0),
    estimatedTokens: Math.max(0, Number(input.estimatedTokens) || 0),
    toolAttempts: Math.max(0, Number(input.toolAttempts) || 0),
    modelRounds: Math.max(0, Number(input.modelRounds) || 0),
    noProgressRounds: Math.max(0, Number(input.noProgressRounds) || 0),
    stage: Math.max(1, Number(input.stage) || 1),
    compactions: Math.max(0, Number(input.compactions) || 0),
    updatedAt: Number(input.updatedAt) || Date.now(),
  };
}

export function recordContextUsage(snapshot, usage = {}) {
  const state = createContextBudget(snapshot);
  state.promptTokens += Math.max(0, Number(usage.promptTokens) || 0);
  state.completionTokens += Math.max(0, Number(usage.completionTokens) || 0);
  state.estimatedTokens = Math.max(state.estimatedTokens, Math.max(0, Number(usage.estimatedTokens) || 0));
  state.toolAttempts += Math.max(0, Number(usage.toolAttempts) || 0);
  state.modelRounds += Math.max(0, Number(usage.modelRounds) || 0);
  state.noProgressRounds = usage.progress === true ? 0 : state.noProgressRounds + (usage.progress === false ? 1 : 0);
  state.updatedAt = Date.now();
  return state;
}

export function assessContextBudget(snapshot, options = {}) {
  const state = createContextBudget(snapshot);
  const current = Math.max(state.estimatedTokens, Number(options.currentPromptTokens) || 0);
  const usable = Math.max(1, state.contextWindowTokens - state.reserveTokens);
  const ratio = current / usable;
  let action = 'continue';
  let reason = '上下文与执行预算充足';
  if (state.noProgressRounds >= 5) {
    action = 'replan'; reason = '连续多轮没有新增证据，需要更换本质不同的路线';
  } else if (ratio >= 0.92) {
    action = state.compactions >= 2 ? 'checkpoint' : 'compact';
    reason = action === 'compact' ? '上下文接近上限，先压缩已完成内容' : '上下文多次压缩后仍接近上限，需要写入恢复点再续跑';
  } else if (ratio >= 0.72) {
    action = 'compact'; reason = '上下文超过安全水位，保留目标、证据和未决问题后压缩';
  }
  return { ...state, currentTokens: current, usableTokens: usable, ratio, action, reason };
}

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  try { return JSON.stringify(message?.content ?? ''); } catch { return ''; }
}

export function compactMessageWindow(messages, options = {}) {
  const source = Array.isArray(messages) ? messages : [];
  if (source.length <= 8) return { messages: clone(source), removed: 0, summary: '' };
  const system = source.filter((message) => message.role === 'system').slice(0, 1);
  const tail = source.slice(-Math.max(6, Number(options.keepRecent) || 10));
  const removed = source.slice(system.length, Math.max(system.length, source.length - tail.length));
  const facts = removed.slice(-24).map((message) => `${message.role}：${text(messageText(message), 260)}`).filter((item) => item.length > 3);
  const summary = `阶段压缩摘要（仅压缩对话，原始目标与结构化证据仍以任务账本为准）：\n${facts.map((item) => `- ${item}`).join('\n')}`.slice(0, 7000);
  return { messages: [...system, { role: 'system', content: summary }, ...tail], removed: removed.length, summary };
}

export function createRecoveryCapsule(run, input = {}) {
  const context = restoreTaskContext(run?.context, { taskId: run?.id, goal: run?.goal ?? run?.request, acceptanceCriteria: run?.acceptanceCriteria });
  const payload = {
    recoveryVersion: RECOVERY_VERSION,
    taskId: text(run?.id, 160),
    teamId: text(run?.teamId, 160),
    immutableGoal: text(run?.goal ?? run?.request, 4000),
    acceptanceCriteria: Array.isArray(run?.acceptanceCriteria) ? run.acceptanceCriteria.slice(0, 12).map((item) => text(item, 500)) : [],
    status: text(run?.status, 40),
    phase: text(run?.phase, 40),
    workspaceId: text(run?.workspaceId, 500),
    completedSteps: (run?.steps || []).filter((step) => step.status === 'completed').map((step) => ({ id: step.id, title: text(step.title, 240), evidence: (step.evidence || []).filter((item) => item.verified).slice(-5).map((item) => text(item.summary, 500)) })),
    pendingSteps: (run?.steps || []).filter((step) => step.status !== 'completed').map((step) => ({ id: step.id, title: text(step.title, 240), status: step.status, attempts: Number(step.attempts) || 0, dependsOnStepIds: step.dependsOnStepIds || [] })),
    verifiedFacts: context.summary.verifiedFacts.slice(-18),
    artifacts: context.summary.artifactPaths.slice(-20),
    unresolvedIssues: [...new Set([...(context.openIssues || []), ...(run?.recoveryContext?.unresolvedIssues || [])])].slice(-18),
    steeringMessages: (run?.recoveryContext?.steeringMessages || []).slice(-20),
    budget: createContextBudget(run?.recoveryContext?.budget),
    lastCheckpoint: clone(run?.worker?.lastCheckpoint),
    reason: text(input.reason || '任务状态检查点', 500),
    createdAt: Number(input.createdAt) || Date.now(),
  };
  return { ...payload, checksum: checksum(payload) };
}

export function verifyRecoveryCapsule(capsule) {
  if (!capsule || capsule.recoveryVersion !== RECOVERY_VERSION || typeof capsule.checksum !== 'string') return false;
  const payload = { ...capsule };
  delete payload.checksum;
  return checksum(payload) === capsule.checksum && Boolean(capsule.taskId && capsule.immutableGoal);
}

export function routeTaskInput(run, message, input = {}) {
  const next = clone(run);
  const route = classifyTaskInput(message, next);
  const now = Number(input.createdAt) || Date.now();
  next.context = appendTaskContextEvent(next.context, {
    ts: now,
    type: route.kind === 'correction' ? 'correction' : route.kind.startsWith('control_') ? 'control' : 'steering',
    source: 'user',
    summary: route.message,
    data: { routerVersion: route.routerVersion, action: route.action, priority: route.priority },
  });
  next.recoveryContext ||= { summary: '', completedEvidence: [], unresolvedIssues: [], steeringMessages: [], budget: createContextBudget() };
  if (route.shouldMergeWithGoal) next.recoveryContext.steeringMessages = [...(next.recoveryContext.steeringMessages || []), route.message].slice(-20);
  next.recoveryContext.summary = route.action === 'queue_separately'
    ? '收到一项独立新任务，当前任务保持原目标并等待单独排队。'
    : route.action === 'pause' ? '用户要求暂停，已保存当前上下文。'
      : '已接收用户最新内容，将先回应并重新核对当前路线。';
  next.recoveryContext.interruptedAt = route.shouldPreempt ? now : next.recoveryContext.interruptedAt;
  next.recoveryContext.interruptionReason = route.shouldPreempt ? route.message : next.recoveryContext.interruptionReason;
  next.recoveryCapsule = createRecoveryCapsule(next, { reason: `用户插话：${route.kind}`, createdAt: now });
  next.updatedAt = now;
  return { route, run: next };
}

export function buildRecoveryPrompt(run, maxLength = 18000) {
  const capsule = verifyRecoveryCapsule(run?.recoveryCapsule) ? run.recoveryCapsule : createRecoveryCapsule(run || {});
  const contextPrompt = buildTaskContextPrompt(run?.context, Math.round(maxLength * 0.6));
  const capsulePrompt = [
    '## 可恢复执行胶囊',
    `原始目标（不可改写）：${capsule.immutableGoal}`,
    `当前阶段：${capsule.phase || capsule.status}`,
    capsule.completedSteps.length ? `已完成步骤：${capsule.completedSteps.map((step) => step.title).join('；')}` : '已完成步骤：暂无',
    capsule.pendingSteps.length ? `未完成步骤：${capsule.pendingSteps.map((step) => `${step.title}(${step.status})`).join('；')}` : '未完成步骤：暂无',
    capsule.unresolvedIssues.length ? `未决问题：${capsule.unresolvedIssues.join('；')}` : '',
    capsule.steeringMessages.length ? `用户最新补充：${capsule.steeringMessages.join('；')}` : '',
    '恢复后从第一个未完成且依赖满足的步骤继续。已完成步骤不得重做，除非新的用户纠错明确使其失效。',
  ].filter(Boolean).join('\n');
  return `${capsulePrompt}\n\n${contextPrompt}`.slice(0, maxLength);
}

export const TASK_CONTEXT_ROUTER_VERSION = ROUTER_VERSION;
export const TASK_RECOVERY_CAPSULE_VERSION = RECOVERY_VERSION;
