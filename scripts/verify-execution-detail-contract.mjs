import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const component = read('src/components/chat/ThoughtChainView.tsx');
const assistant = read('src/components/chat/AssistantChat.tsx');
const directMessage = read('src/components/chat/DmChatApp.tsx');
const team = read('src/components/chat/TeamChatApp.tsx');
const appearance = read('src/data/appearance.ts');
const theme = ['core', 'collaboration', 'appearance', 'settings', 'workspace']
  .map((name) => read(`src/styles/${name}.css`)).join('\n');
const packageVerification = read('scripts/verify-packaged-app.cjs');

for (const [surface, source] of [['assistant', assistant], ['employee direct message', directMessage], ['team', team]]) {
  assert.match(source, /import ThoughtChainView from ['"]\.\/ThoughtChainView['"]/u, `${surface} chat does not import the shared execution detail`);
  assert.match(source, /<ThoughtChainView\s/u, `${surface} chat does not render the shared execution detail`);
}

for (const marker of ['执行详情', '放大查看', '自动换行', '原样显示', '输入参数', '原始结果']) {
  assert.ok(component.includes(marker), `Execution detail control is missing: ${marker}`);
}
assert.match(component, /<Modal[\s\S]*className="cot-detail-modal"/u, 'Wide execution detail modal is missing');
assert.match(theme, /\.cot-step-title[^\n]+font-size:\s*var\(--content-font-size/u, 'Step title does not follow the global content size');
assert.match(theme, /\.cot-detail-section pre[^\n]+font:\s*var\(--content-font-size/u, 'Wide raw detail does not follow the global content size');
assert.match(theme, /\.cot-step-args pre\s*\{\s*white-space:\s*pre/u, 'Arguments no longer preserve horizontal scrolling');
assert.match(theme, /@media \(max-width: 720px\)[\s\S]*\.cot-detail-layout/u, 'Narrow-window detail layout is missing');

const fontValues = [...appearance.matchAll(/value:\s*'([^']+)'/gu)].map((match) => match[1]);
assert.deepEqual(fontValues.slice(0, 6), ['youyuan', 'noto-sans', 'noto-serif', 'source-han-regular', 'source-han-light', 'source-han-bold']);
assert.match(packageVerification, /const requiredFonts = \[/u, 'Packaged font verification is missing');
assert.match(packageVerification, /bundledFonts:\s*requiredFonts\.length/u, 'Packaged font count is not reported');

console.log(JSON.stringify({ passed: true, chatSurfaces: 3, detailControls: 6, bundledFonts: 6 }, null, 2));
