const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWorktreeManager, runGit } = require('../electron/worktreeManager.cjs');
const { createCodingRuntime } = require('../electron/codingRuntime.cjs');
const { createNativeToolRuntime } = require('../electron/nativeToolRuntime.cjs');
const { createTaskRuntimeStore } = require('../electron/taskRuntimeStore.cjs');
const { createTaskService } = require('../electron/taskService.cjs');

async function git(args, cwd) { return runGit(args, { cwd }); }

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-coding-runtime-'));
  const source = path.join(root, 'source');
  const workspace = path.join(root, 'workspace');
  try {
    await fs.mkdir(source, { recursive: true });
    await git(['init', '--initial-branch=main'], source);
    await git(['config', 'user.email', 'taiji-test@example.invalid'], source);
    await git(['config', 'user.name', 'Taiji Test'], source);
    await fs.writeFile(path.join(source, 'src.ts'), "export function greet(name) { return `hi ${name}`; }\n", 'utf8');
    await fs.writeFile(path.join(source, 'app.ts'), "import { greet } from './src';\nexport const message = greet('Taiji');\n", 'utf8');
    await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ scripts: { 'test:run': 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"' } }, null, 2), 'utf8');
    await git(['add', '.'], source);
    await git(['commit', '-m', 'base'], source);

    const worktreeManager = createWorktreeManager({ workspaceRoot: workspace, stateRoot: path.join(root, 'state') });
    const codingRuntime = createCodingRuntime({ workspaceRoot: workspace, worktreeManager });
    const prepared = await codingRuntime.prepareTask({ taskId: 'coding-001', sourceRepo: source });
    assert.equal(prepared.ok, true, prepared.error);
    assert.equal(prepared.workspace.mode, 'git-worktree');
    assert.equal(prepared.index.fileCount, 3);
    const search = await codingRuntime.search({ workspacePath: prepared.workspace.path, query: 'greet' });
    assert.equal(search.ok, true);
    assert(search.matches.some((item) => item.path === 'src.ts' && item.symbols.includes('greet')));
    const dependencies = await codingRuntime.dependencies({ workspacePath: prepared.workspace.path, symbol: 'greet' });
    assert.equal(dependencies.ok, true);
    assert(dependencies.importedBy.includes('app.ts'));
    assert.equal(codingRuntime.codingRuntimeVersion, 2);
    const patch = [
      'diff --git a/src.ts b/src.ts',
      '--- a/src.ts',
      '+++ b/src.ts',
      '@@ -1 +1 @@',
      '-export function greet(name) { return `hi ${name}`; }',
      '+export function greet(name) { return `hello ${name}`; }',
      '',
    ].join('\n');
    const applied = await codingRuntime.applyPatch({ taskId: 'coding-001', workspacePath: prepared.workspace.path, patch, label: 'before greeting update' });
    assert.equal(applied.ok, true, applied.error);
    assert(applied.changedFiles.includes('src.ts'), JSON.stringify(applied));
    assert.equal(typeof applied.rollbackCheckpoint.patchSha256, 'string');
    const impact = await codingRuntime.impactAnalysis({ workspacePath: prepared.workspace.path, changedFiles: ['src.ts'] });
    assert(impact.impacted.some((item) => item.file === 'app.ts' && item.depth === 1));
    const selection = await codingRuntime.selectTests({ workspacePath: prepared.workspace.path, changedFiles: ['src.ts'] });
    assert(selection.commands.some((item) => item.script === 'test:run'));
    assert(selection.commands.some((item) => item.script === 'build'));
    const invalidPatch = await codingRuntime.applyPatch({ taskId: 'coding-001', workspacePath: prepared.workspace.path, patch: patch.replace('hello', 'missing-context') });
    assert.equal(invalidPatch.ok, false);
    const nativeTools = createNativeToolRuntime({
      workspaceRoot: workspace, projectRoot: source, codingRuntime,
      fetchImpl: async () => { throw new Error('not used'); }, listSkills: async () => [], readSkill: async () => ({}), installSkill: async () => ({}),
      testObsidianVault: async () => ({}), searchObsidianVault: async () => ({}), readObsidianNote: async () => ({}), fetchKnowledgeUrl: async () => ({}), searchWeb: async () => ({}),
      createWordDocument: async () => {}, readWorkspaceFile: async () => ({}), runCommand: async () => ({}),
    });
    assert(nativeTools.definitions.some((item) => item.function.name === 'coding_search'));
    assert(nativeTools.definitions.some((item) => item.function.name === 'coding_apply_patch'));
    assert(nativeTools.definitions.some((item) => item.function.name === 'coding_delivery'));
    const nativeSearch = await nativeTools.execute('coding_search', { query: 'greet' }, { taskId: 'coding-001', worktreePath: prepared.workspace.path, connectors: [] });
    assert.equal(nativeSearch.success, true);
    assert.match(nativeSearch.output, /src\.ts/u);
    await fs.appendFile(path.join(prepared.workspace.path, 'src.ts'), '// changed\n', 'utf8');
    const checkpoint = await codingRuntime.checkpoint({ taskId: 'coding-001', workspacePath: prepared.workspace.path, label: 'before review' });
    assert.equal(checkpoint.ok, true, checkpoint.error);
    assert.equal(typeof checkpoint.checkpoint.patchSha256, 'string');
    const delivery = await codingRuntime.deliveryReport({ taskId: 'coding-001', workspacePath: prepared.workspace.path, label: 'delivery' });
    assert.equal(delivery.ok, true);
    assert(delivery.changedFiles.includes('src.ts'));
    assert(delivery.impactedFiles.some((item) => item.file === 'app.ts'));
    assert.equal(typeof delivery.rollbackCheckpoint.patchSha256, 'string');

    const service = createTaskService(createTaskRuntimeStore(path.join(root, 'task-runtime')), { codingRuntime });
    const created = await service.create({
      taskType: 'coding', goal: 'Build a React client with an API and tests', sourceRepo: source, idempotencyKey: 'coding-contract-001',
      members: [
        { id: 'pm', name: 'PM', capabilities: ['coordination'] },
        { id: 'arch', name: 'Architect', capabilities: ['architecture'] },
        { id: 'ux', name: 'Designer', capabilities: ['ui_ux'] },
        { id: 'fe', name: 'Frontend', capabilities: ['frontend'] },
        { id: 'be', name: 'Backend', capabilities: ['backend'] },
        { id: 'qa', name: 'QA', capabilities: ['review'] },
      ],
    });
    assert.equal(created.ok, true);
    assert.equal(created.task.codingProject.status, 'ready');
    assert(created.task.steps.some((step) => step.id === 'frontend' && step.employeeId === 'fe'));
    assert(created.task.steps.some((step) => step.id === 'review' && step.kind === 'review'));
    assert.equal(created.task.workspace.status, 'ready');
    await service.completeStep(created.task.id, { stepId: 'backend', summary: 'Backend evidence is preserved' });
    const review = await service.recordReviewDecision(created.task.id, { reviewStepId: 'review', approved: false, responsibleStepId: 'frontend', reason: 'Missing loading state' });
    assert.equal(review.ok, true);
    const task = (await service.read({ taskId: created.task.id })).runs[0];
    assert.equal(task.steps.find((step) => step.id === 'frontend').status, 'queued');
    assert.equal(task.steps.find((step) => step.id === 'review').status, 'queued');
    assert.equal(task.steps.find((step) => step.id === 'backend').status, 'completed');
    console.log('verify-coding-runtime: PASS');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
