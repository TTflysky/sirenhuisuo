import { describe, expect, it } from 'vitest';
import { deriveProjectTitle } from '../../src/engine/projectNaming.mjs';

describe('project naming', () => {
  it('uses the understood goal instead of a trailing approval sentence', () => {
    expect(deriveProjectTitle({
      goal: '\u62c9\u4e2a\u56e2\u961f\u505a\u4e00\u4e2a\u7f51\u6587\u5c0f\u8bf4\u751f\u4ea7\u5de5\u5177',
      fallback: '\u53ef\u4ee5\uff0c\u5c31\u6309\u8fd9\u4e2a\u56e2\u961f\u62c9\u7fa4\u5427',
    })).toBe('\u7f51\u6587\u5c0f\u8bf4\u751f\u4ea7\u5de5\u5177');
  });

  it('keeps a concise model goal intact', () => {
    expect(deriveProjectTitle({ goal: '\u4e2a\u4eba\u521b\u4f5c\u8005\u53d1\u5e03\u5e73\u53f0\u5ba2\u6237\u7aef' })).toBe('\u4e2a\u4eba\u521b\u4f5c\u8005\u53d1\u5e03\u5e73\u53f0\u5ba2\u6237\u7aef');
  });
});
