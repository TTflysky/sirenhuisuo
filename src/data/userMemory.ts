import {
  USER_MEMORY_CATEGORY_LABELS,
  clampMemoryValue,
  inferMemoryCategory,
  memoryQualitySummary,
  memoryReviewState,
  memorySimilarity,
  normalizeMemoryItem,
  organizeMemoryItems,
  reviewMemoryItem,
  upsertMemoryItems,
  type UserMemoryCategory,
  type UserMemoryItem,
} from '../engine/userMemoryQuality.mjs';

const LS_USER_MEMORY = 'hermes_office_user_memory';
const LS_USER_PROFILE = 'hermes_office_user_profile';

export type { UserMemoryCategory, UserMemoryItem };
export {
  USER_MEMORY_CATEGORY_LABELS,
  clampMemoryValue,
  inferMemoryCategory,
  memoryQualitySummary,
  memoryReviewState,
  memorySimilarity,
};

export function loadUserMemory(): UserMemoryItem[] {
  try {
    const raw = localStorage.getItem(LS_USER_MEMORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => normalizeMemoryItem(item)).filter((item): item is UserMemoryItem => Boolean(item)) : [];
  } catch { return []; }
}

export function saveUserMemory(items: UserMemoryItem[]): void {
  try { localStorage.setItem(LS_USER_MEMORY, JSON.stringify(organizeMemoryItems(items))); } catch {}
}

export function organizeUserMemory(items: UserMemoryItem[] = loadUserMemory()): UserMemoryItem[] {
  return organizeMemoryItems(items);
}

export function upsertUserMemory(item: UserMemoryItem, replaces?: string): { action: 'added' | 'updated' | 'ignored'; reason: string; items: UserMemoryItem[] } {
  const result = upsertMemoryItems(loadUserMemory(), item, { replaces });
  if (result.action !== 'ignored') saveUserMemory(result.items);
  return { ...result, items: result.action === 'ignored' ? result.items : loadUserMemory() };
}

export function reviewUserMemory(fingerprint: string): UserMemoryItem[] {
  const now = Date.now();
  const items = loadUserMemory().map((item) => item.fingerprint === fingerprint
    ? reviewMemoryItem(item, { now, reason: `用户于 ${new Date(now).toLocaleDateString('zh-CN')} 确认仍然有效` }) || item
    : item);
  saveUserMemory(items);
  return loadUserMemory();
}

export function appendUserMemory(item: UserMemoryItem): void {
  upsertUserMemory(item);
}

export function loadUserProfile(): string {
  try { return localStorage.getItem(LS_USER_PROFILE) ?? ''; } catch { return ''; }
}

export function saveUserProfile(text: string): void {
  try { localStorage.setItem(LS_USER_PROFILE, text); } catch {}
}

export function buildUserContext(query = ''): string {
  const profile = loadUserProfile().trim();
  const memory = loadUserMemory();
  let context = profile ? `## 用户画像\n${profile}\n\n` : '';
  if (!memory.length) return context;
  const now = Date.now();
  const eligible = memory.filter((item) => memoryReviewState(item, now) === 'active' && (item.confidence ?? 0.8) >= 0.65);
  const ranked = [...eligible].sort((left, right) => {
    const score = (item: UserMemoryItem) => {
      const relevance = query.trim() ? memorySimilarity(query, item.content) * 100 : 0;
      const importance = (item.importance ?? 3) * 8;
      const confidence = (item.confidence ?? 0.8) * 5;
      const recency = Math.max(0, 5 - (now - (item.updatedAt ?? item.ts)) / (90 * 24 * 60 * 60 * 1000));
      return relevance + importance + confidence + recency;
    };
    return score(right) - score(left);
  });
  const selected: UserMemoryItem[] = [];
  if (!query.trim()) {
    for (const category of Object.keys(USER_MEMORY_CATEGORY_LABELS) as UserMemoryCategory[]) {
      const candidate = ranked.find((item) => item.category === category);
      if (candidate) selected.push(candidate);
    }
  } else {
    for (const item of ranked) {
      if (selected.length >= 8) break;
      if (memorySimilarity(query, item.content) >= 0.08) selected.push(item);
    }
  }
  for (const item of ranked) {
    if (selected.length >= 12) break;
    if (!selected.includes(item)) selected.push(item);
  }
  if (selected.length) {
    const important = selected.map((item) => `- [${USER_MEMORY_CATEGORY_LABELS[item.category ?? 'identity']}] ${item.content}`).join('\n');
    context += `## 经筛选的长期记忆（${selected.length} 条）\n${important}\n`;
  }
  return context;
}
