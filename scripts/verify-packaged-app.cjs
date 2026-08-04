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
  'electron/taskWorker.cjs',
  'electron/executionAdapterProtocol.cjs',
  'electron/nativeToolRuntime.cjs',
  'electron/nativeExecutionAdapter.cjs',
  'electron/nativeExecutionProjection.cjs',
  'electron/appIdentityMigration.cjs',
  'electron/executionObservability.cjs',
  'electron/operationDiagnostics.cjs',
  'electron/webArtifactVerifier.cjs',
  'src\\engine\\taskFidelity.mjs',
  'src\\engine\\autonomousControl.mjs',
  'src\\engine\\explicitResourceContract.mjs',
  'src\\engine\\taskRunner.mjs',
  'src\\engine\\toolRegistry.mjs',
  'src\\engine\\turnRuntime.mjs',
  'src\\engine\\capabilityGraph.mjs',
  'src\\engine\\moaRuntime.mjs',
  'skills\\ima-skill\\SKILL.md',
  'skills\\ima-skill\\knowledge-base\\SKILL.md',
  'skills\\ima-skill\\notes\\SKILL.md',
];
for (const file of requiredFiles) {
  assert.ok(asar.extractFile(archive, file).length > 0, `Packaged file is empty: ${file}`);
}

const archiveFiles = asar.listPackage(archive);
const requiredFonts = [
  /\\dist\\assets\\YouYuan-[^\\]+\.ttf$/u,
  /\\dist\\assets\\NotoSansSC-[^\\]+\.ttf$/u,
  /\\dist\\assets\\NotoSerifSC-[^\\]+\.ttf$/u,
  /\\dist\\assets\\SourceHanSansCN-Regular-[^\\]+\.otf$/u,
  /\\dist\\assets\\SourceHanSansCN-Light-[^\\]+\.otf$/u,
  /\\dist\\assets\\SourceHanSansCN-Bold-[^\\]+\.otf$/u,
];
for (const fontPattern of requiredFonts) {
  const bundledFont = archiveFiles.find((file) => fontPattern.test(file));
  assert.ok(bundledFont, `Packaged font was not found: ${fontPattern}`);
  assert.ok(asar.extractFile(archive, bundledFont.replace(/^\\/u, '')).length > 1_000_000, `Packaged font is unexpectedly small: ${bundledFont}`);
}
const rendererBundle = archiveFiles.find((file) => /\\dist\\assets\\index-[^\\]+\.js$/u.test(file));
assert.ok(rendererBundle, 'Packaged renderer bundle was not found');
const rendererSource = asar.extractFile(archive, rendererBundle.replace(/^\\/u, '')).toString('utf8');
for (const marker of ['正在选择可验证动作', '正在对照最初目标重新验收', '模型请求已按', '任务上下文快照', 'Skill 证据', '连接器证据', '客户端连接器证据', '交付文件事件', '计划图事件', '历史任务检索', '任务回放', '确定性压缩摘要', '任务事件账本', '账本完整', '已恢复损坏尾部']) {
  assert.match(rendererSource, new RegExp(marker), `ExecutionController marker missing from packaged renderer: ${marker}`);
}

for (const marker of ['后台 Worker', 'Worker 命令记录', '真实进展', '进程心跳', '新建聊天', '任务已暂停', '正在继续']) {
  assert.match(rendererSource, new RegExp(marker), `Worker marker missing from packaged renderer: ${marker}`);
}
assert.match(rendererSource, /verify_web_artifact/u, 'Built-in Web artifact verification tool is missing from the packaged renderer');
for (const marker of ['自主判断', '动态计划第', '查看判断依据', '最近计划修订', '执行预算判断']) {
  assert.match(rendererSource, new RegExp(marker), `Autonomous-control marker missing from packaged renderer: ${marker}`);
}

const installer = path.join(root, 'release', `taiji-office-setup-${sourcePackage.version}.exe`);
const blockmap = `${installer}.blockmap`;
const latest = path.join(root, 'release', 'latest.yml');
for (const file of [installer, blockmap, latest]) {
  assert.equal(fs.existsSync(file), true, `Missing release artifact: ${file}`);
  assert.ok(fs.statSync(file).size > 0, `Release artifact is empty: ${file}`);
}
const latestSource = fs.readFileSync(latest, 'utf8');
assert.match(latestSource, new RegExp(`^version: ${sourcePackage.version.replaceAll('.', '\\.')}\\s*$`, 'mu'), 'latest.yml version does not match package.json');
assert.match(latestSource, new RegExp(`(?:url|path): taiji-office-setup-${sourcePackage.version.replaceAll('.', '\\.')}\\.exe`, 'u'), 'latest.yml installer path does not match package.json');

console.log(JSON.stringify({
  passed: true,
  version: packaged.version,
  requiredFiles: requiredFiles.length,
  bundledFonts: requiredFonts.length,
  executionControllerMarkers: 3,
  p1Markers: 12,
  installerBytes: fs.statSync(installer).size,
}, null, 2));
