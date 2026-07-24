const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const MAX_BODY_BYTES = 256 * 1024;
const MAX_SKILLS = 2000;
const SKILL_DOWNLOAD_TIMEOUT_MS = 15000;

function uniqueRoots(projectRoot) {
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  return [...new Set([
    path.join(userProfile, '.workbuddy', 'skills'),
    path.join(projectRoot, 'skills'),
    path.join(projectRoot, '.workbuddy', 'skills'),
  ].map((p) => path.resolve(p)))];
}

async function insideRealRoot(root, target) {
  const realRoot = await fs.realpath(root);
  const realTarget = await fs.realpath(target);
  const rel = path.relative(realRoot, realTarget);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return {};
  const end = raw.indexOf('\n---', 3);
  if (end < 0) return {};
  const result = {};
  for (const line of raw.slice(3, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]{0,40})\s*:\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, '').slice(0, 1000);
    result[match[1].toLowerCase()] = value;
  }
  return result;
}

async function scanSkills(projectRoot) {
  const entries = [];
  const userSkillsRoot = path.resolve(process.env.USERPROFILE || process.env.HOME || '', '.workbuddy', 'skills');
  for (const root of uniqueRoots(projectRoot)) {
    let rootStat;
    try { rootStat = await fs.stat(root); } catch { continue; }
    if (!rootStat.isDirectory()) continue;
    const walk = async (dir, depth) => {
      if (depth > 4 || entries.length >= MAX_SKILLS) return;
      let names;
      try { names = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const ent of names) {
        if (entries.length >= MAX_SKILLS || ent.name.startsWith('.')) continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) { await walk(full, depth + 1); continue; }
        if (ent.name !== 'SKILL.md') continue;
        try {
          if (!(await insideRealRoot(root, full))) continue;
          const stat = await fs.stat(full);
          if (!stat.isFile() || stat.size > MAX_BODY_BYTES) continue;
          const raw = await fs.readFile(full, 'utf8');
          const fm = parseFrontmatter(raw);
          const real = await fs.realpath(full);
          const pathHash = crypto.createHash('sha256').update(real).digest('hex').slice(0, 24);
          entries.push({
            id: `${pathHash}:${(fm.name || path.basename(path.dirname(real))).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 64)}`,
            name: fm.name || path.basename(path.dirname(real)),
            description: fm.description_zh || fm.description || '',
            source: path.relative(root, real).replace(/\\/g, '/').split('/')[0] || 'root',
            scope: root === userSkillsRoot ? 'mine' : 'built-in',
            version: fm.version || undefined,
            pathHash,
            _path: real,
          });
        } catch {}
      }
    };
    await walk(root, 0);
  }
  return entries;
}

async function listSkills(projectRoot) {
  return (await scanSkills(projectRoot)).map(({ _path, ...item }) => item).sort((a, b) => a.name.localeCompare(b.name));
}

async function readSkill(projectRoot, id) {
  if (typeof id !== 'string' || id.length > 200) throw new Error('无效技能 ID');
  const found = (await scanSkills(projectRoot)).find((item) => item.id === id);
  if (!found) throw new Error('技能不存在或已移除');
  let allowed = false;
  for (const root of uniqueRoots(projectRoot)) {
    try { if (await insideRealRoot(root, found._path)) { allowed = true; break; } } catch {}
  }
  if (!allowed) throw new Error('技能路径不安全');
  const stat = await fs.stat(found._path);
  if (!stat.isFile() || stat.size > MAX_BODY_BYTES) throw new Error('技能正文超过大小限制');
  const content = await fs.readFile(found._path, 'utf8');
  return { id: found.id, name: found.name, content: content.slice(0, MAX_BODY_BYTES) };
}

async function deleteSkill(projectRoot, id) {
  if (typeof id !== 'string' || id.length > 200) throw new Error('无效技能 ID');
  const all = await scanSkills(projectRoot);
  const found = all.find((item) => item.id === id);
  if (!found) throw new Error('技能不存在或已移除');
  if (found.scope !== 'mine') throw new Error('内置技能不能删除');
  let allowed = false;
  for (const root of uniqueRoots(projectRoot)) {
    try { if (await insideRealRoot(root, found._path)) { allowed = true; break; } } catch {}
  }
  if (!allowed) throw new Error('技能路径不安全');
  const dir = path.dirname(found._path);
  const rel = await (async () => {
    for (const root of uniqueRoots(projectRoot)) {
      try {
        if (!(await insideRealRoot(root, dir))) continue;
        const r = path.relative(root, dir);
        if (!r.startsWith('..') && !path.isAbsolute(r)) return r;
      } catch {}
    }
    return null;
  })();
  if (!rel) throw new Error('无法定位技能目录');
  await fs.rm(dir, { recursive: true, force: true });
  return { ok: true, id: found.id };
}

function githubCandidates(inputUrl) {
  const parsed = new URL(inputUrl);
  if (parsed.hostname !== 'github.com') return [inputUrl];
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return [inputUrl];
  const [owner, repoWithGit] = parts;
  const repo = repoWithGit.replace(/\.git$/i, '');
  const contentsUrl = (branch, skillPath) => `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${skillPath.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`;
  if (parts[2] === 'blob' && parts.length >= 5) {
    return [contentsUrl(parts[3], parts.slice(4).join('/'))];
  }
  if (parts[2] === 'raw' && parts.length >= 5) {
    return [contentsUrl(parts[3], parts.slice(4).join('/'))];
  }
  if (parts[2] === 'tree' && parts.length >= 5) {
    return [contentsUrl(parts[3], `${parts.slice(4).join('/')}/SKILL.md`)];
  }
  if (parts.length === 2) {
    return [
      contentsUrl('main', 'SKILL.md'),
      contentsUrl('master', 'SKILL.md'),
    ];
  }
  return [inputUrl];
}

async function downloadSkillMarkdown(sourceUrl) {
  let parsed;
  try { parsed = new URL(sourceUrl); } catch { throw new Error('技能地址不是有效 URL'); }
  if (parsed.protocol !== 'https:') throw new Error('技能地址必须使用 HTTPS');
  let lastError = '下载失败';
  for (const candidate of githubCandidates(parsed.toString())) {
    try {
      const response = await fetch(candidate, {
        headers: { 'User-Agent': 'Hermes-Office-Skill-Installer/1.0', Accept: 'application/vnd.github.raw+json,text/markdown,text/plain,*/*' },
        signal: AbortSignal.timeout(SKILL_DOWNLOAD_TIMEOUT_MS),
      });
      if (!response.ok) { lastError = `HTTP ${response.status}`; continue; }
      const length = Number(response.headers.get('content-length') || 0);
      if (length > MAX_BODY_BYTES) throw new Error('技能文件超过 256KB');
      const content = await response.text();
      if (Buffer.byteLength(content, 'utf8') > MAX_BODY_BYTES) throw new Error('技能文件超过 256KB');
      if (/^\s*<!doctype html|^\s*<html/i.test(content)) {
        lastError = '该链接是网页，不是 SKILL.md 或 GitHub 仓库地址';
        continue;
      }
      if (!content.trim() || !/(^|\n)#{1,3}\s+|(^|\n)---\s*\n/u.test(content)) {
        lastError = '下载内容不是有效的 Markdown 技能文件';
        continue;
      }
      return { content, resolvedUrl: candidate };
    } catch (error) {
      lastError = String(error?.message ?? error);
    }
  }
  throw new Error(`技能下载失败：${lastError}`);
}

async function installSkill(projectRoot, input) {
  const sourceUrl = typeof input?.sourceUrl === 'string' ? input.sourceUrl.trim() : '';
  const requestedName = typeof input?.name === 'string' ? input.name.trim().slice(0, 80) : '';
  if (!sourceUrl || sourceUrl.length > 2048) throw new Error('请填写有效的技能地址');
  const { content, resolvedUrl } = await downloadSkillMarkdown(sourceUrl);
  const frontmatter = parseFrontmatter(content);
  const fallbackName = path.basename(new URL(resolvedUrl).pathname, '.md') || 'installed-skill';
  const name = requestedName || frontmatter.name || fallbackName;
  const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  if (!slug) throw new Error('无法生成安全的技能目录名');
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  if (!userProfile) throw new Error('无法定位当前用户目录');
  const skillsRoot = path.resolve(userProfile, '.workbuddy', 'skills');
  const targetDir = path.resolve(skillsRoot, slug);
  const rel = path.relative(skillsRoot, targetDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('技能目录不安全');
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, 'SKILL.md'), content, 'utf8');
  const installed = (await scanSkills(projectRoot)).find((item) => item._path === path.join(targetDir, 'SKILL.md'));
  return { ok: true, skill: installed ? (({ _path, ...item }) => item)(installed) : { name, source: slug }, resolvedUrl };
}

module.exports = { listSkills, readSkill, deleteSkill, installSkill, MAX_BODY_BYTES };
