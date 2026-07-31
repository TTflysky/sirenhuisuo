const URL_PATTERN = /https?:\/\/[^\s<>\][)"']+/giu;
const RESOURCE_KINDS = new Set(['web', 'file', 'attachment', 'skill', 'connector', 'employee', 'task']);

function clean(value, limit = 4000) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ').slice(0, limit);
}

export function normalizeWebUrl(value) {
  const raw = String(value ?? '').trim().replace(/[.,;:!?，。；：！？]+$/u, '');
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/u.test(parsed.protocol)) return '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function extractWebUrls(value) {
  return [...new Set([...String(value ?? '').matchAll(URL_PATTERN)]
    .map((match) => normalizeWebUrl(match[0]))
    .filter(Boolean))];
}

function normalizePath(value) {
  return clean(value, 2048).replace(/\\/gu, '/').replace(/\/{2,}/gu, '/');
}

export function normalizeResourceRef(input) {
  if (typeof input === 'string') {
    const url = normalizeWebUrl(input);
    return url ? { kind: 'web', id: `web:${url}`, locator: url, source: 'user', metadata: {} } : undefined;
  }
  if (!input || typeof input !== 'object') return undefined;
  const kind = clean(input.kind, 40).toLowerCase();
  if (!RESOURCE_KINDS.has(kind)) return undefined;
  const locator = kind === 'web'
    ? normalizeWebUrl(input.url ?? input.locator ?? input.id)
    : kind === 'file' || kind === 'attachment'
      ? normalizePath(input.path ?? input.locator ?? input.id)
      : clean(input.id ?? input.locator ?? input.name, 512);
  if (!locator) return undefined;
  return {
    kind,
    id: `${kind}:${locator}`,
    locator,
    label: clean(input.label ?? input.name, 200),
    source: clean(input.source, 40) || 'user',
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
  };
}

export function createResourceContract(input = {}) {
  const resources = [...new Map((input.resources ?? [])
    .map(normalizeResourceRef)
    .filter(Boolean)
    .map((resource) => [resource.id, resource])).values()];
  if (!resources.length) return undefined;
  return {
    version: 1,
    operation: clean(input.operation, 80) || 'read',
    resources,
    acquisitionRequired: input.acquisitionRequired !== false,
    evidenceRequired: input.evidenceRequired !== false,
    substitutionAllowed: input.substitutionAllowed === true,
  };
}

export function isWebContentTransformation(value) {
  const input = clean(value);
  return /(?:总结|概括|摘要|提炼|归纳|解读|分析|阅读|读取|查看|打开|翻译|改写|提取|summari[sz]e|analy[sz]e|read|translate|extract)/iu.test(input)
    && /(?:链接|网页|页面|文章|正文|内容|url|website|webpage|article|content|https?:\/\/)/iu.test(input);
}

export function createWebContentContract(goal, supplementalUrls = []) {
  if (!isWebContentTransformation(goal)) return undefined;
  const urls = [...new Set([...extractWebUrls(goal), ...supplementalUrls.map(normalizeWebUrl).filter(Boolean)])];
  return createResourceContract({
    operation: 'read-transform',
    resources: urls.map((url) => ({ kind: 'web', url })),
    acquisitionRequired: true,
    evidenceRequired: true,
    substitutionAllowed: false,
  });
}

function parseArguments(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function callResource(toolName, argumentsValue) {
  const args = parseArguments(argumentsValue);
  if (toolName === 'read_web_page') return normalizeResourceRef({ kind: 'web', url: args.url });
  if (toolName === 'read_file') return normalizeResourceRef({ kind: 'file', path: args.path });
  if (toolName === 'read_skill' || toolName === 'install_skill') return normalizeResourceRef({ kind: 'skill', id: args.id ?? args.sourceUrl ?? args.url });
  if (/connector/iu.test(toolName)) return normalizeResourceRef({ kind: 'connector', id: args.connector ?? args.id ?? args.preset });
  return undefined;
}

export function resourceContractProgress(contract, callLog = []) {
  if (!contract) return { attempted: [], succeeded: [], failed: [], complete: true };
  const expected = new Set(contract.resources.map((resource) => resource.id));
  const attempted = [];
  const succeeded = [];
  const failed = [];
  for (const call of callLog) {
    const resource = callResource(call.name, call.args ?? call.arguments);
    if (!resource || !expected.has(resource.id)) continue;
    attempted.push(resource.id);
    (call.success ? succeeded : failed).push(resource.id);
  }
  const unique = (items) => [...new Set(items)];
  const successIds = unique(succeeded);
  return {
    attempted: unique(attempted),
    succeeded: successIds,
    failed: unique(failed),
    complete: contract.resources.every((resource) => successIds.includes(resource.id)),
  };
}

export function validateResourceToolCall(contract, toolName, argumentsValue, callLog = []) {
  if (!contract) return { allowed: true, reason: '' };
  const webResources = contract.resources.filter((resource) => resource.kind === 'web');
  if (webResources.length && toolName === 'web_search' && !contract.substitutionAllowed) {
    const progress = resourceContractProgress(contract, callLog);
    return {
      allowed: false,
      reason: progress.complete
        ? '指定网页已经读取，不得再用搜索结果污染原文任务。'
        : '用户已经指定网页地址，搜索只能发现未知资源，不能替代已指定网页。',
    };
  }
  const actual = callResource(toolName, argumentsValue);
  if (!actual) return { allowed: true, reason: '' };
  const sameKind = contract.resources.filter((resource) => resource.kind === actual.kind);
  if (!sameKind.length) return { allowed: true, reason: '' };
  if (!sameKind.some((resource) => resource.id === actual.id)) {
    return { allowed: false, reason: `工具尝试处理的${actual.kind}对象不是用户指定资源：${actual.locator}` };
  }
  return { allowed: true, reason: '' };
}

export function assessResourceCompletion(contract, callLog = []) {
  if (!contract || !contract.evidenceRequired) return { passed: true, issues: [] };
  const progress = resourceContractProgress(contract, callLog);
  const issues = contract.resources
    .filter((resource) => !progress.succeeded.includes(resource.id))
    .map((resource) => progress.failed.includes(resource.id)
      ? `指定资源获取失败，不能用其他对象替代：${resource.locator}`
      : `尚未取得用户指定资源：${resource.locator}`);
  return { passed: issues.length === 0, issues, progress };
}

export function buildResourceGuidance(contract) {
  if (!contract) return '';
  const rows = contract.resources.map((resource) => `- ${resource.kind}: ${resource.locator}`).join('\n');
  return `## 明确资源合同\n当前任务处理以下用户指定对象：\n${rows}\n必须先通过与资源类型匹配的读取工具取得真实内容，再根据原内容完成任务。禁止用搜索结果、相似文件、其他 Skill 或旧任务替代。获取失败时保留对象身份并报告真实失败类别，只能改用本质不同且适用于该资源的获取器。`;
}
