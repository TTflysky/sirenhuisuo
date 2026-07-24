const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const MAX_BODY_BYTES = 256 * 1024;
const MAX_SKILLS = 2000;

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

module.exports = { listSkills, readSkill, deleteSkill, MAX_BODY_BYTES };
