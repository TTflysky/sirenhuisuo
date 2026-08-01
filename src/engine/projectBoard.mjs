const STAGE_ORDER = [
  { id: 'discovery', label: '需求与方案' },
  { id: 'design', label: 'UI/UX 设计' },
  { id: 'build', label: '开发实现' },
  { id: 'integration', label: '数据与接入' },
  { id: 'review', label: '验收' },
];

const ACTIVE_RUNS = new Set(['queued', 'running']);
const RUNNING_STEPS = new Set(['running']);
const NEEDS_ACTION = new Set(['awaiting_user', 'paused', 'failed']);

function text(value, limit = 360) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function stageFor(step = {}) {
  const source = `${text(step.title, 500)} ${text(step.assignment, 2000)}`;
  if (step.kind === 'review') return 'review';
  if (/数据|数据库|接口|api|连接器|知识库|mcp|ima|接入|联调|连通/u.test(source)) return 'integration';
  if (/ui\/?ux|交互|视觉|原型|界面设计|用户体验/iu.test(source)) return 'design';
  if (/html|css|react|前端|后端|代码|开发|实现|构建|编程/u.test(source)) return 'build';
  if (/验收|审查|复审|review|检查/iu.test(source)) return 'review';
  return 'discovery';
}

function stateLabel(status) {
  if (status === 'running') return '执行中';
  if (status === 'queued') return '等待执行';
  if (status === 'awaiting_user') return '等待你处理';
  if (status === 'paused') return '已暂停';
  if (status === 'failed') return '需要恢复';
  if (status === 'archived') return '已归档';
  if (status === 'stopped') return '已停止';
  return '已完成';
}

function resultForRun(run) {
  const handoff = text(run?.handoff?.blocked, 280);
  if (handoff) return handoff;
  const error = text(run?.lastError, 280);
  if (error) return error;
  const latest = [...(run?.steps ?? [])].reverse().find((step) => text(step?.output?.summary, 280));
  if (latest) return text(latest.output.summary, 280);
  return text(run?.recoveryContext?.summary, 280) || '尚未产生可展示的结果。';
}

function projectTitle(run, project) {
  if (project?.title) return text(project.title, 80);
  const raw = String(run?.title || run?.goal || run?.request || '').trim();
  const latest = raw.match(/(?:老板)?最新(?:要求|任务)\s*[:：]\s*([\s\S]+)$/u)?.[1]
    ?? raw.split(/\n\s*\n/u).at(-1)
    ?? raw;
  return text(latest.replace(/^(?:请|帮我|麻烦你)/u, ''), 80) || '未命名项目';
}

function rootFor(run, byId) {
  let current = run;
  const seen = new Set();
  while (current?.parentTaskId && byId.has(current.parentTaskId) && !seen.has(current.id)) {
    seen.add(current.id);
    current = byId.get(current.parentTaskId);
  }
  return current ?? run;
}

function sortByTime(a, b) {
  return Number(a?.updatedAt || a?.createdAt || 0) - Number(b?.updatedAt || b?.createdAt || 0);
}

function stepTimeRange(run, step) {
  const eventTimes = (step.events ?? []).map((event) => Number(event.ts)).filter(Number.isFinite);
  const startedAt = Number(step.startedAt) || (eventTimes.length ? Math.min(...eventTimes) : undefined);
  const terminal = ['completed', 'failed', 'stopped'].includes(step.status);
  const completedAt = Number(step.completedAt)
    || (terminal && eventTimes.length ? Math.max(...eventTimes) : undefined)
    || (terminal ? Number(run.updatedAt) || undefined : undefined);
  const elapsedMs = startedAt ? Math.max(0, (completedAt || Date.now()) - startedAt) : 0;
  return { startedAt, completedAt, elapsedMs };
}

function stepProjection(run, step) {
  const unresolvedDependencies = step.status === 'queued'
    ? (step.dependsOnStepIds ?? [])
      .map((dependencyId) => run.steps.find((candidate) => candidate.id === dependencyId))
      .filter((candidate) => candidate?.status !== 'completed')
      .map((candidate) => candidate?.title || '未知前置步骤')
    : [];
  const evidence = step.evidence ?? [];
  const verifiedEvidence = evidence.filter((item) => item.verified === true).length;
  const waitingCondition = unresolvedDependencies.length
    ? `等待前置步骤：${unresolvedDependencies.join('、')}`
    : step.status === 'awaiting_user' ? text(run?.handoff?.blocked, 300) || '等待你的确认或补充信息'
      : step.status === 'paused' ? '任务已暂停，等待继续执行'
        : step.status === 'failed' ? text(step.lastError || step.reviewReason || run.lastError, 300) || '步骤失败，等待恢复'
          : '';
  const nextAction = step.status === 'completed' ? '进入下一阶段'
    : step.status === 'running' ? text(step.events?.at(-1)?.detail, 240) || '继续执行并记录证据'
      : step.status === 'awaiting_user' ? '收到确认后从当前步骤继续'
        : step.status === 'paused' ? '继续当前步骤'
          : step.status === 'failed' ? '修复当前责任步骤后重新验收'
            : unresolvedDependencies.length ? '前置步骤完成后自动开始'
              : '等待调度执行';
  return {
    run,
    step,
    ...stepTimeRange(run, step),
    evidenceTotal: evidence.length,
    verifiedEvidence,
    evidenceComplete: evidence.length > 0 && verifiedEvidence === evidence.length,
    waitingCondition,
    nextAction,
    responsibility: step.revisionOfStepId
      ? `仅返工：${run.steps.find((candidate) => candidate.id === step.revisionOfStepId)?.title || step.revisionOfStepId}`
      : '',
  };
}

/**
 * Converts execution records into the user-facing project view. Child runs,
 * retry records and individual steps remain evidence inside their root project.
 */
export function buildProjectBoard(runs = [], projectRecords = []) {
  const byId = new Map(runs.filter((run) => run?.id).map((run) => [run.id, run]));
  const projectsById = new Map((projectRecords || []).filter((project) => project?.id).map((project) => [project.id, project]));
  const projects = new Map();
  for (const run of byId.values()) {
    const root = rootFor(run, byId);
    if (!projects.has(root.id)) projects.set(root.id, { root, runs: [] });
    projects.get(root.id).runs.push(run);
  }

  return [...projects.values()].map(({ root, runs: projectRuns }) => {
    const projectRecord = root.projectId ? projectsById.get(root.projectId) : undefined;
    const entries = [];
    for (const run of projectRuns) {
      for (const step of run.steps ?? []) entries.push({ ...stepProjection(run, step), stageId: stageFor(step) });
    }
    const stages = STAGE_ORDER.map((stage) => {
      const stageEntries = entries.filter((entry) => entry.stageId === stage.id);
      const total = stageEntries.length;
      const completed = stageEntries.filter((entry) => entry.step.status === 'completed').length;
      const activeEntry = stageEntries.find((entry) => RUNNING_STEPS.has(entry.step.status));
      const actionEntry = stageEntries.find((entry) => NEEDS_ACTION.has(entry.step.status));
      const queuedEntry = stageEntries.find((entry) => entry.step.status === 'queued');
      const owner = activeEntry?.step?.employeeId ?? actionEntry?.step?.employeeId ?? queuedEntry?.step?.employeeId ?? stageEntries.at(-1)?.step?.employeeId;
      const status = activeEntry ? 'running'
        : actionEntry ? actionEntry.step.status
          : total > 0 && completed === total ? 'completed'
            : total > 0 ? 'queued' : 'empty';
      const elapsedMs = stageEntries.reduce((sum, entry) => sum + entry.elapsedMs, 0);
      const evidenceTotal = stageEntries.reduce((sum, entry) => sum + entry.evidenceTotal, 0);
      const verifiedEvidence = stageEntries.reduce((sum, entry) => sum + entry.verifiedEvidence, 0);
      const focusEntry = activeEntry ?? actionEntry ?? queuedEntry ?? stageEntries.at(-1);
      return {
        ...stage,
        total,
        completed,
        status,
        ownerId: owner,
        elapsedMs,
        evidenceTotal,
        verifiedEvidence,
        evidenceComplete: evidenceTotal > 0 && verifiedEvidence === evidenceTotal,
        waitingCondition: focusEntry?.waitingCondition || '',
        nextAction: focusEntry?.nextAction || (status === 'completed' ? '阶段已完成' : '等待调度'),
        entries: stageEntries,
      };
    }).filter((stage) => stage.total > 0);
    const sortedRuns = [...projectRuns].sort(sortByTime);
    const latestRun = sortedRuns.at(-1) ?? root;
    const actionRun = [...sortedRuns].reverse().find((run) => NEEDS_ACTION.has(run.status));
    const runningRun = [...sortedRuns].reverse().find((run) => ACTIVE_RUNS.has(run.status));
    const currentStage = stages.find((stage) => stage.status === 'running')
      ?? stages.find((stage) => NEEDS_ACTION.has(stage.status))
      ?? stages.find((stage) => stage.status === 'queued')
      ?? stages.at(-1);
    const total = entries.length;
    const completed = entries.filter((entry) => entry.step.status === 'completed').length;
    const status = projectRecord?.status === 'archived'
      ? 'archived'
      : actionRun?.status ?? runningRun?.status ?? root.status;
    return {
      id: root.id,
      projectId: root.projectId,
      archived: projectRecord?.status === 'archived',
      title: projectTitle(root, projectRecord),
      goal: text(projectRecord?.request || root.goal || root.request, 1000),
      status,
      statusLabel: stateLabel(status),
      total,
      completed,
      runs: sortedRuns,
      root,
      currentStage,
      stages,
      actionRun,
      elapsedMs: entries.reduce((sum, entry) => sum + entry.elapsedMs, 0),
      evidenceTotal: entries.reduce((sum, entry) => sum + entry.evidenceTotal, 0),
      verifiedEvidence: entries.reduce((sum, entry) => sum + entry.verifiedEvidence, 0),
      waitingCondition: currentStage?.waitingCondition || text(actionRun?.handoff?.blocked, 300),
      nextAction: currentStage?.nextAction || (status === 'completed' ? '项目已完成' : '等待制定下一步'),
      latestResult: resultForRun(actionRun ?? latestRun),
      updatedAt: Math.max(...sortedRuns.map((run) => Number(run.updatedAt || run.createdAt || 0))),
      section: ACTIVE_RUNS.has(status) || NEEDS_ACTION.has(status) ? 'current' : status === 'completed' ? 'completed' : 'stopped',
    };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function projectBoardSections(projects = []) {
  return {
    current: projects.filter((project) => project.section === 'current'),
    completed: projects.filter((project) => project.section === 'completed'),
    stopped: projects.filter((project) => project.section === 'stopped'),
  };
}
