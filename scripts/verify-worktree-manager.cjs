const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWorktreeManager, runGit, WORKTREE_PROTOCOL_VERSION } = require('../electron/worktreeManager.cjs');

async function git(args, cwd) { return runGit(args, { cwd }); }

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-worktree-'));
  const source = path.join(root, 'source');
  const workspace = path.join(root, 'workspace');
  const state = path.join(root, 'state');
  try {
    await fs.mkdir(source, { recursive: true });
    await git(['init', '--initial-branch=main'], source);
    await git(['config', 'user.email', 'taiji-test@example.invalid'], source);
    await git(['config', 'user.name', 'Taiji Test'], source);
    await fs.writeFile(path.join(source, 'tracked.txt'), 'base\n', 'utf8');
    await git(['add', 'tracked.txt'], source);
    await git(['commit', '-m', 'base'], source);

    const manager = createWorktreeManager({ workspaceRoot: workspace, stateRoot: state });
    const health = await manager.health();
    assert.equal(health.ok, true);
    const inspected = await manager.inspectRepository(source);
    assert.equal(inspected.ok, true);
    assert.equal(inspected.clean, true);

    const first = await manager.create({ taskId: 'code-task-one', sourceRepo: source });
    assert.equal(first.ok, true, first.error);
    assert.equal(first.worktree.protocolVersion, WORKTREE_PROTOCOL_VERSION);
    assert.match(first.worktree.branch, /^taiji\/code-task-one-/u);
    assert.equal((await manager.create({ taskId: 'code-task-one', sourceRepo: source })).idempotencyHit, true);
    await fs.writeFile(path.join(first.worktree.path, 'tracked.txt'), 'changed by task one\n', 'utf8');
    await fs.writeFile(path.join(first.worktree.path, 'new-file.txt'), 'untracked evidence\n', 'utf8');
    const checkpoint = await manager.checkpoint('code-task-one', { label: '实现完成前' });
    assert.equal(checkpoint.ok, true, checkpoint.error);
    assert.equal(checkpoint.checkpoint.untracked.length, 1);
    assert.equal(checkpoint.checkpoint.untracked[0].path, 'new-file.txt');

    const second = await manager.create({ taskId: 'code-task-two', sourceRepo: source });
    assert.equal(second.ok, true, second.error);
    assert.notEqual(first.worktree.path, second.worktree.path);
    assert.equal((await fs.readFile(path.join(second.worktree.path, 'tracked.txt'), 'utf8')).trim(), 'base');
    await assert.rejects(fs.readFile(path.join(second.worktree.path, 'new-file.txt'), 'utf8'));
    assert.equal((await manager.release('code-task-two')).ok, true);

    await git(['worktree', 'remove', '--force', first.worktree.path], source);
    const missing = await manager.status('code-task-one');
    assert.equal(missing.ok, false);
    assert.equal(missing.recoverable, true);
    const recovered = await manager.recover('code-task-one');
    assert.equal(recovered.ok, true, recovered.error);
    assert.equal(recovered.recovered, true);
    assert.equal((await fs.readFile(path.join(first.worktree.path, 'tracked.txt'), 'utf8')).trim(), 'changed by task one');
    assert.equal((await fs.readFile(path.join(first.worktree.path, 'new-file.txt'), 'utf8')).trim(), 'untracked evidence');
    const unsafeRelease = await manager.release('code-task-one');
    assert.equal(unsafeRelease.ok, false);
    assert.match(unsafeRelease.error, /未提交修改/u);

    const restarted = createWorktreeManager({ workspaceRoot: workspace, stateRoot: state });
    assert.equal((await restarted.status('code-task-one')).ok, true);
    const registry = JSON.parse(await fs.readFile(restarted.registryPath, 'utf8'));
    assert.equal(typeof registry.checksum, 'string');
    console.log(JSON.stringify({ passed: true, protocolVersion: WORKTREE_PROTOCOL_VERSION, branch: first.worktree.branch, patchSha256: checkpoint.checkpoint.patchSha256, untracked: checkpoint.checkpoint.untracked.length }));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
