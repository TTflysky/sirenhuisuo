const crypto = require('crypto');
const { EventEmitter } = require('events');
const fs = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const CODING_RUNTIME_VERSION = 1;
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

  return { codingRuntimeVersion: CODING_RUNTIME_VERSION, workspaceRoot, codingRoot, prepareTask, indexWorkspace, search, dependencies, diff, startCommand, commandStatus, checkpoint };
}

module.exports = { CODING_RUNTIME_VERSION, createCodingRuntime, classifyCodingFailure: classifyFailure };
