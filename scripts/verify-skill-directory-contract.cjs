const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { installSkill, readSkill, validatePackageManifest } = require('../electron/skills.cjs');

const owner = 'anthropics';
const repo = 'skills';
const ref = 'main';
const rootPath = `https://api.github.com/repos/${owner}/${repo}/contents/skills/skill-creator`;
const sourceApiSkill = `${rootPath}/SKILL.md?ref=${ref}`;
const files = {
  'SKILL.md': '---\nname: skill-creator\ndescription: Creates skills\n---\n\nRead [the guide](references/guide.md).\n',
  'LICENSE.txt': 'Apache-2.0\n',
  'agents/openai.yaml': 'interface:\n  display_name: Skill Creator\n',
  'assets/template.txt': 'template\n',
  'eval-viewer/index.html': '<!doctype html><title>Eval</title>\n',
  'references/guide.md': '# Guide\n\nUse the bundled scripts.\n',
  'scripts/check.mjs': 'export const check = () => true;\n',
};

function entry(name, type, relative) {
  const child = relative ? `${rootPath}/${relative}` : rootPath;
  return type === 'dir'
    ? { name, type, url: `${child}?ref=${ref}` }
    : { name, type, download_url: `https://raw.example.test/${relative}` };
}

function responseForDirectory(url) {
  const parsed = new URL(url);
  if (!parsed.pathname.startsWith('/repos/anthropics/skills/contents/')) return undefined;
  const relative = parsed.pathname.split('/contents/')[1];
  if (relative === 'skills/skill-creator') return [
    entry('SKILL.md', 'file', 'SKILL.md'),
    entry('LICENSE.txt', 'file', 'LICENSE.txt'),
    entry('agents', 'dir', 'agents'),
    entry('assets', 'dir', 'assets'),
    entry('eval-viewer', 'dir', 'eval-viewer'),
    entry('references', 'dir', 'references'),
    entry('scripts', 'dir', 'scripts'),
  ];
  const prefix = 'skills/skill-creator/';
  const requested = relative.startsWith(prefix) ? relative.slice(prefix.length) : '';
  const direct = Object.keys(files).filter((file) => path.posix.dirname(file) === requested);
  return direct.map((file) => entry(path.posix.basename(file), 'file', file));
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taiji-skill-directory-contract-'));
  const originalUserProfile = process.env.USERPROFILE;
  const projectRoot = path.join(tempRoot, 'project');
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href === sourceApiSkill) return new Response(files['SKILL.md'], { status: 200, headers: { 'content-type': 'text/markdown' } });
    if (href.startsWith('https://raw.example.test/')) {
      const relative = href.slice('https://raw.example.test/'.length);
      return Object.hasOwn(files, relative)
        ? new Response(files[relative], { status: 200 })
        : new Response('missing', { status: 404 });
    }
    const listing = responseForDirectory(href);
    if (listing) return new Response(JSON.stringify(listing), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`unexpected fetch: ${href}`);
  };
  try {
    process.env.USERPROFILE = path.join(tempRoot, 'profile');
    const result = await installSkill(projectRoot, { sourceUrl: sourceApiSkill, name: 'skill-creator' }, { fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.verification.verified, true);
    assert.equal(result.verification.sourceFileCount, Object.keys(files).length);
    const installedRoot = path.join(process.env.USERPROFILE, '.workbuddy', 'skills', 'skill-creator');
    for (const relative of Object.keys(files)) assert.equal(await fs.readFile(path.join(installedRoot, relative), 'utf8'), files[relative]);
    const metadata = JSON.parse(await fs.readFile(path.join(installedRoot, '.taiji-skill.json'), 'utf8'));
    assert.equal(metadata.installMode, 'directory');
    assert.equal(metadata.packageManifest.expectedFileCount, Object.keys(files).length);
    assert.equal(metadata.packageManifest.source.type, 'github-directory');
    assert.equal(metadata.packageManifest.source.subdirectory, 'skills/skill-creator');
    const readBack = await readSkill(projectRoot, result.skill.id);
    assert.deepEqual(readBack.documents.map((item) => item.path), ['references/guide.md']);
    await fs.rm(path.join(installedRoot, 'agents', 'openai.yaml'));
    await assert.rejects(validatePackageManifest(installedRoot, metadata.packageManifest), /完整包校验未通过/u);
    console.log('verify-skill-directory-contract: PASS');
  } finally {
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`verify-skill-directory-contract: FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
