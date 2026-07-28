const CONTEXT_VERSION = 2;
const SUMMARY_VERSION = 1;
const MAX_EVENTS = 120;
const MAX_DECISIONS = 12;
const MAX_ISSUES = 12;
const MAX_FACTS = 18;
const MAX_ARTIFACTS = 20;
const RECENT_PROMPT_EVENTS = 18;

function text(value, max = 900) {
  return String(value ?? '').trim().slice(0, max);
}

function list(value, max = 8, itemMax = 500) {
  return Array.isArray(value) ? value.map((item) => text(item, itemMax)).filter(Boolean).slice(0, max) : [];
}

function unique(value, max) {
  return [...new Set(value.filter(Boolean))].slice(-max);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function eventData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 5000) return undefined;
    return JSON.parse(serialized);
  } catch { return undefined; }
}

function eventId() {
  return `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEvent(event) {
  return {
    id: text(event?.id, 100) || eventId(),
    ts: Number.isFinite(event?.ts) ? event.ts : Date.now(),
    type: text(event?.type, 60) || 'progress',
    source: text(event?.source, 60) || 'system',
    stepId: text(event?.stepId, 160) || undefined,
    summary: text(event?.summary, 900),
    verified: event?.verified === true,
    data: eventData(event?.data),
  };
}

function emptySummary() {
  return {
    summaryVersion: SUMMARY_VERSION,
    narrative: '',
    verifiedFacts: [],
    completedStepIds: [],
    artifactPaths: [],
    blockers: [],
    sourceEventCount: 0,
    modelNarrative: '',
    modelName: '',
    modelCoveredEventCount: 0,
    compactedAt: undefined,
  };
}

function artifactPath(event) {
  return text(event?.data?.artifact?.path ?? event?.data?.artifact?.diskPath, 800);
}

function deterministicNarrative(state, facts, blockers, artifacts) {
  const parts = [];
  if (state.decisions.length) parts.push(`已确认：${state.decisions.slice(-3).join('；')}`);
  if (facts.length) parts.push(`已验证：${facts.slice(-5).join('；')}`);
  if (artifacts.length) parts.push(`交付文件：${artifacts.slice(-5).join('、')}`);
  if (blockers.length) parts.push(`未决：${blockers.slice(-4).join('；')}`);
  return text(parts.join('。'), 2400);
}

export function compactTaskContext(snapshot) {
  const state = snapshot && typeof snapshot === 'object' ? clone(snapshot) : createTaskContext();
  const events = (Array.isArray(state.events) ? state.events : []).map(normalizeEvent).filter((event) => event.summary).slice(-MAX_EVENTS);
  const previousSummary = state.summary && typeof state.summary === 'object' ? state.summary : emptySummary();
  const sourceEventCount = Math.max(events.length, Number(previousSummary.sourceEventCount) || 0);
  const verifiedFacts = unique(events.filter((event) => event.verified).map((event) => event.summary), MAX_FACTS);
  const completedStepIds = unique(events.filter((event) => event.verified && event.stepId).map((event) => event.stepId), 40);
  const artifactPaths = unique(events.map(artifactPath), MAX_ARTIFACTS);
  const blockers = list(state.openIssues, MAX_ISSUES, 700);
  state.events = events;
  state.summary = {
    ...emptySummary(),
    modelNarrative: text(previousSummary.modelNarrative, 1600),
    modelName: text(previousSummary.modelName, 120),
    modelCoveredEventCount: Math.min(sourceEventCount, Number(previousSummary.modelCoveredEventCount) || 0),
    narrative: deterministicNarrative(state, verifiedFacts, blockers, artifactPaths),
    verifiedFacts,
    completedStepIds,
    artifactPaths,
    blockers,
    sourceEventCount,
    compactedAt: Date.now(),
  };
  return state;
}

export function createTaskContext(input = {}) {
  const timestamp = Number.isFinite(input.createdAt) ? input.createdAt : Date.now();
  return {
    contextVersion: CONTEXT_VERSION,
    taskId: text(input.taskId, 160),
    goal: text(input.goal, 2000),
    acceptanceCriteria: list(input.acceptanceCriteria, 8),
    decisions: list(input.decisions, MAX_DECISIONS),
    openIssues: list(input.openIssues, MAX_ISSUES),
    relatedTaskIds: list(input.relatedTaskIds, 12, 160),
    summary: emptySummary(),
    events: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function restoreTaskContext(snapshot, fallback = {}) {
  const base = createTaskContext(fallback);
  if (!snapshot || typeof snapshot !== 'object') return base;
  const restored = {
    ...base,
    ...clone(snapshot),
    contextVersion: CONTEXT_VERSION,
    taskId: text(snapshot.taskId || base.taskId, 160),
    goal: text(snapshot.goal || base.goal, 2000),
    acceptanceCriteria: list(snapshot.acceptanceCriteria?.length ? snapshot.acceptanceCriteria : base.acceptanceCriteria, 8),
    decisions: list(snapshot.decisions, MAX_DECISIONS),
    openIssues: list(snapshot.openIssues, MAX_ISSUES),
    relatedTaskIds: list(snapshot.relatedTaskIds, 12, 160),
    summary: snapshot.summary && typeof snapshot.summary === 'object' ? snapshot.summary : emptySummary(),
    events: Array.isArray(snapshot.events) ? snapshot.events.map(normalizeEvent).filter((event) => event.summary).slice(-MAX_EVENTS) : [],
    createdAt: Number.isFinite(snapshot.createdAt) ? snapshot.createdAt : base.createdAt,
    updatedAt: Number.isFinite(snapshot.updatedAt) ? snapshot.updatedAt : base.updatedAt,
  };
  return compactTaskContext(restored);
}

export function appendTaskContextEvent(snapshot, input = {}) {
  const state = restoreTaskContext(snapshot);
  const summary = text(input.summary, 900);
  if (!summary) return state;
  const event = normalizeEvent({ ...input, summary });
  state.events = [...state.events, event].slice(-MAX_EVENTS);
  state.summary.sourceEventCount = Math.max(state.events.length - 1, Number(state.summary.sourceEventCount) || 0) + 1;
  if (event.type === 'decision') state.decisions = unique([...state.decisions, summary], MAX_DECISIONS);
  if (event.type === 'error' || event.type === 'blocked') state.openIssues = unique([...state.openIssues, summary], MAX_ISSUES);
  if (event.type === 'resolved' && state.openIssues.length > 0) state.openIssues = state.openIssues.slice(0, -1);
  if (event.type === 'history' && Array.isArray(event.data?.taskIds)) {
    state.relatedTaskIds = unique([...state.relatedTaskIds, ...event.data.taskIds.map(String)], 12);
  }
  state.updatedAt = event.ts;
  return compactTaskContext(state);
}

export function applyModelTaskSummary(snapshot, proposal = {}) {
  const state = restoreTaskContext(snapshot);
  const narrative = text(proposal.narrative, 1600);
  if (!narrative) return state;
  state.summary.modelNarrative = narrative;
  state.summary.modelName = text(proposal.modelName, 120);
  state.summary.modelCoveredEventCount = Math.min(state.summary.sourceEventCount, Math.max(0, Number(proposal.sourceEventCount) || state.summary.sourceEventCount));
  state.summary.compactedAt = Date.now();
  state.updatedAt = Math.max(state.updatedAt, state.summary.compactedAt);
  return state;
}

export function shouldModelSummarizeTaskContext(snapshot) {
  const state = restoreTaskContext(snapshot);
  const chars = state.events.reduce((total, event) => total + event.summary.length, 0);
  return state.events.length >= 24 && chars >= 5000 && state.summary.modelCoveredEventCount < state.summary.sourceEventCount - 4;
}

export function buildTaskSummaryMaterial(snapshot, maxLength = 16000) {
  const state = restoreTaskContext(snapshot);
  return JSON.stringify({
    goal: state.goal,
    acceptanceCriteria: state.acceptanceCriteria,
    decisions: state.decisions,
    openIssues: state.openIssues,
    verifiedFacts: state.summary.verifiedFacts,
    artifactPaths: state.summary.artifactPaths,
    recentEvents: state.events.slice(-36).map(({ ts, type, source, stepId, summary, verified }) => ({ ts, type, source, stepId, summary, verified })),
    sourceEventCount: state.summary.sourceEventCount,
  }).slice(0, maxLength);
}

export function searchTaskContext(snapshot, query, limit = 8) {
  const state = restoreTaskContext(snapshot);
  const terms = String(query ?? '').toLowerCase().split(/\s+/u).filter((term) => term.length > 1);
  return state.events
    .map((event) => ({ event, score: terms.reduce((score, term) => score + (event.summary.toLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter((item) => terms.length === 0 || item.score > 0)
    .sort((a, b) => b.score - a.score || b.event.ts - a.event.ts)
    .slice(0, Math.max(1, limit))
    .map((item) => item.event);
}

export function buildTaskContextPrompt(snapshot, maxLength = 12000) {
  const state = restoreTaskContext(snapshot);
  const events = state.events.slice(-RECENT_PROMPT_EVENTS).map((event) => {
    const step = event.stepId ? ` [${event.stepId}]` : '';
    const verified = event.verified ? '（已验证）' : '';
    return `- ${event.type}${step}${verified}：${event.summary}`;
  }).join('\n');
  const sections = [
    '## 任务上下文快照',
    `目标：${state.goal || '未记录'}`,
    `验收标准：${state.acceptanceCriteria.join('；') || '未记录'}`,
    state.summary.narrative ? `确定性压缩摘要：${state.summary.narrative}` : '',
    state.summary.modelNarrative ? `模型辅助叙事摘要（仅用于导航，事实仍以上述结构化字段为准）：${state.summary.modelNarrative}` : '',
    state.decisions.length ? `已确认决策：\n${state.decisions.map((item) => `- ${item}`).join('\n')}` : '',
    state.openIssues.length ? `未决问题：\n${state.openIssues.map((item) => `- ${item}`).join('\n')}` : '',
    state.summary.artifactPaths.length ? `已登记交付文件：\n${state.summary.artifactPaths.map((item) => `- ${item}`).join('\n')}` : '',
    events ? `最近执行记录：\n${events}` : '最近执行记录：暂无',
    '必须基于以上真实记录继续；已完成步骤不要重复执行，未决问题要先处理或明确说明。模型摘要不能覆盖结构化事实。',
  ].filter(Boolean);
  return sections.join('\n\n').slice(0, maxLength);
}

export const TASK_CONTEXT_VERSION = CONTEXT_VERSION;
export const TASK_CONTEXT_SUMMARY_VERSION = SUMMARY_VERSION;
