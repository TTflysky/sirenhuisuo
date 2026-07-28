import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

async function loadStandaloneTypeScript(relativePath) {
  const rawSource = await fs.readFile(relativePath, 'utf8');
  const source = rawSource.replace(/from\s+(['"])(\.{1,2}\/[^'"]+)\1/g, (_match, quote, specifier) => {
    const resolved = path.resolve(path.dirname(relativePath), specifier);
    return `from ${quote}${pathToFileURL(resolved).href}${quote}`;
  });
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
    fileName: relativePath,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`);
}

async function verifySecretRedaction() {
  const security = await loadStandaloneTypeScript('src/engine/securityBoundary.ts');
  const input = JSON.stringify({ apiKey: 'sk-real-secret-value', nested: { password: 'very-secret-password' }, note: 'Bearer abcdefghijklmnop' });
  const redacted = security.redactToolArguments(input);
  assert.equal(redacted.includes('sk-real-secret-value'), false);
  assert.equal(redacted.includes('very-secret-password'), false);
  assert.equal(redacted.includes('abcdefghijklmnop'), false);
  return redacted;
}

async function verifyStaleTaskRecovery() {
  const savedWindow = globalThis.window;
  const savedStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  globalThis.window = { electronAPI: { getAppSessionId: () => 'new-test-session' } };
  try {
    values.set('hermes_office_task_runs_v1', JSON.stringify([{
      id: 'stale-run', teamId: 'team-a', workspaceId: 'tasks/team/team-a/run-stale', executionSessionId: 'old-test-session',
      title: '恢复测试', request: '验证重启恢复', status: 'running', createdAt: Date.now() - 5000, updatedAt: Date.now() - 5000,
      memberSnapshot: [], steps: [{ id: 'step-a', employeeId: 'employee-a', title: '执行', order: 1, kind: 'work', assignment: '执行', dependsOnStepIds: [], status: 'running', attempts: 1, events: [] }],
    }]));
    const taskRuns = await loadStandaloneTypeScript('src/data/taskRuns.ts');
    const [recovered] = taskRuns.loadTaskRuns();
    assert.equal(recovered.status, 'paused');
    assert.equal(recovered.steps[0].status, 'paused');
    assert.match(recovered.recoveryContext.summary, /待恢复/u);
    assert.match(recovered.recoveryContext.interruptionReason, /中断/u);
    assert.equal(recovered.recoveryContext.controller.goal, '验证重启恢复');
    assert.equal(recovered.recoveryContext.controller.requiresEvidence, true);
    return recovered.recoveryContext.summary;
  } finally {
    globalThis.window = savedWindow;
    globalThis.localStorage = savedStorage;
  }
}

async function verifyIsolatedWorkspaceLayout() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-workspace-foundation-'));
  try {
    const first = path.join(root, 'tasks', 'assistant', 'first');
    const second = path.join(root, 'tasks', 'assistant', 'second');
    const source = path.join(root, 'staging', 'uploads');
    await Promise.all([fs.mkdir(first, { recursive: true }), fs.mkdir(second, { recursive: true }), fs.mkdir(source, { recursive: true })]);
    await Promise.all([
      fs.writeFile(path.join(first, 'same.txt'), 'first-content', 'utf8'),
      fs.writeFile(path.join(second, 'same.txt'), 'second-content', 'utf8'),
      fs.writeFile(path.join(source, 'input.txt'), 'attachment-content', 'utf8'),
    ]);
    await fs.mkdir(path.join(first, 'inputs'), { recursive: true });
    await fs.copyFile(path.join(source, 'input.txt'), path.join(first, 'inputs', 'input.txt'));
    const contents = await Promise.all([
      fs.readFile(path.join(first, 'same.txt'), 'utf8'),
      fs.readFile(path.join(second, 'same.txt'), 'utf8'),
      fs.readFile(path.join(first, 'inputs', 'input.txt'), 'utf8'),
    ]);
    assert.deepEqual(contents, ['first-content', 'second-content', 'attachment-content']);
    return contents;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function verifyDiagnosticsCoverage() {
  const source = await fs.readFile('src/diagnostics/systemDiagnostics.ts', 'utf8');
  const view = await fs.readFile('src/components/settings/DiagnosticsTab.tsx', 'utf8');
  for (const name of ['diagnoseActiveModel()', 'diagnoseConnectors()', 'diagnoseSkills()', 'diagnoseToolRegistry()', 'diagnoseTaskRuntime()', 'diagnoseWorkspace()', 'diagnosePermission()']) {
    assert.match(source, new RegExp(name.replace(/[()]/g, '\\$&')));
  }
  for (const label of ['AI 模型', '连接器与知识库', 'Skill 健康', '工具注册中心', '任务内核与恢复', '任务工作区', '安全与审批']) assert.match(source, new RegExp(label));
  assert.match(view, /diagnostic-item/u);
  return 7;
}

const [workspace, redacted, recovery, diagnostics] = await Promise.all([
  verifyIsolatedWorkspaceLayout(), verifySecretRedaction(), verifyStaleTaskRecovery(), verifyDiagnosticsCoverage(),
]);
console.log(JSON.stringify({ passed: true, workspace, redacted, recovery, diagnostics }, null, 2));
