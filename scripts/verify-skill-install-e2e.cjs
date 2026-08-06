const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createNativeToolRuntime } = require('../electron/nativeToolRuntime.cjs');
const { installSkill, listSkills, readSkill } = require('../electron/skills.cjs');

const DIAGRAM_BUILDER_ZIP = Buffer.from(
  'UEsDBBQAAAAIANgB/lxl2Nn8YQAAAHYAAAAYAAAAZGlhZ3JhbS1idWlsZGVyXFNLSUxMLm1ke797v66uLldeYm6qlUJKZmJ6UWKublJpZk5KahFXSmpxclFmQUlmfp6VghNIEKakmAuki0tZwQXCh8gCtXAFpSamKESnl2ampMZqFKWmpRal5iWnFuuDRfRyUzT1uHi5AFBLAwQUAAAACADYAf5cKwu3fS8AAAAtAAAAIwAAAGRpYWdyYW0tYnVpbGRlclxyZWZlcmVuY2VzXGd1aWRlLm1ke797v7KCe2lmSioXV2hxqkJxSVFpcklpUWqKQkpmYnpRYq5CZl5BaUmxHhcvFwBQSwECFAAUAAAACADYAf5cZdjZ/GEAAAB2AAAAGAAAAAAAAAAAAAAAAAAAAAAAZGlhZ3JhbS1idWlsZGVyXFNLSUxMLm1kUEsBAhQAFAAAAAgA2AH+XCsLt30vAAAALQAAACMAAAAAAAAAAAAAAAAAlwAAAGRpYWdyYW0tYnVpbGRlclxyZWZlcmVuY2VzXGd1aWRlLm1kUEsFBgAAAAACAAIAlwAAAAcBAAAAAA==',
  'base64',
);

const REPOSITORY_SKILL_FILES = {
  'skills/skill-alpha/SKILL.md': '---\nname: skill-alpha\ndescription: Alpha workflow\n---\n\nRead [the guide](references/guide.md).\n',
  'skills/skill-alpha/references/guide.md': '# Alpha Guide\n\nUse the alpha workflow.\n',
  'skills/skill-beta/SKILL.md': '---\nname: skill-beta\ndescription: Beta workflow\n---\n\nRun the beta workflow.\n',
};

const REPOSITORY_TREE = Object.keys(REPOSITORY_SKILL_FILES).map((file) => ({ path: file, type: 'blob' }));

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-skill-e2e-'));
  const originalUserProfile = process.env.USERPROFILE;
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    fetchCalls.push(href);
    if (href.startsWith('https://api.skillhub.cn/api/skills?')) {
      return new Response(JSON.stringify({ data: { skills: [{ slug: 'diagram-builder', name: 'Diagram Builder', description: 'Build diagrams', downloads: 42 }] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (href === 'https://api.skillhub.cn/api/v1/download?slug=diagram-builder') {
      return new Response(DIAGRAM_BUILDER_ZIP, { status: 200, headers: { 'content-type': 'application/zip', 'content-length': String(DIAGRAM_BUILDER_ZIP.length) } });
    }
    if (href === 'https://api.github.com/repos/vercel-labs/agent-skills/git/trees/main?recursive=1') {
      return new Response(JSON.stringify({ tree: REPOSITORY_TREE, truncated: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const repositoryPrefix = 'https://raw.githubusercontent.com/vercel-labs/agent-skills/main/';
    if (href.startsWith(repositoryPrefix)) {
      const relativePath = href.slice(repositoryPrefix.length);
      return Object.hasOwn(REPOSITORY_SKILL_FILES, relativePath)
        ? new Response(REPOSITORY_SKILL_FILES[relativePath], { status: 200 })
        : new Response('missing', { status: 404 });
    }
    throw new Error(`unexpected fetch: ${href}`);
  };

  try {
    process.env.USERPROFILE = path.join(root, 'profile');
    const routing = await import(pathToFileURL(path.join(projectRoot, 'src/engine/skillInstallRouting.mjs')).href);
    const decisionKernel = await import(pathToFileURL(path.join(projectRoot, 'src/engine/taskDecisionKernel.mjs')).href);
    const fidelity = await import(pathToFileURL(path.join(projectRoot, 'src/engine/taskFidelity.mjs')).href);
    const prompt = '请根据 https://skillhub.cn/install/skillhub.md，安装 diagram-builder。';
    const resolved = routing.resolveSkillInstallRequest(prompt);
    assert.equal(resolved.sourceUrl, 'https://api.skillhub.cn/api/v1/download?slug=diagram-builder');

    const decision = decisionKernel.normalizeTaskDecision({
      mode: 'execute', goal: prompt, primaryRoute: 'run_command', deliverableType: 'file',
      acceptanceCriteria: ['运行一条命令'], deliverables: [{ label: '安装说明.md', format: 'markdown' }],
      requiresEvidence: true, needsUser: false, missingUserCondition: '', searchQuery: '',
      decisionReason: '故意模拟错误决策', confidence: 0.5,
    }, { latestMessage: prompt, availableTools: ['search_skills', 'read_skill', 'install_skill', 'run_command'] });
    assert.equal(decision.primaryRoute, 'install_skill');
    assert.equal(decision.deliverableType, 'operation');
    assert.equal(decision.deliverables[0].type, 'operation');

    const cliCommand = 'npx skills add vercel-labs/agent-skills';
    const cliSource = routing.resolveSkillInstallRequest(cliCommand);
    assert.equal(cliSource.sourceUrl, 'https://github.com/vercel-labs/agent-skills');
    assert.equal(cliSource.installAll, true);
    assert.equal(routing.isExplicitSkillInstallOperation(cliCommand), true);
    assert.equal(routing.isExplicitSkillInstallOperation(`${cliCommand} 是什么命令？`), false);
    assert.equal(routing.isSkillInstallAction('安装它', { allowBoundReference: true }), true);
    assert.equal(routing.isSkillInstallAction('安装它'), false);
    assert.equal(routing.isSkillInstallAction('为什么它没有安装好？', { allowBoundReference: true }), false);
    const cliDecision = decisionKernel.createFallbackTaskDecision({ latestMessage: cliCommand, availableTools: ['install_skill', 'run_command'] });
    assert.equal(cliDecision.mode, 'execute');
    assert.equal(cliDecision.primaryRoute, 'install_skill');
    const resumedCliDecision = decisionKernel.createFallbackTaskDecision({
      latestMessage: '继续安装。', previousUserMessage: cliCommand, availableTools: ['install_skill', 'run_command'],
    });
    assert.equal(resumedCliDecision.goal, cliCommand);
    assert.equal(resumedCliDecision.primaryRoute, 'install_skill');

    const repositoryInstall = await installSkill(projectRoot, { sourceUrl: cliSource.sourceUrl, requestText: cliCommand }, { fetchImpl });
    assert.equal(repositoryInstall.ok, true);
    assert.equal(repositoryInstall.skills.length, 2);
    assert.deepEqual(repositoryInstall.skills.map((skill) => skill.name), ['skill-alpha', 'skill-beta']);
    assert.equal(repositoryInstall.verification.skillCount, 2);
    await assert.rejects(
      () => installSkill(projectRoot, { sourceUrl: cliSource.sourceUrl, installAll: false }, { fetchImpl }),
      /请指定要安装的 Skill 名称/u,
    );

    const direct = await installSkill(projectRoot, { sourceUrl: 'https://skillhub.cn/skills/diagram-builder' }, { fetchImpl });
    assert.equal(direct.ok, true);
    assert.equal(direct.slug, 'diagram-builder');
    assert.equal(direct.verification.verified, true);
    assert.equal(direct.verification.manifestReadable, true);
    const readBack = await readSkill(projectRoot, direct.skill.id);
    assert.match(readBack.content, /Diagram Builder/u);
    assert.equal(readBack.documents[0].path, 'references/guide.md');
    const readByUniquePrefix = await readSkill(projectRoot, direct.skill.id.slice(0, 8));
    assert.equal(readByUniquePrefix.id, direct.skill.id, 'a unique Skill ID prefix must resolve to the complete installed Skill');

    const runtime = createNativeToolRuntime({
      projectRoot,
      workspaceRoot: path.join(root, 'workspace'),
      fetchImpl,
      listSkills,
      readSkill,
      installSkill: (runtimeProjectRoot, input) => installSkill(runtimeProjectRoot, input, { fetchImpl }),
    });
    const market = await runtime.execute('search_skills', { query: 'diagram-builder' }, { executionPolicy: { approvalMode: 'full' } });
    assert.equal(market.success, true);
    assert.match(market.output, /diagram-builder/u);
    assert.match(market.output, /api\.skillhub\.cn\/api\/v1\/download/u);
    const inventory = await runtime.execute('search_skills', { query: 'all', scope: 'local' }, { executionPolicy: { approvalMode: 'full' } });
    assert.equal(inventory.success, true, inventory.output);
    assert.match(inventory.output, /Local skill inventory:/u);
    assert.match(inventory.output, /built-in/u);

    const installed = await runtime.execute('install_skill', { name: 'diagram-builder' }, {
      goal: prompt,
      executionPolicy: { approvalMode: 'full' },
    });
    assert.equal(installed.success, true, installed.output);
    assert.match(installed.output, /完整包回读验证/u);
    assert.match(installed.output, /已核验源文件/u);
    assert.match(installed.output, /健康状态/u);

    const blockedCli = await runtime.execute('run_command', { cmd: cliCommand }, {
      goal: cliCommand,
      executionPolicy: { approvalMode: 'full' },
    });
    assert.equal(blockedCli.success, false);
    assert.match(blockedCli.output, /install_skill/u);

    const acceptance = fidelity.assessTaskCompletion(prompt, 'diagram-builder 已安装并验证。', [{
      name: 'install_skill', args: JSON.stringify({ slug: 'diagram-builder' }), result: installed.output, success: true,
    }]);
    assert.equal(acceptance.passed, true, acceptance.issues.join('; '));
    assert(fetchCalls.filter((url) => url.includes('/api/v1/download?slug=diagram-builder')).length >= 2);
    console.log('verify-skill-install-e2e: PASS');
  } finally {
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`verify-skill-install-e2e: FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
