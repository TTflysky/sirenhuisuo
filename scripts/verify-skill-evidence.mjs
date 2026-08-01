import assert from 'node:assert/strict';
import { appendSkillEvidence, buildSkillLifecycle, summarizeSkillEvidence } from '../src/engine/skillEvidence.mjs';

let events = appendSkillEvidence([], { skillId: 's1', skillName: '写作', action: 'matched', score: 16, reason: '主题匹配', verified: true });
events = appendSkillEvidence(events, { skillId: 's1', skillName: '写作', action: 'read', verified: true, reason: '已读取主规则' });
events = appendSkillEvidence(events, { skillId: 's1', skillName: '写作', action: 'read', verified: true, reason: '已读取主规则' });
assert.equal(events.length, 2);
const summary = summarizeSkillEvidence(events);
assert.equal(summary.matched, 1);
assert.equal(summary.read, 1);
assert.equal(summary.verified, 2);
assert.equal(events[0].stage, 'discovery');
assert.equal(events[1].stage, 'rules');
events = appendSkillEvidence(events, { skillId: 's1', action: 'called', verified: true });
events = appendSkillEvidence(events, { skillId: 's1', action: 'produced', verified: true });
events = appendSkillEvidence(events, { skillId: 's1', action: 'accepted', verified: true });
assert.equal(buildSkillLifecycle(events, 's1').usable, true);
console.log(JSON.stringify({ passed: true, version: 3, total: events.length }));
