const path = require('path');
const fs = require('fs/promises');

const MAX_WEB_BYTES = 2 * 1024 * 1024;
const MAX_NOTE_BYTES = 1024 * 1024;
const MAX_VAULT_FILES = 3000;
const DEFAULT_WEB_TIMEOUT_MS = 30000;
const DEFAULT_SEARCH_ATTEMPTS = 2;
const BLOCKED_PAGE_PATTERN = /(?:访问过于频繁|环境异常|完成验证后继续访问|请输入验证码|安全验证|人机验证|请在微信客户端打开链接|网页无法打开|内容已被发布者删除|access denied|verify you are human|captcha|unusual traffic|temporarily blocked)/iu;

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
    headers: { 'User-Agent': 'Taiji-Office-Knowledge/2.6', Accept: 'text/html,text/markdown,text/plain,application/json' },
  }, options.timeoutMs ?? DEFAULT_WEB_TIMEOUT_MS, '读取知识库页面超时');
  if (!response.ok) throw new Error(`知识库返回 HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_WEB_BYTES) throw new Error('知识库页面超过 2MB');
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_WEB_BYTES) throw new Error('知识库页面超过 2MB');
  const contentType = response.headers.get('content-type') || '';
  const content = /html/i.test(contentType) || /<html|<!doctype/i.test(raw.slice(0, 500)) ? htmlToText(raw) : raw.trim();
  if (!content) throw new Error('网页没有返回可读取的正文');
  if (BLOCKED_PAGE_PATTERN.test(content) && content.length < 8000) {
    throw new Error('网页返回了访问验证或拦截页面，没有取得原文正文');
  }
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

function isWeatherQuery(query) {
  return /天气|气温|温度|降雨|下雨|湿度|风力|空气质量|紫外线/u.test(query);
}

function extractSpecificLocation(query) {
  const text = String(query ?? '').trim();
  const matches = [...text.matchAll(/[县区旗镇乡]/gu)];
  const match = matches.at(-1);
  if (!match || match.index == null) {
    return /([\u4e00-\u9fff]{2,8}市)/u.exec(text)?.[1] ?? '';
  }
  const suffixIndex = match.index;
  let start = Math.max(0, suffixIndex - 6);
  for (let index = suffixIndex - 1; index >= Math.max(0, suffixIndex - 8); index -= 1) {
    if (/[省市州盟，,。；;、\s]/u.test(text[index])) {
      start = index + 1;
      break;
    }
  }
  return text.slice(start, suffixIndex + 1).replace(/^(?:今天|今日|明天|后天|现在|当前)/u, '').trim();
}

function weatherDescription(code, fallback = '') {
  const numeric = Number(code);
  if (numeric === 113) return '晴';
  if (numeric === 116) return '多云间晴';
  if (numeric === 119 || numeric === 122) return '多云';
  if ([143, 248, 260].includes(numeric)) return '有雾';
  if ([176, 263, 266, 293, 296, 353].includes(numeric)) return '有小雨';
  if ([299, 302, 305, 308, 356, 359].includes(numeric)) return '有中到大雨';
  if ([200, 386, 389, 392, 395].includes(numeric)) return '有雷雨';
  if ([179, 182, 185, 227, 230, 323, 326, 329, 332, 335, 338, 368, 371].includes(numeric)) return '有雪';
  if (numeric === 149) return '有霾';
  const translated = String(fallback ?? '').trim()
    .replace(/partly cloudy/iu, '多云间晴')
    .replace(/cloudy|overcast/iu, '多云')
    .replace(/clear|sunny/iu, '晴')
    .replace(/smoky haze/iu, '有霾');
  return translated || '天气状态未说明';
}

function localizedPlace(value) {
  const names = { Anhui: '安徽', China: '中国' };
  return names[String(value ?? '').trim()] ?? String(value ?? '').trim();
}

function localizedWind(value) {
  const directions = {
    N: '北', NNE: '北东北', NE: '东北', ENE: '东东北', E: '东', ESE: '东东南', SE: '东南', SSE: '南东南',
    S: '南', SSW: '南西南', SW: '西南', WSW: '西西南', W: '西', WNW: '西西北', NW: '西北', NNW: '北西北',
  };
  return directions[String(value ?? '').trim().toUpperCase()] ?? String(value ?? '').trim();
}

async function searchWeather(query, options = {}) {
  const location = extractSpecificLocation(query);
  if (!location) throw new Error('天气查询缺少可识别的城市、县区或乡镇');
  const dataUrl = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
  const response = await fetchWithTimeout(options.fetchImpl ?? globalThis.fetch, dataUrl, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Taiji-Office-Weather/1.0', Accept: 'application/json' },
  }, options.timeoutMs ?? DEFAULT_WEB_TIMEOUT_MS, '实时天气数据源连接超时');
  if (!response.ok) throw new Error(`实时天气数据源返回 HTTP ${response.status}`);
  const payload = await response.json();
  const current = payload?.current_condition?.[0];
  const day = payload?.weather?.[0];
  const area = payload?.nearest_area?.[0];
  if (!current || !day || !day.date) throw new Error('实时天气数据源没有返回可验收的气象字段');
  const region = localizedPlace(area?.region?.[0]?.value ?? '');
  const country = localizedPlace(area?.country?.[0]?.value ?? '');
  const latitude = area?.latitude ?? '';
  const longitude = area?.longitude ?? '';
  const rainChance = Math.max(0, ...(day.hourly ?? []).map((item) => Number(item?.chanceofrain) || 0));
  const description = weatherDescription(current.weatherCode, current.weatherDesc?.[0]?.value);
  const locationEvidence = [location, region, country].filter(Boolean).join('，');
  const coordinates = latitude && longitude ? `，坐标 ${latitude}, ${longitude}` : '';
  const wind = localizedWind(current.winddir16Point) || '风向未说明';
  const snippet = `地点核对：${locationEvidence}${coordinates}；日期：${day.date}；当前${description}，${current.temp_C}°C，体感 ${current.FeelsLikeC}°C，湿度 ${current.humidity}%，${wind}风 ${current.windspeedKmph} km/h；今日 ${day.mintempC}～${day.maxtempC}°C，最高降雨概率 ${rainChance}%，紫外线指数 ${day.uvIndex ?? current.uvIndex ?? '未说明'}。`;
  return {
    ok: true,
    provider: 'wttr.in 实时天气',
    results: [{ title: `${location} ${day.date} 天气实况与预报`, url: dataUrl, snippet }],
    attempts: 1,
    durationMs: 0,
    warnings: [],
  };
}

function filterRelevantSearchResults(query, results) {
  const location = extractSpecificLocation(query);
  const topicPattern = isWeatherQuery(query)
    ? /天气|气温|温度|降雨|降水|湿度|风力|风速|体感|摄氏|℃|weather|temperature|humidity|precipitation/iu
    : /股价|股票|汇率|金价|价格|行情|指数/u.test(query)
      ? /股价|股票|汇率|金价|价格|行情|指数|涨|跌|成交|人民币|美元|港元/u
      : /新闻|资讯|热点|热搜|动态|进展/u.test(query)
        ? /新闻|资讯|消息|报道|发布|宣布|进展|动态|发生/u
        : null;
  if (!location && !topicPattern) return results;
  const shortLocation = location.replace(/[县区旗镇乡市]$/u, '');
  return results.filter((item) => {
    const evidence = `${item.title}\n${item.url}\n${item.snippet}`;
    const locationMatches = !location || evidence.includes(location) || (shortLocation.length >= 2 && evidence.includes(shortLocation));
    const topicMatches = !topicPattern || topicPattern.test(evidence);
    return locationMatches && topicMatches;
  });
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

  if (isWeatherQuery(query) && options.skipWeatherProvider !== true) {
    try {
      options.onAttempt?.({ provider: 'wttr.in 实时天气', attempt: 1, state: 'started' });
      const result = await searchWeather(query, { fetchImpl, timeoutMs });
      result.durationMs = Date.now() - startedAt;
      options.onAttempt?.({ provider: result.provider, attempt: 1, state: 'succeeded', resultCount: result.results.length, durationMs: result.durationMs });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`wttr.in 实时天气：${reason}`);
      options.onAttempt?.({ provider: 'wttr.in 实时天气', attempt: 1, state: 'failed', error: reason });
    }
  }

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
        const parsedResults = provider.parse(raw);
        if (!Array.isArray(parsedResults) || parsedResults.length === 0) throw new Error('没有解析到有效搜索结果');
        const results = filterRelevantSearchResults(query, parsedResults);
        if (results.length === 0) throw new Error('返回内容没有覆盖查询中的关键地点或主题，已判定为偏题结果');
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
  searchWeather,
  filterRelevantSearchResults,
  parseBingRss,
  parseDuckDuckGoHtml,
};
