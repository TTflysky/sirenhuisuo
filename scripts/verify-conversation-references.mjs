import assert from 'node:assert/strict';
import { referencesFromToolResult, resolveConversationReferences } from '../src/engine/conversationReferences.mjs';

const searchOutput = `1. social-content (social-content)\n主页：https://skillhub.cn/skills/social-content\n来源地址：https://api.skillhub.cn/api/v1/download?slug=social-content`;
const skillRefs = referencesFromToolResult('search_skills', '{"query":"爆款视频拆解 skill"}', searchOutput, true);
assert.equal(skillRefs.length, 1);
assert.equal(skillRefs[0].id, 'social-content');
assert.match(skillRefs[0].sourceUrl, /slug=social-content/u);

const history = [{ id: 'assistant-search', roleId: 'custom', content: '找到候选。', references: skillRefs }];
const link = resolveConversationReferences({ input: '把它的链接发给我', history });
assert.equal(link.status, 'resolved');
assert.equal(link.references[0].id, 'social-content');
assert.equal(link.action, 'share-link');

const web = resolveConversationReferences({ input: '打开刚才那个网页', history: [{ id: 'web', roleId: 'custom', content: '资料', references: [{ kind: 'web', id: 'https://example.com/a', label: '资料页', sourceUrl: 'https://example.com/a', state: 'verified' }] }] });
assert.equal(web.status, 'resolved');
assert.equal(web.references[0].kind, 'web');

const ambiguous = resolveConversationReferences({ input: '安装它', history: [{ id: 'two-skills', roleId: 'custom', content: '候选', references: [...skillRefs, { kind: 'skill', id: 'other-skill', label: 'other-skill', sourceUrl: 'https://api.skillhub.cn/api/v1/download?slug=other-skill', state: 'candidate' }] }] });
assert.equal(ambiguous.status, 'ambiguous');
console.log(JSON.stringify({ passed: true, cases: 4 }));
