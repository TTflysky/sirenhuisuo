const DEFAULT_PROJECT_TITLE = '\u672a\u547d\u540d\u9879\u76ee';

function clean(value, max = 4000) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, max);
}

/**
 * Derive a stable display name from the model-understood goal. The current
 * user sentence is deliberately the last fallback because it may only be an
 * approval, correction, or closing remark.
 */
export function deriveProjectTitle(input = {}) {
  const source = [input.goal, input.originalGoal, input.request, input.fallback]
    .map((value) => clean(value))
    .find(Boolean);
  if (!source) return DEFAULT_PROJECT_TITLE;

  const firstClause = source.split(/[\n\r\u3002\uff01\uff1f!?;\uff1b]/u)[0]?.trim() || source;
  const withoutDispatchPreamble = firstClause
    .replace(/^(?:\u8bf7|\u5e2e\u6211|\u6211\u9700\u8981|\u6211\u60f3\u8981|\u6211\u8981)\s*/u, '')
    .replace(/^(?:\u62c9|\u5efa|\u7ec4\u5efa|\u5b89\u6392)\s*(?:\u4e00\u4e2a|\u4e2a)?\s*(?:\u56e2\u961f|\u5c0f\u7ec4)\s*(?:\u6765|\u5e2e\u6211)?\s*/u, '')
    .replace(/^(?:\u505a|\u5236\u4f5c|\u5f00\u53d1|\u5b9e\u73b0|\u6784\u5efa|\u642d\u5efa)\s*(?:\u4e00\u4e2a|\u4e2a)?\s*/u, '')
    .replace(/^(?:to\s+)?(?:build|create|develop|implement)\s+(?:an?\s+)?/iu, '')
    .trim();
  const title = withoutDispatchPreamble || firstClause;
  return title.slice(0, 40).trim() || DEFAULT_PROJECT_TITLE;
}

export const TAIJI_PROJECT_NAMING_VERSION = 1;
