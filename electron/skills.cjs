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
const SKILL_DRAFT_SCHEMA = 1;

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

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function inspectSkillRequirements(raw, skillDir) {
  const frontmatter = parseFrontmatter(raw);
  const frontmatterEnv = String(frontmatter.env_vars || frontmatter.env || '')
    .replace(/^\[|\]$/g, '').split(',').map((value) => value.trim().replace(/^['"]|['"]$/g, ''));
  const environmentVariables = unique([
    ...frontmatterEnv,
    ...[...raw.matchAll(/\b([A-Z][A-Z0-9_]{2,}(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_ID|CLIENT_SECRET|PASSWORD))\b/g)].map((match) => match[1]),
  ]).slice(0, 30);
  const externalSoftware = unique([
    ...[...raw.matchAll(/requires(?:\s+the)?(?:\s+external)?\s+[`'"]([a-z0-9_.-]{2,40})[`'"]/gi)].map((match) => match[1]),
    ...(/macOS only|requires Apple|Notes\.app|iMessage/iu.test(raw) ? ['macOS'] : []),
  ]).slice(0, 20);
  const accountRequired = /\b(?:log[ -]?in|oauth|auth configured|requires subscription|account required)\b|账号|登录|授权|订阅/u.test(raw);
  const referencedFiles = unique([...raw.matchAll(/\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)]
    .map((match) => match[1].split('#')[0])
    .filter((value) => /^(?:\.\.?\/|scripts?\/|references?\/|assets?\/)/iu.test(value))
    .map((value) => value.replace(/^\.\//, ''))).slice(0, 80);
  const missingFiles = [];
  if (skillDir) {
    const root = path.resolve(skillDir);
    for (const reference of referencedFiles) {
      const target = path.resolve(root, reference);
      const leadingParents = reference.replace(/\\/g, '/').split('/').filter((part) => part === '..').length;
      if (leadingParents > 1) { missingFiles.push(reference); continue; }
      try { if (!(await fs.stat(target)).isFile()) missingFiles.push(reference); } catch { missingFiles.push(reference); }
    }
  }
  return { environmentVariables, externalSoftware, accountRequired, referencedFiles, missingFiles: unique(missingFiles) };
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
          const requirements = await inspectSkillRequirements(raw, path.dirname(real));
          let health = 'ready';
          let healthMessage;
          let sourceUrl;
          let origin = root === userSkillsRoot ? 'manual' : 'system';
          try {
            const metadata = JSON.parse(await fs.readFile(path.join(path.dirname(real), '.taiji-skill.json'), 'utf8'));
            sourceUrl = metadata.requestedSourceUrl || metadata.sourceUrl;
            if (metadata.origin === 'auto') origin = 'auto';
            if (metadata.installMode === 'single-file') {
              health = 'limited';
              healthMessage = '此技能仅安装了 SKILL.md；如原作者依赖脚本或参考资料，请从完整目录重新安装。';
            }
          } catch {}
          if (requirements.missingFiles.length > 0) {
            health = 'broken';
            healthMessage = `缺少引用文件：${requirements.missingFiles.slice(0, 5).join('、')}`;
          } else if (health === 'ready' && (requirements.environmentVariables.length > 0 || requirements.externalSoftware.length > 0 || requirements.accountRequired)) {
            health = 'setup';
            const needs = [
              requirements.environmentVariables.length ? `环境变量 ${requirements.environmentVariables.slice(0, 4).join('、')}` : '',
              requirements.externalSoftware.length ? `外部软件 ${requirements.externalSoftware.join('、')}` : '',
              requirements.accountRequired ? '账号或授权' : '',
            ].filter(Boolean);
            healthMessage = `使用前需要：${needs.join('；')}`;
          }
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
            quarantined: health === 'broken',
            requirements,
            sourceUrl,
            origin,
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
  const skillDir = path.dirname(found._path);
  const referencedPaths = unique([...content.matchAll(/`((?:[A-Za-z0-9._-]+\/){1,4}SKILL\.md)`/g)].map((match) => match[1])).slice(0, 12);
  const documents = [];
  let totalBytes = Buffer.byteLength(content, 'utf8');
  for (const relativePath of referencedPaths) {
    const target = path.resolve(skillDir, relativePath);
    try {
      if (!(await insideRealRoot(skillDir, target))) continue;
      const childStat = await fs.stat(target);
      if (!childStat.isFile() || childStat.size > MAX_BODY_BYTES) continue;
      const childContent = await fs.readFile(target, 'utf8');
      const childBytes = Buffer.byteLength(childContent, 'utf8');
      if (totalBytes + childBytes > MAX_BODY_BYTES) break;
      documents.push({ path: relativePath.replace(/\\/g, '/'), content: childContent });
      totalBytes += childBytes;
    } catch {}
  }
  return { id: found.id, name: found.name, content: content.slice(0, MAX_BODY_BYTES), documents };
}

async function resolveSkillDirectory(projectRoot, id) {
  if (typeof id !== 'string' || id.length > 200) throw new Error('无效技能 ID');
  const found = (await scanSkills(projectRoot)).find((item) => item.id === id);
  if (!found) throw new Error('技能不存在或已移除');
  for (const root of uniqueRoots(projectRoot)) {
    try {
      if (await insideRealRoot(root, found._path)) return path.dirname(found._path);
    } catch {}
  }
  throw new Error('技能路径不安全');
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

function skillDirectoryName(name) {
  return name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

async function validateStagedSkill(stageDir) {
  const root = path.resolve(stageDir);
  const manifestPath = path.join(root, 'SKILL.md');
  const manifestStat = await fs.stat(manifestPath).catch(() => null);
  if (!manifestStat?.isFile()) throw new Error('待安装技能中没有 SKILL.md');
  if (manifestStat.size > MAX_BODY_BYTES) throw new Error('SKILL.md 超过 256KB');

  let files = 0;
  let totalBytes = 0;
  const walk = async (directory) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relative = path.relative(root, fullPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('技能目录包含不安全路径');
      if (entry.isSymbolicLink()) throw new Error('技能目录包含不允许的符号链接');
      if (entry.isDirectory()) { await walk(fullPath); continue; }
      if (!entry.isFile()) throw new Error('技能目录包含不支持的文件类型');
      const stat = await fs.stat(fullPath);
      files += 1;
      totalBytes += stat.size;
      if (files > MAX_SKILL_BUNDLE_FILES) throw new Error(`技能目录文件超过 ${MAX_SKILL_BUNDLE_FILES} 个`);
      if (totalBytes > MAX_SKILL_EXPANDED_BYTES) throw new Error('技能目录超过 16MB');
    }
  };
  await walk(root);

  const content = await fs.readFile(manifestPath, 'utf8');
  if (!content.trim()) throw new Error('SKILL.md 不能为空');
  const metadataPath = path.join(root, '.taiji-skill.json');
  let metadata;
  try { metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')); } catch { throw new Error('技能安装记录无效'); }
  if (!['single-file', 'directory', 'zip'].includes(metadata.installMode)) throw new Error('技能安装方式无效');
  if (!metadata.requestedSourceUrl || !metadata.contentHash) throw new Error('技能安装记录不完整');
  const actualHash = crypto.createHash('sha256').update(content).digest('hex');
  if (metadata.contentHash !== actualHash) throw new Error('SKILL.md 完整性校验失败');
  const requirements = await inspectSkillRequirements(content, root);
  if (metadata.installMode !== 'single-file' && requirements.missingFiles.length > 0) {
    throw new Error(`技能包缺少引用文件：${requirements.missingFiles.slice(0, 5).join('、')}`);
  }
  return { content, files, totalBytes };
}

async function replaceSkillDirectoryAtomically(targetDir, stageDir) {
  const target = path.resolve(targetDir);
  const stage = path.resolve(stageDir);
  const skillsRoot = path.dirname(target);
  const [realSkillsRoot, realStageRoot] = await Promise.all([
    fs.realpath(skillsRoot),
    fs.realpath(path.dirname(stage)),
  ]);
  const sameRoot = process.platform === 'win32'
    ? realSkillsRoot.toLocaleLowerCase() === realStageRoot.toLocaleLowerCase()
    : realSkillsRoot === realStageRoot;
  if (!sameRoot || target === stage) throw new Error('技能暂存目录不安全');
  try {
    await validateStagedSkill(stage);
  } catch (error) {
    try { await fs.rm(stage, { recursive: true, force: true }); } catch {}
    throw error;
  }

  const slug = path.basename(target);
  const backup = path.join(skillsRoot, `.backup-${slug}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  let backedUp = false;
  try {
    try { await fs.rename(target, backup); backedUp = true; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await fs.rename(stage, target);
  } catch (error) {
    try { await fs.rm(stage, { recursive: true, force: true }); } catch {}
    if (backedUp) {
      try { await fs.rename(backup, target); } catch (restoreError) {
        throw new Error(`技能替换失败，旧版本恢复失败：${restoreError?.message ?? restoreError}`);
      }
    }
    throw error;
  }
  if (backedUp) {
    try { await fs.rm(backup, { recursive: true, force: true }); } catch {}
  }
}

async function createSkillStage(skillsRoot, slug) {
  await fs.mkdir(skillsRoot, { recursive: true });
  return fs.mkdtemp(path.join(skillsRoot, `.install-${slug}-`));
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
    const slug = skillDirectoryName(name);
    if (!slug) throw new Error('无法生成安全的技能目录名');
    const userProfile = process.env.USERPROFILE || process.env.HOME || '';
    if (!userProfile) throw new Error('无法定位当前用户目录');
    const skillsRoot = path.resolve(userProfile, '.workbuddy', 'skills');
    const targetDir = path.resolve(skillsRoot, slug);
    if (path.relative(skillsRoot, targetDir).startsWith('..')) throw new Error('技能目录不安全');
    const stageDir = await createSkillStage(skillsRoot, slug);
    try {
      await fs.cp(skillRoot, stageDir, { recursive: true, errorOnExist: false, force: false });
      await fs.writeFile(path.join(stageDir, '.taiji-skill.json'), JSON.stringify({
        schema: 1,
        installMode: 'zip',
        sourceUrl: response.url || sourceUrl,
        requestedSourceUrl: sourceUrl,
        contentHash: crypto.createHash('sha256').update(content).digest('hex'),
        files: archiveInfo.files,
        installedAt: new Date().toISOString(),
      }, null, 2), 'utf8');
      await replaceSkillDirectoryAtomically(targetDir, stageDir);
    } catch (error) {
      try { await fs.rm(stageDir, { recursive: true, force: true }); } catch {}
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
  const slug = skillDirectoryName(name);
  if (!slug) throw new Error('无法生成安全的技能目录名');
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  if (!userProfile) throw new Error('无法定位当前用户目录');
  const skillsRoot = path.resolve(userProfile, '.workbuddy', 'skills');
  const targetDir = path.resolve(skillsRoot, slug);
  const rel = path.relative(skillsRoot, targetDir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('技能目录不安全');
  await fs.mkdir(skillsRoot, { recursive: true });
  const stageDir = await createSkillStage(skillsRoot, slug);
  try {
    const bundle = await downloadSkillDirectory(sourceUrl, stageDir);
    if (bundle.installMode === 'single-file') await fs.writeFile(path.join(stageDir, 'SKILL.md'), content, 'utf8');
    await fs.writeFile(path.join(stageDir, '.taiji-skill.json'), JSON.stringify({
      schema: 1,
      installMode: bundle.installMode,
      sourceUrl: resolvedUrl,
      requestedSourceUrl: sourceUrl,
      contentHash: crypto.createHash('sha256').update(content).digest('hex'),
      files: bundle.files,
      installedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
    await replaceSkillDirectoryAtomically(targetDir, stageDir);
  } catch (error) {
    try { await fs.rm(stageDir, { recursive: true, force: true }); } catch {}
    throw error;
  }
  const installed = (await scanSkills(projectRoot)).find((item) => item._path === path.join(targetDir, 'SKILL.md'));
  return { ok: true, skill: installed ? (({ _path, ...item }) => item)(installed) : { name, source: slug }, resolvedUrl };
}

async function inspectSkillSource(sourceUrl) {
  if (typeof sourceUrl !== 'string' || !sourceUrl.trim() || sourceUrl.length > 2048) throw new Error('请填写有效的技能地址');
  const parsed = new URL(sourceUrl.trim());
  if (parsed.protocol !== 'https:') throw new Error('技能地址必须使用 HTTPS');
  if (/\.zip$/i.test(parsed.pathname)) {
    return { name: path.basename(parsed.pathname, '.zip') || 'ZIP Skill', description: 'ZIP 技能包会在安装前检查路径、文件数和解压大小。', installMode: 'zip', requirements: { environmentVariables: [], externalSoftware: [], accountRequired: false, referencedFiles: [], missingFiles: [] } };
  }
  const { content, resolvedUrl } = await downloadSkillMarkdown(parsed.toString());
  const frontmatter = parseFrontmatter(content);
  return {
    name: frontmatter.name || path.basename(new URL(resolvedUrl).pathname, '.md') || 'Skill',
    description: frontmatter.description_zh || frontmatter.description || '',
    installMode: githubDirectoryCandidate(parsed.toString()) ? 'directory' : 'single-file',
    requirements: await inspectSkillRequirements(content),
    resolvedUrl,
  };
}

async function repairSkill(projectRoot, id) {
  const found = (await scanSkills(projectRoot)).find((item) => item.id === id);
  if (!found) throw new Error('技能不存在或已移除');
  if (found.scope !== 'mine') throw new Error('内置技能随客户端更新修复，不能单独覆盖');
  if (found.origin === 'auto') throw new Error('自动 Skill 只能通过复盘草案的精确补丁更新，不能从虚拟来源重装');
  if (!found.sourceUrl) throw new Error('这个旧技能没有记录来源地址，请从原地址重新安装');
  return installSkill(projectRoot, { sourceUrl: found.sourceUrl, name: found.name });
}

function skillDraftRoot() {
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  if (!userProfile) throw new Error('无法定位当前用户目录');
  return path.resolve(userProfile, '.workbuddy', 'skill-drafts');
}

function countExact(source, needle) {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while ((cursor = source.indexOf(needle, cursor)) >= 0) { count += 1; cursor += needle.length; }
  return count;
}

function skillDraftManifest(input) {
  const name = String(input?.name || '').trim().slice(0, 80);
  const description = String(input?.description || '').trim().slice(0, 300);
  const instructions = String(input?.content || '').trim().slice(0, MAX_BODY_BYTES);
  if (!name || !instructions) throw new Error('Skill 草案缺少名称或操作说明');
  if (/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/u.test(instructions)) return instructions;
  return `---\nname: ${name.replace(/[\r\n:]/gu, ' ')}\ndescription: ${(description || '太极任务复盘生成的待审核 Skill').replace(/[\r\n]/gu, ' ')}\nversion: 0.1.0\norigin: auto\n---\n\n# ${name}\n\n${instructions}\n`;
}

async function createSkillDraft(projectRoot, input) {
  const action = input?.action === 'patch' ? 'patch' : 'create';
  const name = String(input?.name || input?.skillName || '').trim().slice(0, 80);
  if (!name) throw new Error('Skill 草案缺少名称');
  const draftRoot = skillDraftRoot();
  await fs.mkdir(draftRoot, { recursive: true });
  const draftId = `skill-draft-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const draftDir = path.join(draftRoot, draftId);
  await fs.mkdir(draftDir, { recursive: true });
  const proposal = {
    schema: SKILL_DRAFT_SCHEMA,
    id: draftId,
    status: 'pending',
    action,
    name,
    description: String(input?.description || '').trim().slice(0, 300),
    content: action === 'create' ? skillDraftManifest(input) : undefined,
    targetSkillName: action === 'patch' ? String(input?.targetSkillName || name).trim().slice(0, 80) : undefined,
    oldString: action === 'patch' ? String(input?.oldString || '').slice(0, 12000) : undefined,
    newString: action === 'patch' ? String(input?.newString || '').slice(0, 12000) : undefined,
    reason: String(input?.reason || '任务复盘发现可复用流程').trim().slice(0, 800),
    taskId: String(input?.taskId || '').trim().slice(0, 180) || undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (action === 'patch' && (!proposal.oldString || !proposal.newString)) throw new Error('Skill 补丁草案缺少精确旧文本或新文本');
  await fs.writeFile(path.join(draftDir, 'proposal.json'), `${JSON.stringify(proposal, null, 2)}\n`, 'utf8');
  if (proposal.content) await fs.writeFile(path.join(draftDir, 'SKILL.md'), proposal.content, 'utf8');
  return { ok: true, draft: proposal };
}

async function listSkillDrafts() {
  const draftRoot = skillDraftRoot();
  const drafts = [];
  let directories = [];
  try { directories = await fs.readdir(draftRoot, { withFileTypes: true }); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  for (const directory of directories) {
    if (!directory.isDirectory() || !directory.name.startsWith('skill-draft-')) continue;
    try {
      const proposal = JSON.parse(await fs.readFile(path.join(draftRoot, directory.name, 'proposal.json'), 'utf8'));
      if (proposal?.schema === SKILL_DRAFT_SCHEMA) drafts.push(proposal);
    } catch {}
  }
  return drafts.sort((a, b) => b.createdAt - a.createdAt);
}

async function reviewSkillDraft(projectRoot, draftId, decision, note = '') {
  const draftRoot = skillDraftRoot();
  const safeId = String(draftId || '');
  if (!/^skill-draft-[a-z0-9-]+$/iu.test(safeId)) throw new Error('Skill 草案 ID 无效');
  const draftDir = path.resolve(draftRoot, safeId);
  if (path.dirname(draftDir) !== draftRoot) throw new Error('Skill 草案路径不安全');
  const proposalPath = path.join(draftDir, 'proposal.json');
  const proposal = JSON.parse(await fs.readFile(proposalPath, 'utf8'));
  if (proposal.status !== 'pending') throw new Error('这条 Skill 草案已经处理');
  proposal.status = decision === 'approve' ? 'approved' : 'rejected';
  proposal.reviewNote = String(note || '').trim().slice(0, 500) || undefined;
  proposal.updatedAt = Date.now();
  if (decision !== 'approve') {
    await fs.writeFile(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`, 'utf8');
    return { ok: true, action: 'rejected', draft: proposal };
  }

  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  const skillsRoot = path.resolve(userProfile, '.workbuddy', 'skills');
  const slug = skillDirectoryName(proposal.name);
  if (!slug) throw new Error('无法生成安全的自动 Skill 目录名');
  if (proposal.action === 'create') {
    const targetDir = path.resolve(skillsRoot, slug);
    const existing = (await scanSkills(projectRoot)).find((item) => item.name.toLocaleLowerCase() === proposal.name.toLocaleLowerCase());
    if (existing) throw new Error('同名 Skill 已存在，自动草案不能覆盖现有 Skill');
    const stageDir = await createSkillStage(skillsRoot, slug);
    const content = skillDraftManifest(proposal);
    try {
      await fs.writeFile(path.join(stageDir, 'SKILL.md'), content, 'utf8');
      await fs.writeFile(path.join(stageDir, '.taiji-skill.json'), JSON.stringify({
        schema: 1, installMode: 'single-file', origin: 'auto', sourceUrl: `taiji-review:${proposal.taskId || proposal.id}`,
        requestedSourceUrl: `taiji-review:${proposal.taskId || proposal.id}`, contentHash: crypto.createHash('sha256').update(content).digest('hex'),
        files: 1, installedAt: new Date().toISOString(), approvedDraftId: proposal.id,
      }, null, 2), 'utf8');
      await replaceSkillDirectoryAtomically(targetDir, stageDir);
    } catch (error) {
      await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  } else {
    const target = (await scanSkills(projectRoot)).find((item) => item.name.toLocaleLowerCase() === String(proposal.targetSkillName).toLocaleLowerCase());
    if (!target) throw new Error('要更新的自动 Skill 不存在');
    if (target.scope !== 'mine' || target.origin !== 'auto') throw new Error('只允许更新由太极复盘生成的自动 Skill；内置和手动安装 Skill 不会被后台修改');
    const targetDir = path.dirname(target._path);
    const source = await fs.readFile(target._path, 'utf8');
    const matches = countExact(source, proposal.oldString);
    if (matches !== 1) throw new Error(`精确补丁要求旧文本恰好匹配一次，当前匹配 ${matches} 次`);
    const updated = source.replace(proposal.oldString, proposal.newString);
    const stageDir = await createSkillStage(skillsRoot, path.basename(targetDir));
    try {
      await fs.cp(targetDir, stageDir, { recursive: true, errorOnExist: false, force: false });
      await fs.writeFile(path.join(stageDir, 'SKILL.md'), updated, 'utf8');
      const metadataPath = path.join(stageDir, '.taiji-skill.json');
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      metadata.contentHash = crypto.createHash('sha256').update(updated).digest('hex');
      metadata.updatedAt = new Date().toISOString();
      metadata.approvedDraftId = proposal.id;
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
      await replaceSkillDirectoryAtomically(targetDir, stageDir);
    } catch (error) {
      await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }
  await fs.writeFile(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`, 'utf8');
  return { ok: true, action: proposal.action === 'create' ? 'created' : 'patched', draft: proposal };
}

module.exports = { listSkills, readSkill, resolveSkillDirectory, deleteSkill, installSkill, inspectSkillSource, repairSkill, createSkillDraft, listSkillDrafts, reviewSkillDraft, validateZipArchive, validateStagedSkill, replaceSkillDirectoryAtomically, MAX_BODY_BYTES };
