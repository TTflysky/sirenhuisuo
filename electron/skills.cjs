const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const os = require('os');
const extractZip = require('extract-zip');
const yauzl = require('yauzl');

const MAX_BODY_BYTES = 256 * 1024;
const MAX_SKILLS = 2000;
const SKILL_DOWNLOAD_TIMEOUT_MS = 15000;
const MAX_SKILL_BUNDLE_FILES = 160;
const MAX_SKILL_BUNDLE_BYTES = 8 * 1024 * 1024;
const MAX_SKILL_ARCHIVE_BYTES = 12 * 1024 * 1024;
const MAX_SKILL_EXPANDED_BYTES = 16 * 1024 * 1024;

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
          let health = 'ready';
          let healthMessage;
          try {
            const metadata = JSON.parse(await fs.readFile(path.join(path.dirname(real), '.taiji-skill.json'), 'utf8'));
            if (metadata.installMode === 'single-file') {
              health = 'limited';
              healthMessage = '此技能仅安装了 SKILL.md；如原作者依赖脚本或参考资料，请从完整目录重新安装。';
            }
          } catch {}
          const pathHash = crypto.createHash('sha256').update(real).digest('hex').slice(0, 24);
          entries.push({
            id: `${pathHash}:${(fm.name || path.basename(path.dirname(real))).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 64)}`,
            name: fm.name || path.basename(path.dirname(real)),
            description: fm.description_zh || fm.description || '',
            source: path.relative(root, real).replace(/\\/g, '/').split('/')[0] || 'root',
            scope: root === userSkillsRoot ? 'mine' : 'built-in',
            version: fm.version || undefined,
            pathHash,
            health,
            healthMessage,
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

function githubDirectoryCandidate(inputUrl) {
  const parsed = new URL(inputUrl);
  if (parsed.hostname !== 'github.com') return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts[2] !== 'tree' || parts.length < 5) return null;
  const [owner, repo, , branch, ...skillPath] = parts;
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo.replace(/\.git$/i, ''))}/contents/${skillPath.map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`;
}

async function downloadSkillDirectory(sourceUrl, targetDir) {
  const rootUrl = githubDirectoryCandidate(sourceUrl);
  if (!rootUrl) return { installMode: 'single-file', files: 1 };
  let totalBytes = 0;
  let fileCount = 0;
  const download = async (directoryUrl, relativeDir = '') => {
    const response = await fetch(directoryUrl, {
      headers: { 'User-Agent': 'Taiji-Skill-Installer/1.0', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(SKILL_DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`无法读取技能目录：HTTP ${response.status}`);
    const entries = await response.json();
    if (!Array.isArray(entries)) throw new Error('技能目录格式不正确');
    for (const entry of entries) {
      if (fileCount >= MAX_SKILL_BUNDLE_FILES) throw new Error('技能目录文件过多，无法安全安装');
      if (entry.name.startsWith('.')) continue;
      const relative = path.posix.join(relativeDir, entry.name);
      const target = path.resolve(targetDir, relative);
      if (!target.startsWith(`${targetDir}${path.sep}`)) throw new Error('技能目录包含不安全路径');
      if (entry.type === 'dir') { await download(entry.url, relative); continue; }
      if (entry.type !== 'file' || !entry.download_url) continue;
      const fileResponse = await fetch(entry.download_url, { signal: AbortSignal.timeout(SKILL_DOWNLOAD_TIMEOUT_MS) });
      if (!fileResponse.ok) throw new Error(`无法下载技能文件：${entry.name}`);
      const content = Buffer.from(await fileResponse.arrayBuffer());
      totalBytes += content.length;
      if (totalBytes > MAX_SKILL_BUNDLE_BYTES) throw new Error('技能目录超过 8MB，无法安全安装');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
      fileCount += 1;
    }
  };
  await download(rootUrl);
  if (!(await fs.stat(path.join(targetDir, 'SKILL.md'))).isFile()) throw new Error('技能目录中没有 SKILL.md');
  return { installMode: 'directory', files: fileCount };
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

function validateZipArchive(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (openError, zip) => {
      if (openError || !zip) { reject(new Error(`ZIP 无法打开：${openError?.message ?? '未知错误'}`)); return; }
      let files = 0;
      let expandedBytes = 0;
      let settled = false;
      const fail = (message) => {
        if (settled) return;
        settled = true;
        try { zip.close(); } catch {}
        reject(new Error(message));
      };
      zip.on('error', (error) => fail(`ZIP 读取失败：${error.message}`));
      zip.on('entry', (entry) => {
        const normalized = String(entry.fileName || '').replace(/\\/g, '/');
        if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) || /(^|\/)\.\.(\/|$)/.test(normalized)) {
          fail('ZIP 中包含不安全路径'); return;
        }
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
        if ((unixMode & 0o170000) === 0o120000) { fail('ZIP 中包含不允许的符号链接'); return; }
        if (!normalized.endsWith('/')) files += 1;
        expandedBytes += Number(entry.uncompressedSize) || 0;
        if (files > MAX_SKILL_BUNDLE_FILES) { fail(`ZIP 文件超过 ${MAX_SKILL_BUNDLE_FILES} 个`); return; }
        if (expandedBytes > MAX_SKILL_EXPANDED_BYTES) { fail('ZIP 解压后超过 16MB'); return; }
        zip.readEntry();
      });
      zip.on('end', () => {
        if (settled) return;
        settled = true;
        if (files === 0) reject(new Error('ZIP 中没有文件'));
        else resolve({ files, expandedBytes });
      });
      zip.readEntry();
    });
  });
}

async function findSkillManifests(root) {
  const found = [];
  const walk = async (dir, depth) => {
    if (depth > 6 || found.length > 10) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') found.push(full);
    }
  };
  await walk(root, 0);
  return found.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b));
}

async function installZipSkill(projectRoot, sourceUrl, requestedName) {
  const response = await fetch(sourceUrl, {
    headers: { 'User-Agent': 'Taiji-Skill-Installer/1.0', Accept: 'application/zip,application/octet-stream,*/*' },
    signal: AbortSignal.timeout(SKILL_DOWNLOAD_TIMEOUT_MS * 2),
  });
  if (!response.ok) throw new Error(`技能 ZIP 下载失败：HTTP ${response.status}`);
  const declaredBytes = Number(response.headers.get('content-length') || 0);
  if (declaredBytes > MAX_SKILL_ARCHIVE_BYTES) throw new Error('技能 ZIP 超过 12MB');
  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.length > MAX_SKILL_ARCHIVE_BYTES) throw new Error('技能 ZIP 超过 12MB');
  if (archive.length < 4 || archive[0] !== 0x50 || archive[1] !== 0x4b) throw new Error('下载内容不是有效 ZIP 技能包');

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-skill-'));
  const zipPath = path.join(tempRoot, 'skill.zip');
  const extractedRoot = path.join(tempRoot, 'expanded');
  await fs.mkdir(extractedRoot, { recursive: true });
  try {
    await fs.writeFile(zipPath, archive);
    const archiveInfo = await validateZipArchive(zipPath);
    await extractZip(zipPath, { dir: extractedRoot });
    const manifests = await findSkillManifests(extractedRoot);
    if (manifests.length === 0) throw new Error('ZIP 中没有找到 SKILL.md');
    const manifestPath = manifests[0];
    const skillRoot = path.dirname(manifestPath);
    const content = await fs.readFile(manifestPath, 'utf8');
    if (Buffer.byteLength(content, 'utf8') > MAX_BODY_BYTES) throw new Error('SKILL.md 超过 256KB');
    const frontmatter = parseFrontmatter(content);
    const fallbackName = path.basename(skillRoot) || 'installed-skill';
    const name = requestedName || frontmatter.name || fallbackName;
    const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 64);
    if (!slug) throw new Error('无法生成安全的技能目录名');
    const userProfile = process.env.USERPROFILE || process.env.HOME || '';
    if (!userProfile) throw new Error('无法定位当前用户目录');
    const skillsRoot = path.resolve(userProfile, '.workbuddy', 'skills');
    const targetDir = path.resolve(skillsRoot, slug);
    if (path.relative(skillsRoot, targetDir).startsWith('..')) throw new Error('技能目录不安全');
    await fs.mkdir(skillsRoot, { recursive: true });
    const stageDir = path.join(skillsRoot, `.install-${slug}-${crypto.randomBytes(5).toString('hex')}`);
    const backupDir = path.join(skillsRoot, `.backup-${slug}-${Date.now()}`);
    await fs.cp(skillRoot, stageDir, { recursive: true, errorOnExist: true, force: false });
    await fs.writeFile(path.join(stageDir, '.taiji-skill.json'), JSON.stringify({
      schema: 1,
      installMode: 'zip',
      sourceUrl: response.url || sourceUrl,
      files: archiveInfo.files,
      installedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
    let backedUp = false;
    try {
      try { await fs.rename(targetDir, backupDir); backedUp = true; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      await fs.rename(stageDir, targetDir);
      if (backedUp) await fs.rm(backupDir, { recursive: true, force: true });
    } catch (error) {
      try { await fs.rm(stageDir, { recursive: true, force: true }); } catch {}
      if (backedUp) { try { await fs.rename(backupDir, targetDir); } catch {} }
      throw error;
    }
    const installed = (await scanSkills(projectRoot)).find((item) => item._path === path.join(targetDir, 'SKILL.md'));
    return { ok: true, skill: installed ? (({ _path, ...item }) => item)(installed) : { name, source: slug }, resolvedUrl: response.url || sourceUrl };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function installSkill(projectRoot, input) {
  const sourceUrl = typeof input?.sourceUrl === 'string' ? input.sourceUrl.trim() : '';
  const requestedName = typeof input?.name === 'string' ? input.name.trim().slice(0, 80) : '';
  if (!sourceUrl || sourceUrl.length > 2048) throw new Error('请填写有效的技能地址');
  let parsedSource;
  try { parsedSource = new URL(sourceUrl); } catch { throw new Error('技能地址不是有效 URL'); }
  if (parsedSource.protocol !== 'https:') throw new Error('技能地址必须使用 HTTPS');
  if (/\.zip$/i.test(parsedSource.pathname)) return installZipSkill(projectRoot, parsedSource.toString(), requestedName);
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
  const bundle = await downloadSkillDirectory(sourceUrl, targetDir);
  if (bundle.installMode === 'single-file') await fs.writeFile(path.join(targetDir, 'SKILL.md'), content, 'utf8');
  await fs.writeFile(path.join(targetDir, '.taiji-skill.json'), JSON.stringify({
    schema: 1,
    installMode: bundle.installMode,
    sourceUrl: resolvedUrl,
    files: bundle.files,
    installedAt: new Date().toISOString(),
  }, null, 2), 'utf8');
  const installed = (await scanSkills(projectRoot)).find((item) => item._path === path.join(targetDir, 'SKILL.md'));
  return { ok: true, skill: installed ? (({ _path, ...item }) => item)(installed) : { name, source: slug }, resolvedUrl };
}

module.exports = { listSkills, readSkill, deleteSkill, installSkill, validateZipArchive, MAX_BODY_BYTES };
