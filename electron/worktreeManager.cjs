const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');

const WORKTREE_PROTOCOL_VERSION = 1;

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function safe(value, fallback = 'task') { return String(value || fallback).replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || fallback; }
function digest(value) { return crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex'); }
function inside(root, target) { const relative = path.relative(root, target); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative); }

function runGit(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(options.gitBinary || 'git', args, { cwd: options.cwd, windowsHide: true, timeout: options.timeout || 30000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = String(stdout || ''); error.stderr = String(stderr || '');
        reject(error); return;
      }
      resolve({ stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() });
    });
  });
}

async function atomicWrite(filePath, content) {
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temp, content, 'utf8');
  await fs.rename(temp, filePath);
}

function createWorktreeManager(options) {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const worktreesRoot = path.resolve(options.worktreesRoot || path.join(workspaceRoot, '.taiji-worktrees'));
  const stateRoot = path.resolve(options.stateRoot || path.join(workspaceRoot, '.taiji-worktree-state'));
  const registryPath = path.join(stateRoot, 'registry.json');
  const checkpointsRoot = path.join(stateRoot, 'checkpoints');
  const gitBinary = options.gitBinary || 'git';
  let queue = Promise.resolve();
  let registry;

  async function git(args, cwd, timeout) { return runGit(args, { cwd, timeout, gitBinary }); }

  async function loadRegistry() {
    if (registry) return registry;
    try {
      const parsed = JSON.parse(await fs.readFile(registryPath, 'utf8'));
      const checksum = parsed.checksum;
      delete parsed.checksum;
      if (parsed.protocolVersion !== WORKTREE_PROTOCOL_VERSION || checksum !== digest(parsed)) throw new Error('工作树注册表校验失败');
      registry = parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        const corrupt = `${registryPath}.corrupt-${Date.now()}`;
        try { await fs.rename(registryPath, corrupt); } catch {}
      }
      registry = { protocolVersion: WORKTREE_PROTOCOL_VERSION, updatedAt: Date.now(), entries: [] };
    }
    return registry;
  }

  async function saveRegistry() {
    registry.updatedAt = Date.now();
    const envelope = { ...registry, checksum: digest(registry) };
    await atomicWrite(registryPath, JSON.stringify(envelope, null, 2));
  }

  async function inspectRepository(sourceRepo) {
    const requested = path.resolve(String(sourceRepo || ''));
    if (!sourceRepo) return { ok: false, error: '没有提供 Git 仓库路径' };
    try {
      const root = (await git(['-C', requested, 'rev-parse', '--show-toplevel'])).stdout;
      const head = (await git(['-C', root, 'rev-parse', 'HEAD'])).stdout;
      const branch = (await git(['-C', root, 'branch', '--show-current'])).stdout;
      const status = (await git(['-C', root, 'status', '--porcelain=v1'])).stdout;
      return { ok: true, sourceRepo: path.resolve(root), head, branch: branch || '(detached)', clean: !status, changes: status ? status.split(/\r?\n/u).filter(Boolean).length : 0 };
    } catch (error) {
      return { ok: false, error: `无法读取 Git 仓库：${error?.stderr || error?.message || String(error)}` };
    }
  }

  function create(input = {}) {
    const operation = queue.then(async () => {
      const repo = await inspectRepository(input.sourceRepo);
      if (!repo.ok) return repo;
      const taskId = safe(input.taskId, 'task');
      const state = await loadRegistry();
      const existing = state.entries.find((item) => item.taskId === taskId && item.sourceRepo.toLowerCase() === repo.sourceRepo.toLowerCase() && item.state !== 'released');
      if (existing) {
        const current = await statusUnlocked(taskId);
        if (current.ok) return { ...current, idempotencyHit: true };
      }
      const suffix = digest(`${repo.sourceRepo}\n${taskId}`).slice(0, 8);
      const target = path.resolve(worktreesRoot, `${taskId}-${suffix}`);
      if (!inside(worktreesRoot, target)) throw new Error('工作树目标路径越界');
      await fs.mkdir(worktreesRoot, { recursive: true });
      try {
        const items = await fs.readdir(target);
        if (items.length) throw new Error('工作树目标目录已存在且不为空');
        await fs.rmdir(target);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      const baseRef = String(input.baseRef || repo.head);
      const branch = `taiji/${taskId}-${suffix}`;
      try {
        await git(['-C', repo.sourceRepo, 'worktree', 'add', '-b', branch, target, baseRef], undefined, 120000);
      } catch (error) {
        if (/already exists/iu.test(`${error?.stderr}\n${error?.message}`)) await git(['-C', repo.sourceRepo, 'worktree', 'add', target, branch], undefined, 120000);
        else throw error;
      }
      const now = Date.now();
      const entry = {
        protocolVersion: WORKTREE_PROTOCOL_VERSION, taskId, sourceRepo: repo.sourceRepo, path: target,
        workspaceId: path.relative(workspaceRoot, target).replace(/\\/gu, '/'), branch, baseRef, head: repo.head,
        state: 'active', createdAt: now, updatedAt: now, lastCheckpointId: undefined,
      };
      state.entries = [...state.entries.filter((item) => item.taskId !== taskId), entry].slice(-200);
      await saveRegistry();
      return { ok: true, worktree: clone(entry) };
    });
    queue = operation.then(() => undefined, () => undefined);
    return operation.catch((error) => ({ ok: false, error: `创建 Git 工作树失败：${error?.stderr || error?.message || String(error)}` }));
  }

  async function statusUnlocked(taskId) {
    const state = await loadRegistry();
    const entry = state.entries.find((item) => item.taskId === safe(taskId));
    if (!entry) return { ok: false, error: '找不到任务工作树记录' };
    if (!inside(worktreesRoot, path.resolve(entry.path))) return { ok: false, error: '工作树记录路径越界' };
    try {
      const head = (await git(['-C', entry.path, 'rev-parse', 'HEAD'])).stdout;
      const porcelain = (await git(['-C', entry.path, 'status', '--porcelain=v1'])).stdout;
      return { ok: true, worktree: { ...clone(entry), head, clean: !porcelain, changes: porcelain ? porcelain.split(/\r?\n/u).filter(Boolean) : [] } };
    } catch (error) {
      return { ok: false, worktree: clone(entry), recoverable: true, error: `工作树不可用：${error?.stderr || error?.message || String(error)}` };
    }
  }

  async function status(taskId) {
    await queue;
    return statusUnlocked(taskId);
  }

  function checkpoint(taskId, input = {}) {
    const operation = queue.then(async () => {
      const current = await statusUnlocked(taskId);
      if (!current.ok) return current;
      const entry = current.worktree;
      const patch = (await git(['-C', entry.path, 'diff', '--binary', '--no-ext-diff', 'HEAD'], undefined, 120000)).stdout;
      const untrackedPaths = (await git(['-C', entry.path, 'ls-files', '--others', '--exclude-standard'])).stdout.split(/\r?\n/u).filter(Boolean);
      const checkpointId = `worktree-checkpoint-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const patchPath = path.join(checkpointsRoot, `${checkpointId}.patch`);
      const untrackedRoot = path.join(checkpointsRoot, `${checkpointId}-untracked`);
      await fs.mkdir(checkpointsRoot, { recursive: true });
      await fs.writeFile(patchPath, patch ? `${patch}\n` : '', 'utf8');
      const untracked = [];
      for (const relative of untrackedPaths) {
        const source = path.resolve(entry.path, relative);
        if (!inside(entry.path, source)) throw new Error(`未跟踪文件路径越界：${relative}`);
        const stat = await fs.stat(source);
        if (!stat.isFile()) continue;
        const target = path.resolve(untrackedRoot, relative);
        if (!inside(untrackedRoot, target)) throw new Error(`恢复点文件路径越界：${relative}`);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.copyFile(source, target);
        untracked.push({ path: relative.replace(/\\/gu, '/'), size: stat.size, sha256: digest(await fs.readFile(source)) });
      }
      const manifest = {
        protocolVersion: WORKTREE_PROTOCOL_VERSION, checkpointId, taskId: entry.taskId, sourceRepo: entry.sourceRepo,
        worktreePath: entry.path, branch: entry.branch, head: entry.head, label: String(input.label || '任务恢复点').slice(0, 160),
        patchPath, patchSha256: digest(patch ? `${patch}\n` : ''), untrackedRoot, untracked, createdAt: Date.now(),
      };
      await atomicWrite(path.join(checkpointsRoot, `${checkpointId}.json`), JSON.stringify({ ...manifest, checksum: digest(manifest) }, null, 2));
      const state = await loadRegistry();
      const stored = state.entries.find((item) => item.taskId === entry.taskId);
      if (stored) { stored.lastCheckpointId = checkpointId; stored.updatedAt = Date.now(); }
      await saveRegistry();
      return { ok: true, checkpoint: manifest, worktree: entry };
    });
    queue = operation.then(() => undefined, () => undefined);
    return operation.catch((error) => ({ ok: false, error: `创建工作树恢复点失败：${error?.stderr || error?.message || String(error)}` }));
  }

  function recover(taskId) {
    const operation = queue.then(async () => {
      const state = await loadRegistry();
      const entry = state.entries.find((item) => item.taskId === safe(taskId));
      if (!entry) return { ok: false, error: '找不到任务工作树记录' };
      const current = await statusUnlocked(taskId);
      if (current.ok) return { ...current, recovered: false };
      if (!inside(worktreesRoot, path.resolve(entry.path))) return { ok: false, error: '工作树恢复路径越界' };
      try { await git(['-C', entry.sourceRepo, 'worktree', 'prune']); } catch {}
      await git(['-C', entry.sourceRepo, 'worktree', 'add', entry.path, entry.branch], undefined, 120000);
      if (entry.lastCheckpointId) {
        const manifestPath = path.join(checkpointsRoot, `${entry.lastCheckpointId}.json`);
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        const checksum = manifest.checksum; delete manifest.checksum;
        if (checksum !== digest(manifest)) throw new Error('工作树恢复点清单校验失败');
        const patch = await fs.readFile(manifest.patchPath, 'utf8');
        if (digest(patch) !== manifest.patchSha256) throw new Error('工作树恢复补丁校验失败');
        if (patch.trim()) {
          await git(['-C', entry.path, 'apply', '--check', manifest.patchPath]);
          await git(['-C', entry.path, 'apply', manifest.patchPath]);
        }
        for (const file of manifest.untracked || []) {
          const source = path.resolve(manifest.untrackedRoot, file.path);
          const target = path.resolve(entry.path, file.path);
          if (!inside(manifest.untrackedRoot, source) || !inside(entry.path, target)) throw new Error('未跟踪文件恢复路径越界');
          const content = await fs.readFile(source);
          if (digest(content) !== file.sha256) throw new Error(`未跟踪文件恢复校验失败：${file.path}`);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, content);
        }
      }
      entry.state = 'active'; entry.updatedAt = Date.now();
      await saveRegistry();
      return { ...(await statusUnlocked(taskId)), recovered: true };
    });
    queue = operation.then(() => undefined, () => undefined);
    return operation.catch((error) => ({ ok: false, error: `恢复 Git 工作树失败：${error?.stderr || error?.message || String(error)}` }));
  }

  function release(taskId) {
    const operation = queue.then(async () => {
      const current = await statusUnlocked(taskId);
      if (!current.ok) return current;
      if (!current.worktree.clean) return { ok: false, error: '工作树还有未提交修改，已拒绝清理；请先提交或创建恢复点并保留工作树。', worktree: current.worktree };
      await git(['-C', current.worktree.sourceRepo, 'worktree', 'remove', current.worktree.path], undefined, 120000);
      const state = await loadRegistry();
      const entry = state.entries.find((item) => item.taskId === safe(taskId));
      if (entry) { entry.state = 'released'; entry.releasedAt = Date.now(); entry.updatedAt = Date.now(); }
      await saveRegistry();
      return { ok: true, released: true, worktree: current.worktree };
    });
    queue = operation.then(() => undefined, () => undefined);
    return operation.catch((error) => ({ ok: false, error: `释放 Git 工作树失败：${error?.stderr || error?.message || String(error)}` }));
  }

  async function health() {
    try {
      const version = (await git(['--version'])).stdout;
      const state = await loadRegistry();
      return { ok: true, version, active: state.entries.filter((item) => item.state === 'active').length, worktreesRoot };
    } catch (error) { return { ok: false, error: `Git 不可用：${error?.message || String(error)}` }; }
  }

  return { workspaceRoot, worktreesRoot, stateRoot, registryPath, inspectRepository, create, status, checkpoint, recover, release, health };
}

module.exports = { WORKTREE_PROTOCOL_VERSION, createWorktreeManager, runGit, digest };
