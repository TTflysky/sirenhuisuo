import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  assessExplicitResourceCompletion,
  buildExplicitResourceGuidance,
  createExplicitResourceContract,
  extractExplicitUrls,
  normalizeExplicitUrl,
  validateExplicitResourceToolCall,
} from '../src/engine/explicitResourceContract.mjs';
import { createFallbackTaskDecision, normalizeTaskDecision } from '../src/engine/taskDecisionKernel.mjs';

const target = 'https://mp.weixin.qq.com/s/6d_2gn2jK3lVTJaeookHkA';
const prompt = `${target}  总结链接内容。`;
const contract = createExplicitResourceContract(prompt);

assert.deepEqual(contract?.urls, [target]);
assert.deepEqual(extractExplicitUrls(`${target}。`), [target]);
assert.equal(normalizeExplicitUrl(`${target}，`), target);
assert.match(buildExplicitResourceGuidance(contract), /read_web_page/u);

const unrelatedSearch = validateExplicitResourceToolCall(contract, 'web_search', { query: '微信公众号文章' }, []);
assert.equal(unrelatedSearch.allowed, false, 'Explicit URL content requests must not start with search');
assert.match(unrelatedSearch.reason, /原始地址|明确网页地址|指定网页地址/u);

const wrongRead = validateExplicitResourceToolCall(contract, 'read_web_page', { url: 'https://example.com/article' }, []);
assert.equal(wrongRead.allowed, false, 'A similar or substitute page must be rejected');
assert.equal(validateExplicitResourceToolCall(contract, 'read_web_page', { url: target }, []).allowed, true);

const successLog = [{ name: 'read_web_page', args: JSON.stringify({ url: target }), result: '原网页正文', success: true }];
assert.equal(assessExplicitResourceCompletion(contract, []).passed, false);
assert.equal(assessExplicitResourceCompletion(contract, successLog).passed, true);
assert.equal(validateExplicitResourceToolCall(contract, 'web_search', { query: target }, successLog).allowed, false, 'Search must not contaminate an exact-page transformation after a successful read');
assert.equal(assessExplicitResourceCompletion(contract, [{ ...successLog[0], success: false }]).passed, false);

const followUp = createExplicitResourceContract('总结这个链接里面的内容', [target]);
assert.deepEqual(followUp?.urls, [target], 'A resolved conversation reference must retain the original URL');

const tools = ['read_web_page', 'web_search', 'read_file'];
const fallback = createFallbackTaskDecision({ latestMessage: prompt, availableTools: tools });
assert.equal(fallback.primaryRoute, 'read_web_page');
const normalized = normalizeTaskDecision({
  mode: 'execute', turnRelation: 'new_task', goal: prompt, primaryRoute: 'web_search',
  acceptanceCriteria: ['搜索相关内容'], deliverableType: 'answer', requiresEvidence: true,
  needsUser: false, missingUserCondition: '', searchQuery: '微信公众号文章', decisionReason: '搜索', confidence: 0.9,
}, { latestMessage: prompt, availableTools: tools });
assert.equal(normalized.primaryRoute, 'read_web_page', 'The kernel must override model drift for an explicit webpage transformation');
assert(normalized.requiredConstraints.some((item) => item.includes(target)), 'The exact URL must survive into the task contract');

const [agentSource, nativeAdapterSource, nativeStepSource] = await Promise.all([
  fs.readFile(new URL('../src/data/agentLoopRuntime.ts', import.meta.url), 'utf8'),
  fs.readFile(new URL('../electron/nativeExecutionAdapter.cjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../electron/nativeStepExecutor.cjs', import.meta.url), 'utf8'),
]);
const nativeSource = `${nativeAdapterSource}\n${nativeStepSource}`;
for (const source of [agentSource, nativeSource]) {
  assert.match(source, /validateExplicitResourceToolCall/u);
  assert.match(source, /assessExplicitResourceCompletion/u);
  assert.match(source, /buildExplicitResourceGuidance/u);
}

console.log(JSON.stringify({ passed: true, target, route: normalized.primaryRoute }, null, 2));
