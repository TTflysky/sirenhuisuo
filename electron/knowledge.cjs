const path = require('path');
const fs = require('fs/promises');

const MAX_WEB_BYTES = 2 * 1024 * 1024;
const MAX_NOTE_BYTES = 1024 * 1024;
const MAX_VAULT_FILES = 3000;
const DEFAULT_WEB_TIMEOUT_MS = 30000;
const DEFAULT_SEARCH_ATTEMPTS = 2;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertAbsoluteDirectory(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('知识库目录无效');
  return path.resolve(input);
}

async function safeVaultFile(rootInput, relativeInput) {
  const root = assertAbsoluteDirectory(rootInput);
  const relative = typeof relativeInput === 'string' ? relativeInput.replace(/\\/g, '/') : '';
  if (!relative || path.isAbsolute(relative)) throw new Error('笔记路径无效');
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('笔记路径越界');
  const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
  const realRel = path.relative(realRoot, realTarget);
  if (realRel.startsWith('..') || path.isAbsolute(realRel)) throw new Error('笔记路径越界');
  return { root: realRoot, target: realTarget, relative: realRel.replace(/\\/g, '/') };
}

async function collectMarkdownFiles(rootInput) {
  const root = assertAbsoluteDirectory(rootInput);
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory()) throw new Error('知识库目录不存在');
  const files = [];
  const walk = async (dir, depth) => {
    if (depth > 12 || files.length >= MAX_VAULT_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_VAULT_FILES || entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name)) files.push(full);
    }
  };
  await walk(root, 0);
  return { root, files };
}

async function testObsidianVault(rootInput) {
  const { root, files } = await collectMarkdownFiles(rootInput);
  let isObsidian = false;
  try { isObsidian = (await fs.stat(path.join(root, '.obsidian'))).isDirectory(); } catch {}
  return { ok: true, path: root, noteCount: files.length, isObsidian };
}

async function searchObsidianVault(rootInput, queryInput) {
  const query = typeof queryInput === 'string' ? queryInput.trim().toLowerCase().slice(0, 200) : '';
  if (!query) throw new Error('搜索关键词不能为空');
  const { root, files } = await collectMarkdownFiles(rootInput);
  const terms = query.split(/\s+/).filter(Boolean);
  const results = [];
  for (const file of files) {
    if (results.length >= 20) break;
    const stat = await fs.stat(file);
    if (stat.size > MAX_NOTE_BYTES) continue;
    const content = await fs.readFile(file, 'utf8');
    const haystack = `${path.basename(file)}\n${content}`.toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) continue;
    const firstIndex = Math.max(0, Math.min(...terms.map((term) => {
      const index = content.toLowerCase().indexOf(term);
      return index < 0 ? content.length : index;
    })) - 100);
    const snippet = content.slice(firstIndex, firstIndex + 500).replace(/\s+/g, ' ').trim();
    results.push({ path: path.relative(root, file).replace(/\\/g, '/'), title: path.basename(file, path.extname(file)), snippet });
  }
  return { ok: true, results, scanned: files.length };
}

async function readObsidianNote(rootInput, relativeInput) {
  const file = await safeVaultFile(rootInput, relativeInput);
  if (!/\.(md|markdown|txt)$/i.test(file.target)) throw new Error('仅支持读取 Markdown 或文本笔记');
  const stat = await fs.stat(file.target);
  if (!stat.isFile() || stat.size > MAX_NOTE_BYTES) throw new Error('笔记不存在或超过 1MB');
  return { ok: true, path: file.relative, content: await fs.readFile(file.target, 'utf8'), size: stat.size };
}

function decodeHtml(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const value = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return entities[entity.toLowerCase()] ?? match;
  });
}

function htmlToText(html) {
  return decodeHtml(html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|header|footer|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs, timeoutMessage) {
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持联网请求');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(timeoutMessage)), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(timeoutMessage);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(detail || '网络连接失败');
  } finally {
    clearTimeout(timer);
  }
}

async function fetchKnowledgeUrl(rawUrl, options = {}) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('知识库链接无效'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('知识库链接仅支持 HTTP/HTTPS');
  const response = await fetchWithTimeout(options.fetchImpl ?? globalThis.fetch, url.toString(), {
    redirect: 'follow',
    headers: { 'User-Agent': 'Hermes-Office-Knowledge/1.0', Accept: 'text/html,text/markdown,text/plain,application/json' },
  }, options.timeoutMs ?? DEFAULT_WEB_TIMEOUT_MS, '读取知识库页面超时');
  if (!response.ok) throw new Error(`知识库返回 HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_WEB_BYTES) throw new Error('知识库页面超过 2MB');
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_WEB_BYTES) throw new Error('知识库页面超过 2MB');
  const contentType = response.headers.get('content-type') || '';
  const content = /html/i.test(contentType) || /<html|<!doctype/i.test(raw.slice(0, 500)) ? htmlToText(raw) : raw.trim();
  return { ok: true, url: response.url, title: content.split('\n').find(Boolean)?.slice(0, 160) || url.hostname, content: content.slice(0, 50000) };
}

function parseBingRss(xml) {
  const field = (item, tag) => {
    const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (!match) return '';
    return decodeHtml(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  };
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8).map((match) => ({
    title: field(match[1], 'title').slice(0, 240),
    url: field(match[1], 'link').slice(0, 2048),
    snippet: field(match[1], 'description').slice(0, 600),
  })).filter((item) => item.title && /^https?:\/\//i.test(item.url));
}

function normalizeDuckDuckGoUrl(rawHref) {
  try {
    const decoded = decodeHtml(rawHref);
    const url = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded, 'https://html.duckduckgo.com');
    const redirected = url.searchParams.get('uddg');
    const target = redirected ? new URL(redirected) : url;
    if (!['http:', 'https:'].includes(target.protocol) || /(^|\.)duckduckgo\.com$/iu.test(target.hostname)) return '';
    return target.toString();
  } catch {
    return '';
  }
}

function parseDuckDuckGoHtml(html) {
  const anchors = [...html.matchAll(/<a\b([^>]*\bclass=["'][^"']*\bresult__a\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/giu)];
  return anchors.slice(0, 8).map((match, index) => {
    const attributes = match[1];
    const href = /\bhref=["']([^"']+)["']/iu.exec(attributes)?.[1] ?? '';
    const segmentEnd = anchors[index + 1]?.index ?? html.length;
    const segment = html.slice((match.index ?? 0) + match[0].length, segmentEnd);
    const snippetHtml = /<(?:a|div)\b[^>]*\bclass=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/iu.exec(segment)?.[1] ?? '';
    return {
      title: htmlToText(match[2]).slice(0, 240),
      url: normalizeDuckDuckGoUrl(href).slice(0, 2048),
      snippet: htmlToText(snippetHtml).slice(0, 600),
    };
  }).filter((item) => item.title && item.url);
}

function defaultSearchProviders(query) {
  const encoded = encodeURIComponent(query);
  return [
    {
      name: 'DuckDuckGo HTML',
      url: `https://html.duckduckgo.com/html/?q=${encoded}`,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Taiji-Web-Research/2.0', Accept: 'text/html,application/xhtml+xml' },
      parse: parseDuckDuckGoHtml,
    },
    {
      name: 'Bing RSS',
      url: `https://www.bing.com/search?format=rss&mkt=zh-CN&setlang=zh-Hans&q=${encoded}`,
      headers: { 'User-Agent': 'Taiji-Web-Research/2.0', Accept: 'application/rss+xml,application/xml,text/xml' },
      parse: parseBingRss,
    },
  ];
}

async function searchWeb(rawQuery, options = {}) {
  const query = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 300) : '';
  if (!query) throw new Error('搜索关键词不能为空');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WEB_TIMEOUT_MS;
  const attemptsPerProvider = Math.max(1, options.attemptsPerProvider ?? DEFAULT_SEARCH_ATTEMPTS);
  const providers = options.providers ?? defaultSearchProviders(query);
  const failures = [];
  const startedAt = Date.now();
  let attemptCount = 0;

  for (const provider of providers) {
    for (let attempt = 1; attempt <= attemptsPerProvider; attempt += 1) {
      attemptCount += 1;
      options.onAttempt?.({ provider: provider.name, attempt, state: 'started' });
      try {
        const response = await fetchWithTimeout(fetchImpl, provider.url, {
          redirect: 'follow',
          headers: provider.headers,
        }, timeoutMs, `${provider.name} 连接超时`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.text();
        if (Buffer.byteLength(raw, 'utf8') > MAX_WEB_BYTES) throw new Error('返回内容超过 2MB');
        const results = provider.parse(raw);
        if (!Array.isArray(results) || results.length === 0) throw new Error('没有解析到有效搜索结果');
        const durationMs = Date.now() - startedAt;
        options.onAttempt?.({ provider: provider.name, attempt, state: 'succeeded', resultCount: results.length, durationMs });
        return { ok: true, results, provider: provider.name, attempts: attemptCount, durationMs, warnings: failures };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push(`${provider.name} 第 ${attempt}/${attemptsPerProvider} 次：${reason}`);
        options.onAttempt?.({ provider: provider.name, attempt, state: 'failed', error: reason });
        if (attempt < attemptsPerProvider) await wait(Math.min(1500 * attempt, 3000));
      }
    }
  }

  throw new Error(`所有联网搜索源均失败。${failures.join('；')}`);
}

module.exports = {
  testObsidianVault,
  searchObsidianVault,
  readObsidianNote,
  fetchKnowledgeUrl,
  searchWeb,
  parseBingRss,
  parseDuckDuckGoHtml,
};
