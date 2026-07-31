import { describe, expect, it } from 'vitest';
import {
  assessResourceCompletion,
  buildResourceGuidance,
  createResourceContract,
  createWebContentContract,
  extractWebUrls,
  isWebContentTransformation,
  normalizeWebUrl,
  normalizeResourceRef,
  resourceContractProgress,
  validateResourceToolCall,
} from '../../src/engine/resourceContract.mjs';

describe('resource contract', () => {
  it('normalizes every supported resource identity without conflating kinds', () => {
    const inputs = [
      { kind: 'web', url: 'https://example.com/a#part' },
      { kind: 'file', path: 'workspace\\report.md' },
      { kind: 'attachment', path: 'uploads/image.png' },
      { kind: 'skill', id: 'social-content' },
      { kind: 'connector', id: 'obsidian' },
      { kind: 'employee', id: 'emp-ui' },
      { kind: 'task', id: 'task-1' },
    ];
    const refs = inputs.map(normalizeResourceRef);
    expect(refs.every(Boolean)).toBe(true);
    expect(new Set(refs.map((ref) => ref.id)).size).toBe(inputs.length);
    expect(refs[0].locator).toBe('https://example.com/a');
    expect(refs[1].locator).toBe('workspace/report.md');
  });

  it('keeps an exact webpage pinned from acquisition through completion', () => {
    const url = 'https://mp.weixin.qq.com/s/example';
    const contract = createWebContentContract(`${url} 总结链接内容`);
    expect(validateResourceToolCall(contract, 'web_search', { query: '相关文章' }).allowed).toBe(false);
    expect(validateResourceToolCall(contract, 'read_web_page', { url: 'https://example.com/other' }).allowed).toBe(false);
    expect(validateResourceToolCall(contract, 'read_web_page', { url }).allowed).toBe(true);
    expect(assessResourceCompletion(contract, [{ name: 'read_web_page', args: { url }, success: true }]).passed).toBe(true);
  });

  it('applies identity checks to files and skills using the same contract', () => {
    const contract = createResourceContract({ resources: [
      { kind: 'file', path: 'workspace/brief.md' },
      { kind: 'skill', id: 'grill-me' },
    ] });
    expect(validateResourceToolCall(contract, 'read_file', { path: 'workspace/other.md' }).allowed).toBe(false);
    expect(validateResourceToolCall(contract, 'read_skill', { id: 'grill-me' }).allowed).toBe(true);
  });

  it('rejects invalid references and deduplicates normalized resources', () => {
    expect(normalizeWebUrl('file:///tmp/a')).toBe('');
    expect(normalizeWebUrl('not a url')).toBe('');
    expect(normalizeResourceRef(null)).toBeUndefined();
    expect(normalizeResourceRef({ kind: 'unknown', id: 'x' })).toBeUndefined();
    expect(normalizeResourceRef({ kind: 'file', path: '' })).toBeUndefined();
    expect(createResourceContract({ resources: [] })).toBeUndefined();
    const contract = createResourceContract({
      operation: 'inspect',
      resources: [{ kind: 'file', path: 'a\\b.md' }, { kind: 'file', path: 'a/b.md' }],
      acquisitionRequired: false,
      evidenceRequired: false,
      substitutionAllowed: true,
    });
    expect(contract.resources).toHaveLength(1);
    expect(contract.operation).toBe('inspect');
    expect(assessResourceCompletion(contract, []).passed).toBe(true);
  });

  it('extracts exact URLs and recognizes only read-transform requests', () => {
    expect(extractWebUrls('read https://example.com/a#x and https://example.com/a#y')).toEqual(['https://example.com/a']);
    expect(isWebContentTransformation('read and summarize this webpage https://example.com/a')).toBe(true);
    expect(isWebContentTransformation('search for current weather')).toBe(false);
    expect(createWebContentContract('search for current weather')).toBeUndefined();
  });

  it('tracks attempts, failures, malformed arguments, and completion evidence', () => {
    const contract = createResourceContract({ resources: [
      { kind: 'file', path: 'workspace/brief.md' },
      { kind: 'connector', id: 'obsidian' },
    ] });
    const calls = [
      { name: 'read_file', arguments: '{bad-json', success: false },
      { name: 'read_file', args: { path: 'workspace/brief.md' }, success: false },
      { name: 'read_file', args: { path: 'workspace/brief.md' }, success: true },
      { name: 'inspect_connector', args: { connector: 'obsidian' }, success: true },
      { name: 'web_search', args: { query: 'ignored' }, success: true },
    ];
    const progress = resourceContractProgress(contract, calls);
    expect(progress.attempted).toHaveLength(2);
    expect(progress.failed).toEqual(['file:workspace/brief.md']);
    expect(progress.complete).toBe(true);
    expect(assessResourceCompletion(contract, calls).passed).toBe(true);
    expect(validateResourceToolCall(contract, 'write_file', {}, calls).allowed).toBe(true);
  });

  it('reports missing evidence and produces resource-pinned guidance', () => {
    const contract = createResourceContract({ resources: [
      { kind: 'attachment', path: 'uploads/photo.png' },
      { kind: 'employee', id: 'designer' },
      { kind: 'task', id: 'task-7' },
    ] });
    const result = assessResourceCompletion(contract, [
      { name: 'read_file', args: { path: 'uploads/photo.png' }, success: false },
    ]);
    expect(result.passed).toBe(false);
    expect(result.issues).toHaveLength(3);
    expect(buildResourceGuidance(contract)).toContain('uploads/photo.png');
  });
});
