export const USER_MEMORY_QUALITY_VERSION = 2;
export const MAX_USER_MEMORY_ITEMS = 100;

export const USER_MEMORY_CATEGORY_LABELS = {
  identity: '身份背景',
  preference: '长期偏好',
  constraint: '明确约束',
  workflow: '工作习惯',
  decision: '长期决策',
  project: '项目背景',
};

const REVIEW_INTERVAL_DAYS = {
  identity: 365,
  preference: 180,
  constraint: 365,
  workflow: 180,
  decision: 180,
  project: 90,
};

const DECAY_HALF_LIFE_DAYS = {
  identity: 365,
  preference: 180,
  constraint: 365,
  workflow: 180,
  decision: 180,
  project: 90,
};

export function clampMemoryValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeMemoryText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^(用户|老板|该用户)[：:，,\s]*/u, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .replace(/的/gu, '');
}

export function memoryFingerprint(value) {
  const normalized = normalizeMemoryText(value);
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function memoryTokens(value) {
  const normalized = normalizeMemoryText(value);
  const tokens = new Set();
  const latinWords = String(value || '').toLowerCase().match(/[a-z0-9][a-z0-9._+-]*/g) || [];
  latinWords.forEach((word) => tokens.add(word));
  for (let index = 0; index < normalized.length - 1; index += 1) tokens.add(normalized.slice(index, index + 2));
  if (normalized.length === 1) tokens.add(normalized);
  return tokens;
}

export function memorySimilarity(leftValue, rightValue) {
  const leftNormalized = normalizeMemoryText(leftValue);
  const rightNormalized = normalizeMemoryText(rightValue);
  if (!leftNormalized || !rightNormalized) return 0;
  if (leftNormalized === rightNormalized) return 1;
  if ((leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized))
    && Math.min(leftNormalized.length, rightNormalized.length) / Math.max(leftNormalized.length, rightNormalized.length) >= 0.72) return 0.9;
  const left = memoryTokens(leftValue);
  const right = memoryTokens(rightValue);
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

export function inferMemoryCategory(content) {
  if (/(必须|不能|不要|禁止|务必|每次|一律|约束|要求)/u.test(content)) return 'constraint';
  if (/(偏好|喜欢|倾向|风格|希望|更喜欢)/u.test(content)) return 'preference';
  if (/(流程|习惯|先.+再|工作方式|验收|测试|提交|发布)/u.test(content)) return 'workflow';
  if (/(决定|确定|以后|长期|统一|采用|改为)/u.test(content)) return 'decision';
  if (/(项目|产品|仓库|版本|应用|团队)/u.test(content)) return 'project';
  return 'identity';
}

function reviewIntervalMs(item) {
  const baseDays = REVIEW_INTERVAL_DAYS[item.category] || 180;
  const importanceFactor = item.importance >= 5 ? 2 : item.importance <= 2 ? 0.5 : 1;
  return baseDays * importanceFactor * 24 * 60 * 60 * 1000;
}

export function memoryDecayScore(item, now = Date.now()) {
  const halfLifeDays = Math.max(7, Number(item?.decayHalfLifeDays) || DECAY_HALF_LIFE_DAYS[item?.category] || 180);
  const ageMs = Math.max(0, Number(now) - (Number(item?.updatedAt) || Number(item?.ts) || Number(now)));
  return Math.max(0.05, Math.pow(0.5, ageMs / (halfLifeDays * 24 * 60 * 60 * 1000)));
}

export function normalizeMemoryItem(item, options = {}) {
  const now = Number(options.now) || Date.now();
  const content = String(item?.content || '').trim();
  if (!content) return null;
  const ts = Number.isFinite(item.ts) ? Number(item.ts) : now;
  const updatedAt = Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : ts;
  const category = Object.hasOwn(USER_MEMORY_CATEGORY_LABELS, item.category || '') ? item.category : inferMemoryCategory(content);
  const normalized = {
    ts,
    content: content.slice(0, 240),
    source: String(item.source || '历史记忆').slice(0, 160),
    category,
    importance: clampMemoryValue(Math.round(Number(item.importance) || 3), 1, 5),
    confidence: clampMemoryValue(Number(item.confidence) || (item.source === '手动添加' ? 1 : 0.8), 0, 1),
    updatedAt,
    fingerprint: memoryFingerprint(content),
    decayHalfLifeDays: Math.max(7, Math.min(3650, Math.round(Number(item.decayHalfLifeDays) || DECAY_HALF_LIFE_DAYS[category] || 180))),
    lastReviewedAt: Number.isFinite(item.lastReviewedAt) ? Number(item.lastReviewedAt) : undefined,
    lastChangeReason: String(item.lastChangeReason || `从“${item.source || '历史记忆'}”保留`).slice(0, 240),
    supersedes: item.supersedes ? String(item.supersedes).slice(0, 240) : undefined,
  };
  normalized.reviewAfter = Number.isFinite(item.reviewAfter)
    ? Number(item.reviewAfter)
    : Math.max(updatedAt, normalized.lastReviewedAt || 0) + reviewIntervalMs(normalized);
  return normalized;
}

export function memoryReviewState(item, now = Date.now()) {
  const normalized = normalizeMemoryItem(item, { now });
  if (!normalized) return 'invalid';
  return normalized.reviewAfter <= now ? 'review_due' : 'active';
}

function mergeSources(left, right) {
  return [...new Set([...String(left || '').split('、'), ...String(right || '').split('、')].filter(Boolean))].slice(-3).join('、');
}

function trimCapacity(items) {
  if (items.length <= MAX_USER_MEMORY_ITEMS) return items;
  const ranked = [...items].sort((left, right) => {
    const score = (item) => (item.importance || 3) * 20 + (item.confidence || 0.8) * 10 + (item.updatedAt || item.ts) / 1e12;
    return score(right) - score(left);
  }).slice(0, MAX_USER_MEMORY_ITEMS);
  return ranked.sort((left, right) => left.ts - right.ts);
}

function polarity(value) {
  return /(?:不再|不要|不能|禁止|拒绝|取消|停止|不喜欢|不采用)/u.test(String(value || '')) ? -1 : 1;
}

function withoutPolarity(value) {
  return String(value || '').replace(/(?:不再|不要|不能|禁止|拒绝|取消|停止|不喜欢|不采用|喜欢|采用)/gu, '');
}

function conflictIndex(items, incoming) {
  return items.findIndex((existing) => existing.category === incoming.category
    && polarity(existing.content) !== polarity(incoming.content)
    && memorySimilarity(withoutPolarity(existing.content), withoutPolarity(incoming.content)) >= 0.72);
}

export function organizeMemoryItems(items, options = {}) {
  const now = Number(options.now) || Date.now();
  const organized = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const item = normalizeMemoryItem(raw, { now });
    if (!item) continue;
    const duplicateIndex = organized.findIndex((existing) => existing.fingerprint === item.fingerprint
      || (existing.category === item.category && memorySimilarity(existing.content, item.content) >= 0.82));
    if (duplicateIndex < 0) {
      organized.push(item);
      continue;
    }
    const existing = organized[duplicateIndex];
    const preferIncoming = item.updatedAt >= existing.updatedAt && item.content.length >= existing.content.length * 0.75;
    organized[duplicateIndex] = normalizeMemoryItem({
      ...(preferIncoming ? item : existing),
      ts: Math.min(existing.ts, item.ts),
      updatedAt: Math.max(existing.updatedAt, item.updatedAt),
      importance: Math.max(existing.importance, item.importance),
      confidence: Math.max(existing.confidence, item.confidence),
      source: mergeSources(existing.source, item.source),
      lastChangeReason: `自动归并相同或高度相似的记忆：${existing.content}`,
    }, { now });
  }
  return trimCapacity(organized.filter(Boolean));
}

export function upsertMemoryItems(items, rawItem, options = {}) {
  const now = Number(options.now) || Date.now();
  const list = organizeMemoryItems(items, { now });
  const incoming = normalizeMemoryItem(rawItem, { now });
  if (!incoming) return { action: 'ignored', reason: '内容为空，未写入', items: list };
  let matchIndex = options.replaces
    ? list.findIndex((existing) => existing.fingerprint === memoryFingerprint(options.replaces)
      || memorySimilarity(existing.content, options.replaces) >= 0.72)
    : -1;
  let reason = '';
  if (matchIndex >= 0) reason = `新事实明确替代旧记忆：${list[matchIndex].content}`;
  if (matchIndex < 0) {
    matchIndex = list.findIndex((existing) => existing.fingerprint === incoming.fingerprint);
    if (matchIndex >= 0) return { action: 'ignored', reason: '已有完全相同的记忆', items: list };
  }
  if (matchIndex < 0) {
    matchIndex = conflictIndex(list, incoming);
    if (matchIndex >= 0) reason = `检测到方向冲突，使用较新的明确事实替代：${list[matchIndex].content}`;
  }
  if (matchIndex < 0) {
    matchIndex = list.findIndex((existing) => existing.category === incoming.category && memorySimilarity(existing.content, incoming.content) >= 0.82);
    if (matchIndex >= 0) reason = `与现有记忆重复或高度相似：${list[matchIndex].content}`;
  }
  if (matchIndex >= 0) {
    const existing = list[matchIndex];
    list[matchIndex] = normalizeMemoryItem({
      ...incoming,
      ts: existing.ts,
      updatedAt: now,
      source: mergeSources(existing.source, incoming.source),
      supersedes: existing.content,
      lastChangeReason: reason,
      lastReviewedAt: now,
    }, { now });
    return { action: 'updated', reason, items: trimCapacity(list.filter(Boolean)) };
  }
  incoming.lastChangeReason = `新增长期记忆，来源：${incoming.source}`;
  list.push(incoming);
  return { action: 'added', reason: incoming.lastChangeReason, items: trimCapacity(list) };
}

export function reviewMemoryItem(item, options = {}) {
  const now = Number(options.now) || Date.now();
  const normalized = normalizeMemoryItem(item, { now });
  if (!normalized) return null;
  return normalizeMemoryItem({
    ...normalized,
    lastReviewedAt: now,
    reviewAfter: now + reviewIntervalMs(normalized),
    lastChangeReason: String(options.reason || '用户确认这条记忆仍然有效').slice(0, 240),
  }, { now });
}

export function memoryQualitySummary(items, now = Date.now()) {
  const normalized = organizeMemoryItems(items, { now });
  return {
    total: normalized.length,
    active: normalized.filter((item) => memoryReviewState(item, now) === 'active').length,
    reviewDue: normalized.filter((item) => memoryReviewState(item, now) === 'review_due').length,
    lowConfidence: normalized.filter((item) => item.confidence < 0.65).length,
  };
}
