const { app, BrowserWindow, ipcMain, screen, shell, dialog, Tray, Menu, nativeImage, net, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { exec, execFile } = require('child_process');
const officeParser = require('officeparser');
const { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } = require('docx');
const { initAutoUpdater } = require('./autoUpdate.cjs');
const { listSkills, readSkill, resolveSkillDirectory, deleteSkill, installSkill, inspectSkillSource, repairSkill, createSkillDraft, listSkillDrafts, reviewSkillDraft, setAutoSkillEnabled, rollbackAutoSkill } = require('./skills.cjs');
const { createSkillRuntime } = require('./skillRuntime.cjs');
const { createSkillLifecycle } = require('./skillLifecycle.cjs');
const { createCredentialVault } = require('./credentialVault.cjs');
const { searchSkillHub } = require('./skillHubSearch.cjs');
const { testObsidianVault, searchObsidianVault, readObsidianNote, fetchKnowledgeUrl, searchWeb } = require('./knowledge.cjs');
const { version: APP_VERSION } = require('../package.json');
const { sanitizeInjectedEnv, redactInjectedValues } = require('./secretSafety.cjs');
const { invokeConnectorAdapter, verifyConnectorAdapter } = require('./connectorAdapters.cjs');
const { buildPowerShellCommand } = require('./commandShell.cjs');
const { createTaskRuntimeStore } = require('./taskRuntimeStore.cjs');
const { createOperationDiagnostics } = require('./operationDiagnostics.cjs');
const { createTelemetryLedger } = require('./telemetryLedger.cjs');
const { createAutonomyEvaluation } = require('./autonomyEvaluation.cjs');
const { createTaskService } = require('./taskService.cjs');
const { createTaskWorker } = require('./taskWorker.cjs');
const { createNativeToolRuntime } = require('./nativeToolRuntime.cjs');
const { createNativeExecutionAdapter } = require('./nativeExecutionAdapter.cjs');
const { createWorktreeManager } = require('./worktreeManager.cjs');
const { createCodingRuntime } = require('./codingRuntime.cjs');
const { createEcosystemHealth } = require('./ecosystemHealth.cjs');
const { createMemoryManager } = require('./memoryManager.cjs');
const { createLearningReviewQueue } = require('./learningReviewQueue.cjs');
const { createWebResourceAcquirer } = require('./resourceAcquisition.cjs');
const { createBrowserPageReader } = require('./browserPageReader.cjs');
const { createWebArtifactVerifier } = require('./webArtifactVerifier.cjs');
const { createWindowRegistry } = require('./windowRegistry.cjs');
const { registerWindowIpc } = require('./windowIpc.cjs');
const { registerTaskServiceIpc } = require('./taskServiceIpc.cjs');
const { configureAppUserData } = require('./appIdentityMigration.cjs');
const { applyRenderingPolicy, attachRendererDiagnostics, revealWindowAfterLoad } = require('./renderingPolicy.cjs');
// Configure the canonical Taiji data root before any module resolves userData.
// Automated Electron verification remains isolated from a user's real data.
const identityMigration = configureAppUserData(app, { testUserData: process.env.TAIJI_TEST_USER_DATA });
const renderingPolicy = applyRenderingPolicy(app, { platform: process.platform, env: process.env });
if (process.env.TAIJI_TEST_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', String(process.env.TAIJI_TEST_DEBUG_PORT));
const log = require('electron-log');
log.info('[startup] rendering policy', renderingPolicy);
const APP_TITLE = `太极 AI 办公会所 v${APP_VERSION}`;
const APP_SESSION_ID = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const WINDOW_PREFERENCES_PATH = path.join(app.getPath('userData'), 'window-preferences.json');
const DEV_SERVER_URL = process.env.TAIJI_DEV_SERVER_URL || 'http://localhost:5173';

// The durable task store remains the source of full execution details. IPC
// notifications only wake renderers, so keep high-frequency tool events small.
function compactExecutionEventForRenderer(event) {
  if (!event || typeof event !== 'object') return event;
  const next = { ...event };
  if (typeof next.output === 'string' && next.output.length > 320) next.output = `${next.output.slice(0, 320)}...`;
  if (typeof next.summary === 'string' && next.summary.length > 320) next.summary = `${next.summary.slice(0, 320)}...`;
  if (typeof next.error === 'string' && next.error.length > 320) next.error = `${next.error.slice(0, 320)}...`;
  if (next.arguments && typeof next.arguments === 'object') {
    const preview = JSON.stringify(next.arguments);
    if (preview.length > 480) next.arguments = { preview: `${preview.slice(0, 480)}...`, truncated: true };
  }
  return next;
}

ipcMain.on('app:getSessionId', (event) => { event.returnValue = APP_SESSION_ID; });

// ===== 自主代理工作区（沙箱目录，所有文件读写/命令执行都限制在此）=====
const WORKSPACE = path.join(app.getPath('userData'), 'workspace');
const worktreeManager = createWorktreeManager({
  workspaceRoot: WORKSPACE,
  stateRoot: path.join(app.getPath('userData'), 'task-runtime', 'git-worktrees'),
});
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TASK_RUNTIME_ROOT = path.join(app.getPath('userData'), 'task-runtime');
const skillLifecycle = createSkillLifecycle(path.join(app.getPath('userData'), 'skill-runtime'), {
  createSkillDraft: (input) => createSkillDraft(PROJECT_ROOT, input),
  async resolveInstalledSkill(name) {
    const matched = (await listSkills(PROJECT_ROOT)).find((item) => item.name.toLocaleLowerCase() === String(name || '').toLocaleLowerCase());
    if (!matched) return undefined;
    if (matched.origin !== 'auto') throw new Error('自动学习只能更新太极自己生成的 Skill，不能覆盖内置或手动安装 Skill');
    return { skill: matched, ...(await readSkill(PROJECT_ROOT, matched.id)) };
  },
  setAutoSkillEnabled: (name, enabled, reason) => setAutoSkillEnabled(PROJECT_ROOT, name, enabled, reason),
  rollbackAutoSkill: (name) => rollbackAutoSkill(PROJECT_ROOT, name),
});
const skillRuntime = createSkillRuntime({
  stateRoot: path.join(app.getPath('userData'), 'skill-runtime'),
  projectRoot: PROJECT_ROOT,
  listSkills,
  readSkill,
  installSkill: (root, input) => installSkill(root, input, { fetchImpl: (url, options) => net.fetch(url, options) }),
  repairSkill,
  onInvocation: (input) => skillLifecycle.recordInvocation(input),
});
const credentialVault = createCredentialVault({ root: path.join(app.getPath('userData'), 'credential-vault'), safeStorage });
const telemetryLedger = createTelemetryLedger(TASK_RUNTIME_ROOT);
const operationDiagnostics = createOperationDiagnostics(TASK_RUNTIME_ROOT, {
  onRecord(entry) {
    return telemetryLedger.record({
      type: 'diagnostic.recorded', source: entry.scope, severity: entry.level, taskId: entry.taskId,
      status: entry.level === 'error' ? 'failed' : undefined, failureClass: entry.failureClass,
      recoverable: entry.recoverable, occurredAt: entry.occurredAt, summary: entry.message,
      metadata: { operation: entry.operation, teamId: entry.teamId, diagnosticId: entry.id },
    });
  },
});
if (identityMigration.status === 'partial') {
  void operationDiagnostics.record({
    scope: 'app-identity',
    operation: 'migrate-user-data',
    failureClass: 'filesystem',
    recoverable: true,
    message: '太极数据目录迁移未完整完成，下次启动将继续迁移',
    context: { failures: identityMigration.failures },
  });
}
const taskRuntimeStore = createTaskRuntimeStore(TASK_RUNTIME_ROOT, {
  diagnostics: operationDiagnostics,
  onEvents(events) {
    return telemetryLedger.recordMany(events.map((event) => ({
      type: `task.${event.type}`, source: event.source || 'task-runtime', occurredAt: event.occurredAt,
      taskId: event.taskId, sessionId: event.sessionId, status: event.nextStatus || event.previousStatus,
      summary: event.detail, metadata: { sequence: event.sequence, domains: event.domains, teamId: event.teamId },
    })));
  },
});
process.on('uncaughtException', (error) => {
  void operationDiagnostics.record({ scope: 'main-process', operation: 'uncaught-exception', message: error?.message || String(error), error });
});
process.on('unhandledRejection', (reason) => {
  void operationDiagnostics.record({ scope: 'main-process', operation: 'unhandled-rejection', message: reason?.message || String(reason), error: reason });
});
const codingRuntime = createCodingRuntime({ workspaceRoot: WORKSPACE, worktreeManager });
const taskService = createTaskService(taskRuntimeStore, { codingRuntime });
const memoryManager = createMemoryManager(path.join(app.getPath('userData'), 'taiji-memory'));
const autonomyEvaluation = createAutonomyEvaluation(path.join(app.getPath('userData'), 'autonomy-evaluation'));
const AUTONOMY_CAPTURE_INTERVAL_MS = 5000;
let autonomyCaptureTimer;
let autonomyCaptureInFlight = false;
async function captureAutonomyEvaluationEvidence() {
  if (autonomyCaptureInFlight) return { ok: true, captured: 0, skipped: true };
  autonomyCaptureInFlight = true;
  try {
  const [tasks, memory, skills] = await Promise.all([
    taskRuntimeStore.read(),
    memoryManager.list({ includeRetrievals: true }),
    skillLifecycle.list(),
  ]);
  return autonomyEvaluation.capture({
    taskRuns: tasks?.runs || [],
    memoryRetrievals: memory?.retrievals || [],
    skillRollouts: skills?.rollouts || [],
  });
  } finally {
    autonomyCaptureInFlight = false;
  }
}
function stopAutonomyCaptureLoop() {
  if (!autonomyCaptureTimer) return;
  clearInterval(autonomyCaptureTimer);
  autonomyCaptureTimer = undefined;
}
async function ensureAutonomyCaptureLoop() {
  const summary = await autonomyEvaluation.summary();
  if (!summary.activeSession) {
    stopAutonomyCaptureLoop();
    return summary;
  }
  if (!autonomyCaptureTimer) {
    autonomyCaptureTimer = setInterval(() => {
      void captureAutonomyEvaluationEvidence().catch((error) => operationDiagnostics.record({
        scope: 'autonomy-evaluation', operation: 'capture-live-evidence', message: error?.message || String(error), error,
      }));
    }, AUTONOMY_CAPTURE_INTERVAL_MS);
  }
  return summary;
}
function registerAutonomyEvaluationIpc(reportIpcResult) {
  ipcMain.handle('autonomy-evaluation:summary', async () => {
    try {
      await captureAutonomyEvaluationEvidence();
      return await autonomyEvaluation.summary();
    } catch (error) {
      await operationDiagnostics.record({ scope: 'ipc', operation: 'autonomy-evaluation-summary', message: error?.message || String(error), error });
      return { ok: false, error: error?.message || String(error) };
    }
  });
  ipcMain.handle('autonomy-evaluation:start', async (_event, input) => {
    try {
      const result = await autonomyEvaluation.start(input || {});
      await captureAutonomyEvaluationEvidence();
      await ensureAutonomyCaptureLoop();
      return { ...result, summary: await autonomyEvaluation.summary() };
    } catch (error) {
      return reportIpcResult('autonomy-evaluation-start', input, { ok: false, error: error?.message || String(error) });
    }
  });
  ipcMain.handle('autonomy-evaluation:complete', async (_event, input) => {
    try {
      stopAutonomyCaptureLoop();
      await captureAutonomyEvaluationEvidence();
      const result = await autonomyEvaluation.complete(input?.sessionId);
      return { ...result, summary: await autonomyEvaluation.summary() };
    } catch (error) {
      return reportIpcResult('autonomy-evaluation-complete', input, { ok: false, error: error?.message || String(error) });
    }
  });
  ipcMain.handle('autonomy-evaluation:run-baseline', async () => {
    try {
      const result = await autonomyEvaluation.runBaseline({ label: `内置自动验收 ${new Date().toLocaleString('zh-CN')}`, operator: 'system' });
      return { ...result, summary: await autonomyEvaluation.summary() };
    } catch (error) {
      return reportIpcResult('autonomy-evaluation-run-baseline', undefined, { ok: false, error: error?.message || String(error) });
    }
  });
  ipcMain.handle('autonomy-evaluation:export', async () => {
    try {
      await captureAutonomyEvaluationEvidence();
      const result = await dialog.showSaveDialog({
        title: '导出自治陪跑评测',
        defaultPath: `taiji-autonomy-evaluation-${Date.now()}.json`,
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { ok: true, canceled: true };
      const payload = await autonomyEvaluation.exportData();
      await fsp.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
      return { ok: true, path: result.filePath, count: payload.observations.length };
    } catch (error) {
      await operationDiagnostics.record({ scope: 'ipc', operation: 'autonomy-evaluation-export', message: error?.message || String(error), error });
      return { ok: false, error: error?.message || String(error) };
    }
  });
}
const learningReviewQueue = createLearningReviewQueue(path.join(app.getPath('userData'), 'task-runtime'), {
  memoryManager,
  fetchImpl: (url, options) => net.fetch(url, options),
  skillLifecycle,
});
const taskWorker = createTaskWorker({
  rootDir: path.join(app.getPath('userData'), 'task-runtime'),
  store: taskRuntimeStore,
  sessionId: APP_SESSION_ID,
  onChanged(event) {
    void telemetryLedger.record({
      type: `worker.${event?.type || 'changed'}`, source: 'task-worker', sessionId: APP_SESSION_ID,
      taskId: event?.taskId, status: event?.status || event?.state, summary: event?.detail || event?.message || 'Worker 状态已更新',
      metadata: { workerId: event?.workerId, commandId: event?.commandId },
    });
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('task-worker:changed', event);
    }
  },
});
const acquireWebResource = createWebResourceAcquirer({
  directReader: (url) => fetchKnowledgeUrl(url, { fetchImpl: (target, options) => net.fetch(target, options) }),
  browserReader: createBrowserPageReader(BrowserWindow, {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Taiji/2.7',
  }),
});
const verifyWebArtifact = createWebArtifactVerifier(BrowserWindow, { workspaceRoot: WORKSPACE });
const nativeToolRuntime = createNativeToolRuntime({
  workspaceRoot: WORKSPACE,
  projectRoot: PROJECT_ROOT,
  fetchImpl: (url, options) => net.fetch(url, options),
  listSkills,
  readSkill,
  installSkill: (projectRoot, input) => installSkill(projectRoot, input, { fetchImpl: (url, options) => net.fetch(url, options) }),
  verifyConnectorAdapter,
  testObsidianVault,
  searchObsidianVault,
  readObsidianNote,
  fetchKnowledgeUrl: acquireWebResource,
  searchWeb,
  createWordDocument: createVerifiedWordDocument,
  readWorkspaceFile,
  runCommand: executeWorkspaceCommand,
  verifyWebArtifact,
  codingRuntime,
  taskService,
});
const ecosystemHealth = createEcosystemHealth({
  appVersion: APP_VERSION,
  projectRoot: PROJECT_ROOT,
  workspaceRoot: WORKSPACE,
  store: taskRuntimeStore,
  worker: taskWorker,
  toolRuntime: nativeToolRuntime,
  worktreeManager,
  listSkills,
  memoryManager,
  learningReviewQueue,
});
const nativeExecutionAdapter = createNativeExecutionAdapter({
  projectRoot: PROJECT_ROOT,
  store: taskRuntimeStore,
  taskService,
  worker: taskWorker,
  toolRuntime: nativeToolRuntime,
  worktreeManager,
  memoryManager,
  learningReviewQueue,
  diagnostics: operationDiagnostics,
  sessionId: APP_SESSION_ID,
  fetchImpl: (url, options) => net.fetch(url, options),
  onChanged(event) {
    void telemetryLedger.record({
      type: `execution.${event?.type || 'changed'}`, source: 'native-execution', sessionId: APP_SESSION_ID,
      taskId: event?.taskId, projectId: event?.projectId, stepId: event?.stepId, attemptId: event?.attemptId,
      status: event?.status || event?.job?.state, actorId: event?.actorId || event?.memberId,
      modelId: event?.modelId, toolCallId: event?.toolCallId, durationMs: event?.durationMs, usage: event?.usage,
      failureClass: event?.failureClass || event?.errorClass, error: event?.error,
      summary: event?.summary || event?.detail || event?.activity || '执行状态已更新',
      metadata: { success: event?.success, toolName: event?.toolName, eventSequence: event?.sequence },
    });
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('task-execution:changed', compactExecutionEventForRenderer(event));
    }
  },
});
const TEXT_FILE_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.yaml', '.yml',
  '.xml', '.log', '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.cpp', '.h',
  '.css', '.scss', '.less', '.html', '.htm', '.sh', '.bat', '.cmd', '.ps1', '.go',
  '.rs', '.php', '.rb', '.sql', '.toml', '.ini', '.cfg', '.conf', '.svg', '.vue', '.svelte',
]);
const PARSABLE_DOCUMENT_EXTENSIONS = new Set([
  '.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods', '.pdf', '.rtf', '.epub',
]);
const MAX_READABLE_FILE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 4 * 1024 * 1024;

function decodeTextBuffer(buffer) {
  if (buffer.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function wordRuns(source) {
  const runs = [];
  const value = String(source || '');
  const boldPattern = /\*\*(.+?)\*\*/g;
  let cursor = 0;
  let match;
  while ((match = boldPattern.exec(value))) {
    if (match.index > cursor) runs.push(new TextRun(value.slice(cursor, match.index)));
    runs.push(new TextRun({ text: match[1], bold: true }));
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) runs.push(new TextRun(value.slice(cursor)));
  return runs.length ? runs : [new TextRun('')];
}

function wordParagraph(line) {
  const heading = String(line).match(/^(#{1,6})\s+(.+)$/);
  if (heading) {
    const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
    return new Paragraph({ children: wordRuns(heading[2]), heading: levels[heading[1].length - 1] });
  }
  const bullet = String(line).match(/^\s*[-*+]\s+(.+)$/);
  if (bullet) return new Paragraph({ children: wordRuns(bullet[1]), bullet: { level: 0 } });
  const quote = String(line).match(/^>\s*(.*)$/);
  if (quote) return new Paragraph({ children: wordRuns(quote[1]), indent: { left: 360 } });
  return new Paragraph({ children: wordRuns(String(line)), alignment: AlignmentType.LEFT });
}

async function createVerifiedWordDocument(target, content) {
  const document = new Document({
    sections: [{
      properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      children: String(content || '').replace(/\r\n/g, '\n').split('\n').map(wordParagraph),
    }],
  });
  const buffer = await Packer.toBuffer(document);
  if (buffer.length < 100 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error('生成的 Word 文件格式无效');
  await fsp.writeFile(target, buffer);
  const parsed = await officeParser.parseOffice(target, { extractAttachments: false, ocr: false });
  const extracted = parsed.toText().trim();
  if (String(content || '').trim() && !extracted) throw new Error('Word 文件校验失败：没有读取到正文');
  return { size: buffer.length, extractedChars: extracted.length };
}
function ensureWorkspace() {
  try { fs.mkdirSync(WORKSPACE, { recursive: true }); } catch {}
  return WORKSPACE;
}
ensureWorkspace();

// 路径安全：限制在 WORKSPACE 内，禁止 .. 穿越
function safeJoin(...parts) {
  const target = path.resolve(WORKSPACE, path.join(...parts));
  const rel = path.relative(WORKSPACE, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径越界：不允许访问工作区以外的文件');
  }
  return target;
}

function sandboxPathEscape(command) {
  const text = String(command || '');
  return /(?:^|[\s'"])[a-z]:[\\/]/i.test(text)
    || /(?:^|[\s'"])[\\/]{2}/.test(text)
    || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(text)
    || /\$(?:env:(?:userprofile|home|appdata|localappdata|temp|windir|systemroot)|home|profile)\b|%(?:userprofile|appdata|localappdata|temp|windir|systemroot)%/i.test(text);
}

async function readWorkspaceFile(targetInput) {
  const target = path.resolve(targetInput);
  const relative = path.relative(WORKSPACE, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('文件路径越界');
  const stat = await fsp.stat(target);
  if (!stat.isFile()) throw new Error('目标不是文件');
  if (stat.size > MAX_READABLE_FILE_BYTES) {
    throw new Error(`文件过大（${Math.ceil(stat.size / 1024 / 1024)}MB），当前单文件读取上限为 50MB`);
  }
  const extension = path.extname(target).toLowerCase();
  if (TEXT_FILE_EXTENSIONS.has(extension)) {
    return { ok: true, path: target, content: await fsp.readFile(target, 'utf8'), format: 'text', size: stat.size };
  }
  if (PARSABLE_DOCUMENT_EXTENSIONS.has(extension)) {
    try {
      const ast = await officeParser.parseOffice(target, { extractAttachments: false, ocr: false });
      const extracted = ast.toText();
      const truncated = extracted.length > MAX_EXTRACTED_TEXT_CHARS;
      return {
        ok: true,
        path: target,
        content: truncated ? `${extracted.slice(0, MAX_EXTRACTED_TEXT_CHARS)}\n\n[内容过长，已截断]` : extracted,
        format: ast.type || extension.slice(1),
        size: stat.size,
        truncated,
        warnings: Array.isArray(ast.warnings) ? ast.warnings.map((warning) => String(warning?.message ?? warning)).slice(0, 10) : [],
      };
    } catch (error) {
      throw new Error(`无法解析 ${extension || '该'} 文件：${String(error?.message ?? error)}`);
    }
  }
  const possibleText = decodeTextBuffer(await fsp.readFile(target));
  if (possibleText !== null) return { ok: true, path: target, content: possibleText, format: 'text', size: stat.size };
  return { ok: false, path: target, size: stat.size, error: `文件已保存，但 ${extension || '该二进制格式'} 不支持直接提取文本` };
}

async function executeWorkspaceCommand(payload) {
  const cmd = typeof payload === 'string' ? payload : payload?.cmd;
  const scope = typeof payload === 'object' && typeof payload?.scope === 'string'
    ? payload.scope.split(/[\\/]+/).map((part) => part.replace(/[^a-zA-Z0-9_-]/g, '_')).filter(Boolean).join('/') || 'global'
    : 'global';
  let cwd = safeJoin(scope);
  const sandboxEnabled = typeof payload !== 'object' || payload?.sandboxEnabled !== false;
  const extraEnv = sanitizeInjectedEnv(payload && typeof payload === 'object' ? payload.env : undefined);
  if (typeof payload === 'object' && typeof payload?.skillId === 'string' && payload.skillId.trim()) {
    try { cwd = await resolveSkillDirectory(PROJECT_ROOT, payload.skillId.trim()); }
    catch (error) { return { success: false, exitCode: -1, stdout: '', stderr: `无法进入已安装 Skill：${String(error?.message ?? error)}`, cwd }; }
  }
  await fsp.mkdir(cwd, { recursive: true });
  if (typeof cmd !== 'string' || !cmd.trim()) return { success: false, exitCode: -1, stdout: '', stderr: '命令不能为空', cwd };
  if (sandboxEnabled && sandboxPathEscape(cmd)) {
    return { success: false, exitCode: -1, stdout: '', stderr: '命令沙盒已阻止访问工作区以外的路径。请改用相对路径。', cwd };
  }
  const timeoutMs = 30000;
  const maxOutput = 100 * 1024;
  return new Promise((resolve) => {
    const options = { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true, env: { ...process.env, ...extraEnv, FORCE_COLOR: '0' } };
    const done = (error, stdout, stderr) => resolve({
      success: !error,
      exitCode: error ? (error.code || -1) : 0,
      stdout: redactInjectedValues(stdout, extraEnv).slice(0, maxOutput),
      stderr: redactInjectedValues(stderr, extraEnv).slice(0, maxOutput),
      signal: error?.killed ? 'TIMEOUT' : undefined,
      cwd,
    });
    const child = process.platform === 'win32'
      ? execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', buildPowerShellCommand(cmd)], options, done)
      : exec(cmd, options, done);
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000);
    }, timeoutMs);
    child.on('close', () => clearTimeout(timer));
  });
}

const chatWindows = createWindowRegistry('chat-windows');
const toolWindows = createWindowRegistry('tool-windows');
const toolWindowPayloads = createWindowRegistry('tool-window-payloads');
const TOOL_WINDOW_TYPES = new Set(['add-employee', 'edit-employee', 'create-team', 'rename-team', 'manage-team-members', 'connector-config', 'assistant-settings']);
const CHAT_WINDOW_WIDTH = 560;
const CHAT_WINDOW_HEIGHT = 700;
const CHAT_WINDOW_MIN_WIDTH = 420;
const CHAT_WINDOW_MIN_HEIGHT = 420;
const CHAT_WINDOW_OFFSET = 28;
const ASSISTANT_COMPANION_KEY = 'assistant-chat';
const ASSISTANT_COMPANION_WIDTH = 480;
const ASSISTANT_COMPANION_MIN_WIDTH = 400;
const ASSISTANT_COMPANION_GAP = 10;
const LOCKED_CHAT_WIDTH = 480;

function normalizeChatOptions(opts) {
  const type = opts?.type;
  if (!['dm-chat', 'team-chat', 'assistant-chat'].includes(type)) return null;
  if (type === 'assistant-chat') return { type, refId: '', key: 'assistant-chat' };
  const refId = typeof opts?.refId === 'string' ? opts.refId.trim() : '';
  if (!refId) return null;
  return { type, refId, key: `${type}:${refId}` };
}

function focusChatWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.moveTop();
}

function bringToFront(win) {
  // 仅作为显式打开入口保留短暂置顶，不由窗口 focus 事件调用。
  if (!win || win.isDestroyed()) return;
  focusChatWindow(win);
  win.setAlwaysOnTop(true);
  setTimeout(() => {
    if (win.isDestroyed()) return;
    if (isLockedCompanionWindow(win)) {
      win.setAlwaysOnTop(true, 'floating');
      win.moveTop();
    } else {
      win.setAlwaysOnTop(false);
    }
  }, 100);
}

function isLockedCompanionWindow(win) {
  if (!win || win.isDestroyed()) return false;
  if (win === assistantCompanionWindow && assistantCompanionLocked) return true;
  return [...lockedChatWindowKeys].some((key) => chatWindows.get(key) === win);
}

function applyAssistantCompanionLayer() {
  if (!assistantCompanionWindow || assistantCompanionWindow.isDestroyed()) return;
  if (assistantCompanionLocked) {
    assistantCompanionWindow.setAlwaysOnTop(true, 'floating');
    assistantCompanionWindow.moveTop();
  } else {
    assistantCompanionWindow.setAlwaysOnTop(false);
  }
}

function getRootOwner(win) {
  if (!win || win.isDestroyed()) return null;
  let owner = win;
  let parent = owner.getParentWindow();
  while (parent && !parent.isDestroyed()) {
    owner = parent;
    parent = owner.getParentWindow();
  }
  return owner;
}

function getChatWindowBounds(sourceWindow) {
  const sourceBounds = sourceWindow && !sourceWindow.isDestroyed()
    ? sourceWindow.getBounds()
    : screen.getPrimaryDisplay().workArea;
  const workArea = screen.getDisplayMatching(sourceBounds).workArea;
  const width = Math.min(CHAT_WINDOW_WIDTH, workArea.width);
  const height = Math.min(CHAT_WINDOW_HEIGHT, workArea.height);
  const maxX = Math.max(workArea.x, workArea.x + workArea.width - width);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - height);
  const clampX = (value) => Math.max(workArea.x, Math.min(maxX, value));
  const clampY = (value) => Math.max(workArea.y, Math.min(maxY, value));
  const baseX = clampX(sourceBounds.x);
  const baseY = clampY(sourceBounds.y);
  const candidates = [];
  const candidateKeys = new Set();
  const addCandidate = (x, y) => {
    const key = `${x},${y}`;
    if (candidateKeys.has(key)) return;
    candidateKeys.add(key);
    candidates.push({ x, y });
  };

  const xSlots = Math.floor((maxX - workArea.x) / CHAT_WINDOW_OFFSET) + 2;
  const ySlots = Math.floor((maxY - workArea.y) / CHAT_WINDOW_OFFSET) + 2;
  const diagonalSlots = Math.max(xSlots, ySlots);
  for (let index = 0; index < diagonalSlots; index += 1) {
    addCandidate(
      clampX(baseX + index * CHAT_WINDOW_OFFSET),
      clampY(baseY + index * CHAT_WINDOW_OFFSET),
    );
  }

  const xCandidates = [];
  const yCandidates = [];
  for (let x = workArea.x; x <= maxX; x += CHAT_WINDOW_OFFSET) xCandidates.push(x);
  for (let y = workArea.y; y <= maxY; y += CHAT_WINDOW_OFFSET) yCandidates.push(y);
  if (xCandidates.at(-1) !== maxX) xCandidates.push(maxX);
  if (yCandidates.at(-1) !== maxY) yCandidates.push(maxY);
  for (const y of yCandidates) {
    for (const x of xCandidates) addCandidate(x, y);
  }

  const occupied = new Set();
  for (const chatWindow of chatWindows.values()) {
    if (!chatWindow || chatWindow.isDestroyed()) continue;
    const bounds = chatWindow.getBounds();
    occupied.add(`${bounds.x},${bounds.y}`);
  }
  const position = candidates.find(({ x, y }) => !occupied.has(`${x},${y}`)) ?? candidates[0];
  return { ...position, width, height };
}

function createChatBrowserWindow(type, bounds) {
  return new BrowserWindow({
    ...bounds,
    minWidth: CHAT_WINDOW_MIN_WIDTH,
    minHeight: CHAT_WINDOW_MIN_HEIGHT,
    title: type === 'team-chat' ? `${APP_TITLE} · 团队聊天` : `${APP_TITLE} · 员工私聊`,
    skipTaskbar: false,
    frame: false,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
}

async function loadRendererWindow(window, hash) {
  if (!app.isPackaged) return window.loadURL(`${DEV_SERVER_URL}/#${hash}`);
  return window.loadFile(path.join(__dirname, '../dist/index.html'), { hash });
}

let mainWindow = null;
let lastActiveWindow = null;
let ipcHandlersRegistered = false;
let assistantCompanionWindow = null;
let assistantCompanionManuallyClosed = false;
let assistantCompanionLocked = loadAssistantCompanionLockPreference();
const lockedChatWindowKeys = loadLockedChatWindowKeys();
let settingsWindow = null;
let tray = null;
let isQuitting = false;

function loadWindowPreferences() {
  try {
    const value = JSON.parse(fs.readFileSync(WINDOW_PREFERENCES_PATH, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function saveWindowPreferences(partial) {
  try {
    fs.writeFileSync(WINDOW_PREFERENCES_PATH, JSON.stringify({ ...loadWindowPreferences(), ...partial }, null, 2), 'utf8');
  } catch (error) {
    console.warn('Failed to save window preference:', error);
  }
}

function loadAssistantCompanionLockPreference() {
  return loadWindowPreferences().assistantCompanionLocked === true;
}

function loadLockedChatWindowKeys() {
  const saved = loadWindowPreferences();
  return new Set(Array.isArray(saved.lockedChatWindowKeys) ? saved.lockedChatWindowKeys.filter((key) => typeof key === 'string') : []);
}

function saveAssistantCompanionLockPreference() {
  saveWindowPreferences({ assistantCompanionLocked, lockedChatWindowKeys: [...lockedChatWindowKeys] });
}

function normalizeToolWindowOptions(opts) {
  const type = typeof opts?.type === 'string' ? opts.type : '';
  if (!TOOL_WINDOW_TYPES.has(type)) return null;
  const refId = typeof opts?.refId === 'string' ? opts.refId.trim() : '';
  if (['edit-employee', 'rename-team', 'manage-team-members'].includes(type) && !refId) return null;
  return { type, refId, payload: opts?.payload ?? null, key: `${type}:${refId || 'new'}` };
}

function getToolWindowSpec(type) {
  if (type === 'edit-employee') return { width: 650, height: 820, minWidth: 560, minHeight: 620, title: `${APP_TITLE} · 编辑员工` };
  if (type === 'connector-config') return { width: 620, height: 820, minWidth: 540, minHeight: 620, title: `${APP_TITLE} · 配置连接器` };
  if (type === 'assistant-settings') return { width: 660, height: 760, minWidth: 560, minHeight: 560, title: `${APP_TITLE} · 助手设置` };
  if (type === 'create-team') return { width: 520, height: 620, minWidth: 440, minHeight: 460, title: `${APP_TITLE} · 新建团队` };
  if (type === 'rename-team') return { width: 420, height: 260, minWidth: 360, minHeight: 220, title: `${APP_TITLE} · 重命名团队` };
  if (type === 'manage-team-members') return { width: 560, height: 680, minWidth: 460, minHeight: 520, title: `${APP_TITLE} · 添加团队成员` };
  return { width: 560, height: 760, minWidth: 460, minHeight: 560, title: `${APP_TITLE} · 添加员工` };
}

async function createToolWindow(opts, requester = mainWindow) {
  const normalized = normalizeToolWindowOptions(opts);
  if (!normalized) throw new Error('无效的工具窗口参数');
  const existing = toolWindows.get(normalized.key);
  if (existing && !existing.isDestroyed()) {
    focusChatWindow(existing);
    return { win: existing, reused: true };
  }
  if (existing) toolWindows.delete(normalized.key);

  const spec = getToolWindowSpec(normalized.type);
  const sourceBounds = requester && !requester.isDestroyed() ? requester.getBounds() : screen.getPrimaryDisplay().workArea;
  const workArea = screen.getDisplayMatching(sourceBounds).workArea;
  const edgeGap = 8;
  const width = Math.min(spec.width, Math.max(1, workArea.width - edgeGap * 2));
  const height = Math.min(spec.height, Math.max(1, workArea.height - edgeGap * 2));
  const minWidth = Math.min(spec.minWidth, width);
  const minHeight = Math.min(spec.minHeight, height);
  const preferredX = sourceBounds.x + 36;
  const preferredY = sourceBounds.y + 36;
  const x = Math.min(Math.max(workArea.x + edgeGap, preferredX), workArea.x + workArea.width - width - edgeGap);
  const y = Math.min(Math.max(workArea.y + edgeGap, preferredY), workArea.y + workArea.height - height - edgeGap);
  const win = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    x,
    y,
    title: spec.title,
    frame: false,
    show: false,
    backgroundColor: '#f5f6fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const session = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  toolWindows.set(normalized.key, win);
  toolWindowPayloads.set(session, { windowId: win.id, payload: normalized.payload });
  trackActiveWindow(win);
  attachRendererDiagnostics(win, { log, label: `tool:${normalized.type}` });
  revealWindowAfterLoad(win, {
    log,
    label: `tool:${normalized.type}`,
    onReveal: () => bringToFront(win),
  });
  win.on('closed', () => {
    if (toolWindows.get(normalized.key) === win) toolWindows.delete(normalized.key);
    toolWindowPayloads.delete(session);
  });
  const hash = `tool?type=${encodeURIComponent(normalized.type)}&id=${encodeURIComponent(normalized.refId)}&session=${encodeURIComponent(session)}`;
  try {
    if (!app.isPackaged) await win.loadURL(`${DEV_SERVER_URL}/#${hash}`);
    else await win.loadFile(path.join(__dirname, '../dist/index.html'), { hash });
    return { win, reused: false };
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    throw error;
  }
}

function showMainWindow() {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (!assistantCompanionManuallyClosed) {
    createAssistantCompanion(win).catch((error) => {
      console.error('Failed to restore assistant companion window:', error);
    });
  }
}

function showAssistantCompanion() {
  showMainWindow();
  assistantCompanionManuallyClosed = false;
  createAssistantCompanion(mainWindow, { focus: true }).catch((error) => {
    console.error('Failed to open assistant companion window:', error);
  });
}

function createTray() {
  if (tray) return tray;
  // Keep the icon inside the application bundle so the installed client can
  // remain in the tray after its main window is closed.
  const iconPath = path.join(__dirname, '../public/tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 20, height: 20 }));
  tray.setToolTip('太极 AI 办公会所');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开太极', click: showMainWindow },
    { label: '打开章北海助理', click: showAssistantCompanion },
    { type: 'separator' },
    {
      label: '彻底退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
  return tray;
}

function getAssistantCompanionBounds(owner, companion) {
  const ownerBounds = owner.getBounds();
  const display = screen.getDisplayMatching(ownerBounds);
  const workArea = display.workArea;
  const currentBounds = companion && !companion.isDestroyed() ? companion.getBounds() : null;
  const width = Math.min(
    Math.max(currentBounds?.width ?? ASSISTANT_COMPANION_WIDTH, ASSISTANT_COMPANION_MIN_WIDTH),
    workArea.width,
  );
  const height = Math.min(Math.max(ownerBounds.height, CHAT_WINDOW_MIN_HEIGHT), workArea.height);
  const y = Math.max(workArea.y, Math.min(ownerBounds.y, workArea.y + workArea.height - height));
  const rightX = ownerBounds.x + ownerBounds.width + ASSISTANT_COMPANION_GAP;
  const leftX = ownerBounds.x - width - ASSISTANT_COMPANION_GAP;

  if (rightX + width <= workArea.x + workArea.width) {
    return { x: rightX, y, width, height };
  }
  if (leftX >= workArea.x) {
    return { x: leftX, y, width, height };
  }

  // A maximized or nearly full-screen owner leaves no external space. Keep the
  // companion fully visible against the right edge until external space returns.
  return { x: workArea.x + workArea.width - width, y, width, height };
}

function syncLockedAssistantCompanion() {
  if (!assistantCompanionLocked || !mainWindow || mainWindow.isDestroyed()) return;
  if (!assistantCompanionWindow || assistantCompanionWindow.isDestroyed()) return;
  if (mainWindow.isMinimized() || !mainWindow.isVisible()) return;
  assistantCompanionWindow.setBounds(getAssistantCompanionBounds(mainWindow, assistantCompanionWindow));
  applyAssistantCompanionLayer();
}

function getLockedChatWindows() {
  return [...chatWindows.entries()]
    .filter(([key, win]) => key !== ASSISTANT_COMPANION_KEY && lockedChatWindowKeys.has(key) && win && !win.isDestroyed())
    .sort(([a], [b]) => a.localeCompare(b));
}

function getLockedChatBounds(owner, chat, index, total) {
  const ownerBounds = owner.getBounds();
  const workArea = screen.getDisplayMatching(ownerBounds).workArea;
  const currentBounds = chat.getBounds();
  const width = Math.min(Math.max(Math.min(currentBounds.width, LOCKED_CHAT_WIDTH), CHAT_WINDOW_MIN_WIDTH), workArea.width);
  const availableHeight = Math.max(CHAT_WINDOW_MIN_HEIGHT, Math.floor(Math.min(ownerBounds.height, workArea.height) / total));
  const height = Math.min(availableHeight, workArea.height);
  const x = Math.max(workArea.x, ownerBounds.x - width - ASSISTANT_COMPANION_GAP);
  const maxY = workArea.y + workArea.height - height;
  const y = Math.max(workArea.y, Math.min(maxY, ownerBounds.y + index * height));
  return { x, y, width, height };
}

function syncLockedChatWindows() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible()) return;
  const lockedChats = getLockedChatWindows();
  lockedChats.forEach(([, chat], index) => {
    chat.setBounds(getLockedChatBounds(mainWindow, chat, index, lockedChats.length));
    if (isLockedCompanionWindow(chat)) {
      chat.setAlwaysOnTop(true, 'floating');
      chat.moveTop();
    }
  });
}

function syncLockedCompanionWindows() {
  syncLockedAssistantCompanion();
  syncLockedChatWindows();
}

function scheduleLockedAssistantSync() {
  if (!assistantCompanionLocked && lockedChatWindowKeys.size === 0) return;
  setTimeout(syncLockedCompanionWindows, 0);
}

function getInitialWindowBounds() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const companionWidth = Math.min(ASSISTANT_COMPANION_WIDTH, workArea.width);
  const availableMainWidth = workArea.width - companionWidth - ASSISTANT_COMPANION_GAP;
  const width = Math.min(1280, Math.max(860, availableMainWidth));
  const height = Math.min(820, workArea.height);
  const groupWidth = Math.min(workArea.width, width + ASSISTANT_COMPANION_GAP + companionWidth);
  return {
    x: workArea.x + Math.max(0, Math.floor((workArea.width - groupWidth) / 2)),
    y: workArea.y + Math.max(0, Math.floor((workArea.height - height) / 2)),
    width,
    height,
  };
}

async function createAssistantCompanion(owner = mainWindow, { focus = false } = {}) {
  if (!owner || owner.isDestroyed()) return null;
  if (assistantCompanionWindow && !assistantCompanionWindow.isDestroyed()) {
    if (focus) focusChatWindow(assistantCompanionWindow);
    return assistantCompanionWindow;
  }

  assistantCompanionManuallyClosed = false;
  const companion = new BrowserWindow({
    ...getAssistantCompanionBounds(owner, null),
    modal: false,
    minWidth: ASSISTANT_COMPANION_MIN_WIDTH,
    minHeight: CHAT_WINDOW_MIN_HEIGHT,
    title: `${APP_TITLE} · 章北海助理`,
    skipTaskbar: false,
    frame: false,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The assistant is a task runner as well as a window. Hiding its window
      // must not throttle timers or pause an in-flight agent loop.
      backgroundThrottling: false,
    },
  });
  assistantCompanionWindow = companion;
  chatWindows.set(ASSISTANT_COMPANION_KEY, companion);
  applyAssistantCompanionLayer();
  trackActiveWindow(companion);
  attachRendererDiagnostics(companion, { log, label: 'assistant' });
  revealWindowAfterLoad(companion, {
    log,
    label: 'assistant',
    showWindow: () => {
      if (focus) focusChatWindow(companion);
      else companion.showInactive();
    },
    onReveal: () => {
      if (assistantCompanionLocked) syncLockedCompanionWindows();
    },
  });
  companion.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    assistantCompanionManuallyClosed = true;
    companion.hide();
  });
  companion.on('closed', () => {
    if (chatWindows.get(ASSISTANT_COMPANION_KEY) === companion) {
      chatWindows.delete(ASSISTANT_COMPANION_KEY);
    }
    if (assistantCompanionWindow === companion) assistantCompanionWindow = null;
  });

  const hash = 'chat?type=assistant-chat&id=';
  try {
    if (!app.isPackaged) await companion.loadURL(`${DEV_SERVER_URL}/#${hash}`);
    else await companion.loadFile(path.join(__dirname, '../dist/index.html'), { hash });
    return companion;
  } catch (error) {
    if (!companion.isDestroyed()) companion.destroy();
    throw error;
  }
}

async function createSettingsWindow(sourceWindow = mainWindow) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    focusChatWindow(settingsWindow);
    return settingsWindow;
  }

  const sourceBounds = sourceWindow && !sourceWindow.isDestroyed()
    ? sourceWindow.getBounds()
    : screen.getPrimaryDisplay().workArea;
  const workArea = screen.getDisplayMatching(sourceBounds).workArea;
  // Settings always opens at the same comfortable working size. It is still
  // resizable for this session, but deliberately does not restore old bounds.
  const width = Math.max(900, Math.min(1100, workArea.width - 80));
  const height = Math.max(620, Math.min(760, workArea.height - 80));
  const win = new BrowserWindow({
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
    minWidth: 900,
    minHeight: 620,
    title: `${APP_TITLE} · 设置`,
    frame: false,
    show: false,
    backgroundColor: '#f5f6fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow = win;
  trackActiveWindow(win);
  attachRendererDiagnostics(win, { log, label: 'settings' });
  revealWindowAfterLoad(win, {
    log,
    label: 'settings',
    onReveal: () => win.focus(),
  });
  win.on('closed', () => {
    if (settingsWindow === win) settingsWindow = null;
  });
  try {
    if (!app.isPackaged) await win.loadURL(`${DEV_SERVER_URL}/#settings`);
    else await win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'settings' });
    return win;
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    throw error;
  }
}

function trackActiveWindow(win) {
  lastActiveWindow = win;
  win.on('focus', () => {
    lastActiveWindow = win;
    // Keep the clicked chat window above its sibling chat windows without
    // leaving it permanently always-on-top.
    if (!win.isDestroyed()) win.moveTop();
  });
  win.on('closed', () => {
    if (lastActiveWindow === win) lastActiveWindow = null;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    ...getInitialWindowBounds(),
    minWidth: 860,
    minHeight: 600,
    title: APP_TITLE,
    frame: false,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;
  trackActiveWindow(win);
  attachRendererDiagnostics(win, { log, label: 'main' });

  for (const eventName of ['move', 'resize', 'maximize', 'unmaximize', 'restore']) {
    win.on(eventName, scheduleLockedAssistantSync);
  }
  win.on('minimize', () => {
    if (assistantCompanionLocked && assistantCompanionWindow && !assistantCompanionWindow.isDestroyed()) {
      assistantCompanionWindow.minimize();
    }
    for (const [, chat] of getLockedChatWindows()) chat.minimize();
  });
  win.on('restore', () => {
    if (assistantCompanionLocked && assistantCompanionWindow && !assistantCompanionWindow.isDestroyed()) {
      assistantCompanionWindow.restore();
    }
    for (const [, chat] of getLockedChatWindows()) chat.restore();
    scheduleLockedAssistantSync();
  });

  revealWindowAfterLoad(win, {
    log,
    label: 'main',
    onReveal() {
      bringToFront(win);
      createAssistantCompanion(win).catch((error) => {
        log.error('Failed to create assistant companion window:', error);
      });
    },
  });
  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (assistantCompanionLocked && assistantCompanionWindow && !assistantCompanionWindow.isDestroyed()) {
      assistantCompanionWindow.hide();
    }
    for (const [, chat] of getLockedChatWindows()) chat.hide();
    win.hide();
  });

  if (!app.isPackaged) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  if (!ipcHandlersRegistered) {
    ipcHandlersRegistered = true;
  const reportIpcResult = async (operation, input, result) => {
    if (result?.ok !== false) return result;
    await operationDiagnostics.record({
      scope: 'ipc', operation, taskId: input?.taskId, teamId: input?.teamId,
      message: result.error || `${operation} failed`, context: { input },
    });
    return result;
  };

  registerWindowIpc({
    ipcMain,
    BrowserWindow,
    chatWindows,
    toolWindowPayloads,
    lockedChatWindowKeys,
    normalizeChatOptions,
    getMainWindow: () => mainWindow,
    getAssistantCompanionWindow: () => assistantCompanionWindow,
    isAssistantCompanionLocked: () => assistantCompanionLocked,
      setAssistantCompanionLocked: (locked) => {
        assistantCompanionLocked = locked === true;
        applyAssistantCompanionLayer();
      },
    saveWindowLockPreferences: saveAssistantCompanionLockPreference,
    createAssistantCompanion,
    syncLockedAssistantCompanion,
    syncLockedChatWindows,
    focusChatWindow,
    getRootOwner,
    getChatWindowBounds,
    createChatWindow: createChatBrowserWindow,
    trackActiveWindow,
    attachRendererDiagnostics,
    revealWindowAfterLoad,
    bringToFront,
    loadRenderer: loadRendererWindow,
    createSettingsWindow,
    getSettingsWindow: () => settingsWindow,
    createToolWindow,
    log,
  });

  // ===== 命令执行 IPC（handle 模式，支持 async/await）=====
  // 命令在自主代理工作区（WORKSPACE）内执行，便于写码-构建-运行闭环
  ipcMain.handle('skills:list', async () => {
    try { return { ok: true, skills: await listSkills(path.resolve(__dirname, '..')) }; }
    catch (e) { return { ok: false, skills: [], error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('skills:read', async (_event, id) => {
    try {
      if (typeof id !== 'string') throw new Error('无效技能 ID');
      return { ok: true, skill: await readSkill(path.resolve(__dirname, '..'), id) };
    } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('skills:delete', async (_event, id) => {
    try { return await deleteSkill(path.resolve(__dirname, '..'), id); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('skills:install', async (_event, input) => {
    try { return await installSkill(path.resolve(__dirname, '..'), input, { fetchImpl: (url, options) => net.fetch(url, options) }); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('skills:searchMarket', async (_event, query) => {
    try { return await searchSkillHub(String(query || ''), (url, options) => net.fetch(url, options)); }
    catch (e) { return { ok: false, results: [], error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('skills:inspectSource', async (_event, sourceUrl) => {
    try { return { ok: true, inspection: await inspectSkillSource(sourceUrl, { fetchImpl: (url, options) => net.fetch(url, options) }) }; }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('skills:repair', async (_event, id) => {
    try { return await repairSkill(path.resolve(__dirname, '..'), id); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('skills:runtime', async () => {
    try { return { ok: true, manifest: await skillRuntime.refresh('ipc') }; }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('skills:runtimeHealth', async () => {
    try { return { ok: true, ...(await skillRuntime.health()) }; }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('skills:runtimeInspect', async (_event, id) => {
    try { return await skillRuntime.inspect(id); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('skills:runtimeInvocation', async (_event, input) => {
    try { return { ok: true, evidence: await skillRuntime.recordInvocation(input) }; }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('skills:runtimeInstall', async (_event, input) => {
    try { return await skillRuntime.install(input); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('skills:runtimeRepair', async (_event, id) => {
    try { return await skillRuntime.repair(id); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('credentials:save', async (_event, input) => {
    try { return await credentialVault.save(input?.credentialRef, input?.credentials); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('credentials:read', async (_event, credentialRef) => {
    try { return { ok: true, credentials: await credentialVault.read(credentialRef) }; }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('credentials:status', async (_event, credentialRef) => {
    try { return await credentialVault.status(credentialRef); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('credentials:delete', async (_event, credentialRef) => {
    try { return await credentialVault.remove(credentialRef); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('sys:openExternal', async (_event, rawUrl) => {
    try {
      const url = new URL(typeof rawUrl === 'string' ? rawUrl : '');
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('仅允许打开 HTTP/HTTPS 链接');
      await shell.openExternal(url.toString());
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });

  // ===== 连接器 API 调用（主进程代理 HTTP 请求，避免渲染进程 CORS）=====
  ipcMain.handle('connector:call', async (_event, opts) => {
    const { url, method, headers, body, timeout } = opts;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout ?? 15000);
      const res = await fetch(url, {
        method: method ?? 'GET',
        headers: headers ?? { 'Content-Type': 'application/json' },
        body: body ?? undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const text = await res.text();
      return { ok: true, status: res.status, data: text };
    } catch (e) {
      return { ok: false, status: 0, data: '', error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('knowledge:pickObsidian', async () => {
    const result = await dialog.showOpenDialog({ title: '选择 Obsidian Vault', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    try { return await testObsidianVault(result.filePaths[0]); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('knowledge:testObsidian', async (_event, root) => {
    try { return await testObsidianVault(root); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('knowledge:searchObsidian', async (_event, input) => {
    try { return await searchObsidianVault(input?.root, input?.query); }
    catch (e) { return { ok: false, error: String(e?.message ?? e), results: [] }; }
  });
  ipcMain.handle('knowledge:readObsidian', async (_event, input) => {
    try { return await readObsidianNote(input?.root, input?.path); }
    catch (e) { return { ok: false, error: String(e?.message ?? e) }; }
  });
  ipcMain.handle('knowledge:fetchUrl', async (_event, url) => {
    try { return await acquireWebResource(url); }
    catch (e) {
      log.warn('[knowledge] page fetch failed:', String(e?.message ?? e));
      return { ok: false, error: String(e?.message ?? e) };
    }
  });
  ipcMain.handle('task-store:read', async () => taskRuntimeStore.read());
  ipcMain.handle('task-store:query', async (_event, options) => taskRuntimeStore.read(options));
  ipcMain.handle('task-store:write', async (_event, runs, metadata) => reportIpcResult('task-store-write', metadata, await taskRuntimeStore.write(runs, metadata)));
  ipcMain.handle('diagnostics:record', async (_event, input) => operationDiagnostics.record({ ...input, scope: input?.scope || 'renderer' }));
  ipcMain.handle('diagnostics:query', async (_event, options) => operationDiagnostics.query(options));
  ipcMain.handle('diagnostics:summary', async (_event, options) => operationDiagnostics.summary(options));
  ipcMain.handle('diagnostics:export', async (_event, options) => {
    const result = await dialog.showSaveDialog({
      title: '导出错误诊断日志',
      defaultPath: `taiji-diagnostics-${Date.now()}.json`,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    const payload = await operationDiagnostics.exportData(options);
    await fsp.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, path: result.filePath, count: payload.diagnostics.length };
  });
  ipcMain.handle('telemetry:query', async (_event, options) => telemetryLedger.query(options));
  ipcMain.handle('telemetry:summary', async (_event, options) => telemetryLedger.summary(options));
  ipcMain.handle('telemetry:export', async (_event, options) => {
    try {
      const result = await dialog.showSaveDialog({
        title: '导出运行问题包',
        defaultPath: `taiji-runtime-report-${Date.now()}.json`,
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { ok: true, canceled: true };
      const [telemetry, tasks, diagnostics] = await Promise.all([
        telemetryLedger.exportData(options), taskRuntimeStore.read({ taskId: options?.taskId, projectId: options?.projectId, limit: 200 }), operationDiagnostics.exportData({ taskId: options?.taskId }),
      ]);
      const payload = {
        format: 'taiji-runtime-problem-package/v1', exportedAt: Date.now(), appVersion: APP_VERSION,
        filters: options || {}, telemetry, taskSnapshot: { runs: tasks.runs || [], events: tasks.events || [], integrity: tasks.integrity }, diagnostics,
        notice: '已脱敏：不包含模型隐藏推理、密钥、访问令牌或附件正文。',
      };
      await fsp.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
      return { ok: true, path: result.filePath, count: telemetry.events.length };
    } catch (error) {
      await operationDiagnostics.record({ scope: 'ipc', operation: 'telemetry-export', message: error?.message || String(error), error });
      return { ok: false, error: error?.message || String(error) };
    }
  });
  registerAutonomyEvaluationIpc(reportIpcResult);
  ipcMain.handle('task-ledger:read', async (_event, options) => taskRuntimeStore.read(options));
  ipcMain.handle('task-ledger:audit', async (_event, options) => taskRuntimeStore.audit(options));
  ipcMain.handle('task-recovery:create', async (_event, options) => taskRuntimeStore.createRecoveryPoint(options));
  ipcMain.handle('task-recovery:list', async (_event, options) => taskRuntimeStore.listRecoveryPoints(options));
  ipcMain.handle('task-recovery:rebuild', async (_event, options) => taskRuntimeStore.rebuild(options));
  ipcMain.handle('task-recovery:restore', async (_event, input) => taskRuntimeStore.restoreRecoveryPoint(input?.recoveryPointId, input?.metadata));
  registerTaskServiceIpc(ipcMain, taskService);
  ipcMain.handle('task-worker:command', async (_event, command) => {
    if (command?.type === 'resume') {
      try {
        await taskService.repairDelegationCollisions(command?.taskId);
        const recovery = await taskService.recoveryPlan(command?.taskId);
        if (!recovery.plan?.ready) {
          await operationDiagnostics.record({
            scope: 'ipc', operation: 'task-worker-resume-preflight', taskId: command?.taskId,
            message: recovery.plan?.nextAction || 'Task cannot resume yet',
            context: { recoveryPlan: recovery.plan },
          });
          return {
            ok: false,
            error: recovery.plan?.nextAction || '任务当前不满足继续条件',
            recoveryPlan: recovery.plan,
          };
        }
      } catch (error) {
        await operationDiagnostics.record({ scope: 'ipc', operation: 'task-worker-resume-preflight', taskId: command?.taskId, message: error?.message ?? String(error), error });
        return { ok: false, error: error?.message ?? String(error) };
      }
    }
    try {
      const result = await taskWorker.dispatch(command);
      await nativeExecutionAdapter.handleControl(command, result);
      return reportIpcResult('task-worker-command', command, result);
    } catch (error) {
      return reportIpcResult('task-worker-command', command, { ok: false, error: error?.message ?? String(error) });
    }
  });
  ipcMain.handle('skills:drafts', async () => {
    try { return { ok: true, drafts: await listSkillDrafts() }; } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('skills:lifecycle', async (_event, input) => {
    try { return await skillLifecycle.list(input || {}); } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('skills:rollbackAuto', async (_event, input) => {
    try { return await skillLifecycle.rollback(input?.skillName || input?.skillId); } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('skills:reviewDraft', async (_event, input) => {
    try {
      const result = await reviewSkillDraft(PROJECT_ROOT, input?.draftId, input?.decision, input?.note);
      const lifecycle = await skillLifecycle.reviewDraft(result.draft, input?.decision, result);
      await skillRuntime.refresh(input?.decision === 'approve' ? 'auto-skill-approved' : 'auto-skill-rejected');
      return { ...result, lifecycle };
    } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('task-worker:status', async () => taskWorker.status());
  ipcMain.handle('task-worker:commands', async (_event, options) => taskWorker.readCommands(options));
  ipcMain.handle('task-execution:start', async (_event, input) => reportIpcResult('task-execution-start', input, await nativeExecutionAdapter.start(input)));
  ipcMain.handle('task-execution:status', async (_event, taskId) => nativeExecutionAdapter.status(taskId));
  ipcMain.handle('task-execution:events', async (_event, input) => nativeExecutionAdapter.events(input?.taskId, input?.afterSequence));
  ipcMain.handle('task-execution:observability', async (_event, taskId) => nativeExecutionAdapter.observability(taskId));
  ipcMain.handle('task-execution:steer', async (_event, input) => reportIpcResult('task-execution-steer', input, await nativeExecutionAdapter.steer(input?.taskId, input?.message)));
  ipcMain.handle('task-execution:decide-approval', async (_event, input) => reportIpcResult('task-execution-decide-approval', input, await nativeExecutionAdapter.decideApproval(input?.taskId, input?.approvalId, input?.decision, input?.note)));
  ipcMain.handle('task-execution:sync-members', async (_event, input) => reportIpcResult('task-execution-sync-members', input, await nativeExecutionAdapter.syncMembers(input?.taskId, input)));
  ipcMain.handle('memory:list', async (_event, input) => memoryManager.list(input));
  ipcMain.handle('memory:context', async (_event, input) => memoryManager.context(input));
  ipcMain.handle('memory:upsert', async (_event, input) => {
    try { return await memoryManager.upsert(input, { replaceExact: input?.replaceExact }); } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('memory:propose', async (_event, input) => {
    try { return await memoryManager.propose(input); } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('memory:remove', async (_event, input) => memoryManager.remove(input?.entryId, { reason: input?.reason }));
  ipcMain.handle('memory:rollback', async (_event, input) => {
    try { return await memoryManager.rollback(input?.entryId, { reason: input?.reason, source: '用户在记忆中心恢复历史版本' }); } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('memory:reviewProposal', async (_event, input) => {
    try { return await memoryManager.reviewProposal(input?.proposalId, input?.decision, { reviewedBy: 'user', note: input?.note }); } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('memory:importLegacy', async (_event, input) => {
    try { return await memoryManager.importLegacy(input); } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('learning-review:status', async (_event, input) => learningReviewQueue.status(input));
  ipcMain.handle('learning-review:process', async (_event, input) => learningReviewQueue.process(input));
  ipcMain.handle('learning-review:retry', async (_event, input) => learningReviewQueue.retry(input?.itemId, input));
  ipcMain.handle('task-delegation:create', async (_event, input) => nativeExecutionAdapter.delegate(input?.taskId, input));
  ipcMain.handle('task-delegation:status', async (_event, taskId) => nativeExecutionAdapter.delegationStatus(taskId));
  ipcMain.handle('worktree:inspect', async (_event, sourceRepo) => worktreeManager.inspectRepository(sourceRepo));
  ipcMain.handle('worktree:create', async (_event, input) => worktreeManager.create(input));
  ipcMain.handle('worktree:status', async (_event, taskId) => worktreeManager.status(taskId));
  ipcMain.handle('worktree:checkpoint', async (_event, input) => worktreeManager.checkpoint(input?.taskId, input));
  ipcMain.handle('worktree:recover', async (_event, taskId) => worktreeManager.recover(taskId));
  ipcMain.handle('worktree:release', async (_event, taskId) => worktreeManager.release(taskId));
  ipcMain.handle('worktree:health', async () => worktreeManager.health());
  ipcMain.handle('coding:prepare', async (_event, input) => {
    try { return await codingRuntime.prepareTask(input); } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('coding:index', async (_event, input) => {
    try { return { ok: true, index: await codingRuntime.indexWorkspace(input) }; } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('coding:search', async (_event, input) => {
    try { return await codingRuntime.search(input); } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('coding:dependencies', async (_event, input) => {
    try { return await codingRuntime.dependencies(input); } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('coding:diff', async (_event, input) => {
    try { return await codingRuntime.diff(input); } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('coding:checkpoint', async (_event, input) => {
    try { return await codingRuntime.checkpoint(input); } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('coding:start-command', async (_event, input) => {
    try { return codingRuntime.startCommand(input); } catch (error) { return { ok: false, error: error?.message ?? String(error) }; }
  });
  ipcMain.handle('coding:command-status', async (_event, input) => codingRuntime.commandStatus(input?.sessionId, input?.after));
  ipcMain.handle('system:ecosystemHealth', async (_event, input) => ecosystemHealth.run(input));

  ipcMain.handle('connector:verifyPreset', async (_event, input) => {
    const result = await verifyConnectorAdapter(input, { fetchImpl: (url, options) => net.fetch(url, options) });
    log.info(`[connectorAdapter] adapter=${result.adapter ?? input?.adapter ?? 'unknown'} stage=${result.stage} ok=${result.ok} attempts=${result.attempts ?? 0} latencyMs=${result.latencyMs ?? 0} http=${result.httpStatus ?? 0}`);
    return result;
  });
  ipcMain.handle('connector:invokePreset', async (_event, input) => {
    const result = await invokeConnectorAdapter(input, { fetchImpl: (url, options) => net.fetch(url, options) });
    log.info(`[connectorAdapter] adapter=${result.adapter ?? input?.adapter ?? 'unknown'} action=${result.action ?? input?.action ?? 'unknown'} stage=${result.stage} ok=${result.ok} attempts=${result.attempts ?? 0} latencyMs=${result.latencyMs ?? 0} http=${result.httpStatus ?? 0}`);
    return result;
  });
  ipcMain.handle('knowledge:searchWeb', async (_event, query) => {
    const startedAt = Date.now();
    try {
      const result = await searchWeb(query, {
        fetchImpl: (url, options) => net.fetch(url, options),
        onAttempt(event) {
          if (event.state === 'failed') log.warn(`[webSearch] provider=${event.provider} attempt=${event.attempt} failed: ${event.error}`);
        },
      });
      log.info(`[webSearch] provider=${result.provider} attempts=${result.attempts} results=${result.results.length} durationMs=${result.durationMs}`);
      return result;
    } catch (e) {
      const error = String(e?.message ?? e);
      log.warn(`[webSearch] all providers failed durationMs=${Date.now() - startedAt}: ${error}`);
      return { ok: false, error, results: [] };
    }
  });

  ipcMain.handle('exec:command', async (_event, payload) => executeWorkspaceCommand(payload));
  ipcMain.handle('web-artifact:verify', async (_event, input) => {
    try { return await verifyWebArtifact(input); } catch (error) { return { ok: false, error: error?.message ?? String(error), viewports: [] }; }
  });

  // ===== 文件系统 IPC（自主代理工作区，沙箱到 WORKSPACE）=====
  ipcMain.handle('fs:getWorkspace', async () => WORKSPACE);

  ipcMain.handle('fs:write', async (_event, { filePath, content }) => {
    try {
      const target = safeJoin(filePath || '');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, content ?? '', 'utf8');
      const stat = await fsp.stat(target);
      return { ok: true, path: target, size: stat.size };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('fs:writeDocument', async (_event, { filePath, content }) => {
    try {
      const target = safeJoin(filePath || 'document.docx');
      if (path.extname(target).toLowerCase() !== '.docx') throw new Error('当前文档生成接口只支持 .docx');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const verified = await createVerifiedWordDocument(target, content);
      return { ok: true, path: target, size: verified.size, validated: true, extractedChars: verified.extractedChars };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('fs:writeData', async (_event, { filePath, dataUrl }) => {
    try {
      const target = safeJoin(filePath || '');
      const match = typeof dataUrl === 'string' ? dataUrl.match(/^data:[^;]*;base64,(.+)$/s) : null;
      if (!match) throw new Error('附件不是有效的 base64 数据');
      const buffer = Buffer.from(match[1], 'base64');
      if (buffer.length > 50 * 1024 * 1024) throw new Error('单个附件不能超过 50MB');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, buffer);
      return { ok: true, path: target, size: buffer.length };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('fs:read', async (_event, { filePath }) => {
    try {
      const target = safeJoin(filePath || '');
      return await readWorkspaceFile(target);
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('fs:mkdir', async (_event, { dirPath }) => {
    try {
      const target = safeJoin(dirPath || '');
      await fsp.mkdir(target, { recursive: true });
      return { ok: true, path: target };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('fs:initWorkspace', async (_event, { workspaceId, metadata } = {}) => {
    try {
      if (typeof workspaceId !== 'string' || !workspaceId.trim()) throw new Error('工作区标识不能为空');
      const target = safeJoin(workspaceId);
      await fsp.mkdir(target, { recursive: true });
      const manifestPath = path.join(target, '.taiji-workspace.json');
      let previous = {};
      try { previous = JSON.parse(await fsp.readFile(manifestPath, 'utf8')); } catch {}
      const manifest = {
        ...previous,
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        workspaceId,
        createdAt: previous.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      return { ok: true, path: target };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('fs:copyIntoWorkspace', async (_event, { sourceScope, targetWorkspaceId, entries } = {}) => {
    try {
      if (typeof sourceScope !== 'string' || !sourceScope.trim()) throw new Error('附件来源工作区不能为空');
      if (typeof targetWorkspaceId !== 'string' || !targetWorkspaceId.trim()) throw new Error('目标任务工作区不能为空');
      if (!Array.isArray(entries) || entries.length > 40) throw new Error('附件清单无效或数量超过 40 个');
      const sourceRoot = safeJoin(sourceScope);
      const targetRoot = safeJoin(targetWorkspaceId);
      await fsp.mkdir(targetRoot, { recursive: true });
      let copied = 0;
      const errors = [];
      for (const entry of entries) {
        try {
          const sourcePath = typeof entry?.sourcePath === 'string' ? entry.sourcePath : '';
          const targetPath = typeof entry?.targetPath === 'string' && entry.targetPath.trim() ? entry.targetPath : sourcePath;
          if (!sourcePath || sourcePath.includes('\0') || targetPath.includes('\0')) throw new Error('附件路径无效');
          const source = path.resolve(sourceRoot, sourcePath);
          const target = path.resolve(targetRoot, targetPath);
          const sourceRel = path.relative(sourceRoot, source);
          const targetRel = path.relative(targetRoot, target);
          if (sourceRel.startsWith('..') || path.isAbsolute(sourceRel) || targetRel.startsWith('..') || path.isAbsolute(targetRel)) {
            throw new Error('附件路径越界');
          }
          const stat = await fsp.stat(source);
          if (!stat.isFile()) throw new Error('来源不是文件');
          if (stat.size > MAX_READABLE_FILE_BYTES) throw new Error('附件超过 50MB');
          await fsp.mkdir(path.dirname(target), { recursive: true });
          await fsp.copyFile(source, target);
          copied += 1;
        } catch (error) {
          errors.push(String(error?.message ?? error));
        }
      }
      return { ok: errors.length === 0, copied, errors };
    } catch (e) {
      return { ok: false, copied: 0, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle('fs:list', async (_event, { dirPath, recursive } = {}) => {
    try {
      const root = safeJoin(dirPath || '');
      const out = [];
      const walk = async (dir, prefix) => {
        let entries;
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const ent of entries) {
          if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
          const full = path.join(dir, ent.name);
          const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
          if (ent.isDirectory()) {
            out.push({ name: rel, type: 'dir', size: 0 });
            if (recursive) await walk(full, rel);
          } else {
            let size = 0;
            let modifiedAt = 0;
            try {
              const stat = await fsp.stat(full);
              size = stat.size;
              modifiedAt = stat.mtimeMs;
            } catch {}
            out.push({ name: rel, type: 'file', size, modifiedAt });
          }
        }
      };
      await walk(root, '');
      out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
      return { ok: true, path: root, items: out };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e), items: [] };
    }
  });

  // ===== 在文件管理器中打开路径（如工作区目录）=====
  ipcMain.handle('sys:openPath', async (_event, p) => {
    try {
      if (typeof p !== 'string' || !p.trim()) throw new Error('路径不能为空');
      const target = path.resolve(p);
      const rel = path.relative(WORKSPACE, target);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error('路径越界：不允许打开工作区以外的路径');
      }
      const realWorkspace = await fsp.realpath(WORKSPACE);
      const realTarget = await fsp.realpath(target);
      const realRel = path.relative(realWorkspace, realTarget);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw new Error('路径越界：不允许打开工作区以外的路径');
      }
      const error = await shell.openPath(realTarget);
      if (error) return { ok: false, error };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  // ===== 导出工作区为 zip（方便交付，仅 Windows 打包目标可用）=====
  ipcMain.handle('fs:exportZip', async () => {
    try {
      const outPath = path.join(app.getPath('userData'), `workspace-export-${Date.now()}.zip`);
      try { fs.unlinkSync(outPath); } catch {}
      // 单引号在 PowerShell 中为字面量，路径中的反斜杠/中文均安全
      const script = `Compress-Archive -Path '${WORKSPACE}' -DestinationPath '${outPath}' -Force`;
      await new Promise((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
          (err, _stdout, stderr) => {
            if (err) reject(new Error((stderr || err.message || '').toString()));
            else resolve(undefined);
          });
      });
      return { ok: true, path: outPath };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  // ===== 自动更新（仅打包后生效）=====
  initAutoUpdater(win, { runtimeHealthProvider: () => ecosystemHealth.run({ mode: 'runtime' }) });
  }

  // 主窗口关闭时，关闭所有原生聊天子窗口
  win.on('closed', () => {
    mainWindow = null;
    for (const child of [...chatWindows.values()]) {
      try { child.close(); } catch {}
    }
    chatWindows.clear();
    assistantCompanionWindow = null;
  });

}

// Isolated verification must not collide with an installed production client.
const hasSingleInstanceLock = process.env.TAIJI_TEST_USER_DATA ? true : app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    try { await taskWorker.start(); }
    catch (error) { log.error('[taskWorker] startup failed:', String(error?.message ?? error)); }
    try { await ensureAutonomyCaptureLoop(); }
    catch (error) { log.error('[autonomyEvaluation] live capture resume failed:', String(error?.message ?? error)); }
    createTray();
    createWindow();
    app.on('activate', () => {
      if (!mainWindow || mainWindow.isDestroyed()) createWindow();
      else showMainWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (isQuitting && process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  stopAutonomyCaptureLoop();
  nativeExecutionAdapter.stopAll();
  taskWorker.stop();
});
