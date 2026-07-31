const URL_PATTERN = /https?:\/\/[^\s<>\][)"']+/giu;

function clean(value, limit = 4000) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ').slice(0, limit);
}

export function normalizeExplicitUrl(value) {
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

export function extractExplicitUrls(value) {
  const urls = [...String(value ?? '').matchAll(URL_PATTERN)]
    .map((match) => normalizeExplicitUrl(match[0]))
    .filter(Boolean);
  return [...new Set(urls)];
}

export function isExplicitWebContentRequest(value) {
  const input = clean(value);
  return /(?:总结|概括|摘要|提炼|归纳|解读|分析|阅读|读取|查看|打开|翻译|改写|提取|summari[sz]e|analy[sz]e|read|translate|extract)/iu.test(input)
    && /(?:链接|网页|页面|文章|正文|内容|url|website|webpage|article|content|https?:\/\/)/iu.test(input);
}

export function createExplicitResourceContract(goal, supplementalUrls = []) {
  if (!isExplicitWebContentRequest(goal)) return undefined;
  const urls = [...new Set([
    ...extractExplicitUrls(goal),
    ...supplementalUrls.map(normalizeExplicitUrl).filter(Boolean),
  ])];
  if (!urls.length) return undefined;
  return {
    kind: 'web-content',
    operation: 'read-transform',
    urls,
    requiredTool: 'read_web_page',
  };
}

function parsedArgs(argumentsValue) {
  if (argumentsValue && typeof argumentsValue === 'object') return argumentsValue;
  try { return JSON.parse(argumentsValue || '{}'); } catch { return {}; }
}

function exactReadCall(contract, call) {
  if (!contract || call?.name !== contract.requiredTool) return false;
  const args = parsedArgs(call.args ?? call.arguments);
  const actual = normalizeExplicitUrl(args.url);
  return Boolean(actual && contract.urls.includes(actual));
}

export function explicitResourceProgress(contract, callLog = []) {
  if (!contract) return { attemptedUrls: [], succeededUrls: [], failedUrls: [], complete: true };
  const attemptedUrls = [];
  const succeededUrls = [];
  const failedUrls = [];
  for (const call of callLog) {
    if (!exactReadCall(contract, call)) continue;
    const args = parsedArgs(call.args ?? call.arguments);
    const url = normalizeExplicitUrl(args.url);
    attemptedUrls.push(url);
    (call.success ? succeededUrls : failedUrls).push(url);
  }
  const unique = (items) => [...new Set(items)];
  const succeeded = unique(succeededUrls);
  return {
    attemptedUrls: unique(attemptedUrls),
    succeededUrls: succeeded,
    failedUrls: unique(failedUrls),
    complete: contract.urls.every((url) => succeeded.includes(url)),
  };
}

export function validateExplicitResourceToolCall(contract, toolName, argumentsValue, callLog = []) {
  if (!contract) return { allowed: true, reason: '' };
  const progress = explicitResourceProgress(contract, callLog);
  if (toolName === 'web_search') {
    return {
      allowed: false,
      reason: progress.complete
        ? '用户要求处理指定网页正文，原网页已经读取；不得再用搜索结果替代或污染该网页内容。'
        : '用户已经给出明确网页地址。必须先用 read_web_page 读取该地址本身，禁止把网页地址改成搜索词或用其他网页替代。',
    };
  }
  if (toolName !== contract.requiredTool) return { allowed: true, reason: '' };
  const args = parsedArgs(argumentsValue);
  const actual = normalizeExplicitUrl(args.url);
  if (!actual) return { allowed: false, reason: '读取指定网页时缺少有效 url，必须使用用户提供的原始地址。' };
  if (!contract.urls.includes(actual)) {
    return { allowed: false, reason: `当前地址不是用户指定的网页：${actual}。不得读取相似页面或替代来源。` };
  }
  return { allowed: true, reason: '' };
}

export function assessExplicitResourceCompletion(contract, callLog = []) {
  if (!contract) return { passed: true, issues: [] };
  const progress = explicitResourceProgress(contract, callLog);
  const issues = contract.urls
    .filter((url) => !progress.succeededUrls.includes(url))
    .map((url) => progress.failedUrls.includes(url)
      ? `指定网页读取失败，不能用搜索结果代替：${url}`
      : `尚未读取用户指定网页：${url}`);
  return { passed: issues.length === 0, issues, progress };
}

export function buildExplicitResourceGuidance(contract) {
  if (!contract) return '';
  return `## 明确资源合同\n用户要求处理以下精确网页，不是围绕主题搜索：\n${contract.urls.map((url) => `- ${url}`).join('\n')}\n第一项真实证据必须来自 read_web_page 对原地址的读取。禁止调用 web_search 替代原网页，禁止读取相似页面。读取成功后只能基于该正文完成总结、分析、翻译或改写；读取失败时报告该地址的真实错误，不得要求用户重复发送已经保存的地址。`;
}
