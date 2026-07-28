const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createSkillDraft, listSkillDrafts, reviewSkillDraft, listSkills } = require('../electron/skills.cjs');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-skill-drafts-'));
  const previousProfile = process.env.USERPROFILE;
  process.env.USERPROFILE = root;
  try {
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(path.join(projectRoot, 'skills'), { recursive: true });
    const created = await createSkillDraft(projectRoot, { action: 'create', name: 'verified-report', description: '验证报告', content: '1. 写入文件。\n2. 读回验证。', taskId: 'task-1' });
    assert.equal((await listSkillDrafts()).length, 1);
    const approved = await reviewSkillDraft(projectRoot, created.draft.id, 'approve');
    assert.equal(approved.action, 'created');
    let installed = await listSkills(projectRoot);
    const autoSkill = installed.find((skill) => skill.name === 'verified-report');
    assert(autoSkill);
    assert.equal(autoSkill.origin, 'auto');

    const patchDraft = await createSkillDraft(projectRoot, { action: 'patch', name: 'verified-report', targetSkillName: 'verified-report', oldString: '2. 读回验证。', newString: '2. 读回并确认文件可以打开。', reason: '补齐验收步骤', taskId: 'task-2' });
    const patched = await reviewSkillDraft(projectRoot, patchDraft.draft.id, 'approve');
    assert.equal(patched.action, 'patched');
    installed = await listSkills(projectRoot);
    assert.equal(installed.find((skill) => skill.name === 'verified-report').origin, 'auto');

    const manualRoot = path.join(root, '.workbuddy', 'skills', 'manual-skill');
    await fs.mkdir(manualRoot, { recursive: true });
    const manualContent = '---\nname: manual-skill\ndescription: manual\n---\n\nManual content';
    await fs.writeFile(path.join(manualRoot, 'SKILL.md'), manualContent, 'utf8');
    const manualPatch = await createSkillDraft(projectRoot, { action: 'patch', name: 'manual-skill', targetSkillName: 'manual-skill', oldString: 'Manual content', newString: 'Changed' });
    await assert.rejects(() => reviewSkillDraft(projectRoot, manualPatch.draft.id, 'approve'), /只允许更新由太极复盘生成/u);
    console.log('skill drafts verified: create, exact patch, manual source protection');
  } finally {
    if (previousProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousProfile;
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
