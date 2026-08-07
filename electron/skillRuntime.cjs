const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const RUNTIME_SCHEMA = 1;

function now() { return new Date().toISOString(); }
function safeText(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function hash(value) { return crypto.createHash('sha256').update(String(value ?? '')).digest('hex'); }

/**
 * Runtime orchestration around the existing installer. Installation remains
 * the single owner of filesystem replacement; this layer owns lifecycle state,
 * health and auditable invocation evidence.
 */
function createSkillRuntime(options = {}) {
  const stateRoot = path.resolve(options.stateRoot || path.join(process.cwd(), '.taiji-skill-runtime'));
  const manifestPath = path.join(stateRoot, 'runtime-manifest.json');
  const listSkills = options.listSkills;
  const readSkill = options.readSkill;
  const installSkill = options.installSkill;
  const repairSkill = options.repairSkill;
  const projectRoot = options.projectRoot || process.cwd();

  async function readManifest() {
    try {
      const value = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      if (value?.schema === RUNTIME_SCHEMA) return value;
    } catch {}
    return { schema: RUNTIME_SCHEMA, generatedAt: now(), skills: {}, invocations: [] };
  }
  async function writeManifest(manifest) {
    await fs.mkdir(stateRoot, { recursive: true });
    const temp = `${manifestPath}.tmp-${process.pid}`;
    await fs.writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await fs.rename(temp, manifestPath);
    return manifest;
  }
  async function refresh(reason = 'manual') {
    if (typeof listSkills !== 'function') throw new Error('Skill Runtime 未配置 Skill 清单读取器');
    const items = await listSkills(projectRoot);
    const manifest = await readManifest();
    const skills = {};
    for (const skill of Array.isArray(items) ? items : []) {
      const id = safeText(skill.id, 240);
      if (!id) continue;
      const previous = manifest.skills[id] || {};
      skills[id] = {
        id, name: safeText(skill.name, 160), scope: skill.scope, source: safeText(skill.source, 300),
        sourceUrl: safeText(skill.sourceUrl, 1000) || undefined, version: safeText(skill.version, 80) || undefined,
        origin: skill.origin, lifecycleStatus: skill.lifecycleStatus,
        health: skill.health || 'unknown', healthMessage: safeText(skill.healthMessage, 300),
        quarantined: skill.quarantined === true, contentHash: skill.contentHash || previous.contentHash,
        lastSeenAt: now(), lastInvocationAt: previous.lastInvocationAt, invocationCount: previous.invocationCount || 0,
      };
    }
    manifest.generatedAt = now();
    manifest.lastRefreshReason = safeText(reason, 160);
    manifest.skills = skills;
    return writeManifest(manifest);
  }
  async function health() {
    const manifest = await refresh('health');
    const entries = Object.values(manifest.skills);
    const broken = entries.filter((item) => item.health === 'broken' || item.quarantined);
    const missing = entries.filter((item) => item.health === 'missing');
    return { schema: RUNTIME_SCHEMA, ok: broken.length === 0 && missing.length === 0, checkedAt: manifest.generatedAt, total: entries.length, ready: entries.filter((item) => item.health === 'ready').length, broken: broken.length, missing: missing.length, skills: entries };
  }
  async function recordInvocation(input = {}) {
    const id = safeText(input.skillId || input.id, 240);
    if (!id) throw new Error('Skill 调用缺少技能 ID');
    let manifest = await readManifest();
    if (!manifest.skills[id]) manifest = await refresh('invocation-discovery');
    const existing = manifest.skills[id] || { id, name: safeText(input.name, 160), health: 'unknown', invocationCount: 0 };
    existing.lastInvocationAt = now();
    existing.invocationCount = Number(existing.invocationCount || 0) + 1;
    manifest.skills[id] = existing;
    manifest.invocations = [{ id: `inv-${Date.now()}-${hash(id).slice(0, 8)}`, skillId: id, taskId: safeText(input.taskId, 180) || undefined, status: input.ok === false ? 'failed' : 'succeeded', evidence: safeText(input.evidence, 800), occurredAt: now() }, ...(manifest.invocations || [])].slice(0, 500);
    await writeManifest(manifest);
    let lifecycle;
    if (existing.origin === 'auto' && typeof options.onInvocation === 'function') {
      lifecycle = await options.onInvocation({ ...input, skillId: id, skillName: existing.name });
      if (lifecycle?.autoDisabled) await refresh('canary-auto-disabled');
    }
    return { ...manifest.invocations[0], lifecycle };
  }
  async function install(input) {
    if (typeof installSkill !== 'function') throw new Error('Skill Runtime 未配置安装器');
    const result = await installSkill(projectRoot, input);
    await refresh('install');
    return { ...result, runtime: await health() };
  }
  async function repair(id) {
    if (typeof repairSkill !== 'function') throw new Error('Skill Runtime 未配置修复器');
    const result = await repairSkill(projectRoot, id);
    await refresh('repair');
    return { ...result, runtime: await health() };
  }
  async function inspect(id) {
    const manifest = await readManifest();
    const item = manifest.skills[safeText(id, 240)];
    if (!item) return { ok: false, error: '技能尚未进入运行时清单，请先刷新' };
    if (typeof readSkill !== 'function') return { ok: true, skill: item };
    const skill = await readSkill(projectRoot, item.id);
    return { ok: true, skill: { ...item, contentHash: hash(skill.content), documentCount: skill.documents?.length || 0 } };
  }
  return { refresh, health, recordInvocation, install, repair, inspect, readManifest, manifestPath };
}

module.exports = { RUNTIME_SCHEMA, createSkillRuntime };
