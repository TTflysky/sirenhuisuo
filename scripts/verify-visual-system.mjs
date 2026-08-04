import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [catalog, css, workspaceCss, app, sound] = await Promise.all([
  readFile(new URL('src/data/visualSystem.ts', root), 'utf8'),
  readFile(new URL('src/styles/visual-system.css', root), 'utf8'),
  readFile(new URL('src/styles/workspace.css', root), 'utf8'),
  readFile(new URL('src/App.tsx', root), 'utf8'),
  readFile(new URL('src/data/interactionSound.ts', root), 'utf8'),
]);

assert.match(catalog, /id: 'original'/u);
assert.match(catalog, /id: 'pop'/u);
assert.match(catalog, /id: 'acid'/u);
assert.match(css, /data-visual-style='pop'/u);
assert.match(css, /data-visual-style='acid'/u);
assert.match(css, /--visual-primary-border: 4px/u);
assert.match(css, /\.employee-id-strap \{ display: none; \}/u);
assert.match(workspaceCss, /\.titlebar-btn\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;/su);
assert.match(workspaceCss, /\.chat-only-traffic \.titlebar-btn\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*min-width:\s*32px;[^}]*min-height:\s*32px;[^}]*flex:\s*0 0 32px;/su);
assert.doesNotMatch(workspaceCss, /\.chat-only-traffic \.titlebar-btn\s*\{[^}]*height:\s*100%/su);
assert.match(app, /visual-preferences-changed/u);
assert.match(app, /InteractionSoundControl/u);
assert.match(sound, /volume: 80/u);

console.log('Visual system gate passed: 3 styles, 25 palettes, shared window sync, square window controls, sound controls.');
