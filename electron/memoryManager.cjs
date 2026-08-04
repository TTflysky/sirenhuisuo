const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const MEMORY_SCHEMA_VERSION = 2;
const MEMORY_MANAGER_VERSION = 2;
const VALID_SCOPES = new Set(['organization', 'team', 'employee', 'user']);
const VALID_CATEGORIES = new Set(['identity', 'preference', 'constraint', 'workflow', 'decision', 'project', 'lesson']);
const VALID_MEMORY_KINDS = new Set(['episodic', 'semantic', 'procedural', 'preference']);
const DEFAULT_LIMITS = { organization: 6000, team: 4000, employee: 2600, user: 2600 };

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stable(value[key])]));
}
function checksum(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function text(value, limit = 1000) { return String(value ?? '').trim().replace(/\s+/gu, ' ').slice(0, limit); }
function sanitize(value) {
  return text(value, 1200)
    .replace(/\b(?:sk|pk|api|key|token)[-_][A-Za-z0-9_-]{12,}\b/giu, '[已隐藏凭据]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{10,}\b/giu, 'Bearer [已隐藏凭据]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|password|secret|验证码)\s*[:=]\s*)[^\s,;，；]{4,}/giu, '$1[已隐藏凭据]');
}
function normalized(value) { return sanitize(value).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ''); }
function fingerprint(value) { return crypto.createHash('sha256').update(normalized(value)).digest('hex').slice(0, 24); }
function tokens(value) {
  const source = normalized(value);
  const result = new Set(String(value ?? '').toLocaleLowerCase().match(/[a-z0-9][a-z0-9._+-]*/gu) || []);
  for (let index = 0; index < source.length - 1; index += 1) result.add(source.slice(index, index + 2));
  if (source.length === 1) result.add(source);
  return result;
}
function similarity(left, right) {
  const a = normalized(left); const b = normalized(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) / Math.max(a.length, b.length) >= 0.72) return 0.9;
  const aa = tokens(left); const bb = tokens(right);
  const common = [...aa].filter((item) => bb.has(item)).length;
  const union = new Set([...aa, ...bb]).size;
  return union ? common / union : 0;
}
function inferMemoryKind(input, evidence = []) {
  if (input?.sourceType === 'task-review') return evidence.length > 0 && input?.acceptanceVerified !== false ? 'procedural' : 'episodic';
  if (VALID_MEMORY_KINDS.has(input?.memoryKind)) return input.memoryKind;
  if (input?.category === 'preference') return 'preference';
  if (input?.sourceType === 'legacy' && input?.category === 'lesson') return 'episodic';
  if (input?.category === 'workflow') return 'procedural';
  if (input?.taskId || input?.category === 'decision') return 'episodic';
  return 'semantic';
}
function scopeKey(scope, scopeId) { return `${scope}:${scopeId || 'default'}`; }
function safeScopeId(value) { return text(value || 'default', 160).replace(/[^a-z0-9._-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'default'; }
function emptyState() { return { schemaVersion: MEMORY_SCHEMA_VERSION, entries: [], proposals: [], audit: [], imports: [], updatedAt: Date.now() }; }
function envelope(state) { return { state: clone(state), checksum: checksum(state) }; }

async function atomicWrite(filePath, content) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tempPath, content, 'utf8');
  try { await fs.rename(tempPath, filePath); }
  catch (error) { await fs.rm(tempPath, { force: true }).catch(() => {}); throw error; }
}

function normalizeEntry(input, now = Date.now()) {
  const scope = VALID_SCOPES.has(input?.scope) ? input.scope : 'organization';
  const content = sanitize(input?.content);
  if (!content) throw new Error('记忆内容不能为空');
  const scopeId = scope === 'organization' || scope === 'user' ? 'default' : safeScopeId(input?.scopeId);
  const evidence = Array.isArray(input?.evidence) ? input.evidence.map((item) => sanitize(item)).filter(Boolean).slice(0, 8) : [];
  return {
    id: text(input?.id, 200) || `memory-${scope}-${scopeId}-${crypto.randomUUID()}`,
    scope, scopeId,
    category: VALID_CATEGORIES.has(input?.category) ? input.category : 'lesson',
    memoryKind: inferMemoryKind(input, evidence),
    content,
    source: text(input?.source || 'system', 180),
    sourceType: ['manual', 'legacy', 'task-review', 'review-model'].includes(input?.sourceType) ? input.sourceType : 'manual',
    taskId: text(input?.taskId, 180) || undefined,
    employeeId: text(input?.employeeId, 180) || undefined,
    evidence,
    acceptanceVerified: input?.acceptanceVerified === true || (input?.sourceType === 'task-review' && evidence.length > 0),
    importance: Math.max(1, Math.min(5, Math.round(Number(input?.importance) || 3))),
    confidence: Math.max(0, Math.min(1, Number(input?.confidence) || 0.8)),
    fingerprint: fingerprint(content),
    createdAt: Number(input?.createdAt) || now,
    updatedAt: Number(input?.updatedAt) || now,
  };
}

function createMemoryManager(rootDir, options = {}) {
  const statePath = path.join(rootDir, 'memory-state.json');
  const projectionDir = path.join(rootDir, 'projections');
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  let state = emptyState();
  let initialized = false;
  let initializationPromise;
  let queue = Promise.resolve();

  function transact(operation) {
    const run = async () => {
      await initialize();
      const before = clone(state);
      try { return await operation(); }
      catch (error) { state = before; throw error; }
    };
    const pending = queue.then(run, run);
    queue = pending.catch(() => {});
    return pending;
  }

  async function initializeOnce() {
    await fs.mkdir(projectionDir, { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(statePath, 'utf8'));
      if (!parsed?.state || parsed.checksum !== checksum(parsed.state)) throw new Error('记忆状态校验失败');
      const previousSchemaVersion = Number(parsed.state.schemaVersion) || 1;
      state = { ...emptyState(), ...parsed.state, schemaVersion: MEMORY_SCHEMA_VERSION };
      state.entries = Array.isArray(state.entries) ? state.entries.map((item) => normalizeEntry(item, item.updatedAt)).filter(Boolean) : [];
      state.proposals = Array.isArray(state.proposals) ? state.proposals : [];
      state.audit = Array.isArray(state.audit) ? state.audit : [];
      state.imports = Array.isArray(state.imports) ? state.imports : [];
      if (previousSchemaVersion < MEMORY_SCHEMA_VERSION) state.audit.push({ id: crypto.randomUUID(), ts: Date.now(), action: 'schema_migrated', fromVersion: previousSchemaVersion, toVersion: MEMORY_SCHEMA_VERSION });
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        const corruptPath = `${statePath}.corrupt-${Date.now()}`;
        await fs.rename(statePath, corruptPath).catch(() => {});
        state.audit.push({ id: crypto.randomUUID(), ts: Date.now(), action: 'recovered', detail: '损坏的记忆状态已隔离，使用空状态恢复', corruptPath });
      }
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

  function entriesFor(scope, scopeId) {
    const id = scope === 'organization' || scope === 'user' ? 'default' : safeScopeId(scopeId);
    return state.entries.filter((entry) => entry.scope === scope && entry.scopeId === id);
  }

  function usage(scope, scopeId, entries = entriesFor(scope, scopeId)) {
    const current = entries.reduce((sum, item) => sum + item.content.length + 1, 0);
    const max = Number(limits[scope]) || 2600;
    return { current, max, percent: Math.round((current / max) * 100) };
  }

  async function writeProjections() {
    await fs.rm(projectionDir, { recursive: true, force: true });
    await fs.mkdir(projectionDir, { recursive: true });
    const groups = new Map();
    for (const entry of state.entries) {
      const key = scopeKey(entry.scope, entry.scopeId);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const indexLines = ['# 太极分层记忆', '', '> 本目录是结构化记忆的可读投影。请通过太极界面修改，避免直接编辑导致投影与事实源不一致。', ''];
    for (const [key, entries] of groups) {
      const [scope, ...idParts] = key.split(':');
      const id = idParts.join(':');
      const relative = scope === 'employee' ? `employees/${safeScopeId(id)}.md`
        : scope === 'team' ? `teams/${safeScopeId(id)}.md` : `${scope}.md`;
      const body = [`# ${scope === 'organization' ? '组织共享记忆' : scope === 'team' ? `团队记忆 ${id}` : scope === 'employee' ? `员工经验 ${id}` : '用户画像记忆'}`, '', ...entries
        .sort((a, b) => b.importance - a.importance || b.updatedAt - a.updatedAt)
        .map((entry) => `- [${entry.memoryKind}/${entry.category}] ${entry.content} <!-- ${entry.id} -->`), ''].join('\n');
      await atomicWrite(path.join(projectionDir, relative), body);
      indexLines.push(`- [${key}](./${relative.replace(/\\/gu, '/')}) · ${entries.length} 条`);
    }
    await atomicWrite(path.join(projectionDir, 'README.md'), `${indexLines.join('\n')}\n`);
  }

  async function persist() {
    state.updatedAt = Date.now();
    state.audit = state.audit.slice(-1000);
    state.proposals = state.proposals.slice(-500);
    await atomicWrite(statePath, `${JSON.stringify(envelope(state), null, 2)}\n`);
    // Markdown is a rebuildable projection. A projection failure must not make a
    // successfully persisted fact look failed and trigger a duplicate retry.
    await writeProjections().catch(() => {});
  }

  function appendAudit(action, detail = {}) {
    state.audit.push({ id: `memory-audit-${crypto.randomUUID()}`, ts: Date.now(), action, ...clone(detail) });
  }

  function validateCapacity(candidate, replacingId) {
    const scoped = entriesFor(candidate.scope, candidate.scopeId).filter((item) => item.id !== replacingId);
    const nextUsage = usage(candidate.scope, candidate.scopeId, [...scoped, candidate]);
    if (nextUsage.current > nextUsage.max) throw new Error(`该记忆层已达到容量上限（${nextUsage.current}/${nextUsage.max} 字符），请先整理或删除旧条目`);
    return nextUsage;
  }

  function applyUpsert(input, replaceExact) {
    const candidate = normalizeEntry(input);
    let match;
    if (replaceExact) {
      const exact = sanitize(replaceExact);
      const matches = entriesFor(candidate.scope, candidate.scopeId).filter((item) => item.content === exact);
      if (matches.length !== 1) throw new Error(`精确替换要求旧内容恰好匹配一条，当前匹配 ${matches.length} 条`);
      match = matches[0];
    } else {
      match = entriesFor(candidate.scope, candidate.scopeId).find((item) => item.fingerprint === candidate.fingerprint
        || (item.memoryKind === candidate.memoryKind && item.category === candidate.category && similarity(item.content, candidate.content) >= 0.84));
    }
    if (match?.fingerprint === candidate.fingerprint) {
      return { action: 'ignored', entry: match, usage: usage(match.scope, match.scopeId) };
    }
    validateCapacity(candidate, match?.id);
    if (match) {
      const merged = { ...candidate, id: match.id, createdAt: match.createdAt, updatedAt: Date.now(), importance: Math.max(match.importance, candidate.importance), confidence: Math.max(match.confidence, candidate.confidence) };
      state.entries[state.entries.findIndex((item) => item.id === match.id)] = merged;
      return { action: 'updated', entry: merged, usage: usage(merged.scope, merged.scopeId) };
    }
    state.entries.push(candidate);
    return { action: 'added', entry: candidate, usage: usage(candidate.scope, candidate.scopeId) };
  }

  async function upsert(input, metadata = {}) {
    return transact(async () => {
      await initialize();
      const applied = applyUpsert(input, metadata.replaceExact);
      const entry = applied.entry;
      appendAudit(applied.action === 'ignored' ? 'ignored_duplicate' : applied.action, { entryId: entry.id, scope: entry.scope, scopeId: entry.scopeId, source: entry.source, taskId: entry.taskId });
      await persist();
      return { ok: true, action: applied.action, entry: clone(entry), usage: applied.usage };
    });
  }

  async function remove(entryId, metadata = {}) {
    return transact(async () => {
      await initialize();
      const index = state.entries.findIndex((item) => item.id === entryId);
      if (index < 0) return { ok: false, error: '记忆不存在或已经删除' };
      const [entry] = state.entries.splice(index, 1);
      appendAudit('removed', { entryId, scope: entry.scope, scopeId: entry.scopeId, reason: text(metadata.reason, 300) });
      await persist();
      return { ok: true, entry: clone(entry) };
    });
  }

  async function list(filter = {}) {
    await initialize();
    await queue;
    const requestedKinds = Array.isArray(filter.memoryKinds) ? new Set(filter.memoryKinds.filter((item) => VALID_MEMORY_KINDS.has(item))) : undefined;
    const entries = state.entries.filter((entry) => (!filter.scope || entry.scope === filter.scope)
      && (!filter.scopeId || entry.scopeId === safeScopeId(filter.scopeId))
      && (!filter.employeeId || entry.employeeId === filter.employeeId || (entry.scope === 'employee' && entry.scopeId === safeScopeId(filter.employeeId)))
      && (!filter.taskId || entry.taskId === filter.taskId)
      && (!filter.category || entry.category === filter.category)
      && (!filter.memoryKind || entry.memoryKind === filter.memoryKind)
      && (!requestedKinds?.size || requestedKinds.has(entry.memoryKind)));
    const scopeUsages = {};
    for (const entry of state.entries) scopeUsages[scopeKey(entry.scope, entry.scopeId)] = usage(entry.scope, entry.scopeId);
    for (const scope of ['organization', 'user']) scopeUsages[scopeKey(scope, 'default')] ||= usage(scope, 'default');
    return { ok: true, version: MEMORY_MANAGER_VERSION, entries: clone(entries), proposals: clone(state.proposals.filter((item) => !filter.proposalStatus || item.status === filter.proposalStatus)), audit: clone(filter.includeAudit ? state.audit.slice(-200) : []), limits: clone(limits), usage: clone(scopeUsages) };
  }

  async function context(input = {}) {
    await initialize();
    await queue;
    const allowed = new Set(['organization:default', 'user:default']);
    if (input.teamId) allowed.add(scopeKey('team', safeScopeId(input.teamId)));
    if (input.employeeId) allowed.add(scopeKey('employee', safeScopeId(input.employeeId)));
    const now = Date.now();
    const requestedKinds = Array.isArray(input.memoryKinds) ? new Set(input.memoryKinds.filter((item) => VALID_MEMORY_KINDS.has(item))) : undefined;
    const ranked = state.entries.filter((entry) => allowed.has(scopeKey(entry.scope, entry.scopeId))
      && (!input.memoryKind || entry.memoryKind === input.memoryKind)
      && (!requestedKinds?.size || requestedKinds.has(entry.memoryKind))).map((entry) => ({
      entry,
      score: similarity(input.query || '', entry.content) * 100 + entry.importance * 8 + entry.confidence * 6 + Math.max(0, 5 - (now - entry.updatedAt) / (90 * 86400000)),
    })).sort((a, b) => b.score - a.score).slice(0, Math.max(4, Math.min(24, Number(input.limit) || 14)));
    const labels = { organization: '组织共享经验', team: '当前团队共享经验', employee: '当前员工个人经验', user: '老板画像与偏好' };
    const blocks = [];
    for (const scope of ['organization', 'team', 'employee', 'user']) {
      const items = ranked.filter((item) => item.entry.scope === scope).map((item) => item.entry);
      if (items.length) blocks.push(`## ${labels[scope]}\n${items.map((item) => `- [${item.memoryKind}/${item.category}] ${item.content}`).join('\n')}`);
    }
    return { ok: true, context: blocks.join('\n\n'), entries: clone(ranked.map((item) => item.entry)) };
  }

  async function propose(input) {
    return transact(async () => {
      await initialize();
      const proposal = {
        id: text(input?.id, 200) || `memory-proposal-${crypto.randomUUID()}`,
        status: 'pending', taskId: text(input?.taskId, 180) || undefined,
        summary: text(input?.summary || '任务复盘提出记忆更新', 500),
        update: clone(input?.update || {}), source: text(input?.source || 'review-model', 120),
        createdAt: Date.now(), updatedAt: Date.now(), warnings: Array.isArray(input?.warnings) ? input.warnings.map((item) => text(item, 300)).slice(0, 8) : [],
      };
      normalizeEntry(proposal.update);
      state.proposals.push(proposal);
      appendAudit('proposal_created', { proposalId: proposal.id, taskId: proposal.taskId, source: proposal.source });
      await persist();
      return { ok: true, proposal: clone(proposal) };
    });
  }

  async function reviewProposal(proposalId, decision, metadata = {}) {
    return transact(async () => {
      await initialize();
      const proposal = state.proposals.find((item) => item.id === proposalId);
      if (!proposal) throw new Error('记忆建议不存在');
      if (proposal.status !== 'pending') throw new Error('这条记忆建议已经处理');
      let applied;
      if (decision === 'approve') applied = applyUpsert(proposal.update, proposal.update.replaceExact);
      proposal.status = decision === 'approve' ? 'approved' : 'rejected';
      proposal.updatedAt = Date.now();
      proposal.reviewedBy = text(metadata.reviewedBy || 'user', 120);
      proposal.reviewNote = text(metadata.note, 300) || undefined;
      appendAudit(proposal.status === 'approved' ? 'proposal_approved' : 'proposal_rejected', { proposalId, taskId: proposal.taskId, note: proposal.reviewNote });
      if (applied) appendAudit(`proposal_${applied.action}`, { proposalId, entryId: applied.entry.id, scope: applied.entry.scope, scopeId: applied.entry.scopeId });
      await persist();
      if (!applied) return { ok: true, action: 'rejected' };
      return { ok: true, action: applied.action, entry: clone(applied.entry), usage: applied.usage };
    });
  }

  async function importLegacy(input = {}) {
    const importId = text(input.importId || checksum(input), 200);
    await initialize();
    if (state.imports.includes(importId)) return { ok: true, imported: 0, unchanged: true };
    let imported = 0;
    const userProfile = sanitize(input.userProfile);
    if (userProfile) {
      const result = await upsert({ scope: 'user', category: 'identity', memoryKind: 'semantic', content: userProfile.slice(0, 1000), source: '旧版用户画像', sourceType: 'legacy', importance: 5, confidence: 1 });
      if (result.action !== 'ignored') imported += 1;
    }
    for (const item of Array.isArray(input.userMemory) ? input.userMemory.slice(0, 150) : []) {
      const category = VALID_CATEGORIES.has(item?.category) ? item.category : 'preference';
      const result = await upsert({ scope: 'user', category, memoryKind: category === 'preference' ? 'preference' : 'semantic', content: item?.content, source: item?.source || '旧版长期记忆', sourceType: 'legacy', importance: item?.importance, confidence: item?.confidence, createdAt: item?.ts, updatedAt: item?.updatedAt });
      if (result.action !== 'ignored') imported += 1;
    }
    for (const item of Array.isArray(input.taskLearnings) ? input.taskLearnings.slice(0, 200) : []) {
      const route = Array.isArray(item?.successfulTools) && item.successfulTools.length ? `可行路线：${item.successfulTools.join(' → ')}` : '';
      const avoid = Array.isArray(item?.failedTools) && item.failedTools.length ? `避免重复：${item.failedTools.join('、')}` : '';
      const content = [`相似任务“${text(item?.goal, 220)}”`, route, avoid, text(item?.lesson, 400)].filter(Boolean).join('；');
      if (!content) continue;
      const result = await upsert({ scope: 'organization', category: 'lesson', memoryKind: 'episodic', content, source: '旧版任务经验（未迁移为已验收程序）', sourceType: 'legacy', importance: item?.outcome === 'completed' ? 4 : 3, confidence: 0.75, createdAt: item?.createdAt, updatedAt: item?.updatedAt });
      if (result.action !== 'ignored') imported += 1;
    }
    for (const item of Array.isArray(input.layeredMemory) ? input.layeredMemory.slice(0, 500) : []) {
      if (!VALID_SCOPES.has(item?.scope) || !item?.content) continue;
      const result = await upsert({ ...item, id: undefined, source: item.source || '同步配置导入', sourceType: item.sourceType || 'legacy' });
      if (result.action !== 'ignored') imported += 1;
    }
    await transact(async () => {
      state.imports.push(importId);
      appendAudit('legacy_imported', { importId, imported });
      await persist();
    });
    return { ok: true, imported, unchanged: false };
  }

  return { initialize, list, context, upsert, remove, propose, reviewProposal, importLegacy, statePath, projectionDir };
}

module.exports = { MEMORY_SCHEMA_VERSION, MEMORY_MANAGER_VERSION, DEFAULT_LIMITS, VALID_MEMORY_KINDS, createMemoryManager, inferMemoryKind, similarity, sanitize };
