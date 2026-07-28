const CONTEXT_VERSION = 1;
const MAX_EVENTS = 48;
const MAX_DECISIONS = 12;
const MAX_ISSUES = 12;

function text(value, max = 900) {
  return String(value ?? '').trim().slice(0, max);
}

function list(value, max = 8) {
  return Array.isArray(value) ? value.map((item) => text(item, 500)).filter(Boolean).slice(0, max) : [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function eventId() {
  return `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    events: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function restoreTaskContext(snapshot, fallback = {}) {
  const base = createTaskContext(fallback);
  if (!snapshot || typeof snapshot !== 'object') return base;
  return {
    ...base,
    ...clone(snapshot),
    contextVersion: CONTEXT_VERSION,
    taskId: text(snapshot.taskId || base.taskId, 160),
    goal: text(snapshot.goal || base.goal, 2000),
    acceptanceCriteria: list(snapshot.acceptanceCriteria?.length ? snapshot.acceptanceCriteria : base.acceptanceCriteria, 8),
    decisions: list(snapshot.decisions, MAX_DECISIONS),
    openIssues: list(snapshot.openIssues, MAX_ISSUES),
    events: Array.isArray(snapshot.events) ? snapshot.events.slice(-MAX_EVENTS).map((event) => ({
      id: text(event?.id, 100) || eventId(),
      ts: Number.isFinite(event?.ts) ? event.ts : Date.now(),
      type: text(event?.type, 60) || 'progress',
      source: text(event?.source, 60) || 'system',
      stepId: text(event?.stepId, 160) || undefined,
      summary: text(event?.summary, 900),
      verified: event?.verified === true,
    })).filter((event) => event.summary) : [],
    createdAt: Number.isFinite(snapshot.createdAt) ? snapshot.createdAt : base.createdAt,
    updatedAt: Number.isFinite(snapshot.updatedAt) ? snapshot.updatedAt : base.updatedAt,
  };
}

export function appendTaskContextEvent(snapshot, input = {}) {
  const state = restoreTaskContext(snapshot);
  const summary = text(input.summary, 900);
  if (!summary) return state;
  const event = {
    id: text(input.id, 100) || eventId(),
    ts: Number.isFinite(input.ts) ? input.ts : Date.now(),
    type: text(input.type, 60) || 'progress',
    source: text(input.source, 60) || 'system',
    stepId: text(input.stepId, 160) || undefined,
    summary,
    verified: input.verified === true,
  };
  state.events = [...state.events, event].slice(-MAX_EVENTS);
  if (event.type === 'decision') state.decisions = [...state.decisions, summary].slice(-MAX_DECISIONS);
  if (event.type === 'error' || event.type === 'blocked') state.openIssues = [...state.openIssues, summary].slice(-MAX_ISSUES);
  if (event.type === 'resolved' && state.openIssues.length > 0) state.openIssues = state.openIssues.slice(0, -1);
  state.updatedAt = event.ts;
  return state;
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
  const events = state.events.slice(-18).map((event) => {
    const step = event.stepId ? ` [${event.stepId}]` : '';
    const verified = event.verified ? '（已验证）' : '';
    return `- ${event.type}${step}${verified}：${event.summary}`;
  }).join('\n');
  const sections = [
    '## 任务上下文快照',
    `目标：${state.goal || '未记录'}`,
    `验收标准：${state.acceptanceCriteria.join('；') || '未记录'}`,
    state.decisions.length ? `已确认决策：\n${state.decisions.map((item) => `- ${item}`).join('\n')}` : '',
    state.openIssues.length ? `未决问题：\n${state.openIssues.map((item) => `- ${item}`).join('\n')}` : '',
    events ? `最近执行记录：\n${events}` : '最近执行记录：暂无',
    '必须基于以上真实记录继续；已完成步骤不要重复执行，未决问题要先处理或明确说明。',
  ].filter(Boolean);
  return sections.join('\n\n').slice(0, maxLength);
}

export const TASK_CONTEXT_VERSION = CONTEXT_VERSION;
