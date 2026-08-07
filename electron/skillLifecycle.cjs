const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const SKILL_LIFECYCLE_SCHEMA = 1;
const MIN_INDEPENDENT_TASKS = 2;
const MAX_CANDIDATE_FAILURE_RATE = 0.2;
const MIN_ROUTE_SIMILARITY = 0.7;
const CANARY_INVOCATIONS = 5;
const CANARY_FAILURE_LIMIT = 2;

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stable(value[key])]));
}
function checksum(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function hash(value) { return crypto.createHash('sha256').update(String(value ?? '')).digest('hex'); }
function text(value, limit = 1000) { return String(value ?? '').trim().replace(/\s+/gu, ' ').slice(0, limit); }
function unique(values, limit = 100) { return [...new Set(values.map((value) => text(value, 500)).filter(Boolean))].slice(0, limit); }
function safeArray(value, limit = 20) { return Array.isArray(value) ? value.map((item) => text(item, 800)).filter(Boolean).slice(0, limit) : []; }
function slugify(value, fallbackSeed = '') {
  const slug = String(value || '').normalize('NFKD').toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 63);
  return slug || `taiji-workflow-${hash(fallbackSeed || value).slice(0, 10)}`;
}
async function atomicWrite(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filePath);
}

function collectRoute(input) {
  return (input?.steps || []).flatMap((step) => (step.tools || [])
    .map((tool) => text(tool?.name, 100))
    .filter((name) => name && name !== 'unknown')).slice(0, 80);
}

function lcsLength(left, right) {
  const previous = new Array(right.length + 1).fill(0);
  for (let i = 0; i < left.length; i += 1) {
    let diagonal = 0;
    for (let j = 0; j < right.length; j += 1) {
      const saved = previous[j + 1];
      previous[j + 1] = left[i] === right[j] ? diagonal + 1 : Math.max(previous[j + 1], previous[j]);
      diagonal = saved;
    }
  }
  return previous[right.length];
}

function routeSimilarity(left, right) {
  if (!left.length || !right.length) return 0;
  const sequence = lcsLength(left, right) / Math.max(left.length, right.length);
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]).size || 1;
  const overlap = [...leftSet].filter((item) => rightSet.has(item)).length / union;
  return Number((sequence * 0.7 + overlap * 0.3).toFixed(4));
}

function permissionForTool(toolName) {
  const name = String(toolName || '').toLocaleLowerCase();
  if (/^(read_file|list_files|coding_search|coding_dependencies)$/u.test(name)) return 'filesystem:read';
  if (/^(write_file|coding_|apply_patch)/u.test(name)) return 'filesystem:write';
  if (/^(run_command|exec_command)$/u.test(name)) return 'command:execute';
  if (/^(web_search|read_web_page|search_skills)$/u.test(name)) return 'network:read';
  if (/^(install_skill|skills_install)$/u.test(name)) return 'skill:install';
  if (/email|smtp|deploy|publish|delete|payment|connector_/u.test(name)) return 'external:side-effect';
  if (/connector|knowledge|obsidian|github|http/u.test(name)) return 'external:service';
  return `tool:${name || 'unknown'}`;
}

function riskFromPermissions(permissions) {
  if (permissions.some((item) => item === 'external:side-effect')) return 'high';
  if (permissions.some((item) => ['command:execute', 'filesystem:write', 'skill:install', 'external:service'].includes(item))) return 'medium';
  return 'low';
}

function normalizeHint(item = {}) {
  const name = text(item.name || item.skill_name, 120);
  if (!name) return null;
  const legacySteps = typeof item.content === 'string'
    ? item.content.split(/\r?\n/u).map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/u, '').trim()).filter(Boolean)
    : [];
  return {
    action: item.action === 'update' || item.action === 'patch' ? 'update' : 'create',
    name,
    targetSkillName: text(item.target_skill_name || item.skill_name, 120) || undefined,
    description: text(item.description, 500),
    reason: text(item.reason, 1000),
    steps: safeArray(item.steps, 24).length ? safeArray(item.steps, 24) : legacySteps.slice(0, 24),
    inputs: safeArray(item.inputs, 16),
    outputs: safeArray(item.outputs, 16),
    successCriteria: safeArray(item.success_criteria, 16),
    permissions: safeArray(item.permissions, 20),
    externalServices: safeArray(item.external_services, 12),
    positiveExample: text(item.positive_example, 1000),
    failureExample: text(item.failure_example, 1000),
  };
}

function candidateKey(projectId, hint) {
  return `${projectId}:${slugify(hint.targetSkillName || hint.name, hint.name)}`;
}

function candidateMetrics(candidate) {
  const observations = candidate.observations || [];
  const taskIds = unique(observations.map((item) => item.taskId), 500);
  const successes = observations.filter((item) => item.outcome === 'completed' && item.acceptanceVerified).length;
  const failures = observations.filter((item) => item.outcome !== 'completed').length;
  const considered = successes + failures;
  const routeSamples = observations.map((item) => item.route || []).filter((route) => route.length);
  const canonicalRoute = routeSamples[0] || [];
  const similarities = routeSamples.slice(1).map((route) => routeSimilarity(canonicalRoute, route));
  const minimumSimilarity = similarities.length ? Math.min(...similarities) : routeSamples.length === 1 ? 1 : 0;
  return {
    taskIds,
    evidenceIds: unique(observations.flatMap((item) => item.evidenceIds || []), 500),
    independentTaskCount: taskIds.length,
    successes,
    failures,
    successRate: considered ? Number((successes / considered).toFixed(4)) : 0,
    failureRate: considered ? Number((failures / considered).toFixed(4)) : 0,
    route: canonicalRoute,
    routeFingerprint: canonicalRoute.length ? hash(canonicalRoute.join(' -> ')) : '',
    routeSimilarity: minimumSimilarity,
    failureModes: unique(observations.filter((item) => item.outcome !== 'completed').map((item) => item.failure || item.outcome), 20),
  };
}

function eligibility(candidate) {
  const reasons = [];
  if (!candidate.projectId) reasons.push('缺少项目边界');
  if (candidate.independentTaskCount < MIN_INDEPENDENT_TASKS) reasons.push(`需要至少 ${MIN_INDEPENDENT_TASKS} 个独立任务`);
  if (candidate.successes < MIN_INDEPENDENT_TASKS) reasons.push('至少两个任务必须通过真实验收');
  if (!candidate.route?.length) reasons.push('没有可核对的真实工具路线');
  if (candidate.routeSimilarity < MIN_ROUTE_SIMILARITY) reasons.push(`工具路线相似度低于 ${MIN_ROUTE_SIMILARITY}`);
  if (candidate.failureRate > MAX_CANDIDATE_FAILURE_RATE) reasons.push(`失败率高于 ${MAX_CANDIDATE_FAILURE_RATE}`);
  return { eligible: reasons.length === 0, reasons };
}

function yamlQuote(value) { return JSON.stringify(text(value, 1000)); }
function listSection(title, values, fallback) {
  const items = values.length ? values : [fallback];
  return `## ${title}\n\n${items.map((item) => `- ${item}`).join('\n')}`;
}

function createUnifiedAddition(filePath, content) {
  const lines = String(content || '').split(/\r?\n/u);
  return [`--- /dev/null`, `+++ b/${filePath}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join('\n');
}

function createSimpleDiff(filePath, before, after) {
  if (!before) return createUnifiedAddition(filePath, after);
  if (before === after) return `--- a/${filePath}\n+++ b/${filePath}\n@@ 内容未变化 @@`;
  const beforeLines = before.split(/\r?\n/u);
  const afterLines = after.split(/\r?\n/u);
  return [`--- a/${filePath}`, `+++ b/${filePath}`, `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`, ...beforeLines.map((line) => `-${line}`), ...afterLines.map((line) => `+${line}`)].join('\n');
}

function compileCandidate(candidate, existing) {
  const latest = candidate.observations.at(-1)?.hint || {};
  const skillName = slugify(latest.targetSkillName || latest.name || candidate.name, candidate.routeFingerprint || candidate.candidateId);
  const displayName = text(latest.name || candidate.name, 120) || skillName;
  const steps = unique([...(latest.steps || []), ...(candidate.route || []).map((tool) => `使用 ${tool} 完成对应步骤，并检查真实返回结果。`)], 28);
  const inputs = unique(latest.inputs || [], 16);
  const outputs = unique(latest.outputs || [], 16);
  const successCriteria = unique(latest.successCriteria || [], 16);
  const description = text(latest.description || candidate.description || `执行“${displayName}”的可验证工作流。用于目标与已验证来源任务相近、且需要复用相同工具路线时。`, 500);
  const permissions = unique((candidate.permissions || []).filter((item) => !String(item).startsWith('tool:')), 30);
  const contract = [
    '# Contract',
    '',
    listSection('Inputs', inputs, '从当前任务合同读取明确目标、对象和约束。'),
    '',
    listSection('Outputs', outputs, '交付可核对的结果、文件或结构化结论。'),
    '',
    listSection('Success criteria', successCriteria, '对照当前任务目标和真实工具证据完成验收。'),
    '',
    '## Examples',
    '',
    `- Positive: ${latest.positiveExample || '输入完整且工具返回可验证结果时，完成交付并逐项验收。'}`,
    `- Failure: ${latest.failureExample || '对象、权限或证据不足时，停在真实阻塞点并说明缺少项。'}`,
  ].join('\n');
  const skillMarkdown = [
    '---',
    `name: ${skillName}`,
    `description: ${yamlQuote(description)}`,
    '---',
    '',
    `# ${displayName}`,
    '',
    '先固定当前任务的目标、对象和验收标准。输入、输出和样例见 [contract](references/contract.md)。',
    '',
    '## Workflow',
    '',
    ...(steps.length ? steps : ['根据当前目标选择最小可验证路线。']).map((step, index) => `${index + 1}. ${step}`),
    '',
    '## Guardrails',
    '',
    '- 只在当前项目和当前任务边界内使用来源证据。',
    '- 每次工具返回后重新核对目标，不把工具成功冒充业务完成。',
    `- 只使用已声明权限：${permissions.join('、') || '无需额外权限'}。`,
    '- 遇到用户专属凭据、不可逆外部操作或超出已验证权限时停止并请求人工确认。',
  ].join('\n');
  const openaiYaml = [
    'interface:',
    `  display_name: ${yamlQuote(displayName)}`,
    `  short_description: ${yamlQuote(description.slice(0, 100))}`,
    `  default_prompt: ${yamlQuote(`使用 $${skillName} 完成当前任务，并以真实证据验收。`)}`,
    'policy:',
    '  allow_implicit_invocation: true',
  ].join('\n') + '\n';
  const files = { 'SKILL.md': `${skillMarkdown}\n`, 'references/contract.md': `${contract}\n`, 'agents/openai.yaml': openaiYaml };
  const checks = [];
  const addCheck = (id, label, passed, message) => checks.push({ id, label, status: passed ? 'passed' : 'failed', message });
  addCheck('candidate-threshold', '跨任务候选门槛', eligibility(candidate).eligible, eligibility(candidate).reasons.join('；') || '两个以上独立任务已通过真实验收');
  addCheck('frontmatter', 'Frontmatter 与命名', /^---\nname: [a-z0-9-]+\ndescription: "[^\n]+"\n---\n/u.test(files['SKILL.md']), '只包含 name 和 description，名称使用小写连字符');
  addCheck('progressive-disclosure', '渐进加载', files['SKILL.md'].split(/\r?\n/u).length < 500 && Boolean(files['references/contract.md']), '核心规则保持简洁，详细契约按需读取');
  const combined = Object.values(files).join('\n');
  const sensitive = /(?:BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*[^\s\]]{6,}|~[\\/]\.ssh|[\\/]\.env\b)/iu.test(combined);
  addCheck('sensitive-data', '敏感路径与凭据扫描', !sensitive, sensitive ? '检测到疑似凭据或敏感路径' : '未发现凭据、私钥或敏感路径');
  const observedPermissions = new Set(candidate.permissions || []);
  const undeclared = (latest.permissions || []).filter((permission) => !observedPermissions.has(permission));
  addCheck('permissions', '工具与权限核对', undeclared.length === 0, undeclared.length ? `候选请求了未经来源任务证明的权限：${undeclared.join('、')}` : `权限均来自真实工具路线：${permissions.join('、') || '无额外权限'}`);
  const externalOk = !(latest.externalServices || []).length || [...observedPermissions].some((item) => item.startsWith('network:') || item.startsWith('external:'));
  addCheck('dependencies', '依赖与外联声明', externalOk, externalOk ? `外部依赖：${(latest.externalServices || []).join('、') || '无'}` : '声明了外部服务，但来源任务没有对应网络或连接器证据');
  addCheck('dry-run', '静态 Dry-run', steps.length > 0 && successCriteria.length > 0, steps.length > 0 && successCriteria.length > 0 ? '步骤、输入输出契约和成功标准可被静态演练' : '缺少稳定步骤或成功标准');
  addCheck('positive-example', '正向样例', Boolean(latest.positiveExample), latest.positiveExample || '缺少正向样例');
  addCheck('failure-example', '失败样例', Boolean(latest.failureExample), latest.failureExample || '缺少失败样例');
  const validation = { passed: checks.every((item) => item.status === 'passed'), checks, checkedAt: Date.now() };
  const diff = Object.entries(files).map(([filePath, content]) => filePath === 'SKILL.md' && existing?.content
    ? createSimpleDiff(filePath, existing.content, content)
    : createUnifiedAddition(filePath, content)).join('\n\n');
  return {
    action: existing ? 'replace' : 'create', name: skillName, targetSkillName: existing?.skill?.name,
    description, reason: latest.reason || candidate.reason || '多个独立任务证明该路线稳定可复用',
    content: files['SKILL.md'], bundleFiles: files, previousContent: existing?.content, diff,
    candidateId: candidate.candidateId, projectId: candidate.projectId, taskIds: candidate.taskIds,
    evidenceIds: candidate.evidenceIds, routeFingerprint: candidate.routeFingerprint, route: candidate.route,
    permissions, risk: candidate.risk, validation,
    rollout: { mode: 'canary', targetInvocations: CANARY_INVOCATIONS, failureLimit: CANARY_FAILURE_LIMIT },
  };
}

function failureClass(value) {
  const message = String(value || '');
  if (/timeout|timed out|超时/iu.test(message)) return 'timeout';
  if (/401|403|auth|permission|权限|凭据/iu.test(message)) return 'authorization';
  if (/schema|validation|校验|格式/iu.test(message)) return 'validation';
  if (/network|fetch|ECONN|ENOTFOUND|网络/iu.test(message)) return 'network';
  return 'unknown';
}

function createSkillLifecycle(rootDir, options = {}) {
  const filePath = path.join(rootDir, 'skill-lifecycle.json');
  let state = { schema: SKILL_LIFECYCLE_SCHEMA, candidates: [], rollouts: [], audit: [], updatedAt: Date.now() };
  let initialized = false;
  let initializationPromise;
  let writeQueue = Promise.resolve();

  function transact(operation) {
    const pending = writeQueue.then(operation, operation);
    writeQueue = pending.catch(() => {});
    return pending;
  }
  async function persist() {
    state.updatedAt = Date.now();
    state.candidates = state.candidates.slice(-500);
    state.rollouts = state.rollouts.slice(-500);
    state.audit = state.audit.slice(-1000);
    await atomicWrite(filePath, { state, checksum: checksum(state) });
  }
  async function initializeOnce() {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (!parsed?.state || parsed.checksum !== checksum(parsed.state)) throw new Error('Skill 生命周期账本校验失败');
      state = parsed.state;
    } catch (error) {
      if (error?.code !== 'ENOENT') await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`).catch(() => {});
    }
    initialized = true;
    await persist();
  }
  async function initialize() {
    if (initialized) return;
    if (!initializationPromise) initializationPromise = initializeOnce().catch((error) => { initializationPromise = undefined; throw error; });
    await initializationPromise;
  }
  function audit(action, data = {}) {
    state.audit.push({ id: `skill-audit-${crypto.randomUUID()}`, action, ...data, occurredAt: Date.now() });
  }
  async function resolveExisting(hint) {
    if (hint.action !== 'update' || typeof options.resolveInstalledSkill !== 'function') return undefined;
    return options.resolveInstalledSkill(hint.targetSkillName || hint.name);
  }
  async function compileIfEligible(candidate) {
    const gate = eligibility(candidate);
    candidate.eligibility = gate;
    if (!gate.eligible || candidate.draftId || ['pending_approval', 'canary', 'active', 'disabled', 'rejected'].includes(candidate.status)) {
      candidate.status = candidate.status === 'rejected' ? 'rejected' : gate.eligible ? 'eligible' : 'collecting';
      return undefined;
    }
    candidate.status = 'compiling';
    const existing = await resolveExisting(candidate.observations.at(-1)?.hint || {});
    const compiled = compileCandidate(candidate, existing);
    if (!compiled.validation.passed) {
      candidate.status = 'validation_failed';
      candidate.validation = compiled.validation;
      audit('candidate-validation-failed', { candidateId: candidate.candidateId, projectId: candidate.projectId });
      return undefined;
    }
    if (typeof options.createSkillDraft !== 'function') throw new Error('Skill 生命周期未配置草案持久化器');
    const result = await options.createSkillDraft(compiled);
    candidate.draftId = result.draft.id;
    candidate.status = 'pending_approval';
    candidate.validation = compiled.validation;
    candidate.compiledAt = Date.now();
    audit('candidate-compiled', { candidateId: candidate.candidateId, draftId: candidate.draftId, projectId: candidate.projectId });
    return result.draft;
  }
  async function observe(input, hints = []) {
    await initialize();
    const normalizedHints = hints.map(normalizeHint).filter(Boolean);
    const producedDraftIds = [];
    const candidateIds = [];
    await transact(async () => {
      for (const hint of normalizedHints) {
        const projectId = text(input?.projectId, 180);
        const groupKey = candidateKey(projectId || 'unscoped', hint);
        let candidate = [...state.candidates].reverse().find((item) => item.groupKey === groupKey
          && !['active', 'disabled', 'rejected', 'rolled_back'].includes(item.status));
        if (!candidate) {
          candidate = {
            schema: SKILL_LIFECYCLE_SCHEMA,
            candidateId: `skill-candidate-${crypto.randomUUID()}`,
            key: `${groupKey}:${Date.now()}:${crypto.randomBytes(3).toString('hex')}`,
            groupKey,
            projectId: projectId || undefined,
            name: hint.name,
            description: hint.description,
            reason: hint.reason,
            observations: [],
            status: 'collecting',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          state.candidates.push(candidate);
        }
        candidateIds.push(candidate.candidateId);
        const route = collectRoute(input);
        const observation = {
          observationId: `skill-observation-${crypto.randomUUID()}`,
          taskId: text(input?.taskId, 180),
          projectId: projectId || undefined,
          outcome: input?.outcome === 'completed' ? 'completed' : input?.outcome || 'failed',
          acceptanceVerified: input?.outcome === 'completed' && (input?.evidence || []).some((item) => item?.verified === true),
          evidenceIds: unique((input?.evidence || []).filter((item) => item?.verified).map((item) => item.id), 100),
          route,
          routeFingerprint: route.length ? hash(route.join(' -> ')) : '',
          failure: text(input?.failure, 800) || undefined,
          hint,
          observedAt: Date.now(),
        };
        const existingIndex = candidate.observations.findIndex((item) => item.taskId && item.taskId === observation.taskId);
        if (existingIndex >= 0) candidate.observations[existingIndex] = observation;
        else candidate.observations.push(observation);
        Object.assign(candidate, candidateMetrics(candidate));
        candidate.permissions = unique(candidate.route.map(permissionForTool), 40);
        candidate.risk = riskFromPermissions(candidate.permissions);
        candidate.updatedAt = Date.now();
        const draft = await compileIfEligible(candidate);
        if (draft?.id) producedDraftIds.push(draft.id);
        audit('candidate-observed', { candidateId: candidate.candidateId, taskId: observation.taskId, projectId: candidate.projectId, outcome: observation.outcome });
      }
      await persist();
    });
    return { ok: true, candidateCount: normalizedHints.length, candidateIds: unique(candidateIds, 100), skillDraftIds: producedDraftIds };
  }
  async function list(filter = {}) {
    await initialize();
    await writeQueue;
    const candidates = state.candidates.filter((item) => !filter.projectId || item.projectId === filter.projectId);
    return { ok: true, schema: SKILL_LIFECYCLE_SCHEMA, candidates: clone(candidates), rollouts: clone(state.rollouts), audit: filter.includeAudit ? clone(state.audit.slice(-200)) : undefined };
  }
  async function reviewDraft(draft, decision, result = {}) {
    await initialize();
    return transact(async () => {
      const candidate = state.candidates.find((item) => item.candidateId === draft?.candidateId || item.draftId === draft?.id);
      if (!candidate) return { ok: true, tracked: false };
      if (decision !== 'approve') {
        candidate.status = 'rejected';
        candidate.rejectedAt = Date.now();
        audit('candidate-rejected', { candidateId: candidate.candidateId, draftId: draft.id });
        await persist();
        return { ok: true, tracked: true, candidate: clone(candidate) };
      }
      candidate.status = 'canary';
      candidate.approvedAt = Date.now();
      let rollout = state.rollouts.find((item) => item.candidateId === candidate.candidateId);
      if (!rollout) {
        rollout = {
          rolloutId: `skill-rollout-${crypto.randomUUID()}`,
          candidateId: candidate.candidateId,
          draftId: draft.id,
          skillName: draft.name,
          status: 'canary',
          targetInvocations: Number(draft.rollout?.targetInvocations) || CANARY_INVOCATIONS,
          failureLimit: Number(draft.rollout?.failureLimit) || CANARY_FAILURE_LIMIT,
          invocations: [],
          successes: 0,
          failures: 0,
          successRate: 0,
          versionId: result.versionId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        state.rollouts.push(rollout);
      }
      audit('candidate-approved-canary', { candidateId: candidate.candidateId, draftId: draft.id, rolloutId: rollout.rolloutId });
      await persist();
      return { ok: true, tracked: true, candidate: clone(candidate), rollout: clone(rollout) };
    });
  }
  async function recordInvocation(input = {}) {
    await initialize();
    return transact(async () => {
      const rollout = state.rollouts.find((item) => ['canary', 'active'].includes(item.status)
        && String(item.skillName || '').toLocaleLowerCase() === String(input.skillName || '').toLocaleLowerCase());
      if (!rollout) return { ok: true, tracked: false };
      const invocation = {
        invocationId: `skill-canary-invocation-${crypto.randomUUID()}`,
        skillId: text(input.skillId, 240), taskId: text(input.taskId, 180) || undefined,
        status: input.ok === false ? 'failed' : 'succeeded',
        failureClass: input.ok === false ? failureClass(input.evidence) : undefined,
        evidence: text(input.evidence, 800), occurredAt: Date.now(),
      };
      rollout.invocations.push(invocation);
      rollout.invocations = rollout.invocations.slice(-200);
      rollout.successes = rollout.invocations.filter((item) => item.status === 'succeeded').length;
      rollout.failures = rollout.invocations.filter((item) => item.status === 'failed').length;
      rollout.successRate = Number((rollout.successes / rollout.invocations.length).toFixed(4));
      rollout.failureTypes = Object.fromEntries([...new Set(rollout.invocations.map((item) => item.failureClass).filter(Boolean))]
        .map((kind) => [kind, rollout.invocations.filter((item) => item.failureClass === kind).length]));
      rollout.updatedAt = Date.now();
      let autoDisabled = false;
      if (rollout.status === 'canary' && (rollout.failures >= rollout.failureLimit
        || (rollout.invocations.length >= 3 && rollout.successRate < 0.6))) {
        rollout.status = 'disabled';
        rollout.disabledAt = Date.now();
        rollout.disableReason = `灰度调用 ${rollout.invocations.length} 次，失败 ${rollout.failures} 次`;
        const candidate = state.candidates.find((item) => item.candidateId === rollout.candidateId);
        if (candidate) candidate.status = 'disabled';
        if (typeof options.setAutoSkillEnabled === 'function') await options.setAutoSkillEnabled(rollout.skillName, false, rollout.disableReason);
        autoDisabled = true;
        audit('canary-auto-disabled', { rolloutId: rollout.rolloutId, candidateId: rollout.candidateId, reason: rollout.disableReason });
      } else if (rollout.status === 'canary' && rollout.invocations.length >= rollout.targetInvocations && rollout.successRate >= 0.8) {
        rollout.status = 'active';
        rollout.activatedAt = Date.now();
        const candidate = state.candidates.find((item) => item.candidateId === rollout.candidateId);
        if (candidate) candidate.status = 'active';
        if (typeof options.setAutoSkillEnabled === 'function') await options.setAutoSkillEnabled(rollout.skillName, true, '灰度验证通过');
        audit('canary-promoted', { rolloutId: rollout.rolloutId, candidateId: rollout.candidateId, successRate: rollout.successRate });
      }
      await persist();
      return { ok: true, tracked: true, rollout: clone(rollout), autoDisabled };
    });
  }
  async function rollback(skillName) {
    await initialize();
    if (typeof options.rollbackAutoSkill !== 'function') throw new Error('Skill 生命周期未配置版本回滚器');
    const result = await options.rollbackAutoSkill(skillName);
    await transact(async () => {
      const rollout = [...state.rollouts].reverse().find((item) => String(item.skillName).toLocaleLowerCase() === String(skillName).toLocaleLowerCase());
      if (rollout) { rollout.status = 'rolled_back'; rollout.rolledBackAt = Date.now(); rollout.rollbackVersionId = result.versionId; }
      const candidate = rollout && state.candidates.find((item) => item.candidateId === rollout.candidateId);
      if (candidate) candidate.status = 'rolled_back';
      audit('skill-version-rollback', { skillName, versionId: result.versionId });
      await persist();
    });
    return result;
  }

  return { initialize, observe, list, reviewDraft, recordInvocation, rollback, filePath };
}

module.exports = {
  SKILL_LIFECYCLE_SCHEMA, MIN_INDEPENDENT_TASKS, MAX_CANDIDATE_FAILURE_RATE, MIN_ROUTE_SIMILARITY,
  CANARY_INVOCATIONS, CANARY_FAILURE_LIMIT, createSkillLifecycle, normalizeHint, collectRoute,
  routeSimilarity, permissionForTool, riskFromPermissions, compileCandidate, eligibility,
};
