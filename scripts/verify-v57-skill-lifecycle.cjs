const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createSkillLifecycle } = require('../electron/skillLifecycle.cjs');
const { createSkillRuntime } = require('../electron/skillRuntime.cjs');
const {
  createSkillDraft,
  listSkillDrafts,
  reviewSkillDraft,
  listSkills,
  readSkill,
  setAutoSkillEnabled,
  rollbackAutoSkill,
} = require('../electron/skills.cjs');

function task(taskId, outputLabel = '已验证报告') {
  return {
    taskId,
    projectId: 'project-v57',
    outcome: 'completed',
    goal: '生成报告并确认可以重新打开',
    steps: [{ id: `${taskId}-step`, tools: [
      { name: 'write_file', success: true },
      { name: 'read_file', success: true },
      { name: 'run_command', success: true },
    ] }],
    evidence: [{ id: `${taskId}-evidence`, verified: true, summary: outputLabel }],
  };
}

function hint(action = 'create', suffix = '') {
  return {
    action,
    name: 'verified-report',
    target_skill_name: action === 'update' ? 'verified-report' : undefined,
    description: '生成报告、读回文件并运行验证；用于需要交付可重新打开报告的任务。',
    steps: [`写入报告${suffix}`, '读回文件', '运行验证并检查结果'],
    inputs: ['报告主题与内容要求'],
    outputs: ['可重新打开的报告文件'],
    success_criteria: ['文件已写入并可重新打开', '验证命令成功'],
    permissions: ['filesystem:write', 'filesystem:read', 'command:execute'],
    external_services: [],
    positive_example: '输入报告主题后生成 report.md，读回内容并通过验证。',
    failure_example: '文件写入或读回失败时停止，不得宣布完成。',
    reason: '两个独立任务复用了同一条已验收路线。',
  };
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-v57-'));
  const previousProfile = process.env.USERPROFILE;
  process.env.USERPROFILE = root;
  try {
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(path.join(projectRoot, 'skills'), { recursive: true });
    const lifecycle = createSkillLifecycle(path.join(root, 'runtime'), {
      createSkillDraft: (input) => createSkillDraft(projectRoot, input),
      async resolveInstalledSkill(name) {
        const skill = (await listSkills(projectRoot)).find((item) => item.name === name);
        if (!skill) return undefined;
        if (skill.origin !== 'auto') throw new Error('不能更新非自动 Skill');
        return { skill, ...(await readSkill(projectRoot, skill.id)) };
      },
      setAutoSkillEnabled: (name, enabled, reason) => setAutoSkillEnabled(projectRoot, name, enabled, reason),
      rollbackAutoSkill: (name) => rollbackAutoSkill(projectRoot, name),
    });

    const first = await lifecycle.observe(task('task-a'), [hint()]);
    assert.equal(first.skillDraftIds.length, 0, '一个任务只能形成候选，不能形成草案');
    let state = await lifecycle.list();
    assert.equal(state.candidates[0].independentTaskCount, 1);
    assert.equal(state.candidates[0].status, 'collecting');

    const second = await lifecycle.observe(task('task-b'), [hint()]);
    assert.equal(second.skillDraftIds.length, 1, '两个独立任务通过验收后才形成草案');
    const draft = (await listSkillDrafts()).find((item) => item.id === second.skillDraftIds[0]);
    assert.equal(draft.validation.passed, true);
    assert.equal(draft.taskIds.length, 2);
    assert.deepEqual(new Set(draft.bundlePaths), new Set(['SKILL.md', 'agents/openai.yaml', 'references/contract.md']));
    assert.match(draft.content, /^---\nname: verified-report\ndescription: /u);
    assert.doesNotMatch(draft.content, /\n(?:version|origin):/u);

    const approved = await reviewSkillDraft(projectRoot, draft.id, 'approve');
    assert.equal(approved.action, 'created');
    await lifecycle.reviewDraft(approved.draft, 'approve', approved);
    let installed = (await listSkills(projectRoot)).find((item) => item.name === 'verified-report');
    assert.equal(installed.origin, 'auto');
    assert.equal(installed.lifecycleStatus, 'canary');
    assert.equal(installed.health, 'ready');

    const runtime = createSkillRuntime({
      stateRoot: path.join(root, 'skill-runtime'),
      projectRoot,
      listSkills,
      readSkill,
      onInvocation: (input) => lifecycle.recordInvocation(input),
    });
    await runtime.refresh('v57-test');
    await runtime.recordInvocation({ skillId: installed.id, taskId: 'canary-fail-1', ok: false, evidence: '验证失败：输出格式不正确' });
    const disabled = await runtime.recordInvocation({ skillId: installed.id, taskId: 'canary-fail-2', ok: false, evidence: '验证失败：输出格式不正确' });
    assert.equal(disabled.lifecycle.autoDisabled, true);
    installed = (await listSkills(projectRoot)).find((item) => item.name === 'verified-report');
    assert.equal(installed.lifecycleStatus, 'disabled');
    assert.equal(installed.health, 'broken');

    assert.equal((await lifecycle.observe(task('task-c', '新版报告已验证'), [hint('update', '并写入新版摘要')])).skillDraftIds.length, 0);
    const updateObservation = await lifecycle.observe(task('task-d', '新版报告再次验证'), [hint('update', '并写入新版摘要')]);
    assert.equal(updateObservation.skillDraftIds.length, 1);
    const updateDraft = (await listSkillDrafts()).find((item) => item.id === updateObservation.skillDraftIds[0]);
    assert.equal(updateDraft.action, 'replace');
    assert.match(updateDraft.diff, /--- a\/SKILL\.md/u);
    const replaced = await reviewSkillDraft(projectRoot, updateDraft.id, 'approve');
    assert.equal(replaced.action, 'replaced');
    await lifecycle.reviewDraft(replaced.draft, 'approve', replaced);
    installed = (await listSkills(projectRoot)).find((item) => item.name === 'verified-report');
    const updatedContent = (await readSkill(projectRoot, installed.id)).content;
    assert.match(updatedContent, /新版摘要/u);
    await runtime.refresh('v57-updated-version');
    for (let index = 0; index < 5; index += 1) {
      await runtime.recordInvocation({ skillId: installed.id, taskId: `canary-success-${index}`, ok: true, evidence: '报告已写入、读回并通过验证' });
    }
    installed = (await listSkills(projectRoot)).find((item) => item.name === 'verified-report');
    assert.equal(installed.lifecycleStatus, 'active');
    state = await lifecycle.list();
    assert(state.rollouts.some((item) => item.status === 'active' && item.successRate === 1));

    const rolledBack = await lifecycle.rollback('verified-report');
    assert.equal(rolledBack.ok, true);
    installed = (await listSkills(projectRoot)).find((item) => item.name === 'verified-report');
    const restoredContent = (await readSkill(projectRoot, installed.id)).content;
    assert.doesNotMatch(restoredContent, /新版摘要/u);
    state = await lifecycle.list();
    assert(state.rollouts.some((item) => item.status === 'rolled_back'));
    const uiSource = await fs.readFile(path.join(__dirname, '..', 'src', 'components', 'skills', 'SkillLibraryView.tsx'), 'utf8');
    for (const marker of ['来源任务与证据', '验证报告', 'Skill 正文', '变更 Diff', '批准并灰度启用']) assert(uiSource.includes(marker));
    const personaSource = await fs.readFile(path.join(__dirname, '..', 'src', 'components', 'settings', 'AssistantSettingsModal.tsx'), 'utf8');
    assert(Number(personaSource.match(/DEFAULT_PROMPT_VERSION = '(\d+)'/u)?.[1]) >= 28);
    assert(personaSource.includes('v5.7 Skill 候选、编译、验证与灰度协议'));
    console.log('V5.7 Skill lifecycle verified: aggregation, compile, validation, approval, canary disable, replacement and rollback');
  } finally {
    if (previousProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousProfile;
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
