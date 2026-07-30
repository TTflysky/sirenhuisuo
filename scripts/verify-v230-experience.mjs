import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const read = (file) => fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const [office, workstation, profiles, theme, settingsUi, avatarUi, client, optimizer, parserSource] = await Promise.all([
  read('src/components/office/OfficeView.tsx'),
  read('src/components/office/Workstation.tsx'),
  read('src/data/employeeProfiles.ts'),
  read('src/theme.css'),
  read('src/components/settings/SettingsModal.tsx'),
  read('src/components/sidebar/EmployeeAvatarPicker.tsx'),
  read('src/data/hermesClient.ts'),
  read('src/diagnostics/diagnosticOptimizer.ts'),
  read('src/data/generatedAvatar.ts'),
]);

const categoryIds = ['product', 'design', 'engineering', 'data-ai', 'content', 'growth', 'business', 'finance-law', 'people-education', 'geo', 'support'];
for (const id of categoryIds) assert.match(profiles, new RegExp(`id: '${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`), `缺少员工分类 ${id}`);
assert.match(office, /categoryCounts/u, '办公室必须展示实时分类人数');
assert.match(office, /visibleEmployees\.filter|repairedEmployees\.filter/u, '分类必须过滤真实员工目录');
assert.match(office, /key=\{emp\?\.id/u, '分类切换时工牌状态必须按员工隔离');

for (const marker of ['employee-id-front', 'employee-id-back', 'employee-id-summary', 'employee-id-abilities', 'employee-id-chat']) {
  assert.ok(workstation.includes(marker), `工牌缺少 ${marker}`);
}
assert.match(workstation, /aria-label=\{`打开与\$\{employee\.name\}的私聊`\}/u, '工牌正面必须有明确的键盘操作名称');
assert.match(workstation, /tabIndex=\{flipped \? 0 : -1\}/u, '隐藏的工牌背面按钮不能进入键盘焦点');
assert.match(theme, /content-visibility:\s*auto/u, '大量员工的离屏工牌必须跳过渲染');
assert.match(theme, /prefers-reduced-motion:\s*reduce/u, '翻面动画必须尊重减少动态效果设置');

for (const field of ['diagnosticModelId', 'imageModelId']) {
  assert.ok(client.includes(field), `设置模型缺少 ${field}`);
  assert.ok(settingsUi.includes(field), `模型设置页缺少 ${field}`);
}
assert.match(settingsUi, /if \(s\.diagnosticModelId === id\) s\.diagnosticModelId = undefined/u, '删除模型必须清理诊断指派');
assert.match(settingsUi, /if \(s\.imageModelId === id\) s\.imageModelId = undefined/u, '删除模型必须清理生图指派');
assert.match(avatarUi, /generateEmployeeAvatarImage/u, '头像库必须调用专用生图接口');
assert.match(avatarUi, /使用这个头像/u, '生成结果不得自动覆盖当前头像');

const parserJs = ts.transpileModule(parserSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  fileName: 'src/data/generatedAvatar.ts',
}).outputText;
const parser = await import(`data:text/javascript;base64,${Buffer.from(parserJs).toString('base64')}`);
const base64 = parser.parseGeneratedAvatarPayload({ data: [{ b64_json: 'a'.repeat(24), revised_prompt: 'revised' }] });
assert.equal(base64.kind, 'data');
assert.equal(base64.dataUrl, `data:image/png;base64,${'a'.repeat(24)}`);
assert.equal(base64.revisedPrompt, 'revised');
const url = parser.parseGeneratedAvatarPayload({ data: [{ url: 'https://images.example/avatar.png' }] });
assert.deepEqual(url, { kind: 'url', url: 'https://images.example/avatar.png', revisedPrompt: undefined });
assert.throws(() => parser.parseGeneratedAvatarPayload({ data: [{}] }), /既没有返回 Base64/u);

assert.match(optimizer, /new Set<DiagnosticArea>\(\['skill', 'permission'\]\)/u, '诊断模型自动修复白名单只能包含 Skill 与权限策略');
assert.doesNotMatch(optimizer, /autoFixAreas[^\n]*(?:model|connector|workspace|runtime)/u, '诊断模型不能自动修改模型、连接器、工作区或运行时');
assert.match(optimizer, /saveExecutionPolicy\(\{ sandboxEnabled: true, approvalMode: 'delegate', connectorApprovalMode: 'delegate' \}\)/u, '一键优化只能恢复推荐的可逆安全策略');
assert.match(optimizer, /await runSystemDiagnostics\(\)/u, '一键优化后必须自动复检');

console.log(JSON.stringify({
  passed: true,
  categories: categoryIds.length,
  badgeSides: 2,
  imageResponses: ['base64', 'url', 'invalid'],
  automaticDiagnosticAreas: ['skill', 'permission'],
}, null, 2));
