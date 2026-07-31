const CONTROLLER_VERSION = 2;

const NORMALIZED_FAILURE_CLASS = Object.freeze({
  approval: 'user_decision', authentication: 'credential', authorization: 'user_decision',
  rate_limit: 'network', timeout: 'timeout', network: 'network', server: 'network',
  permission: 'permission', dependency: 'execution_environment', not_found: 'resource_not_found',
  invalid_input: 'input', conflict: 'protocol', duplicate: 'evidence_insufficient',
  unsupported: 'protocol', business: 'protocol', off_target: 'model_misjudgment',
  unknown: 'evidence_insufficient', none: 'none',
});

const FAILURE_DEFINITIONS = [
  { code: 'approval', pattern: /没有获得.{0,12}批准|审批.{0,8}(?:拒绝|取消)|用户取消/u, retryable: false, needsUser: true, label: '操作尚未获得批准' },
  { code: 'authentication', pattern: /(?:HTTP\s*)?(?:401|403)|unauthorized|forbidden|api[ _-]?key|鉴权|密钥.{0,12}(?:错误|无效|缺少)|缺少.{0,12}(?:凭据|密钥)/iu, retryable: false, needsUser: true, label: '账号或凭据未通过验证' },
  { code: 'authorization', pattern: /验证码|captcha|oauth|需要登录|尚未登录|外部授权|完成授权/iu, retryable: false, needsUser: true, label: '需要用户完成登录或授权' },
  { code: 'rate_limit', pattern: /(?:HTTP\s*)?429|rate.?limit|too many requests|频率限制|请求过多/iu, retryable: true, needsUser: false, label: '服务触发频率限制' },
  { code: 'timeout', pattern: /timeout|timed out|aborted|signal is aborted|超时|等待时间太久/iu, retryable: true, needsUser: false, label: '服务响应超时' },
  { code: 'network', pattern: /ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|network|socket|连接重置|网络|连接失败/iu, retryable: true, needsUser: false, label: '网络连接失败' },
  { code: 'server', pattern: /(?:HTTP\s*)?5\d\d|bad gateway|service unavailable|服务器.{0,8}(?:错误|异常)/iu, retryable: true, needsUser: false, label: '外部服务暂时异常' },
  { code: 'permission', pattern: /EACCES|EPERM|permission|access denied|权限|拒绝访问|只读/iu, retryable: false, needsUser: false, label: '当前路径或操作权限不足' },
  { code: 'dependency', pattern: /Cannot find module|module not found|command not found|not recognized|缺少.{0,12}(?:依赖|模块|程序)|未安装|找不到命令/iu, retryable: false, needsUser: false, label: '当前路线缺少依赖或程序' },
  { code: 'not_found', pattern: /ENOENT|404|not found|找不到|不存在|没有找到/iu, retryable: false, needsUser: false, label: '目标资源没有找到' },
  { code: 'invalid_input', pattern: /invalid|malformed|syntax|parse|JSON|不能为空|参数.{0,8}(?:错误|无效)|格式.{0,8}(?:错误|不正确)|(?:HTTP\s*)?(?:400|422)/iu, retryable: false, needsUser: false, label: '参数或数据格式不适用' },
  { code: 'conflict', pattern: /version|版本.{0,12}(?:不一致|冲突|不兼容)|conflict|already exists|已存在/iu, retryable: false, needsUser: false, label: '版本或现有状态发生冲突' },
  { code: 'duplicate', pattern: /重复调用|完全相同|继续读取不会|达到.{0,8}尝试次数|不会产生新证据/iu, retryable: false, needsUser: false, label: '当前路线正在重复且没有新证据' },
  { code: 'unsupported', pattern: /不支持|unsupported|没有对应.{0,12}(?:适配器|能力)|能力缺失/iu, retryable: false, needsUser: false, label: '当前工具不支持这项操作' },
  { code: 'business', pattern: /业务码|业务状态|验证未通过|验收未通过|接口返回.{0,16}(?:失败|错误|code)/iu, retryable: false, needsUser: false, label: '外部服务业务验收未通过' },
  { code: 'off_target', pattern: /偏题|与原始目标不一致|丢失了.{0,20}(?:条件|地点|时间|主题)|没有覆盖.{0,20}(?:目标|地点|时间|主题)|不满足指定方式/u, retryable: false, needsUser: false, label: '结果没有回答原始目标' },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashRoute(value) {
  let hash = 2166136261;
  for (const char of String(value ?? '')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `route-${(hash >>> 0).toString(36)}`;
}

function hashResult(value) {
  const normalized = String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, 12000);
  return hashRoute(normalized).replace(/^route-/u, 'result-');
}

function normalizedFailure(code) {
  return NORMALIZED_FAILURE_CLASS[code] ?? 'evidence_insufficient';
}

function defaultBudgets(options = {}) {
  return {
    modelCalls: Number.isFinite(options.maxModelCalls) ? options.maxModelCalls : 48,
    toolCalls: Number.isFinite(options.maxToolCalls) ? options.maxToolCalls : (Number.isFinite(options.maxAttempts) ? options.maxAttempts : 96),
    elapsedMs: Number.isFinite(options.maxElapsedMs) ? options.maxElapsedMs : 30 * 60 * 1000,
    retries: Number.isFinite(options.maxRetries) ? options.maxRetries : 12,
    tokens: Number.isFinite(options.maxTokens) ? options.maxTokens : 400_000,
  };
}

function emptyUsage(now) {
  return { modelCalls: 0, toolCalls: 0, elapsedMs: 0, retries: 0, tokens: 0, lastUpdatedAt: now };
}

function budgetExceeded(state, now = Date.now()) {
  const usage = state.usage ?? emptyUsage(now);
  const budgets = state.budgets ?? defaultBudgets({ maxAttempts: state.maxAttempts });
  const elapsedMs = Math.max(usage.elapsedMs ?? 0, now - (state.createdAt ?? now));
  if (usage.modelCalls >= budgets.modelCalls) return { dimension: 'modelCalls', reason: `模型调用已达到 ${budgets.modelCalls} 次上限` };
  if (usage.toolCalls >= budgets.toolCalls) return { dimension: 'toolCalls', reason: `工具调用已达到 ${budgets.toolCalls} 次上限` };
  if (elapsedMs >= budgets.elapsedMs) return { dimension: 'elapsedMs', reason: `连续执行已达到 ${Math.round(budgets.elapsedMs / 60000)} 分钟上限` };
  if (usage.retries >= budgets.retries) return { dimension: 'retries', reason: `恢复重试已达到 ${budgets.retries} 次上限` };
  if (usage.tokens >= budgets.tokens) return { dimension: 'tokens', reason: `上下文与输出已使用约 ${budgets.tokens.toLocaleString()} Token` };
  return undefined;
}

function decision(kind, reason, extra = {}) {
  return { kind, reason, at: Date.now(), ...extra };
}

function routeRecord(state, routeId, toolName) {
  let route = state.routeHistory.find((item) => item.id === routeId);
  if (!route) {
    route = { id: routeId, toolName, strategySignature: routeId, routeDifference: '', attempts: 0, failures: 0, successes: 0, lastOutcome: 'pending', resultFingerprints: [], updatedAt: Date.now() };
    state.routeHistory.push(route);
    state.routeHistory = state.routeHistory.slice(-24);
  }
  return route;
}

function unresolvedFailures(state) {
  return state.failures.filter((item) => !item.resolved);
}

export function classifyExecutionFailure(input = {}) {
  if (input.success) return { code: 'none', retryable: false, needsUser: false, label: '执行成功' };
  const raw = `${input.result ?? ''}\n${input.reason ?? ''}`;
  const matched = FAILURE_DEFINITIONS.find((item) => item.pattern.test(raw));
  const base = matched ? { code: matched.code, retryable: matched.retryable, needsUser: matched.needsUser, label: matched.label }
    : { code: 'unknown', retryable: false, needsUser: false, label: '执行结果没有达到预期' };
  return { ...base, category: normalizedFailure(base.code) };
}

export function createExecutionController(options = {}) {
  const now = Date.now();
  return {
    version: CONTROLLER_VERSION,
    goal: String(options.goal ?? '').trim(),
    acceptanceCriteria: Array.isArray(options.acceptanceCriteria) ? options.acceptanceCriteria.filter(Boolean).slice(0, 12) : [],
    acceptanceIssues: [],
    requiresEvidence: options.requiresEvidence !== false,
    status: 'running',
    phase: 'observe',
    attemptCount: 0,
    progressCount: 0,
    consecutiveFailures: 0,
    recoveryCycles: 0,
    routeChanges: 0,
    maxAttempts: Number.isFinite(options.maxAttempts) ? options.maxAttempts : 96,
    maxSameRouteRetries: Number.isFinite(options.maxSameRouteRetries) ? options.maxSameRouteRetries : 1,
    maxRouteChanges: Number.isFinite(options.maxRouteChanges) ? options.maxRouteChanges : 6,
    budgets: defaultBudgets(options),
    usage: emptyUsage(now),
    budgetStopReason: undefined,
    routeHistory: [],
    forbiddenRouteIds: [],
    resultFingerprints: [],
    observations: [],
    evidence: [],
    checkpoints: [],
    lastCheckpoint: undefined,
    unresolvedQuestions: [],
    failures: [],
    activeFailureId: undefined,
    conclusionReviews: 0,
    latestInstruction: '',
    decision: decision('act', '先执行能产生真实证据的下一步。'),
    createdAt: now,
    updatedAt: now,
  };
}

export function restoreExecutionController(snapshot, options = {}) {
  if (!snapshot || ![1, CONTROLLER_VERSION].includes(snapshot.version)) return createExecutionController(options);
  const restored = { ...createExecutionController(options), ...clone(snapshot), version: CONTROLLER_VERSION, status: 'running', phase: 'observe', updatedAt: Date.now() };
  restored.budgets = { ...defaultBudgets({ ...options, maxAttempts: restored.maxAttempts }), ...(snapshot.budgets ?? {}) };
  restored.usage = { ...emptyUsage(Date.now()), ...(snapshot.usage ?? {}) };
  restored.resultFingerprints = Array.isArray(snapshot.resultFingerprints) ? snapshot.resultFingerprints : [];
  restored.checkpoints = Array.isArray(snapshot.checkpoints) ? snapshot.checkpoints : [];
  restored.unresolvedQuestions = Array.isArray(snapshot.unresolvedQuestions) ? snapshot.unresolvedQuestions : [];
  restored.routeHistory = restored.routeHistory.map((route) => ({ strategySignature: route.id, routeDifference: '', resultFingerprints: [], ...route }));
  const active = restored.failures.find((item) => item.id === restored.activeFailureId && !item.resolved);
  restored.decision = active
    ? decision(active.needsUser ? 'await_user' : active.retryable ? 'retry' : 'switch_route', `继续处理上次未解决的问题：${active.label}`, { failureClass: active.classification, routeId: active.routeId, requiresUser: active.needsUser })
    : decision('act', '从已保存进度继续执行尚未满足的目标。');
  if (active?.needsUser) {
    restored.status = 'awaiting_user';
    restored.phase = 'blocked';
  } else if (active?.routeId && active.retryable) {
    restored.forbiddenRouteIds = restored.forbiddenRouteIds.filter((id) => id !== active.routeId);
  }
  return restored;
}

export function canExecuteRoute(state, input = {}) {
  const routeId = hashRoute(input.routeKey ?? `${input.toolName ?? 'tool'}`);
  if (state.status === 'awaiting_user') return { allowed: false, routeId, reason: '当前缺少只有用户才能提供的凭据、授权或批准，不能继续假装执行。' };
  if (state.status === 'blocked' || state.status === 'stopped' || state.status === 'completed') return { allowed: false, routeId, reason: '执行控制器已经停止当前任务路线。' };
  const exceeded = budgetExceeded(state);
  if (exceeded) return { allowed: false, routeId, reason: `${exceeded.reason}，必须保存检查点并交接，不能继续消耗预算。` };
  const route = state.routeHistory.find((item) => item.id === routeId);
  if (route?.lastOutcome === 'success') return { allowed: false, routeId, reason: '这一步已经成功并留下证据，重复执行不会推进目标。' };
  if (state.forbiddenRouteIds.includes(routeId) && !(state.decision.kind === 'retry' && state.decision.routeId === routeId)) {
    return { allowed: false, routeId, reason: '这条路线已经被证明无效，必须更换工具、参数来源或实现方法。' };
  }
  if (state.attemptCount >= state.maxAttempts) return { allowed: false, routeId, reason: '执行尝试已达到安全上限，必须停止并交接真实阻塞。' };
  return { allowed: true, routeId };
}

export function observeExecutionResult(snapshot, input = {}) {
  const state = clone(snapshot);
  const routeId = hashRoute(input.routeKey ?? `${input.toolName ?? 'tool'}`);
  const route = routeRecord(state, routeId, input.toolName ?? 'tool');
  const now = Date.now();
  const success = Boolean(input.success);
  const resultFingerprint = hashResult(input.result ?? input.reason ?? '');
  const outcomeFingerprint = `${routeId}:${success ? 'success' : 'failure'}:${resultFingerprint}`;
  const duplicateOutcome = state.resultFingerprints.includes(outcomeFingerprint);
  const previousRoute = state.decision?.kind === 'switch_route'
    ? state.routeHistory.find((item) => item.id === state.decision.routeId)
    : undefined;
  route.strategySignature = String(input.strategySignature ?? routeId);
  if (previousRoute && previousRoute.id !== routeId) {
    route.routeDifference = String(input.routeDifference ?? `${previousRoute.toolName}/${previousRoute.strategySignature} -> ${route.toolName}/${route.strategySignature}`).slice(0, 600);
  }
  route.resultFingerprints = [...new Set([...(route.resultFingerprints ?? []), resultFingerprint])].slice(-12);
  route.attempts += 1;
  route.updatedAt = now;
  state.attemptCount += 1;
  state.usage = { ...emptyUsage(now), ...(state.usage ?? {}) };
  if (input.toolName === 'model_request') state.usage.modelCalls += 1;
  else state.usage.toolCalls += 1;
  state.usage.elapsedMs = Math.max(state.usage.elapsedMs, now - state.createdAt);
  state.usage.tokens += Math.max(0, Number(input.tokenUsage) || 0);
  state.usage.lastUpdatedAt = now;
  state.resultFingerprints = [...new Set([...(state.resultFingerprints ?? []), outcomeFingerprint])].slice(-80);
  state.phase = 'observe';
  state.observations.push({ ts: now, toolName: input.toolName ?? 'tool', routeId, success, resultFingerprint, duplicate: duplicateOutcome });
  state.observations = state.observations.slice(-40);

  if (success) {
    route.successes += 1;
    route.lastOutcome = 'success';
    state.progressCount += 1;
    state.consecutiveFailures = 0;
    if (input.contributesEvidence !== false) {
      const evidenceId = `evidence-${now}-${state.evidence.length + 1}`;
      state.evidence.push({ id: evidenceId, ts: now, toolName: input.toolName ?? 'tool', routeId, resultFingerprint, verified: input.verified !== false, kind: input.evidenceKind ?? 'progress', summary: String(input.result ?? '').replace(/\s+/gu, ' ').trim().slice(0, 240) });
      state.evidence = state.evidence.slice(-30);
      const checkpoint = {
        id: `checkpoint-${now}`,
        ts: now,
        phase: state.phase,
        goal: state.goal,
        latestInstruction: state.latestInstruction,
        routeId,
        evidenceIds: state.evidence.filter((item) => item.verified).slice(-12).map((item) => item.id),
        unresolvedQuestions: [...(state.unresolvedQuestions ?? [])],
      };
      state.lastCheckpoint = checkpoint;
      state.checkpoints = [...(state.checkpoints ?? []), checkpoint].slice(-12);
    }
    // A successful alternate route is evidence that the preceding recovery problem
    // was overcome. Keeping older attempts unresolved would deadlock completion.
    state.failures.forEach((item) => { item.resolved = true; });
    state.activeFailureId = undefined;
    state.status = 'running';
    state.decision = decision('continue', '这一步产生了新证据，保留结果并继续检查尚未满足的目标。', { routeId });
    state.updatedAt = now;
    return state;
  }

  route.failures += 1;
  route.lastOutcome = 'failure';
  state.consecutiveFailures += 1;
  const failure = duplicateOutcome
    ? { code: 'duplicate', category: 'evidence_insufficient', retryable: false, needsUser: false, label: '同一路线返回了完全相同的结果' }
    : classifyExecutionFailure(input);
  const failureId = `failure-${now}-${state.failures.length + 1}`;
  state.failures.push({
    id: failureId,
    ts: now,
    toolName: input.toolName ?? 'tool',
    routeId,
    classification: failure.code,
    category: failure.category,
    label: failure.label,
    retryable: failure.retryable,
    needsUser: failure.needsUser,
    resolved: false,
  });
  state.failures = state.failures.slice(-20);
  state.activeFailureId = failureId;
  if (route.failures > 1 || duplicateOutcome) state.usage.retries += 1;

  if (failure.needsUser) {
    state.status = 'awaiting_user';
    state.phase = 'blocked';
    state.decision = decision('await_user', failure.label, { failureClass: failure.code, routeId, requiresUser: true });
    state.unresolvedQuestions = [...new Set([...(state.unresolvedQuestions ?? []), failure.label])].slice(-8);
  } else if (failure.retryable && route.failures <= (Number.isFinite(input.retryLimit) ? input.retryLimit : state.maxSameRouteRetries)) {
    state.status = 'running';
    state.phase = 'recover';
    state.decision = decision('retry', `${failure.label}，允许在保留上下文后重试一次。`, { failureClass: failure.code, routeId });
  } else if (state.routeChanges < state.maxRouteChanges) {
    state.status = 'running';
    state.phase = 'recover';
    state.recoveryCycles += 1;
    state.routeChanges += 1;
    if (!state.forbiddenRouteIds.includes(routeId)) state.forbiddenRouteIds.push(routeId);
    state.forbiddenRouteIds = state.forbiddenRouteIds.slice(-16);
    state.decision = decision('switch_route', `${failure.label}，当前路线已停止，必须选择本质不同的方法。`, { failureClass: failure.code, routeId });
  } else {
    state.status = 'blocked';
    state.phase = 'blocked';
    state.decision = decision('stop', '多条替代路线均未形成新证据，已停止重复尝试并保留现有成果。', { failureClass: failure.code, routeId });
  }
  const exceeded = budgetExceeded(state, now);
  if (exceeded) {
    state.status = 'blocked';
    state.phase = 'blocked';
    state.budgetStopReason = exceeded.dimension;
    state.decision = decision('stop', `${exceeded.reason}。已保存最后检查点和已有证据。`, { failureClass: 'duplicate' });
  }
  state.updatedAt = now;
  return state;
}

export function recordExecutionUsage(snapshot, delta = {}) {
  const state = clone(snapshot);
  const now = Date.now();
  state.usage = { ...emptyUsage(now), ...(state.usage ?? {}) };
  for (const key of ['modelCalls', 'toolCalls', 'elapsedMs', 'retries', 'tokens']) {
    const amount = Math.max(0, Number(delta[key]) || 0);
    state.usage[key] += amount;
  }
  state.usage.elapsedMs = Math.max(state.usage.elapsedMs, now - state.createdAt);
  state.usage.lastUpdatedAt = now;
  const exceeded = budgetExceeded(state, now);
  if (exceeded && state.status === 'running') {
    state.status = 'blocked';
    state.phase = 'blocked';
    state.budgetStopReason = exceeded.dimension;
    state.decision = decision('stop', `${exceeded.reason}。已保存最后检查点和已有证据。`);
  }
  state.updatedAt = now;
  return state;
}

export function evaluateExecutionConclusion(snapshot, input = {}) {
  const state = clone(snapshot);
  const now = Date.now();
  state.conclusionReviews += 1;
  if (state.status === 'awaiting_user' || state.status === 'blocked' || state.status === 'stopped') {
    state.updatedAt = now;
    return state;
  }
  const unresolved = unresolvedFailures(state);
  if (unresolved.length > 0) {
    const active = unresolved.at(-1);
    state.phase = 'recover';
    state.decision = decision(active.retryable ? 'retry' : 'switch_route', `还有未解决的问题：${active.label}。不能直接宣布任务完成。`, { failureClass: active.classification, routeId: active.routeId });
    state.updatedAt = now;
    return state;
  }
  const verifiedEvidence = state.evidence.filter((item) => item.verified);
  if (state.requiresEvidence && verifiedEvidence.length === 0) {
    if (state.conclusionReviews <= 2) {
      state.phase = 'act';
      state.decision = decision('act', '当前只有文字结论，没有真实执行或验收证据，必须先采取可验证动作。');
    } else {
      state.status = 'blocked';
      state.phase = 'blocked';
      state.decision = decision('stop', '模型连续给出文字结论但没有产生真实证据，已停止假完成。');
    }
    state.updatedAt = now;
    return state;
  }
  if (!input.reviewed) {
    state.phase = 'verify';
    state.decision = decision('verify', '回到最初目标，根据真实证据做一次独立验收。');
  } else if (input.acceptancePassed === false) {
    state.acceptanceIssues = Array.isArray(input.acceptanceIssues) ? input.acceptanceIssues.filter(Boolean).slice(0, 12) : ['现有结果没有覆盖原始目标'];
    if (state.routeChanges < state.maxRouteChanges) {
      state.status = 'running';
      state.phase = 'recover';
      state.routeChanges += 1;
      state.recoveryCycles += 1;
      state.decision = decision('switch_route', `目标一致性验收未通过：${state.acceptanceIssues.join('；')}`, { failureClass: 'off_target' });
    } else {
      state.status = 'blocked';
      state.phase = 'blocked';
      state.decision = decision('stop', `多条路线仍未覆盖原始目标：${state.acceptanceIssues.join('；')}`, { failureClass: 'off_target' });
    }
  } else {
    state.acceptanceIssues = [];
    state.status = 'completed';
    state.phase = 'complete';
    state.decision = decision('complete', '最终结论已经过目标复核并有真实证据支撑。');
  }
  state.updatedAt = now;
  return state;
}

export function applyExecutionSteering(snapshot, instruction) {
  const state = clone(snapshot);
  if (state.status === 'completed' || state.status === 'stopped') return state;
  state.latestInstruction = String(instruction ?? '').trim().slice(0, 1000);
  const active = state.failures.find((item) => item.id === state.activeFailureId && !item.resolved);
  if (active?.needsUser && state.latestInstruction) {
    active.resolved = true;
    state.activeFailureId = undefined;
    state.unresolvedQuestions = [];
  }
  state.status = 'running';
  state.phase = 'observe';
  state.decision = decision('act', '已吸收用户最新要求，先重新判断目标与现有证据，再选择下一步。');
  state.updatedAt = Date.now();
  return state;
}

export function markExecutionBudgetReached(snapshot, dimension = 'toolCalls') {
  const state = blockExecution(snapshot, '执行预算已达到安全上限，停止重复操作并保留全部证据。');
  state.budgetStopReason = dimension;
  return state;
}

export function blockExecution(snapshot, reason, failureClass) {
  const state = clone(snapshot);
  state.status = 'blocked';
  state.phase = 'blocked';
  state.decision = decision('stop', String(reason || '执行已停止并保留当前进度。'), failureClass ? { failureClass } : {});
  state.updatedAt = Date.now();
  return state;
}

export function executionControllerGuidance(state) {
  const current = state.decision;
  if (current.kind === 'retry') return `## 执行控制器决定：保留上下文重试\n失败分类：${current.failureClass ?? '瞬时错误'}。只允许修正瞬时条件后重试一次；再次失败必须换路线。`;
  if (current.kind === 'switch_route') return `## 执行控制器决定：更换路线\n失败分类：${current.failureClass ?? '路线不适用'}。禁止重复刚才的工具与参数组合。重新检查假设，改用不同工具、不同数据来源、不同路径或不同实现方式，并在操作后重新验证。`;
  if (current.kind === 'await_user') return `## 执行控制器决定：等待必要的用户条件\n原因：${current.reason}。先说明已经完成和保留了什么，再只询问无法由客户端自行取得的凭据、授权、批准或业务选择；不要要求用户代替客户端执行验证。`;
  if (current.kind === 'verify') return '## 执行控制器决定：重新验收\n回到用户最初目标，逐项核对完成标准和真实证据。不能用最后一次操作成功代替整个目标完成。';
  if (current.kind === 'act') return `## 执行控制器决定：继续真实行动\n${current.reason} 不要再给计划或口头承诺，选择能产生文件、运行结果、连接结果或可核验资料的动作。`;
  if (current.kind === 'stop') return `## 执行控制器决定：停止重复路线\n${current.reason} 直接交接真实阻塞、已保留成果和唯一需要用户处理的条件，不得伪造完成。`;
  return `## 执行控制器状态\n${current.reason}`;
}

export function executionControllerStatus(state) {
  const labels = {
    act: '正在选择可验证动作…',
    continue: '已取得新证据，正在判断下一步…',
    retry: '已识别瞬时错误，正在保留上下文重试…',
    switch_route: '当前方法不适用，正在切换路线…',
    await_user: '已确认需要用户提供必要条件',
    verify: '正在对照最初目标重新验收…',
    complete: '已完成目标与证据验收',
    stop: '已停止无效重复并保留进度',
  };
  return labels[state.decision?.kind] ?? '正在观察执行结果…';
}

export function buildExecutionHandoff(state) {
  const verified = (state.evidence ?? []).filter((item) => item.verified);
  const active = (state.failures ?? []).filter((item) => !item.resolved).at(-1);
  const status = state.status === 'completed' ? '整个目标已经完成并通过验收。' : '整个目标还没有完成。';
  const completed = verified.length
    ? verified.slice(-5).map((item) => item.summary || `${item.toolName} 已留下可验证结果`).join('；')
    : '暂时没有可以确认的完成项';
  const blocked = active?.label ?? state.decision?.reason ?? '仍需继续核对完成条件';
  const next = state.unresolvedQuestions?.[0]
    ? `请处理这一项：${state.unresolvedQuestions[0]}。完成后可以从保存的检查点继续。`
    : state.status === 'completed'
      ? '不需要额外操作。'
      : '不需要重复前面的步骤；恢复任务后将从最后检查点改用不同路线继续。';
  return `${status}\n\n已保留：${completed}。\n\n当前卡点：${blocked}。\n\n下一步：${next}`;
}
