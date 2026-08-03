import { describe, expect, it } from 'vitest';
import path from 'node:path';
import verifier from '../../electron/webArtifactVerifier.cjs';

const { normalizeViewport, resolveArtifactPath, summarizeVerification } = verifier;

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
    const clean = { label: 'desktop', horizontalOverflow: false, overflowingElements: [], clippedElements: [], unsafeFramedElements: [] };
    expect(summarizeVerification([clean])).toMatchObject({ ok: true, checked: 1 });
    expect(summarizeVerification([{ ...clean, label: 'narrow', unsafeFramedElements: [{}] }])).toMatchObject({ ok: false, failed: ['narrow'] });
    expect(summarizeVerification([clean], ['desktop: script error'])).toMatchObject({ ok: false, runtimeErrors: ['desktop: script error'] });
  });
});
