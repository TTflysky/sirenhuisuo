const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const archive = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
const sourcePackage = require(path.join(root, 'package.json'));

assert.equal(fs.existsSync(archive), true, `Missing packaged archive: ${archive}`);
const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
assert.equal(packaged.name, sourcePackage.name);
assert.equal(packaged.version, sourcePackage.version);
assert.equal(packaged.main, sourcePackage.main);

const requiredFiles = [
  'electron/commandShell.cjs',
  'electron/connectorAdapters.cjs',
  'electron/taskRuntimeStore.cjs',
  'skills\\ima-skill\\SKILL.md',
  'skills\\ima-skill\\knowledge-base\\SKILL.md',
  'skills\\ima-skill\\notes\\SKILL.md',
];
for (const file of requiredFiles) {
  assert.ok(asar.extractFile(archive, file).length > 0, `Packaged file is empty: ${file}`);
}

const archiveFiles = asar.listPackage(archive);
const rendererBundle = archiveFiles.find((file) => /\\dist\\assets\\index-[^\\]+\.js$/u.test(file));
assert.ok(rendererBundle, 'Packaged renderer bundle was not found');
const rendererSource = asar.extractFile(archive, rendererBundle.replace(/^\\/u, '')).toString('utf8');
for (const marker of ['正在选择可验证动作', '正在对照最初目标重新验收', '模型请求已自动重试 5 次', '任务上下文快照', 'Skill 证据', '连接器证据', '客户端连接器证据', '交付文件事件', '计划图事件', '历史任务检索', '任务回放', '确定性压缩摘要']) {
  assert.match(rendererSource, new RegExp(marker), `ExecutionController marker missing from packaged renderer: ${marker}`);
}

const installer = path.join(root, 'release', `taiji-office-setup-${sourcePackage.version}.exe`);
const blockmap = `${installer}.blockmap`;
const latest = path.join(root, 'release', 'latest.yml');
for (const file of [installer, blockmap, latest]) {
  assert.equal(fs.existsSync(file), true, `Missing release artifact: ${file}`);
  assert.ok(fs.statSync(file).size > 0, `Release artifact is empty: ${file}`);
}

console.log(JSON.stringify({
  passed: true,
  version: packaged.version,
  requiredFiles: requiredFiles.length,
  executionControllerMarkers: 3,
  p1Markers: 9,
  installerBytes: fs.statSync(installer).size,
}, null, 2));
