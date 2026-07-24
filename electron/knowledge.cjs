const path = require('path');
const fs = require('fs/promises');

const MAX_WEB_BYTES = 2 * 1024 * 1024;
const MAX_NOTE_BYTES = 1024 * 1024;
const MAX_VAULT_FILES = 3000;

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

async function fetchKnowledgeUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('知识库链接无效'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('知识库链接仅支持 HTTP/HTTPS');
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Hermes-Office-Knowledge/1.0', Accept: 'text/html,text/markdown,text/plain,application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`知识库返回 HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_WEB_BYTES) throw new Error('知识库页面超过 2MB');
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_WEB_BYTES) throw new Error('知识库页面超过 2MB');
  const contentType = response.headers.get('content-type') || '';
  const content = /html/i.test(contentType) || /<html|<!doctype/i.test(raw.slice(0, 500)) ? htmlToText(raw) : raw.trim();
  return { ok: true, url: response.url, title: content.split('\n').find(Boolean)?.slice(0, 160) || url.hostname, content: content.slice(0, 50000) };
}

module.exports = { testObsidianVault, searchObsidianVault, readObsidianNote, fetchKnowledgeUrl };
