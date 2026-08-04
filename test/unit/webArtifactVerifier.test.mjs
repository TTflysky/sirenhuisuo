import { describe, expect, it } from 'vitest';
import path from 'node:path';
import verifier from '../../electron/webArtifactVerifier.cjs';

const { normalizeSemanticChecks, normalizeViewport, resolveArtifactPath, summarizeVerification } = verifier;

describe('web artifact verifier', () => {
  it('clamps viewport dimensions and preserves a stable label', () => {
    expect(normalizeViewport({ width: 120, height: 9999, label: 'Phone 375' })).toEqual({
      width: 320,
      height: 1600,
      label: 'Phone-375',
    });
  });

  it('resolves HTML only inside the task workspace', () => {
    const root = path.resolve('C:/taiji-workspace');
    const resolved = resolveArtifactPath(root, 'tasks/assistant/run-1', 'site/index.html');
    expect(resolved.target).toBe(path.join(root, 'tasks', 'assistant', 'run-1', 'site', 'index.html'));
    expect(() => resolveArtifactPath(root, 'tasks/assistant/run-1', 'notes.txt')).toThrow(/HTML/u);
  });

  it('fails when any real viewport has boundary violations or runtime errors', () => {
    const clean = { label: 'desktop', horizontalOverflow: false, overflowingElements: [], clippedElements: [], unsafeFramedElements: [], semantic: { checked: 0, passed: 0, failed: 0, results: [] } };
    expect(summarizeVerification([clean])).toMatchObject({ ok: true, checked: 1 });
    expect(summarizeVerification([{ ...clean, label: 'narrow', unsafeFramedElements: [{}] }])).toMatchObject({ ok: false, failed: ['narrow'] });
    expect(summarizeVerification([{ ...clean, semantic: { checked: 1, passed: 0, failed: 1, results: [] } }])).toMatchObject({ ok: false, failed: ['desktop'] });
    expect(summarizeVerification([clean], ['desktop: script error'])).toMatchObject({ ok: false, runtimeErrors: ['desktop: script error'] });
  });

  it('normalizes a generic semantic contract without product-specific rules', () => {
    const checks = normalizeSemanticChecks([
      { id: 'keypad-grid', type: 'grid', container: '[data-testid="grid"]', cells: [{ selector: '[data-key="1"]', row: 1, column: 1 }] },
      { id: 'save-flow', type: 'interaction', steps: [{ action: 'click', selector: '#save', waitMs: 99999 }], assertions: [{ selector: '#status', property: 'text', includes: 'saved' }] },
      { type: 'unsupported-product-special-case' },
    ]);
    expect(checks).toHaveLength(2);
    expect(checks[0]).toMatchObject({ id: 'keypad-grid', type: 'grid', cells: [{ row: 1, column: 1 }] });
    expect(checks[1]).toMatchObject({ id: 'save-flow', type: 'interaction', steps: [{ waitMs: 2000 }] });
  });
});
