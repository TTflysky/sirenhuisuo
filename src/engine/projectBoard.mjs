const STAGE_ORDER = [
  { id: 'discovery', label: '需求与方案' },
  { id: 'design', label: 'UI/UX 设计' },
  { id: 'build', label: '开发实现' },
  { id: 'integration', label: '数据与接入' },
  { id: 'review', label: '验收' },
];

const ACTIVE = new Set(['queued', 'running']);
const NEEDS_ACTION = new Set(['awaiting_user', 'paused', 'failed']);

function text(value, limit = 360) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function stageFor(step = {}) {
  const source = `${text(step.title, 500)} ${text(step.assignment, 2000)}`;
  if (step.kind === 'review' || /验收|审查|复审|review|检查/u.test(source)) return 'review';
  if (/数据|数据库|接口|api|连接器|知识库|mcp|ima|接入|联调|连通/u.test(source)) return 'integration';
  if (/ui\/?ux|交互|视觉|原型|界面设计|用户体验/u.test(source)) return 'design';
  if (/html|css|react|前端|后端|代码|开发|实现|构建|编程/u.test(source)) return 'build';
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
      for (const step of run.steps ?? []) entries.push({ run, step, stageId: stageFor(step) });
    }
    const stages = STAGE_ORDER.map((stage) => {
      const stageEntries = entries.filter((entry) => entry.stageId === stage.id);
      const total = stageEntries.length;
      const completed = stageEntries.filter((entry) => entry.step.status === 'completed').length;
      const activeEntry = stageEntries.find((entry) => ACTIVE.has(entry.step.status));
      const actionEntry = stageEntries.find((entry) => NEEDS_ACTION.has(entry.step.status));
      const owner = activeEntry?.step?.employeeId ?? actionEntry?.step?.employeeId ?? stageEntries.at(-1)?.step?.employeeId;
      const status = activeEntry ? 'running'
        : actionEntry ? actionEntry.step.status
          : total > 0 && completed === total ? 'completed'
            : total > 0 ? 'queued' : 'empty';
      return {
        ...stage,
        total,
        completed,
        status,
        ownerId: owner,
        entries: stageEntries,
      };
    }).filter((stage) => stage.total > 0);
    const sortedRuns = [...projectRuns].sort(sortByTime);
    const latestRun = sortedRuns.at(-1) ?? root;
    const actionRun = [...sortedRuns].reverse().find((run) => NEEDS_ACTION.has(run.status));
    const runningRun = [...sortedRuns].reverse().find((run) => ACTIVE.has(run.status));
    const currentStage = stages.find((stage) => ACTIVE.has(stage.status))
      ?? stages.find((stage) => NEEDS_ACTION.has(stage.status))
      ?? [...stages].reverse().find((stage) => stage.status !== 'completed')
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
      latestResult: resultForRun(actionRun ?? latestRun),
      updatedAt: Math.max(...sortedRuns.map((run) => Number(run.updatedAt || run.createdAt || 0))),
      section: ACTIVE.has(status) || NEEDS_ACTION.has(status) ? 'current' : status === 'completed' ? 'completed' : 'stopped',
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
