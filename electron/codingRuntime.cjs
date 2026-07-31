const crypto = require('crypto');
const { EventEmitter } = require('events');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const CODING_RUNTIME_VERSION = 2;
const MAX_INDEX_FILES = 5000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_LOG_BYTES = 1024 * 1024;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.py', '.go', '.java', '.rs', '.yml', '.yaml']);
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'release', '.next', 'coverage', '.taiji-worktrees']);

function text(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
function safeId(value, fallback = 'task') { return text(value, 160).replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || fallback; }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function within(root, target) { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); }
function classifyFailure(value) {
  const source = text(value, 2000);
  if (/timed out|timeout|ETIMEDOUT|\u8d85\u65f6/iu.test(source)) return 'timeout';
  if (/ENOENT|not recognized|command not found|\u627e\u4e0d\u5230/iu.test(source)) return 'missing_dependency';
  if (/permission|access is denied|EACCES|\u6743\u9650/iu.test(source)) return 'permission';
  if (/npm ERR!|tsc|lint|test|build|compile|\u7f16\u8bd1|\u6d4b\u8bd5/iu.test(source)) return 'command_failed';
  return 'unknown';
}

async function walk(root) {
  const files = [];
  const queue = [root];
  while (queue.length && files.length < MAX_INDEX_FILES) {
    const current = queue.shift();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) queue.push(path.join(current, entry.name));
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(path.join(current, entry.name));
        if (files.length >= MAX_INDEX_FILES) break;
      }
    }
  }
  return files;
}

function symbolsFor(source) {
  const symbols = [];
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gu,
    /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gu,
    /(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/gu,
    /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/gu,
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) symbols.push(match[1]);
  return [...new Set(symbols)].slice(0, 200);
}

function importsFor(source) {
  const imports = [];
  const pattern = /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/gu;
  for (const match of source.matchAll(pattern)) imports.push(match[1]);
  return [...new Set(imports)].slice(0, 200);
}

function outputSummary(output) {
  const compact = String(output || '').replace(/\s+/gu, ' ').trim();
  return compact.slice(0, 1200);
}

function runProcess(command, args, cwd, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} timed out`)); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-MAX_LOG_BYTES); });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-MAX_LOG_BYTES); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (exitCode === 0) resolve({ stdout: stdout.replace(/\s+$/u, ''), stderr: stderr.replace(/\s+$/u, ''), exitCode });
      else reject(Object.assign(new Error(stderr.trim() || stdout.trim() || `${command} exited with ${exitCode}`), { stdout, stderr, exitCode }));
    });
  });
}

function changedPath(row) {
  return String(row || '').slice(3).split(' -> ').at(-1)?.trim().replace(/\\/gu, '/') || '';
}

function resolveImportPath(fromPath, specifier, available) {
  if (!specifier?.startsWith('.')) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  const candidates = [base, ...[...SOURCE_EXTENSIONS].map((extension) => `${base}${extension}`), ...[...SOURCE_EXTENSIONS].map((extension) => `${base}/index${extension}`)];
  return candidates.find((candidate) => available.has(candidate));
}

function createCodingRuntime(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const codingRoot = path.join(workspaceRoot, 'coding-tasks');
  const worktreeManager = options.worktreeManager;
  const indexes = new Map();
  const sessions = new Map();

  function resolveWorkspace(input = {}) {
    const workspace = path.resolve(String(input.workspacePath || input.path || ''));
    const allowed = [codingRoot, worktreeManager?.worktreesRoot].filter(Boolean).map((entry) => path.resolve(entry));
    if (!workspace || !allowed.some((root) => within(root, workspace))) throw new Error('Coding runtime rejected a workspace outside its managed roots');
    return workspace;
  }

  async function indexWorkspace(input = {}) {
    const workspacePath = resolveWorkspace(input);
    const stat = await fs.stat(workspacePath);
    if (!stat.isDirectory()) throw new Error('Coding workspace is not a directory');
    const files = await walk(workspacePath);
    const records = [];
    const symbolMap = {};
    for (const absolute of files) {
      const relative = path.relative(workspacePath, absolute).replace(/\\/gu, '/');
      const fileStat = await fs.stat(absolute);
      if (fileStat.size > MAX_FILE_BYTES) {
        records.push({ path: relative, bytes: fileStat.size, skipped: 'too_large' });
        continue;
      }
      const content = await fs.readFile(absolute, 'utf8');
      const symbols = symbolsFor(content);
      const imports = importsFor(content);
      records.push({ path: relative, bytes: fileStat.size, sha256: digest(content), symbols, imports });
      for (const symbol of symbols) symbolMap[symbol] = [...(symbolMap[symbol] || []), relative];
    }
    const index = {
      codingRuntimeVersion: CODING_RUNTIME_VERSION,
      workspacePath,
      indexedAt: Date.now(),
      fileCount: records.length,
      truncated: files.length >= MAX_INDEX_FILES,
      files: records,
      symbols: symbolMap,
    };
    indexes.set(workspacePath, index);
    return clone(index);
  }

  async function prepareTask(input = {}) {
    const taskId = safeId(input.taskId);
    const sourceRepo = text(input.sourceRepo, 2000);
    let workspace;
    if (sourceRepo) {
      if (!worktreeManager) throw new Error('Git worktree manager is unavailable');
      const created = await worktreeManager.create({ taskId, sourceRepo, baseRef: input.baseRef });
      if (!created.ok) return created;
      workspace = { mode: 'git-worktree', status: 'ready', ...created.worktree };
    } else {
      const target = path.join(codingRoot, taskId);
      if (!within(codingRoot, target)) throw new Error('Unsafe coding task directory');
      await fs.mkdir(target, { recursive: true });
      workspace = { mode: 'task-workspace', status: 'ready', path: target, workspaceId: path.relative(workspaceRoot, target).replace(/\\/gu, '/') };
    }
    const index = await indexWorkspace({ workspacePath: workspace.path });
    return { ok: true, workspace, index: { fileCount: index.fileCount, indexedAt: index.indexedAt, truncated: index.truncated } };
  }

  async function search(input = {}) {
    const workspacePath = resolveWorkspace(input);
    const query = text(input.query, 300);
    if (!query) throw new Error('Coding search query is required');
    const index = indexes.get(workspacePath) || await indexWorkspace({ workspacePath });
    const needle = query.toLowerCase();
    const matches = [];
    for (const file of index.files) {
      if (file.skipped) continue;
      const symbolMatch = (file.symbols || []).filter((symbol) => symbol.toLowerCase().includes(needle));
      if (file.path.toLowerCase().includes(needle) || symbolMatch.length) matches.push({ path: file.path, symbols: symbolMatch, match: symbolMatch.length ? 'symbol' : 'path' });
      if (matches.length >= 100) break;
    }
    return { ok: true, workspacePath, query, matches, indexAgeMs: Date.now() - index.indexedAt };
  }

  async function dependencies(input = {}) {
    const workspacePath = resolveWorkspace(input);
    const index = indexes.get(workspacePath) || await indexWorkspace({ workspacePath });
    const target = text(input.path || input.symbol, 500);
    let file = index.files.find((entry) => entry.path === target);
    if (!file && input.symbol) {
      const location = index.symbols[text(input.symbol, 200)]?.[0];
      file = index.files.find((entry) => entry.path === location);
    }
    if (!file) return { ok: false, error: 'File or symbol is not in the current coding index' };
    const importedBy = index.files.filter((entry) => (entry.imports || []).some((item) => item.includes(path.basename(file.path, path.extname(file.path))))).map((entry) => entry.path);
    return { ok: true, path: file.path, imports: file.imports || [], importedBy: importedBy.slice(0, 100), symbols: file.symbols || [] };
  }

  async function impactAnalysis(input = {}) {
    const workspacePath = resolveWorkspace(input);
    const index = indexes.get(workspacePath) || await indexWorkspace({ workspacePath });
    const changedFiles = [...new Set((Array.isArray(input.changedFiles) ? input.changedFiles : [input.path]).map((item) => text(item, 600).replace(/\\/gu, '/')).filter(Boolean))];
    if (!changedFiles.length) throw new Error('At least one changed file is required for impact analysis');
    const available = new Set(index.files.map((file) => file.path));
    const reverse = new Map();
    for (const file of index.files) {
      for (const specifier of file.imports || []) {
        const resolved = resolveImportPath(file.path, specifier, available);
        if (resolved) reverse.set(resolved, [...(reverse.get(resolved) || []), file.path]);
      }
    }
    const impacted = [];
    const seen = new Set(changedFiles);
    const queue = changedFiles.map((file) => ({ file, depth: 0, via: undefined }));
    while (queue.length && impacted.length < 1000) {
      const current = queue.shift();
      impacted.push(current);
      for (const dependent of reverse.get(current.file) || []) {
        if (seen.has(dependent)) continue;
        seen.add(dependent);
        queue.push({ file: dependent, depth: current.depth + 1, via: current.file });
      }
    }
    return { ok: true, workspacePath, changedFiles, impacted, truncated: impacted.length >= 1000 };
  }

  async function selectTests(input = {}) {
    const workspacePath = resolveWorkspace(input);
    const changedFiles = [...new Set((Array.isArray(input.changedFiles) ? input.changedFiles : []).map((item) => text(item, 600).replace(/\\/gu, '/')).filter(Boolean))];
    const packagePath = path.join(workspacePath, 'package.json');
    let scripts = {};
    try { scripts = JSON.parse(await fs.readFile(packagePath, 'utf8')).scripts || {}; } catch {}
    const commands = [];
    const add = (script, reason, args = '') => {
      if (!scripts[script] || commands.some((item) => item.script === script && item.args === args)) return;
      commands.push({ script, command: `npm run ${script}${args ? ` -- ${args}` : ''}`, args, reason });
    };
    const testFiles = changedFiles.filter((file) => /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(file));
    if (testFiles.length && scripts['test:run']) add('test:run', 'Run the directly changed tests first', testFiles.join(' '));
    else if (changedFiles.some((file) => /\.[cm]?[jt]sx?$/iu.test(file))) add(scripts['test:run'] ? 'test:run' : 'test', 'Source code changed; run the repository test suite');
    if (changedFiles.some((file) => /\.(?:ts|tsx|js|jsx|mjs|cjs|css|html)$/iu.test(file))) add('build', 'Compile and bundle affected application code');
    if (changedFiles.some((file) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/iu.test(file))) add('lint', 'Check changed source against static rules');
    if (changedFiles.some((file) => /(?:^|\/)(?:package|package-lock|npm-shrinkwrap)\.json$/iu.test(file))) commands.unshift({ script: 'dependency-check', command: 'npm install --ignore-scripts --package-lock-only --dry-run', args: '', reason: 'Dependency metadata changed; validate the lockfile without modifying the workspace' });
    return { ok: true, workspacePath, changedFiles, commands, coverage: commands.length ? 'targeted' : 'manual', note: commands.length ? '' : 'No repository test script matched these files; record manual verification evidence.' };
  }

  async function applyPatch(input = {}) {
    const workspacePath = resolveWorkspace(input);
    const patchText = String(input.patch || '');
    if (!patchText.trim()) throw new Error('A unified diff patch is required');
    if (Buffer.byteLength(patchText, 'utf8') > 4 * 1024 * 1024) throw new Error('Patch exceeds the 4MB atomic-edit limit');
    const before = input.taskId && worktreeManager
      ? await checkpoint({ taskId: input.taskId, workspacePath, label: input.label || 'Before atomic patch' })
      : await checkpoint({ workspacePath, label: input.label || 'Before atomic patch' });
    if (!before.ok) return before;
    const patchPath = path.join(workspacePath, `.taiji-patch-${crypto.randomUUID()}.diff`);
    try {
      await fs.writeFile(patchPath, patchText, 'utf8');
      await runProcess('git', ['apply', '--check', '--whitespace=nowarn', patchPath], workspacePath);
      await runProcess('git', ['apply', '--whitespace=nowarn', patchPath], workspacePath);
      await fs.rm(patchPath, { force: true });
      indexes.delete(workspacePath);
      const status = await runProcess('git', ['status', '--porcelain=v1'], workspacePath);
      const changedFiles = status.stdout.split(/\r?\n/u).filter(Boolean).map(changedPath).filter(Boolean);
      return { ok: true, workspacePath, changedFiles, rollbackCheckpoint: before.checkpoint, patchSha256: digest(patchText) };
    } catch (error) {
      return { ok: false, error: `Atomic patch was not applied: ${error?.stderr || error?.message || String(error)}`, rollbackCheckpoint: before.checkpoint };
    } finally {
      await fs.rm(patchPath, { force: true }).catch(() => {});
    }
  }

  async function deliveryReport(input = {}) {
    const workspacePath = resolveWorkspace(input);
    const status = await runProcess('git', ['status', '--porcelain=v1'], workspacePath).catch(() => ({ stdout: '' }));
    const changedFiles = status.stdout.split(/\r?\n/u).filter(Boolean).map(changedPath).filter(Boolean);
    const patch = await runProcess('git', ['diff', '--stat', 'HEAD'], workspacePath).catch(() => ({ stdout: '' }));
    const impact = await impactAnalysis({ workspacePath, changedFiles });
    const selectedTests = await selectTests({ workspacePath, changedFiles });
    const commandEvidence = [...sessions.values()].filter((session) => session.workspacePath === workspacePath && session.status !== 'running').slice(-12).map((session) => ({
      sessionId: session.sessionId, command: session.command, status: session.status, exitCode: session.exitCode, summary: session.summary,
    }));
    const checkpointResult = input.taskId && worktreeManager
      ? await checkpoint({ taskId: input.taskId, workspacePath, label: input.label || 'Delivery checkpoint' })
      : undefined;
    return {
      ok: true,
      codingRuntimeVersion: CODING_RUNTIME_VERSION,
      workspacePath,
      changedFiles,
      diffStat: patch.stdout,
      impactedFiles: impact.impacted,
      selectedTests: selectedTests.commands,
      commandEvidence,
      unverifiedRisks: selectedTests.commands.filter((candidate) => !commandEvidence.some((evidence) => evidence.command.includes(candidate.script) && evidence.status === 'succeeded')).map((candidate) => candidate.reason),
      rollbackCheckpoint: checkpointResult?.ok ? checkpointResult.checkpoint : input.rollbackCheckpoint,
      generatedAt: Date.now(),
    };
  }

  async function diff(input = {}) {
    const workspacePath = resolveWorkspace(input);
    if (input.taskId && worktreeManager) {
      const status = await worktreeManager.status(input.taskId);
      if (status.ok) return { ok: true, workspace: status.worktree, changes: status.worktree.changes || [] };
    }
    const index = indexes.get(workspacePath) || await indexWorkspace({ workspacePath });
    return { ok: true, workspacePath, changes: [], indexedFiles: index.fileCount, note: 'Non-Git workspaces use indexed file evidence until a baseline checkpoint is created.' };
  }

  function startCommand(input = {}) {
    const workspacePath = resolveWorkspace(input);
    const command = text(input.command, 8000);
    if (!command) throw new Error('Coding command is required');
    const sessionId = `coding-command-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const timeoutMs = Math.max(1000, Math.min(30 * 60 * 1000, Number(input.timeoutMs) || 10 * 60 * 1000));
    const emitter = new EventEmitter();
    const record = { sessionId, workspacePath, command, status: 'running', startedAt: Date.now(), timeoutMs, output: '', events: [], emitter };
    const shell = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
    const child = spawn(shell, args, { cwd: workspacePath, windowsHide: true, shell: false });
    const append = (stream, chunk) => {
      const data = String(chunk || '');
      record.output = `${record.output}${data}`.slice(-MAX_LOG_BYTES);
      const event = { ts: Date.now(), stream, chunk: data.slice(-8000) };
      record.events.push(event); record.events = record.events.slice(-1000); emitter.emit('log', event);
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    const timer = setTimeout(() => { record.timedOut = true; child.kill(); }, timeoutMs);
    child.on('error', (error) => append('stderr', error.message));
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      record.finishedAt = Date.now();
      record.exitCode = exitCode;
      record.signal = signal || undefined;
      record.status = exitCode === 0 && !record.timedOut ? 'succeeded' : 'failed';
      record.failureClass = record.status === 'succeeded' ? undefined : classifyFailure(record.timedOut ? 'timeout' : record.output);
      record.summary = outputSummary(record.output);
      emitter.emit('finished', clone({ ...record, emitter: undefined }));
    });
    sessions.set(sessionId, record);
    return { ok: true, sessionId, status: record.status, workspacePath, timeoutMs };
  }

  function commandStatus(sessionId, after = 0) {
    const record = sessions.get(text(sessionId, 180));
    if (!record) return { ok: false, error: 'Coding command session was not found' };
    return {
      ok: true, sessionId: record.sessionId, status: record.status, startedAt: record.startedAt, finishedAt: record.finishedAt,
      exitCode: record.exitCode, timedOut: record.timedOut === true, failureClass: record.failureClass,
      events: record.events.slice(Math.max(0, Number(after) || 0)).map(clone), summary: record.summary,
    };
  }

  async function checkpoint(input = {}) {
    const workspacePath = resolveWorkspace(input);
    if (input.taskId && worktreeManager) {
      const result = await worktreeManager.checkpoint(input.taskId, { label: input.label || 'Coding runtime checkpoint' });
      return result.ok ? { ...result, diff: await diff({ workspacePath, taskId: input.taskId }) } : result;
    }
    const index = await indexWorkspace({ workspacePath });
    return { ok: true, checkpoint: { id: `coding-index-${Date.now()}`, label: text(input.label, 160) || 'Coding runtime index checkpoint', workspacePath, indexedAt: index.indexedAt, fileCount: index.fileCount } };
  }

  return { codingRuntimeVersion: CODING_RUNTIME_VERSION, workspaceRoot, codingRoot, prepareTask, indexWorkspace, search, dependencies, impactAnalysis, selectTests, applyPatch, deliveryReport, diff, startCommand, commandStatus, checkpoint };
}

module.exports = { CODING_RUNTIME_VERSION, createCodingRuntime, classifyCodingFailure: classifyFailure };
