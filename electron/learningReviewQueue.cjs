const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const LEARNING_REVIEW_VERSION = 4;
const TERMINAL_OUTCOMES = new Set(['completed', 'failed', 'stopped']);

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stable(value[key])]));
}
function checksum(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function text(value, limit = 1000) { return String(value ?? '').trim().replace(/\s+/gu, ' ').slice(0, limit); }
function redact(value) {
  return text(value, 3000)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{10,}\b/giu, 'Bearer [已隐藏凭据]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|password|secret|验证码)\s*[:=]\s*)[^\s,;，；]{4,}/giu, '$1[已隐藏凭据]');
}
async function atomicWrite(filePath, content) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporary, content, 'utf8');
  try { await fs.rename(temporary, filePath); }
  catch (error) { await fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
}
function resolveEndpoint(config) {
  const base = String(config?.apiHost || '').trim().replace(/\/+$/u, '');
  if (!base) return '';
  if (/\/chat\/completions$/iu.test(base)) return base;
  if (/\/(?:v1|v2|v3|v4|compatible-mode\/v1|api\/paas\/v4)$/iu.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}
function modelName(config) { return String(config?.model || '').trim() || 'gpt-4o-mini'; }

function toolNameFromEvent(detail) {
  const match = String(detail || '').match(/^([a-z][a-z0-9_-]{1,80})\s/iu);
  return match?.[1];
}
function collectInput(run) {
  const steps = (run.steps || []).map((step) => ({
    id: text(step.id, 180), employeeId: text(step.employeeId, 180), title: text(step.title, 260), kind: step.kind,
    status: step.status, attempts: Number(step.attempts) || 0,
    tools: (step.events || []).filter((event) => event.type === 'tool' || event.type === 'error').map((event) => ({ name: toolNameFromEvent(event.detail) || 'unknown', success: event.type === 'tool', result: redact(event.detail).slice(0, 500) })).slice(-30),
    evidence: (step.evidence || []).map((item, index) => ({ id: text(item.id, 180) || `evidence-${text(run.id, 80)}-${text(step.id, 80)}-${index}-${checksum(item).slice(0, 12)}`, kind: item.kind, verified: item.verified === true, summary: redact(item.summary).slice(0, 500) })).slice(-12),
  }));
  const members = (run.memberSnapshot || []).map((member) => ({ id: text(member.id, 180), name: text(member.name, 120), role: member.role }));
  return {
    taskId: text(run.id, 180), projectId: text(run.projectId, 180) || undefined, conversationId: text(run.conversationId, 180) || undefined, teamId: text(run.teamId, 180), goal: text(run.goal || run.request, 3000), outcome: TERMINAL_OUTCOMES.has(run.status) ? run.status : 'failed',
    steps, members,
    evidence: (run.evidence || []).map((item, index) => ({ id: text(item.id, 180) || `evidence-${text(run.id, 100)}-${index}-${checksum(item).slice(0, 12)}`, kind: item.kind, verified: item.verified === true, summary: redact(item.summary).slice(0, 600) })).slice(-40),
    corrections: (run.recoveryContext?.steeringMessages || []).filter((item) => /不对|错了|不要|必须|改成|纠正|偏题/u.test(item)).map((item) => text(item, 500)).slice(-12),
    failure: text(run.lastError || run.handoff?.blocked, 1000) || undefined,
    completedAt: Date.now(),
  };
}
function toolCount(input) { return input.steps.reduce((sum, step) => sum + step.tools.length, 0); }
function shouldUseReviewModel(input) { return input.outcome !== 'completed' || input.corrections.length > 0 || toolCount(input) >= 3; }
function hasVerifiedAcceptance(input) {
  return input.outcome === 'completed' && input.evidence.some((item) => item.verified === true && text(item.summary, 20));
}

function parseReviewOutput(raw) {
  const match = String(raw || '').match(/\{[\s\S]*\}/u);
  if (!match) throw new Error('审查模型没有返回 JSON');
  const parsed = JSON.parse(match[0]);
  const memoryUpdates = [];
  for (const item of Array.isArray(parsed.memory_updates) ? parsed.memory_updates.slice(0, 12) : []) {
    if (!['organization', 'project', 'team', 'employee', 'user'].includes(item?.target)) continue;
    if (!['add', 'replace'].includes(item?.action || 'add')) continue;
    const content = text(item?.content, 800);
    if (!content) continue;
    if (item.target === 'employee' && !text(item.employee_id, 180)) continue;
    memoryUpdates.push({ target: item.target, action: item.action || 'add', employeeId: text(item.employee_id, 180) || undefined, oldText: text(item.old_text, 800) || undefined, content, category: ['identity', 'preference', 'constraint', 'workflow', 'decision', 'project', 'lesson'].includes(item.category) ? item.category : 'lesson', memoryKind: ['episodic', 'semantic', 'procedural', 'preference'].includes(item.memory_kind) ? item.memory_kind : undefined, importance: Math.max(1, Math.min(5, Number(item.importance) || 3)), confidence: Math.max(0.65, Math.min(1, Number(item.confidence) || 0.8)) });
  }
  const skillCandidates = [];
  const rawCandidates = Array.isArray(parsed.skill_candidates)
    ? parsed.skill_candidates
    : Array.isArray(parsed.skill_suggestions) ? parsed.skill_suggestions : [];
  for (const item of rawCandidates.slice(0, 5)) {
    if (!['create', 'update', 'patch'].includes(item?.action || 'create')) continue;
    const name = text(item?.name || item?.skill_name, 80);
    if (!name) continue;
    skillCandidates.push({
      action: item.action === 'patch' ? 'update' : item.action || 'create',
      name,
      target_skill_name: text(item.target_skill_name || item.skill_name, 80) || undefined,
      description: text(item.description, 500),
      reason: text(item.reason, 800),
      steps: Array.isArray(item.steps) ? item.steps.map((step) => text(step, 800)).filter(Boolean).slice(0, 24) : undefined,
      inputs: Array.isArray(item.inputs) ? item.inputs.map((entry) => text(entry, 500)).filter(Boolean).slice(0, 16) : undefined,
      outputs: Array.isArray(item.outputs) ? item.outputs.map((entry) => text(entry, 500)).filter(Boolean).slice(0, 16) : undefined,
      success_criteria: Array.isArray(item.success_criteria) ? item.success_criteria.map((entry) => text(entry, 500)).filter(Boolean).slice(0, 16) : undefined,
      permissions: Array.isArray(item.permissions) ? item.permissions.map((entry) => text(entry, 160)).filter(Boolean).slice(0, 20) : undefined,
      external_services: Array.isArray(item.external_services) ? item.external_services.map((entry) => text(entry, 160)).filter(Boolean).slice(0, 12) : undefined,
      positive_example: text(item.positive_example, 1000),
      failure_example: text(item.failure_example, 1000),
      content: String(item.content || '').slice(0, 12000) || undefined,
    });
  }
  return { memoryUpdates, skillCandidates };
}

function createLearningReviewQueue(rootDir, options) {
  const filePath = path.join(rootDir, 'learning-reviews.json');
  let state = { version: LEARNING_REVIEW_VERSION, items: [], updatedAt: Date.now() };
  let initialized = false;
  let initializationPromise;
  let writeQueue = Promise.resolve();
  let processing = false;

  function transact(operation) {
    const pending = writeQueue.then(operation, operation);
    writeQueue = pending.catch(() => {});
    return pending;
  }
  async function persist() {
    state.updatedAt = Date.now();
    state.items = state.items.slice(-300);
    await atomicWrite(filePath, `${JSON.stringify({ state, checksum: checksum(state) }, null, 2)}\n`);
  }
  async function initializeOnce() {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (!parsed?.state || parsed.checksum !== checksum(parsed.state)) throw new Error('复盘队列校验失败');
      state = parsed.state;
      state.items = (state.items || []).map((item) => item.status === 'processing' ? { ...item, status: 'queued', lastError: '客户端在复盘过程中退出，已恢复排队' } : item);
    } catch (error) {
      if (error?.code !== 'ENOENT') await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`).catch(() => {});
    }
    initialized = true;
    await persist();
  }

  async function initialize() {
    if (initialized) return;
    if (!initializationPromise) {
      initializationPromise = initializeOnce().catch((error) => {
        initializationPromise = undefined;
        throw error;
      });
    }
    await initializationPromise;
  }

  async function applyVerifiedLessons(input) {
    if (!hasVerifiedAcceptance(input)) return [];
    const results = [];
    const verified = input.evidence.filter((item) => item.verified).map((item) => item.summary).slice(-5);
    const tools = [...new Set(input.steps.flatMap((step) => step.tools.filter((tool) => tool.success).map((tool) => tool.name)).filter((name) => name !== 'unknown'))].slice(0, 10);
    const teamContent = [`任务“${input.goal.slice(0, 220)}”已通过真实验收`, tools.length ? `有效工具路线：${tools.join(' → ')}` : '', verified.length ? `验收证据：${verified.join('；')}` : ''].filter(Boolean).join('；').slice(0, 900);
    results.push(await options.memoryManager.upsert({ scope: 'team', scopeId: input.teamId, projectId: input.projectId, category: 'lesson', memoryKind: 'procedural', content: teamContent, source: `任务复盘 ${input.taskId}`, sourceType: 'task-review', taskId: input.taskId, importance: 4, confidence: 0.95, evidence: verified, evidenceIds: input.evidence.filter((item) => item.verified).map((item) => item.id).filter(Boolean), acceptanceVerified: true }));
    for (const step of input.steps.filter((item) => item.status === 'completed')) {
      const successful = [...new Set(step.tools.filter((tool) => tool.success).map((tool) => tool.name).filter((name) => name !== 'unknown'))];
      const evidence = step.evidence.filter((item) => item.verified).map((item) => item.summary).slice(-4);
      if (!evidence.length) continue;
      const content = `完成“${step.title}”时验证有效：${successful.length ? successful.join(' → ') : evidence.join('；')}`.slice(0, 800);
      results.push(await options.memoryManager.upsert({ scope: 'employee', scopeId: step.employeeId, employeeId: step.employeeId, projectId: input.projectId, category: 'lesson', memoryKind: 'procedural', content, source: `任务复盘 ${input.taskId}`, sourceType: 'task-review', taskId: input.taskId, importance: 4, confidence: 0.95, evidence, evidenceIds: step.evidence.filter((item) => item.verified).map((item) => item.id).filter(Boolean), acceptanceVerified: true }));
    }
    return results;
  }

  function buildPrompt(input, existingContext) {
    return `你是太极的独立任务复盘器。只从真实记录中提取对未来仍有用的原子经验，不得把一次性状态、凭据、错误代码或猜测写入记忆。你只能提出结构化 Skill 候选观察，禁止直接编写 SKILL.md、安装命令或精确补丁。\n\n当前记忆：\n${existingContext || '暂无'}\n\n任务记录：\n${JSON.stringify(input, null, 2).slice(0, 30000)}\n\n只返回 JSON：\n{"memory_updates":[{"target":"organization|project|team|employee|user","employee_id":"员工目标时必填","action":"add|replace","old_text":"精确旧文本，仅 replace","content":"一条原子事实","category":"lesson|workflow|constraint|preference|decision|project","memory_kind":"episodic|semantic|procedural|preference","importance":1,"confidence":0.8}],"skill_candidates":[{"action":"create|update","name":"简短用途名称","target_skill_name":"仅 update 时填写自动 Skill 名称","description":"做什么以及什么场景触发","steps":["稳定步骤"],"inputs":["所需输入"],"outputs":["交付结果"],"success_criteria":["真实验收标准"],"permissions":["来源任务已经实际使用的权限"],"external_services":["真实外部依赖"],"positive_example":"一个成功样例","failure_example":"一个应该停止或失败的样例","reason":"为什么可能可复用"}]}\n规则：情景记忆记录一次任务或决定，语义记忆记录稳定事实，程序记忆只记录已被真实验收证明有效的路线，用户偏好写 preference。默认写 project，项目结束后不得自动提升到其他范围。只有可跨团队复用且有多项真实验收时才建议 organization，且必须等待用户批准；个人偏好写 user，团队约定写 team，员工独有路线写 employee。Skill 候选只是本次任务的一条观察，必须保留实际输入、输出、权限、正向样例和失败样例；是否达到跨任务门槛、如何编译和能否启用由确定性生命周期内核决定。不确定时返回空数组。`;
  }

  async function callReviewModel(input, modelConfig) {
    const endpoint = resolveEndpoint(modelConfig);
    if (!endpoint) throw new Error('未配置独立审查模型');
    const memory = await options.memoryManager.context({ query: input.goal, taskId: input.taskId, conversationId: input.conversationId, projectId: input.projectId, teamId: input.teamId, limit: 18 });
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (modelConfig.apiKey) headers.Authorization = `Bearer ${modelConfig.apiKey}`;
    const response = await options.fetchImpl(endpoint, { method: 'POST', headers, signal: AbortSignal.timeout(60000), body: JSON.stringify({ model: modelName(modelConfig), messages: [{ role: 'system', content: '你是独立审查模型，只输出严格 JSON。' }, { role: 'user', content: buildPrompt(input, memory.context) }], response_format: { type: 'json_object' }, stream: false }) });
    const raw = await response.text();
    if (!response.ok) throw new Error(`审查模型 HTTP ${response.status}：${raw.slice(0, 500)}`);
    const data = JSON.parse(raw);
    return parseReviewOutput(data?.choices?.[0]?.message?.content || '');
  }

  async function applyModelReview(input, review, settings = {}) {
    const proposalIds = [];
    let skillLifecycleResult = { candidateIds: [], skillDraftIds: [] };
    for (const update of review.memoryUpdates) {
      const scope = update.target;
      const scopeId = scope === 'project' ? input.projectId : scope === 'team' ? input.teamId : scope === 'employee' ? update.employeeId : 'default';
      const requestedMemoryKind = update.memoryKind || (update.category === 'preference' ? 'preference' : ['workflow', 'lesson'].includes(update.category) ? 'procedural' : update.taskId ? 'episodic' : 'semantic');
      const memoryKind = requestedMemoryKind === 'procedural' && !hasVerifiedAcceptance(input) ? 'episodic' : requestedMemoryKind;
      const proposal = await options.memoryManager.propose({ taskId: input.taskId, source: 'review-model', summary: `独立审查建议更新${scope === 'employee' ? '员工个人' : scope === 'team' ? '团队' : scope === 'project' ? '当前项目' : scope === 'user' ? '用户' : '组织'}记忆`, update: { scope, scopeId, projectId: input.projectId, employeeId: update.employeeId, category: update.category, memoryKind, content: update.content, replaceExact: update.action === 'replace' ? update.oldText : undefined, source: `独立审查 ${input.taskId}`, sourceType: 'review-model', taskId: input.taskId, importance: update.importance, confidence: update.confidence, acceptanceVerified: memoryKind === 'procedural' && hasVerifiedAcceptance(input) } });
      proposalIds.push(proposal.proposal.id);
      if (settings.memoryWriteApproval === false && update.confidence >= 0.9 && ['team', 'employee'].includes(scope) && memoryKind === 'procedural' && hasVerifiedAcceptance(input)) await options.memoryManager.reviewProposal(proposal.proposal.id, 'approve', { reviewedBy: 'policy:auto-high-confidence' });
    }
    if (review.skillCandidates.length && options.skillLifecycle?.observe) {
      skillLifecycleResult = await options.skillLifecycle.observe(input, review.skillCandidates);
    }
    return { proposalIds, candidateIds: skillLifecycleResult.candidateIds || [], draftIds: skillLifecycleResult.skillDraftIds || [] };
  }

  async function processOne(item, runtime = {}) {
    await transact(async () => {
      item.status = 'processing'; item.attempts += 1; item.updatedAt = Date.now(); item.lastError = undefined;
      await persist();
    });
    try {
      const verifiedResults = await applyVerifiedLessons(item.input);
      let review = { memoryUpdates: [], skillCandidates: [] };
      if (shouldUseReviewModel(item.input)) review = await callReviewModel(item.input, runtime.reviewModelConfig);
      const applied = await applyModelReview(item.input, review, runtime);
      await transact(async () => {
        item.status = 'completed'; item.completedAt = Date.now(); item.updatedAt = Date.now();
        item.result = { verifiedMemories: verifiedResults.filter((result) => result?.ok).length, memoryProposalIds: applied.proposalIds, skillCandidateIds: applied.candidateIds, skillDraftIds: applied.draftIds };
        await persist();
      });
    } catch (error) {
      await transact(async () => {
        const missingModel = /未配置独立审查模型/u.test(String(error?.message));
        item.status = missingModel ? 'waiting_model' : item.attempts < 3 ? 'queued' : 'failed';
        item.lastError = text(error?.message || error, 800); item.updatedAt = Date.now();
        await persist();
      });
    }
  }

  async function process(runtime = {}) {
    await initialize();
    if (processing) return { ok: true, processing: true };
    processing = true;
    try {
      const processed = new Set();
      while (true) {
        const candidates = state.items.filter((item) => item.status === 'queued'
          || (item.status === 'waiting_model' && resolveEndpoint(runtime.reviewModelConfig)));
        if (!candidates.length) break;
        for (const item of candidates) {
          processed.add(item.id);
          await processOne(item, runtime);
        }
        if (!state.items.some((item) => item.status === 'queued')) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return { ok: true, processed: processed.size };
    } finally { processing = false; }
  }

  async function enqueue(run, runtime = {}) {
    await initialize();
    const input = collectInput(run);
    const reviewKey = checksum({ taskId: input.taskId, outcome: input.outcome, steps: input.steps.map((step) => ({ id: step.id, status: step.status, tools: step.tools.length })) });
    let item;
    let idempotencyHit = false;
    await transact(async () => {
      item = state.items.find((candidate) => candidate.reviewKey === reviewKey);
      idempotencyHit = Boolean(item);
      if (!item) {
        item = { id: `learning-review-${crypto.randomUUID()}`, reviewKey, taskId: input.taskId, projectId: input.projectId, teamId: input.teamId, status: 'queued', attempts: 0, input, createdAt: Date.now(), updatedAt: Date.now() };
        state.items.push(item);
        await persist();
      }
    });
    void process(runtime).catch(() => {});
    return { ok: true, item: clone(item), idempotencyHit };
  }

  async function status(filter = {}) {
    await initialize();
    await writeQueue;
    const items = state.items.filter((item) => !filter.taskId || item.taskId === filter.taskId);
    return { ok: true, version: LEARNING_REVIEW_VERSION, processing, items: clone(items), counts: Object.fromEntries(['queued', 'processing', 'waiting_model', 'completed', 'failed'].map((status) => [status, items.filter((item) => item.status === status).length])) };
  }

  async function retry(itemId, runtime = {}) {
    await initialize();
    const found = await transact(async () => {
      const item = state.items.find((candidate) => candidate.id === itemId);
      if (!item) return false;
      item.status = 'queued'; item.attempts = 0; item.lastError = undefined; item.updatedAt = Date.now();
      await persist();
      return true;
    });
    if (!found) return { ok: false, error: '复盘记录不存在' };
    return process(runtime);
  }

  return { initialize, enqueue, process, status, retry, filePath };
}

module.exports = { LEARNING_REVIEW_VERSION, createLearningReviewQueue, collectInput, parseReviewOutput, shouldUseReviewModel, hasVerifiedAcceptance, resolveEndpoint };
