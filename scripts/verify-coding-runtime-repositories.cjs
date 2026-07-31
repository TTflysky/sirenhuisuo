const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWorktreeManager, runGit } = require('../electron/worktreeManager.cjs');
const { createCodingRuntime } = require('../electron/codingRuntime.cjs');

const fixtures = [
  {
    id: 'react-client',
    source: 'src/domain.ts',
    dependent: 'src/app.ts',
    before: 'export function formatTitle(value) { return `Draft: ${value}`; }',
    after: 'export function formatTitle(value) { return `Published: ${value}`; }',
    dependentContent: "import { formatTitle } from './domain';\nexport const title = formatTitle('Taiji');\n",
    symbol: 'formatTitle',
  },
  {
    id: 'node-service',
    source: 'lib/service.js',
    dependent: 'server.js',
    before: 'export function health() { return "starting"; }',
    after: 'export function health() { return "ready"; }',
    dependentContent: "import { health } from './lib/service.js';\nexport const status = health();\n",
    symbol: 'health',
  },
  {
    id: 'vue-workspace',
    source: 'src/store.mjs',
    dependent: 'src/view.mjs',
    before: 'export const employeeLimit = 12;',
    after: 'export const employeeLimit = 999;',
    dependentContent: "import { employeeLimit } from './store.mjs';\nexport const stationCount = employeeLimit;\n",
    symbol: 'employeeLimit',
  },
];

async function git(args, cwd) { return runGit(args, { cwd }); }

function patchFor(fixture) {
  return [
    `diff --git a/${fixture.source} b/${fixture.source}`,
    `--- a/${fixture.source}`,
    `+++ b/${fixture.source}`,
    '@@ -1 +1 @@',
    `-${fixture.before}`,
    `+${fixture.after}`,
    '',
  ].join('\n');
}

async function waitForCommand(runtime, sessionId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const status = runtime.commandStatus(sessionId);
    if (status.status !== 'running') return status;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Command session timed out: ${sessionId}`);
}

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-coding-three-repos-'));
  const workspaceRoot = path.join(root, 'workspace');
  const manager = createWorktreeManager({ workspaceRoot, stateRoot: path.join(root, 'state') });
  const runtime = createCodingRuntime({ workspaceRoot, worktreeManager: manager });
  const reports = [];
  try {
    for (const fixture of fixtures) {
      const sourceRepo = path.join(root, fixture.id);
      await fs.mkdir(path.dirname(path.join(sourceRepo, fixture.source)), { recursive: true });
      await fs.mkdir(path.dirname(path.join(sourceRepo, fixture.dependent)), { recursive: true });
      await git(['init', '--initial-branch=main'], sourceRepo);
      await git(['config', 'user.email', 'taiji-test@example.invalid'], sourceRepo);
      await git(['config', 'user.name', 'Taiji Test'], sourceRepo);
      await fs.writeFile(path.join(sourceRepo, fixture.source), `${fixture.before}\n`, 'utf8');
      await fs.writeFile(path.join(sourceRepo, fixture.dependent), fixture.dependentContent, 'utf8');
      await fs.writeFile(path.join(sourceRepo, 'package.json'), JSON.stringify({
        private: true,
        scripts: {
          'test:run': 'node -e "process.exit(0)"',
          build: 'node -e "process.exit(0)"',
          lint: 'node -e "process.exit(0)"',
        },
      }, null, 2), 'utf8');
      await git(['add', '.'], sourceRepo);
      await git(['commit', '-m', 'fixture baseline'], sourceRepo);

      const taskId = `repo-${fixture.id}`;
      const prepared = await runtime.prepareTask({ taskId, sourceRepo });
      assert.equal(prepared.ok, true, prepared.error);
      const workspacePath = prepared.workspace.path;
      const located = await runtime.search({ workspacePath, query: fixture.symbol });
      assert(located.matches.some((item) => item.path === fixture.source), `${fixture.id}: symbol was not indexed`);
      const applied = await runtime.applyPatch({ taskId, workspacePath, patch: patchFor(fixture), label: `${fixture.id} before edit` });
      assert.equal(applied.ok, true, applied.error);
      const impact = await runtime.impactAnalysis({ workspacePath, changedFiles: [fixture.source] });
      assert(impact.impacted.some((item) => item.file === fixture.dependent), `${fixture.id}: dependent file was not detected`);
      const selection = await runtime.selectTests({ workspacePath, changedFiles: [fixture.source] });
      assert(selection.commands.length >= 2, `${fixture.id}: build and test commands were not selected`);
      for (const candidate of selection.commands) {
        const command = process.platform === 'win32' ? candidate.command.replace(/^npm /u, 'npm.cmd ') : candidate.command;
        const started = runtime.startCommand({ workspacePath, command, timeoutMs: 30_000 });
        const completed = await waitForCommand(runtime, started.sessionId);
        assert.equal(completed.status, 'succeeded', `${fixture.id}: ${candidate.command} failed`);
      }
      const delivery = await runtime.deliveryReport({ taskId, workspacePath, label: `${fixture.id} delivery` });
      assert.equal(delivery.ok, true);
      assert(delivery.changedFiles.includes(fixture.source));
      assert.equal(delivery.unverifiedRisks.length, 0, `${fixture.id}: ${delivery.unverifiedRisks.join(', ')}`);
      assert.equal(typeof delivery.rollbackCheckpoint?.patchSha256, 'string');
      reports.push({ id: fixture.id, changedFiles: delivery.changedFiles, commands: delivery.commandEvidence.length, impacted: delivery.impactedFiles.length });
    }
    console.log(JSON.stringify({ passed: true, repositories: reports }, null, 2));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
