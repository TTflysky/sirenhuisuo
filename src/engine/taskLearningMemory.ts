const LS_TASK_LEARNINGS = 'hermes_office_task_learning_memory_v1';
const LEGACY_TASK_LEARNINGS = 'taiji_task_learning_memory_v1';
const MAX_TASK_LEARNINGS = 80;

export type TaskLearningOutcome = 'completed' | 'blocked' | 'stopped';

export interface TaskLearning {
  id: string;
  goal: string;
  outcome: TaskLearningOutcome;
  successfulTools: string[];
  failedTools: string[];
  failureLabels: string[];
  lesson: string;
  createdAt: number;
  updatedAt: number;
  uses: number;
}

export interface TaskLearningInput {
  goal: string;
  outcome: TaskLearningOutcome;
  successfulTools?: string[];
  failedTools?: string[];
  failureLabels?: string[];
  lesson?: string;
}

function normalizeText(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (const char of normalizeText(value)) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function tokens(value: string): Set<string> {
  const normalized = normalizeText(value);
  const result = new Set<string>(value.toLowerCase().match(/[a-z0-9][a-z0-9._+-]*/g) ?? []);
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}

function similarity(left: string, right: string): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function unique(values: string[] | undefined, limit = 12): string[] {
  return [...new Set((values ?? []).map((item) => String(item).trim()).filter(Boolean))].slice(0, limit);
}

function normalizeLearning(value: Partial<TaskLearning>): TaskLearning | undefined {
  const goal = String(value.goal ?? '').trim().slice(0, 500);
  if (!goal) return undefined;
  const now = Date.now();
  return {
    id: String(value.id || `learning-${fingerprint(goal)}-${now}`),
    goal,
    outcome: value.outcome === 'completed' || value.outcome === 'stopped' ? value.outcome : 'blocked',
    successfulTools: unique(value.successfulTools),
    failedTools: unique(value.failedTools),
    failureLabels: unique(value.failureLabels, 8),
    lesson: String(value.lesson ?? '').trim().slice(0, 600),
    createdAt: Number.isFinite(value.createdAt) ? Number(value.createdAt) : now,
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : now,
    uses: Math.max(1, Number(value.uses) || 1),
  };
}

export function loadTaskLearnings(): TaskLearning[] {
  try {
    const current = localStorage.getItem(LS_TASK_LEARNINGS);
    const legacy = current ? null : localStorage.getItem(LEGACY_TASK_LEARNINGS);
    const parsed = JSON.parse(current ?? legacy ?? '[]');
    if (!current && legacy) {
      localStorage.setItem(LS_TASK_LEARNINGS, legacy);
      localStorage.removeItem(LEGACY_TASK_LEARNINGS);
    }
    return Array.isArray(parsed) ? parsed.map(normalizeLearning).filter((item): item is TaskLearning => Boolean(item)) : [];
  } catch {
    return [];
  }
}

export function saveTaskLearnings(items: TaskLearning[]): void {
  try {
    localStorage.setItem(LS_TASK_LEARNINGS, JSON.stringify(items.map(normalizeLearning).filter(Boolean).slice(-MAX_TASK_LEARNINGS)));
  } catch {}
}

export function rankTaskLearnings(items: TaskLearning[], goal: string): TaskLearning[] {
  const now = Date.now();
  return [...items]
    .map((item) => ({
      item,
      score: similarity(goal, item.goal) * 100
        + (item.outcome === 'completed' ? 8 : 3)
        + Math.min(item.uses, 6)
        + Math.max(0, 6 - (now - item.updatedAt) / (30 * 24 * 60 * 60 * 1000)),
    }))
    .filter(({ score }) => score >= 10)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

export function buildTaskLearningContext(goal: string, limit = 5): string {
  return rankTaskLearnings(loadTaskLearnings(), goal).slice(0, limit).map((item) => {
    const route = item.successfulTools.length ? `可行路线：${item.successfulTools.join(' → ')}` : '尚无已验证可行路线';
    const avoid = item.failedTools.length ? `避免原样重复：${item.failedTools.join('、')}` : '';
    return `- 相似目标：${item.goal}\n  结果：${item.outcome === 'completed' ? '已完成' : item.outcome === 'stopped' ? '已停止' : '受阻'}；${route}${avoid ? `；${avoid}` : ''}${item.lesson ? `；经验：${item.lesson}` : ''}`;
  }).join('\n');
}

export function recordTaskLearning(input: TaskLearningInput): TaskLearning | undefined {
  const incoming = normalizeLearning({
    id: `learning-${fingerprint(input.goal)}-${Date.now()}`,
    goal: input.goal,
    outcome: input.outcome,
    successfulTools: input.successfulTools,
    failedTools: input.failedTools,
    failureLabels: input.failureLabels,
    lesson: input.lesson,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    uses: 1,
  });
  if (!incoming) return undefined;
  const items = loadTaskLearnings();
  const existingIndex = items.findIndex((item) => similarity(item.goal, incoming.goal) >= 0.82);
  if (existingIndex >= 0) {
    const existing = items[existingIndex];
    items[existingIndex] = {
      ...incoming,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
      uses: existing.uses + 1,
      successfulTools: unique([...existing.successfulTools, ...incoming.successfulTools]),
      failedTools: unique([...existing.failedTools, ...incoming.failedTools]),
      failureLabels: unique([...existing.failureLabels, ...incoming.failureLabels], 8),
    };
    saveTaskLearnings(items);
    return items[existingIndex];
  }
  items.push(incoming);
  saveTaskLearnings(items);
  return incoming;
}
