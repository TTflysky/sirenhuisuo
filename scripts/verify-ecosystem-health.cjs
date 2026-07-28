const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createEcosystemHealth, ECOSYSTEM_HEALTH_VERSION } = require('../electron/ecosystemHealth.cjs');
const { NATIVE_TOOL_DEFINITIONS } = require('../electron/nativeToolRuntime.cjs');

(async () => {
  const projectRoot = path.resolve(__dirname, '..');
  const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-ecosystem-health-'));
  try {
    const baseOptions = {
      appVersion: packageJson.version,
      projectRoot,
      workspaceRoot: path.join(root, 'workspace'),
      store: { read: async () => ({ ok: true, schemaVersion: 4, integrity: { ok: true, recovered: false, snapshotRebuilt: false, indexRebuilt: false, eventCount: 12 } }) },
      worker: { status: async () => ({ ok: true, activeRuns: [], pendingCommands: 0, integrity: { ok: true, recovered: false } }) },
      toolRuntime: { definitions: NATIVE_TOOL_DEFINITIONS },
      worktreeManager: { health: async () => ({ ok: true, version: 'git version test', active: 0, worktreesRoot: path.join(root, 'worktrees') }) },
      listSkills: async () => [{ id: 'health-check', name: '健康检查', health: 'ready' }],
      memoryManager: { list: async () => ({ ok: true, entries: [{ scope: 'organization' }], proposals: [], audit: [] }) },
      learningReviewQueue: { status: async () => ({ ok: true, counts: { queued: 0, processing: 0, waiting_model: 0, completed: 2, failed: 0 } }) },
    };

    const healthy = await createEcosystemHealth(baseOptions).run({ mode: 'release' });
    assert.equal(healthy.healthVersion, ECOSYSTEM_HEALTH_VERSION);
    assert.equal(healthy.mode, 'release');
    assert.equal(healthy.checks.length, 9);
    assert.equal(healthy.ok, true);
    assert.equal(healthy.canRelease, true);
    assert.equal(healthy.status, 'ready');
    assert.deepEqual(healthy.checks.map((item) => item.id), ['identity', 'task-store', 'worker', 'tools', 'skills', 'memory', 'learning-review', 'workspace', 'worktree']);

    const degraded = await createEcosystemHealth({
      ...baseOptions,
      store: { read: async () => ({ ok: false, error: '账本校验失败', integrity: { ok: false } }) },
      worktreeManager: { health: async () => ({ ok: false, error: 'Git 不可用' }) },
    }).run();
    assert.equal(degraded.ok, false);
    assert.equal(degraded.canRelease, false);
    assert.equal(degraded.status, 'blocked');
    assert.equal(degraded.checks.find((item) => item.id === 'task-store').critical, true);
    assert.equal(degraded.checks.find((item) => item.id === 'worktree').critical, false);

    console.log(JSON.stringify({ passed: true, healthy: { status: healthy.status, ready: healthy.ready }, degraded: { status: degraded.status, blocked: degraded.blocked } }, null, 2));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
