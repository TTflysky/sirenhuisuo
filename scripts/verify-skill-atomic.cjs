const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { listSkills, readSkill, replaceSkillDirectoryAtomically, validateStagedSkill } = require('../electron/skills.cjs');

async function writeSkill(directory, { body, mode = 'directory', references = {}, hash } = {}) {
  await fs.mkdir(directory, { recursive: true });
  const content = body || '---\nname: Atomic Skill\n---\n\n# Atomic Skill\n';
  await fs.writeFile(path.join(directory, 'SKILL.md'), content, 'utf8');
  for (const [relative, value] of Object.entries(references)) {
    const target = path.join(directory, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, value, 'utf8');
  }
  await fs.writeFile(path.join(directory, '.taiji-skill.json'), JSON.stringify({
    schema: 1,
    installMode: mode,
    sourceUrl: 'https://example.com/SKILL.md',
    requestedSourceUrl: 'https://example.com/SKILL.md',
    contentHash: hash || crypto.createHash('sha256').update(content).digest('hex'),
    files: 1 + Object.keys(references).length,
    installedAt: new Date().toISOString(),
  }), 'utf8');
}

async function run() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-skill-atomic-test-'));
  const originalUserProfile = process.env.USERPROFILE;
  try {
    process.env.USERPROFILE = path.join(root, 'profile');
    const target = path.join(root, 'atomic-skill');
    await writeSkill(target, { references: { 'legacy.txt': 'old-only' } });

    const invalidStage = await fs.mkdtemp(path.join(root, '.install-atomic-skill-'));
    await writeSkill(invalidStage, {
      body: '---\nname: Atomic Skill\n---\n\n# Atomic Skill\n\n[missing](references/missing.md)\n',
    });
    await assert.rejects(validateStagedSkill(invalidStage), /缺少引用文件/u);
    await assert.rejects(replaceSkillDirectoryAtomically(target, invalidStage), /缺少引用文件/u);
    assert.equal(await fs.readFile(path.join(target, 'legacy.txt'), 'utf8'), 'old-only');

    const validStage = await fs.mkdtemp(path.join(root, '.install-atomic-skill-'));
    await writeSkill(validStage, {
      body: '---\nname: Atomic Skill\n---\n\n# Atomic Skill v2\n\n[guide](references/guide.md)\n',
      references: { 'references/guide.md': 'new-guide' },
    });
    await replaceSkillDirectoryAtomically(target, validStage);
    assert.match(await fs.readFile(path.join(target, 'SKILL.md'), 'utf8'), /v2/u);
    assert.equal(await fs.readFile(path.join(target, 'references', 'guide.md'), 'utf8'), 'new-guide');
    await assert.rejects(fs.stat(path.join(target, 'legacy.txt')), /ENOENT/u);

    const badHashStage = await fs.mkdtemp(path.join(root, '.install-atomic-skill-'));
    await writeSkill(badHashStage, { body: '# Corrupt\n', hash: '0'.repeat(64) });
    await assert.rejects(replaceSkillDirectoryAtomically(target, badHashStage), /完整性校验失败/u);
    assert.match(await fs.readFile(path.join(target, 'SKILL.md'), 'utf8'), /v2/u);

    const leftovers = (await fs.readdir(root)).filter((name) => name.startsWith('.backup-'));
    assert.deepEqual(leftovers, []);

    const projectRoot = path.join(root, 'project');
    const bundledSkill = path.join(projectRoot, 'skills', 'ima-test');
    await writeSkill(bundledSkill, {
      body: '---\nname: ima-test\n---\n\nRead `knowledge-base/SKILL.md` and `notes/SKILL.md`.\n',
      references: {
        'knowledge-base/SKILL.md': '# Knowledge Base\n\nUse `search_knowledge_base`.\n',
        'notes/SKILL.md': '# Notes\n\nUse `search_note`.\n',
      },
    });
    const listed = await listSkills(projectRoot);
    const bundled = listed.find((skill) => skill.name === 'ima-test');
    assert.ok(bundled, 'referenced Skill bundle must be scanned');
    assert.equal(bundled.scope, 'built-in');
    const read = await readSkill(projectRoot, bundled.id);
    assert.deepEqual(read.documents.map((document) => document.path), ['knowledge-base/SKILL.md', 'notes/SKILL.md']);
    assert.ok(read.documents.some((document) => document.content.includes('search_knowledge_base')));
    assert.ok(read.documents.some((document) => document.content.includes('search_note')));
    console.log('Skill atomic replacement verification passed.');
  } finally {
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
