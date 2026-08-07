const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SCENARIO_CATALOG, createAutonomyEvaluation } = require('../electron/autonomyEvaluation.cjs');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-v58-autonomy-'));
  try {
    assert.equal(SCENARIO_CATALOG.length, 24, 'V5.8 必须维护 24 个可回放标准场景');
    assert.equal(new Set(SCENARIO_CATALOG.map((item) => item.id)).size, 24, '场景 ID 必须稳定且唯一');
    const evaluation = createAutonomyEvaluation(root);
    const started = await evaluation.start({ label: 'V5.8 自动回放基线', mode: 'automated', operator: 'verification', targetMinutes: 20 });
    assert.equal(started.ok, true);
    assert.equal(started.reused, false);
    const baseline = Date.now();

    for (const [index, scenario] of SCENARIO_CATALOG.entries()) {
      const metrics = scenario.id === 'unnecessary-tool-avoidance' ? { unnecessaryToolCalls: 1, toolCalls: 10 }
        : scenario.id === 'large-roster-residency' ? { residencyMinutes: 12, windowCount: 12, employeeCount: 320 }
          : undefined;
      const result = await evaluation.record({
        scenarioId: scenario.id,
        status: 'passed',
        source: 'v58-replay',
        sourceRef: `catalog:${scenario.id}`,
        evidenceIds: [`evidence:${scenario.id}`],
        note: `${scenario.title} 已通过可回放基线。`,
        metrics,
        observedAt: baseline + index,
      });
      assert.equal(result.ok, true);
      assert.equal(result.added, true);
    }

    const snapshot = {
      taskRuns: [
        { id: 'task-completed', projectId: 'project-a', status: 'completed', updatedAt: baseline + 100, evidence: [{ id: 'evidence-complete' }], toolAttempts: [{}, {}] },
        { id: 'task-recovered', projectId: 'project-a', status: 'completed', updatedAt: baseline + 110, evidence: [{ id: 'evidence-recovered' }], recoveryContext: { autoResume: true }, residencyCheckpoint: { checkpointSequence: 4 } },
        { id: 'task-failed', projectId: 'project-b', status: 'failed', updatedAt: baseline + 120, verification: [{ label: '验收失败', status: 'failed' }] },
      ],
      memoryRetrievals: [
        { retrievalId: 'memory-good', projectId: 'project-a', taskId: 'task-completed', createdAt: baseline + 130, references: [{ memoryId: 'memory-a', scope: 'project', scopeId: 'project-a' }] },
        { retrievalId: 'memory-cross-project', projectId: 'project-a', taskId: 'task-completed', createdAt: baseline + 140, references: [{ memoryId: 'memory-b', scope: 'project', scopeId: 'project-b' }] },
      ],
      skillRollouts: [
        { rolloutId: 'rollout-active', skillName: 'verified-report', status: 'active', invocations: [
          { invocationId: 'skill-success', taskId: 'task-completed', status: 'succeeded', occurredAt: baseline + 150 },
          { invocationId: 'skill-failed', taskId: 'task-failed', status: 'failed', failureClass: 'validation', occurredAt: baseline + 151 },
        ] },
        { rolloutId: 'rollout-disabled', skillName: 'verified-report', status: 'disabled', disabledAt: baseline + 160, disableReason: '灰度失败达到阈值', invocations: [] },
        { rolloutId: 'rollout-rollback', skillName: 'verified-report', status: 'rolled_back', rolledBackAt: baseline + 170, invocations: [] },
      ],
    };
    const captured = await evaluation.capture(snapshot);
    assert.equal(captured.ok, true);
    assert.ok(captured.captured >= 9, '运行时快照必须写入任务、记忆与 Skill 证据');
    const duplicate = await evaluation.capture(snapshot);
    assert.equal(duplicate.captured, 0, '同一运行时证据不得重复计数');

    const summary = await evaluation.summary();
    assert.equal(summary.coverage.total, 24);
    assert.equal(summary.coverage.observed, 24);
    assert.ok(summary.coverage.failed >= 1, '跨项目污染和失败样本必须真实出现在报告中');
    assert.equal(summary.metrics.completionRate.numerator, 2);
    assert.equal(summary.metrics.completionRate.denominator, 3);
    assert.equal(summary.metrics.recoveryRate.numerator, 1);
    assert.equal(summary.metrics.recoveryRate.denominator, 1);
    assert.equal(summary.metrics.memoryHitCorrectness.numerator, 1);
    assert.equal(summary.metrics.memoryHitCorrectness.denominator, 2);
    assert.equal(summary.metrics.crossProjectContaminationRate.numerator, 1);
    assert.equal(summary.metrics.crossProjectContaminationRate.denominator, 2);
    assert.equal(summary.metrics.skillReuseSuccessRate.numerator, 1);
    assert.equal(summary.metrics.skillReuseSuccessRate.denominator, 2);
    assert.equal(summary.metrics.unnecessaryToolCalls.total, 1);
    assert.equal(summary.metrics.residency.maxWindows, 12);
    assert.equal(summary.metrics.residency.maxEmployees, 320);

    const completed = await evaluation.complete(started.session.sessionId);
    assert.equal(completed.ok, true);
    assert.equal(completed.summary.activeSession, undefined);
    const exported = await evaluation.exportData();
    assert.equal(exported.format, 'taiji-autonomy-evaluation/v1');
    assert.equal(exported.catalog.length, 24);
    assert.ok(exported.observations.length >= 33);

    const reloaded = createAutonomyEvaluation(root);
    const afterRestart = await reloaded.summary();
    assert.equal(afterRestart.latestSession.status, 'completed');
    assert.equal(afterRestart.coverage.total, 24);

    let liveClock = 50_000;
    const liveRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-v58-live-'));
    const live = createAutonomyEvaluation(liveRoot, { now: () => liveClock });
    const liveStarted = await live.start({ label: '真实陪跑边界', mode: 'live' });
    liveClock += 100;
    await live.capture({
      taskRuns: [
        { id: 'before-live-session', projectId: 'old-project', status: 'completed', updatedAt: liveStarted.session.startedAt - 1, evidence: [{ id: 'old-evidence' }] },
        { id: 'during-live-session', projectId: 'new-project', status: 'completed', updatedAt: liveClock, evidence: [{ id: 'new-evidence' }], toolAttempts: [{}] },
      ],
    });
    const liveSummary = await live.summary();
    assert.equal(liveSummary.coverage.observed, 1, '真实陪跑不得采纳启动前的历史任务');
    assert.equal(liveSummary.metrics.completionRate.denominator, 1, '真实陪跑指标只能使用本轮证据');
    assert.equal(liveSummary.activeSession.lastCaptureAt, liveClock, '空闲页面之外的后台采集必须留下心跳时间');
    const baselineRun = await live.complete(liveStarted.session.sessionId);
    assert.equal(baselineRun.ok, true);
    const automated = await live.runBaseline({ label: '一键 24 项验收' });
    assert.equal(automated.ok, true);
    assert.equal(automated.summary.selectedSession.mode, 'automated');
    assert.equal(automated.summary.coverage.observed, 24, '内置自动验收必须覆盖全部标准场景');
    assert.equal(automated.summary.coverage.passed, 24, '内置自动验收必须清晰完成全部场景');
    await fs.rm(liveRoot, { recursive: true, force: true });

    const repoRoot = path.resolve(__dirname, '..');
    const [mainSource, preloadSource, uiSource, personaSource] = await Promise.all([
      fs.readFile(path.join(repoRoot, 'electron', 'main.cjs'), 'utf8'),
      fs.readFile(path.join(repoRoot, 'electron', 'preload.cjs'), 'utf8'),
      fs.readFile(path.join(repoRoot, 'src', 'components', 'settings', 'DiagnosticsTab.tsx'), 'utf8'),
      fs.readFile(path.join(repoRoot, 'src', 'components', 'settings', 'AssistantSettingsModal.tsx'), 'utf8'),
    ]);
    for (const marker of ['autonomy-evaluation:summary', 'autonomy-evaluation:start', 'autonomy-evaluation:run-baseline', 'autonomy-evaluation:complete', 'autonomy-evaluation:export', 'AUTONOMY_CAPTURE_INTERVAL_MS', 'ensureAutonomyCaptureLoop']) assert(mainSource.includes(marker));
    for (const marker of ['autonomyEvaluationSummary', 'autonomyEvaluationStart', 'autonomyEvaluationRunBaseline', 'autonomyEvaluationComplete', 'autonomyEvaluationExport']) assert(preloadSource.includes(marker));
    for (const marker of ['自治陪跑评测', '开始真实陪跑', '一键验收 24 项', '自动采集运行中', 'formatAutonomyDuration']) assert(uiSource.includes(marker));
    assert(personaSource.includes("DEFAULT_PROMPT_VERSION = '29'"));
    assert(personaSource.includes('v5.8 真实自治评测与持续学习协议'));

    const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
    const residencySource = await fs.readFile(path.join(repoRoot, 'scripts', 'verify-phase2-window-residency.mjs'), 'utf8');
    assert.match(String(packageJson.scripts?.['verify:v58'] || ''), /verify:phase2-soak:smoke/u);
    assert.match(String(packageJson.scripts?.['verify:phase2-soak:smoke'] || ''), /verify-phase2-window-residency\.mjs/u);
    assert.match(residencySource, /expectedWindowCount = 12/u);
    assert.match(residencySource, /autonomyEvaluationSummary/u);

    console.log(JSON.stringify({
      passed: true,
      scenarios: SCENARIO_CATALOG.length,
      observations: exported.observations.length,
      coverage: summary.coverage,
      metrics: summary.metrics,
    }, null, 2));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
