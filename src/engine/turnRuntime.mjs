const TURN_RUNTIME_VERSION = 2;

const TERMINAL_PHASES = new Set(['completed', 'failed', 'stopped', 'waiting_user', 'checkpointed']);
const FILE_FORMATS = new Set(['markdown', 'docx', 'spreadsheet', 'presentation', 'pdf', 'source', 'archive']);
const TRANSIENT_ERRORS = new Set(['rate_limit', 'timeout', 'network', 'server']);
const USER_ERRORS = new Set(['authentication', 'authorization', 'billing', 'missing_user_input']);
const RECOVERY_LIMITS = Object.freeze({
  authentication: 1,
  authorization: 0,
  billing: 0,
  rate_limit: 1,
  timeout: 1,
  network: 1,
  server: 1,
  context_overflow: 1,
  invalid_arguments: 1,
  missing_dependency: 1,
  result_mismatch: 2,
  verification_failed: 2,
  unknown: 1,
});

function text(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function fingerprint(value) {
  const source = JSON.stringify(stable(value));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function parseArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ok: true, value: clone(value) };
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ok: true, value: parsed }
      : { ok: false, value: {}, error: '工具参数必须是 JSON 对象' };
  } catch (error) {
    return { ok: false, value: {}, error: `工具参数不是有效 JSON：${error instanceof Error ? error.message : String(error)}` };
  }
}

export function classifyExecutionError(input) {
  const raw = text(typeof input === 'string' ? input : input?.message ?? input?.error ?? input?.output, 12000);
  const status = Number(typeof input === 'object' ? input?.status ?? input?.statusCode ?? input?.httpStatus : 0);
  const value = raw.toLowerCase();
  if (status === 401 || /api\s*key|token.*(?:invalid|expired)|unauthori[sz]ed|未配置.*(?:api|密钥)|认证失败|凭据.*失效/iu.test(raw)) return { type: 'authentication', retryable: false, needsUser: true, message: raw };
  if (status === 403 || /forbidden|permission denied|权限不足|无权访问|审批.*拒绝|authorization/iu.test(raw)) return { type: 'authorization', retryable: false, needsUser: true, message: raw };
  if (status === 402 || /billing|credit|quota.*exhaust|余额不足|额度不足|欠费|付费/iu.test(raw)) return { type: 'billing', retryable: false, needsUser: true, message: raw };
  if (status === 429 || /rate.?limit|too many requests|请求过于频繁|限流/iu.test(raw)) return { type: 'rate_limit', retryable: true, needsUser: false, message: raw };
  if (/context.*(?:length|window|overflow)|too many tokens|上下文.*(?:过长|溢出)|token.*上限/iu.test(raw)) return { type: 'context_overflow', retryable: true, needsUser: false, message: raw };
  if (/timed?\s*out|timeout|超时/iu.test(raw)) return { type: 'timeout', retryable: true, needsUser: false, message: raw };
  if (/dns|enotfound|econnreset|econnrefused|network|fetch failed|网络|连接失败|无法访问/iu.test(raw)) return { type: 'network', retryable: true, needsUser: false, message: raw };
  if (status >= 500 || /(?:\b5\d\d\b|internal server|bad gateway|service unavailable|服务器错误|服务不可用)/iu.test(raw)) return { type: 'server', retryable: true, needsUser: false, message: raw };
  if (/invalid.*(?:argument|parameter|json)|missing required|参数.*(?:错误|缺少)|schema/iu.test(raw)) return { type: 'invalid_arguments', retryable: true, needsUser: false, message: raw };
  if (/enoent|not found|not recognized|找不到|不存在|缺少依赖|未安装/iu.test(raw)) return { type: 'missing_dependency', retryable: true, needsUser: false, message: raw };
  if (/偏题|不相关|与.*目标.*不一致|result.*mismatch|没有回答|未找到直接结果/iu.test(raw)) return { type: 'result_mismatch', retryable: true, needsUser: false, message: raw };
  if (/验收.*未通过|verification.*fail|cannot open|打不开|内容为空|产出.*无效/iu.test(raw)) return { type: 'verification_failed', retryable: true, needsUser: false, message: raw };
  if (/需要用户|请提供|验证码|账号密码|等待用户/iu.test(raw)) return { type: 'missing_user_input', retryable: false, needsUser: true, message: raw };
  return { type: 'unknown', retryable: value.length > 0, needsUser: false, message: raw };
}

export function normalizeToolCall(name, rawArguments) {
  const toolName = text(name, 160);
  const parsed = parseArguments(rawArguments);
  if (!toolName) return { ok: false, name: '', args: {}, error: '工具名称为空' };
  if (!parsed.ok) return { ok: false, name: toolName, args: {}, error: parsed.error };
  const args = parsed.value;
  if (toolName === 'web_search') {
    const query = text(args.query, 1200);
    if (!query) return { ok: false, name: toolName, args, error: 'web_search 缺少模型生成的 query，运行时不会用整段任务替换它' };
    args.query = query;
  }
  return { ok: true, name: toolName, args, argumentsText: JSON.stringify(args), fingerprint: fingerprint({ name: toolName, args }) };
}

export function inferDeliverableType(contract, fallbackGoal = '') {
  const declared = text(contract?.deliverableType ?? contract?.metadata?.deliverableType, 80).toLowerCase();
  if (['answer', 'file', 'connection', 'operation', 'decision', 'mixed'].includes(declared)) return declared;
  const deliverables = Array.isArray(contract?.deliverables) ? contract.deliverables.filter((item) => item?.required !== false) : [];
  if (deliverables.some((item) => text(item?.type, 40) === 'connection')) return 'connection';
  if (deliverables.some((item) => text(item?.type, 40) === 'operation')) return 'operation';
  if (deliverables.some((item) => FILE_FORMATS.has(text(item?.format, 40).toLowerCase()))) return 'file';
  const goal = text(contract?.goal || fallbackGoal, 4000);
  if (/(?:创建|生成|编写|制作|修改|修复|重构|打包|导出).{0,20}(?:文件|文档|代码|程序|网页|word|excel|ppt|pdf|markdown|安装包)/iu.test(goal)) return 'file';
  if (/(?:配置|连接|接入|测试).{0,24}(?:连接器|知识库|服务|obsidian|ima|mcp)/iu.test(goal)) return 'connection';
  if (/(?:安装|运行|执行|部署|发送|发布|下载|上传)/u.test(goal)) return 'operation';
  if (/(?:选择|判断|比较|建议|分析|规划)/u.test(goal)) return 'decision';
  return 'answer';
}

export function requiresFileEvidence(contract, step) {
  if (step?.kind === 'review') return false;
  const stepType = text(step?.deliverableType ?? step?.metadata?.deliverableType, 40);
  if (stepType) return stepType === 'file';
  return inferDeliverableType(contract, step?.assignment) === 'file';
}

export function createTurnRuntime(input = {}) {
  const goal = text(input.goal ?? input.contract?.goal, 6000);
  return {
    runtimeVersion: TURN_RUNTIME_VERSION,
    turnId: text(input.turnId, 180) || `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    taskId: text(input.taskId, 180),
    scope: text(input.scope, 180),
    goal,
    contract: clone(input.contract),
    deliverableType: inferDeliverableType(input.contract, goal),
    phase: 'observe',
    round: 0,
    decisions: [],
    evidence: [],
    unresolvedIssues: [],
    recoveryAttempts: {},
    seenCalls: {},
    pendingSteering: [],
    startedAt: Number(input.startedAt) || Date.now(),
    updatedAt: Date.now(),
  };
}

export function observeModelDecision(runtime, input = {}) {
  const next = clone(runtime);
  const toolCalls = Array.isArray(input.toolCalls) ? input.toolCalls : [];
  const normalizedCalls = toolCalls.map((call) => normalizeToolCall(call?.name ?? call?.function?.name, call?.arguments ?? call?.function?.arguments)).map((call) => ({
    name: call.name,
    args: call.args,
    fingerprint: call.fingerprint,
    valid: call.ok,
    error: call.error,
  }));
  const action = normalizedCalls.length ? 'act' : input.content ? 'verify' : 'replan';
  const decision = {
    decisionId: `decision-${next.round + 1}-${Date.now()}`,
    round: next.round + 1,
    action,
    currentGoal: next.goal,
    observedEvidenceIds: next.evidence.slice(-12).map((item) => item.evidenceId),
    evidenceGaps: next.unresolvedIssues.slice(-12),
    toolCalls: normalizedCalls,
    reason: text(input.reason || (action === 'act' ? '模型依据当前证据选择了下一步工具。' : action === 'verify' ? '模型认为可以进入验收。' : '模型没有形成有效动作，需要重新规划。'), 500),
    createdAt: Date.now(),
  };
  next.round += 1;
  next.phase = action;
  next.decisions.push(decision);
  next.decisions = next.decisions.slice(-80);
  next.updatedAt = Date.now();
  return { runtime: next, decision };
}

export function observeToolResult(runtime, input = {}) {
  const next = clone(runtime);
  const normalized = normalizeToolCall(input.name, input.args);
  const success = input.success === true;
  const classifiedError = success ? null : classifyExecutionError(input.output ?? input.error);
  const declaredErrorType = text(input.errorType, 80);
  const error = classifiedError && declaredErrorType
    ? {
      ...classifiedError,
      type: declaredErrorType,
      retryable: !USER_ERRORS.has(declaredErrorType),
      needsUser: USER_ERRORS.has(declaredErrorType),
    }
    : classifiedError;
  const evidence = {
    evidenceId: text(input.evidenceId, 180) || `evidence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    toolCallId: text(input.toolCallId, 180),
    toolName: text(input.name, 160),
    arguments: normalized.ok ? normalized.args : clone(input.args),
    callFingerprint: normalized.fingerprint || fingerprint({ name: input.name, args: input.args }),
    success,
    useful: input.useful !== false && success,
    kind: text(input.kind, 80) || 'tool',
    summary: text(input.summary || input.output, 2400),
    resultRef: text(input.resultRef, 800),
    errorType: error?.type,
    createdAt: Date.now(),
  };
  const previous = next.seenCalls[evidence.callFingerprint] || { attempts: 0, sameResult: 0, lastResultFingerprint: '' };
  const resultFingerprint = fingerprint({ success, summary: evidence.summary });
  next.seenCalls[evidence.callFingerprint] = {
    attempts: previous.attempts + 1,
    sameResult: previous.lastResultFingerprint === resultFingerprint ? previous.sameResult + 1 : 0,
    lastResultFingerprint: resultFingerprint,
  };
  next.evidence.push(evidence);
  next.evidence = next.evidence.slice(-240);
  if (!evidence.useful) {
    const issue = error?.message ? `${error.type}：${text(error.message, 500)}` : `${evidence.toolName} 没有形成可验收的新证据`;
    if (!next.unresolvedIssues.includes(issue)) next.unresolvedIssues.push(issue);
  } else {
    next.unresolvedIssues = next.unresolvedIssues.filter((item) => !item.includes(evidence.toolName));
  }
  next.phase = 'observe';
  next.updatedAt = Date.now();
  return { runtime: next, evidence, error };
}

export function decideRecovery(runtime, errorInput, options = {}) {
  const next = clone(runtime);
  const error = errorInput?.type ? errorInput : classifyExecutionError(errorInput);
  const attempted = Number(next.recoveryAttempts[error.type]) || 0;
  const limit = Number.isInteger(options.limit) ? options.limit : RECOVERY_LIMITS[error.type] ?? 1;
  const routeAttempts = Math.max(0, Number(options.routeAttempts) || 0);
  const routeSensitive = ['invalid_arguments', 'result_mismatch', 'verification_failed', 'unknown'].includes(error.type);
  const attemptedAgainstLimit = routeSensitive && routeAttempts > 0 ? routeAttempts - 1 : attempted;
  next.recoveryAttempts[error.type] = attempted + 1;
  let action = 'switch_route';
  if (USER_ERRORS.has(error.type) || error.needsUser) action = 'waiting_user';
  else if (error.type === 'context_overflow') action = attempted < limit ? 'compact' : 'checkpoint';
  else if (error.type === 'invalid_arguments') action = attemptedAgainstLimit < limit ? 'repair_arguments' : 'switch_route';
  else if (error.type === 'missing_dependency') action = attempted < limit ? 'discover_capability' : 'waiting_user';
  else if (TRANSIENT_ERRORS.has(error.type)) action = attempted < limit ? 'retry' : 'switch_route';
  else if (attemptedAgainstLimit >= limit) action = 'checkpoint';
  const decision = {
    errorType: error.type,
    action,
    attempt: attempted + 1,
    routeAttempt: routeAttempts || undefined,
    limit,
    message: text(error.message, 1200),
    userMessage: action === 'waiting_user'
      ? `当前唯一阻塞是：${text(error.message, 600) || error.type}。需要你补齐该条件后才能继续，现有进度已保存。`
      : '',
  };
  if (action === 'waiting_user') next.phase = 'waiting_user';
  else if (action === 'checkpoint') next.phase = 'checkpointed';
  else next.phase = 'observe';
  next.updatedAt = Date.now();
  return { runtime: next, decision };
}

export function applySteering(runtime, messages = []) {
  const next = clone(runtime);
  const additions = (Array.isArray(messages) ? messages : [messages]).map((item) => text(item, 2000)).filter(Boolean);
  next.pendingSteering.push(...additions);
  next.pendingSteering = next.pendingSteering.slice(-20);
  if (additions.length) {
    next.phase = 'observe';
    next.unresolvedIssues = next.unresolvedIssues.filter((item) => !/^用户修订：/u.test(item));
    next.unresolvedIssues.push(`用户修订：${additions.join('；')}`);
  }
  next.updatedAt = Date.now();
  return next;
}

export function buildTurnGuidance(runtime, options = {}) {
  const recentEvidence = runtime.evidence.slice(-12).map((item) => [
    `- [${item.success ? '成功' : '失败'}] ${item.toolName}`,
    `参数=${JSON.stringify(item.arguments || {}).slice(0, 900)}`,
    `结果=${text(item.summary, 1200)}`,
    item.resultRef ? `结果引用=${item.resultRef}` : '',
  ].filter(Boolean).join('；'));
  return [
    '## 太极 Turn Runtime v2',
    `当前目标：${runtime.goal}`,
    `交付类型：${runtime.deliverableType}`,
    '你是本轮语义决策者。根据真实工具结果选择下一步，不要复读计划。运行时只校验安全、权限和参数，不会替你改写查询词或业务目标。',
    '若结果偏题，重新生成更精确的参数并换路线；若缺少唯一外部条件，明确指出并进入等待，不要重复同一动作。',
    '如果现有工具名称或参数不明确，先用 search_tools 找能力，再用 describe_tool 读取准确 Schema；不要靠猜测反复调用不存在的工具。',
    runtime.deliverableType === 'file' ? '本任务需要真实文件证据，并在结束前验证文件可读取或可运行。' : '本任务不强制生成文件；只需按任务合同提供对应的回答、连接、操作或决策证据。',
    recentEvidence.length ? `最近真实证据：\n${recentEvidence.join('\n')}` : '最近真实证据：暂无，先选择最能验证目标的动作。',
    runtime.unresolvedIssues.length ? `未决问题：${runtime.unresolvedIssues.slice(-12).join('；')}` : '',
    runtime.pendingSteering.length ? `用户最新补充：${runtime.pendingSteering.slice(-8).join('；')}` : '',
    options.additional,
  ].filter(Boolean).join('\n');
}

export function compactRuntimeEvidence(runtime, options = {}) {
  const keep = Math.max(8, Number(options.keepRecent) || 24);
  const evidence = runtime.evidence.slice(-keep).map((item) => ({
    evidenceId: item.evidenceId,
    toolCallId: item.toolCallId,
    toolName: item.toolName,
    arguments: item.arguments,
    success: item.success,
    useful: item.useful,
    kind: item.kind,
    summary: text(item.summary, 1600),
    resultRef: item.resultRef,
    errorType: item.errorType,
  }));
  return {
    runtimeVersion: TURN_RUNTIME_VERSION,
    goal: runtime.goal,
    deliverableType: runtime.deliverableType,
    evidence,
    unresolvedIssues: runtime.unresolvedIssues.slice(-18),
    recoveryAttempts: clone(runtime.recoveryAttempts),
    pendingSteering: runtime.pendingSteering.slice(-12),
    lastDecision: clone(runtime.decisions.at(-1)),
  };
}

export function finalizeTurn(runtime, input = {}) {
  const next = clone(runtime);
  const requested = text(input.status, 40);
  const status = TERMINAL_PHASES.has(requested)
    ? requested
    : input.completed === true ? 'completed'
      : input.waitingFor ? 'waiting_user'
        : input.stopped ? 'stopped'
          : input.error ? 'failed'
            : 'checkpointed';
  next.phase = status;
  if (status === 'completed') next.unresolvedIssues = [];
  next.finishedAt = Date.now();
  next.updatedAt = next.finishedAt;
  const verified = next.evidence.filter((item) => item.useful);
  return {
    runtime: next,
    finalization: {
      runtimeVersion: TURN_RUNTIME_VERSION,
      status,
      goal: next.goal,
      deliverableType: next.deliverableType,
      summary: text(input.summary || input.content || input.error, 4000),
      waitingFor: text(input.waitingFor, 1200),
      verifiedEvidenceIds: verified.slice(-30).map((item) => item.evidenceId),
      unresolvedIssues: next.unresolvedIssues.slice(-18),
      rounds: next.round,
      recoveryAttempts: clone(next.recoveryAttempts),
      startedAt: next.startedAt,
      finishedAt: next.finishedAt,
    },
  };
}

export const TAIJI_TURN_RUNTIME_VERSION = TURN_RUNTIME_VERSION;
export const TAIJI_RECOVERY_LIMITS = RECOVERY_LIMITS;
