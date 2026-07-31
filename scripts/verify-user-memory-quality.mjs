import assert from 'node:assert/strict';
import {
  MAX_USER_MEMORY_ITEMS,
  USER_MEMORY_QUALITY_VERSION,
  memoryQualitySummary,
  memoryReviewState,
  organizeMemoryItems,
  reviewMemoryItem,
  upsertMemoryItems,
} from '../src/engine/userMemoryQuality.mjs';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-07-31T00:00:00.000Z');
const fixture = (content, overrides = {}) => ({ ts: now - 10 * DAY, content, source: '测试', category: 'preference', importance: 3, confidence: 0.9, ...overrides });

const organized = organizeMemoryItems([
  fixture('用户偏好简洁的深色界面'),
  fixture('偏好简洁深色界面', { updatedAt: now - DAY, source: '助手对话' }),
], { now });
assert.equal(organized.length, 1);
assert.match(organized[0].lastChangeReason, /自动归并/u);

const duplicate = upsertMemoryItems(organized, fixture('偏好简洁深色界面', { ts: now }), { now });
assert.equal(duplicate.action, 'ignored');
assert.match(duplicate.reason, /相同/u);

const replaced = upsertMemoryItems(organized, fixture('用户偏好明亮的浅色界面', { ts: now }), {
  now,
  replaces: '用户偏好简洁的深色界面',
});
assert.equal(replaced.action, 'updated');
assert.equal(replaced.items.length, 1);
assert.equal(replaced.items[0].supersedes, organized[0].content);
assert.match(replaced.items[0].lastChangeReason, /明确替代/u);

const conflict = upsertMemoryItems([fixture('用户喜欢自动发布', { category: 'workflow' })], fixture('用户不喜欢自动发布', { category: 'workflow', ts: now }), { now });
assert.equal(conflict.action, 'updated');
assert.match(conflict.reason, /方向冲突/u);

const expired = fixture('用户偏好旧项目背景', { category: 'project', importance: 2, updatedAt: now - 100 * DAY, reviewAfter: now - DAY });
assert.equal(memoryReviewState(expired, now), 'review_due');
const reviewed = reviewMemoryItem(expired, { now, reason: '用户确认仍有效' });
assert.equal(memoryReviewState(reviewed, now), 'active');
assert.equal(reviewed.lastChangeReason, '用户确认仍有效');

const capacityInput = Array.from({ length: 130 }, (_, index) => fixture(`项目记忆 ${index.toString(36)}-${((index + 1) * 2654435761 >>> 0).toString(36)}`, {
  category: 'project', importance: index === 129 ? 5 : 1, updatedAt: now - index * 1000,
}));
const bounded = organizeMemoryItems(capacityInput, { now });
assert.equal(bounded.length, MAX_USER_MEMORY_ITEMS);
assert.ok(bounded.some((item) => item.content === `项目记忆 ${Number(129).toString(36)}-${((130 * 2654435761) >>> 0).toString(36)}`));

const summary = memoryQualitySummary([...replaced.items, expired, fixture('低可信推测', { confidence: 0.4 })], now);
assert.equal(summary.total, 3);
assert.equal(summary.reviewDue, 1);
assert.equal(summary.lowConfidence, 1);

console.log(JSON.stringify({ passed: true, version: USER_MEMORY_QUALITY_VERSION, deduplicated: organized.length, replacement: replaced.action, conflict: conflict.action, reviewDue: summary.reviewDue, capacity: bounded.length }, null, 2));
