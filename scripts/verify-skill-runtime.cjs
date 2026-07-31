const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createSkillRuntime } = require('../electron/skillRuntime.cjs');

;(async () => {
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-skill-runtime-'));
const runtime = createSkillRuntime({
  stateRoot: root,
  projectRoot: root,
  listSkills: async () => [{ id: 'skill-a', name: 'Skill A', scope: 'mine', source: 'local', health: 'ready' }],
  readSkill: async () => ({ content: '# Skill A', documents: [] }),
  installSkill: async () => ({ ok: true, skill: { id: 'skill-a' } }),
  repairSkill: async () => ({ ok: true, skill: { id: 'skill-a' } }),
});
const manifest = await runtime.refresh('verify');
assert.equal(manifest.skills['skill-a'].health, 'ready');
const invocation = await runtime.recordInvocation({ skillId: 'skill-a', taskId: 'task-1', evidence: '规则已读取并完成一次调用' });
assert.equal(invocation.status, 'succeeded');
assert.equal((await runtime.health()).ok, true);
assert.equal((await runtime.inspect('skill-a')).skill.contentHash.length, 64);
assert.equal((await runtime.install({ sourceUrl: 'https://example.test/SKILL.md' })).runtime.ok, true);
console.log(JSON.stringify({ passed: true, manifestPath: runtime.manifestPath }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
