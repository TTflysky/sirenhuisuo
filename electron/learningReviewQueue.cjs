const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const LEARNING_REVIEW_VERSION = 1;
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
    evidence: (step.evidence || []).map((item) => ({ kind: item.kind, verified: item.verified === true, summary: redact(item.summary).slice(0, 500) })).slice(-12),
  }));
  const members = (run.memberSnapshot || []).map((member) => ({ id: text(member.id, 180), name: text(member.name, 120), role: member.role }));
  return {
    taskId: text(run.id, 180), teamId: text(run.teamId, 180), goal: text(run.goal || run.request, 3000), outcome: TERMINAL_OUTCOMES.has(run.status) ? run.status : 'failed',
    steps, members,
    evidence: (run.evidence || []).map((item) => ({ kind: item.kind, verified: item.verified === true, summary: redact(item.summary).slice(0, 600) })).slice(-40),
    corrections: (run.recoveryContext?.steeringMessages || []).filter((item) => /不对|错了|不要|必须|改成|纠正|偏题/u.test(item)).map((item) => text(item, 500)).slice(-12),
    failure: text(run.lastError || run.handoff?.blocked, 1000) || undefined,
    completedAt: Date.now(),
  };
}
function toolCount(input) { return input.steps.reduce((sum, step) => sum + step.tools.length, 0); }
function shouldUseReviewModel(input) { return input.outcome !== 'completed' || input.corrections.length > 0 || toolCount(input) >= 3; }

function parseReviewOutput(raw) {
  const match = String(raw || '').match(/\{[\s\S]*\}/u);
  if (!match) throw new Error('审查模型没有返回 JSON');
  const parsed = JSON.parse(match[0]);
  const memoryUpdates = [];
  for (const item of Array.isArray(parsed.memory_updates) ? parsed.memory_updates.slice(0, 12) : []) {
    if (!['organization', 'team', 'employee', 'user'].includes(item?.target)) continue;
    if (!['add', 'replace'].includes(item?.action || 'add')) continue;
    const content = text(item?.content, 800);
    if (!content) continue;
    if (item.target === 'employee' && !text(item.employee_id, 180)) continue;
    memoryUpdates.push({ target: item.target, action: item.action || 'add', employeeId: text(item.employee_id, 180) || undefined, oldText: text(item.old_text, 800) || undefined, content, category: ['identity', 'preference', 'constraint', 'workflow', 'decision', 'project', 'lesson'].includes(item.category) ? item.category : 'lesson', importance: Math.max(1, Math.min(5, Number(item.importance) || 3)), confidence: Math.max(0.65, Math.min(1, Number(item.confidence) || 0.8)) });
  }
  const skillSuggestions = [];
  for (const item of Array.isArray(parsed.skill_suggestions) ? parsed.skill_suggestions.slice(0, 5) : []) {
    if (!['create', 'patch'].includes(item?.action)) continue;
    const name = text(item?.name || item?.skill_name, 80);
    if (!name) continue;
    if (item.action === 'create' && !text(item.content, 12000)) continue;
    if (item.action === 'patch' && (!text(item.old_string, 12000) || !text(item.new_string, 12000))) continue;
    skillSuggestions.push({ action: item.action, name, targetSkillName: text(item.skill_name || item.name, 80), description: text(item.description, 300), content: String(item.content || '').slice(0, 60000), oldString: String(item.old_string || '').slice(0, 12000), newString: String(item.new_string || '').slice(0, 12000), reason: text(item.reason, 800) });
  }
  return { memoryUpdates, skillSuggestions };
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
    if (input.outcome !== 'completed') return [];
    const results = [];
    const verified = input.evidence.filter((item) => item.verified).map((item) => item.summary).slice(-5);
    const tools = [...new Set(input.steps.flatMap((step) => step.tools.filter((tool) => tool.success).map((tool) => tool.name)).filter((name) => name !== 'unknown'))].slice(0, 10);
    const teamContent = [`任务“${input.goal.slice(0, 220)}”已通过真实验收`, tools.length ? `有效工具路线：${tools.join(' → ')}` : '', verified.length ? `验收证据：${verified.join('；')}` : ''].filter(Boolean).join('；').slice(0, 900);
    results.push(await options.memoryManager.upsert({ scope: 'team', scopeId: input.teamId, category: 'lesson', content: teamContent, source: `任务复盘 ${input.taskId}`, sourceType: 'task-review', taskId: input.taskId, importance: 4, confidence: 0.95, evidence: verified }));
    for (const step of input.steps.filter((item) => item.status === 'completed')) {
      const successful = [...new Set(step.tools.filter((tool) => tool.success).map((tool) => tool.name).filter((name) => name !== 'unknown'))];
      const evidence = step.evidence.filter((item) => item.verified).map((item) => item.summary).slice(-4);
      if (!successful.length && !evidence.length) continue;
      const content = `完成“${step.title}”时验证有效：${successful.length ? successful.join(' → ') : evidence.join('；')}`.slice(0, 800);
      results.push(await options.memoryManager.upsert({ scope: 'employee', scopeId: step.employeeId, employeeId: step.employeeId, category: 'lesson', content, source: `任务复盘 ${input.taskId}`, sourceType: 'task-review', taskId: input.taskId, importance: 4, confidence: 0.95, evidence }));
    }
    return results;
  }

  function buildPrompt(input, existingContext) {
    return `你是太极的独立任务复盘器。只从真实记录中提取对未来仍有用的原子经验，不得把一次性状态、凭据、错误代码或猜测写入记忆。\n\n当前记忆：\n${existingContext || '暂无'}\n\n任务记录：\n${JSON.stringify(input, null, 2).slice(0, 30000)}\n\n只返回 JSON：\n{"memory_updates":[{"target":"organization|team|employee|user","employee_id":"员工目标时必填","action":"add|replace","old_text":"精确旧文本，仅 replace","content":"一条原子事实","category":"lesson|workflow|constraint|preference|decision|project","importance":1,"confidence":0.8}],"skill_suggestions":[{"action":"create|patch","name":"名称","description":"用途","content":"create 时完整可执行说明","skill_name":"patch 目标","old_string":"精确旧文本","new_string":"替换文本","reason":"为什么可复用"}]}\n规则：只有跨任务可复用的内容才建议；个人偏好写 user，团队约定写 team，员工独有路线写 employee，跨团队通用经验写 organization。Skill 必须是重复出现、步骤稳定的工作流；不确定时返回空数组。`;
  }

  async function callReviewModel(input, modelConfig) {
    const endpoint = resolveEndpoint(modelConfig);
    if (!endpoint) throw new Error('未配置独立审查模型');
    const memory = await options.memoryManager.context({ query: input.goal, teamId: input.teamId, limit: 18 });
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
    const draftIds = [];
    for (const update of review.memoryUpdates) {
      const scope = update.target;
      const scopeId = scope === 'team' ? input.teamId : scope === 'employee' ? update.employeeId : 'default';
      const proposal = await options.memoryManager.propose({ taskId: input.taskId, source: 'review-model', summary: `独立审查建议更新${scope === 'employee' ? '员工个人' : scope === 'team' ? '团队' : scope === 'user' ? '用户' : '组织'}记忆`, update: { scope, scopeId, employeeId: update.employeeId, category: update.category, content: update.content, replaceExact: update.action === 'replace' ? update.oldText : undefined, source: `独立审查 ${input.taskId}`, sourceType: 'review-model', taskId: input.taskId, importance: update.importance, confidence: update.confidence } });
      proposalIds.push(proposal.proposal.id);
      if (settings.memoryWriteApproval === false && update.confidence >= 0.9) await options.memoryManager.reviewProposal(proposal.proposal.id, 'approve', { reviewedBy: 'policy:auto-high-confidence' });
    }
    for (const suggestion of review.skillSuggestions) {
      const draft = await options.createSkillDraft({ ...suggestion, taskId: input.taskId });
      draftIds.push(draft.draft.id);
    }
    return { proposalIds, draftIds };
  }

  async function processOne(item, runtime = {}) {
    await transact(async () => {
      item.status = 'processing'; item.attempts += 1; item.updatedAt = Date.now(); item.lastError = undefined;
      await persist();
    });
    try {
      const verifiedResults = await applyVerifiedLessons(item.input);
      let review = { memoryUpdates: [], skillSuggestions: [] };
      if (shouldUseReviewModel(item.input)) review = await callReviewModel(item.input, runtime.reviewModelConfig);
      const applied = await applyModelReview(item.input, review, runtime);
      await transact(async () => {
        item.status = 'completed'; item.completedAt = Date.now(); item.updatedAt = Date.now();
        item.result = { verifiedMemories: verifiedResults.filter((result) => result?.ok).length, memoryProposalIds: applied.proposalIds, skillDraftIds: applied.draftIds };
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
        item = { id: `learning-review-${crypto.randomUUID()}`, reviewKey, taskId: input.taskId, teamId: input.teamId, status: 'queued', attempts: 0, input, createdAt: Date.now(), updatedAt: Date.now() };
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

module.exports = { LEARNING_REVIEW_VERSION, createLearningReviewQueue, collectInput, parseReviewOutput, shouldUseReviewModel, resolveEndpoint };
