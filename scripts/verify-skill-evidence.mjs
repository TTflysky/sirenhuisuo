import assert from 'node:assert/strict';
import { appendSkillEvidence, summarizeSkillEvidence } from '../src/engine/skillEvidence.mjs';

let events = appendSkillEvidence([], { skillId: 's1', skillName: '写作', action: 'matched', score: 16, reason: '主题匹配' });
events = appendSkillEvidence(events, { skillId: 's1', skillName: '写作', action: 'read', verified: true, reason: '已读取主规则' });
events = appendSkillEvidence(events, { skillId: 's1', skillName: '写作', action: 'read', verified: true, reason: '已读取主规则' });
assert.equal(events.length, 2);
const summary = summarizeSkillEvidence(events);
assert.equal(summary.matched, 1);
assert.equal(summary.read, 1);
assert.equal(summary.verified, 1);
assert.equal(events[0].stage, 'selection');
assert.equal(events[1].stage, 'readback');
console.log(JSON.stringify({ passed: true, version: 2, total: summary.total }));
