import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [catalog, css, workspaceCss, runtimeCss, collaborationCss, app, sound, workstation] = await Promise.all([
  readFile(new URL('src/data/visualSystem.ts', root), 'utf8'),
  readFile(new URL('src/styles/visual-system.css', root), 'utf8'),
  readFile(new URL('src/styles/workspace.css', root), 'utf8'),
  readFile(new URL('src/styles/runtime-observer.css', root), 'utf8'),
  readFile(new URL('src/styles/collaboration.css', root), 'utf8'),
  readFile(new URL('src/App.tsx', root), 'utf8'),
  readFile(new URL('src/data/interactionSound.ts', root), 'utf8'),
  readFile(new URL('src/components/office/Workstation.tsx', root), 'utf8'),
]);

assert.match(catalog, /id: 'original'/u);
assert.match(catalog, /id: 'pop'/u);
assert.match(catalog, /id: 'acid'/u);
assert.match(css, /data-visual-style='pop'/u);
assert.match(css, /data-visual-style='acid'/u);
assert.match(css, /--visual-primary-border: 4px/u);
assert.match(css, /\.employee-id-strap \{ display: none; \}/u);
assert.match(css, /\.office-summary \{[^}]*background:\s*var\(--pop-surface\)/su);
assert.match(css, /\.office-summary \{[^}]*grid-template-columns:\s*repeat\(3, 88px\)/su);
assert.match(css, /\.office-summary \{[^}]*border:\s*var\(--visual-primary-border\)/su);
assert.match(css, /\.office-summary > div \{[^}]*background:\s*var\(--pop-surface\)/su);
assert.match(css, /\.office-summary > div\.is-active \{[^}]*background:\s*var\(--pop-yellow\)/su);
assert.match(css, /\.office-workspace \.office-container \{[\s\S]*?background-image:[\s\S]*?linear-gradient[\s\S]*?radial-gradient/su);
assert.doesNotMatch(css, /\.employee-id-face \{[^}]*border-top:\s*12px solid var\(--pop-cyan\)/su);
assert.match(css, /\.employee-id-meta \{[^}]*background:\s*var\(--employee-accent\)/su);
assert.match(css, /\.employee-id-meta > i \{\s*display:\s*none;/su);
assert.match(css, /\.employee-id-foot \{[^}]*background:\s*var\(--pop-ink\)/su);
assert.match(workstation, /--employee-accent/u);
assert.match(workspaceCss, /\.titlebar-btn\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;[^}]*min-width:\s*34px;[^}]*min-height:\s*34px;[^}]*flex:\s*0 0 34px;/su);
assert.match(workspaceCss, /\.chat-only-traffic \.titlebar-btn\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;[^}]*min-width:\s*34px;[^}]*min-height:\s*34px;[^}]*flex:\s*0 0 34px;/su);
assert.doesNotMatch(workspaceCss, /\.chat-only-traffic \.titlebar-btn\s*\{[^}]*height:\s*100%/su);
assert.match(css, /data-visual-style='pop'\] \.app-root[\s\S]*?padding:\s*0;[\s\S]*?gap:\s*0;/u);
assert.match(css, /data-visual-style='pop'\] \.titlebar-btn\s*\{[^}]*border:\s*var\(--visual-secondary-border\)\s+solid\s+var\(--pop-ink\)/su);
assert.match(css, /data-visual-style='pop'\] \.sidebar\s*\{[^}]*width:\s*258px;[^}]*min-width:\s*258px;/su);
assert.match(css, /data-visual-style='pop'\] \.team-hall\s*\{[^}]*background-image:\s*radial-gradient/su);
assert.match(css, /data-visual-style='pop'\] \.team-hall-card\s*\{[^}]*border:\s*var\(--visual-primary-border\) solid var\(--pop-ink\);[^}]*box-shadow:\s*6px 6px 0 var\(--pop-ink\)/su);
assert.match(css, /data-visual-style='pop'\] \.team-hall-members\s*\{[^}]*border:\s*var\(--visual-secondary-border\) solid var\(--pop-ink\)/su);
assert.match(css, /data-visual-style='acid'\] \.team-hall-card\s*\{[^}]*background:\s*#111411/su);
assert.match(runtimeCss, /\.runtime-demo-shell\s*\{[^}]*--runtime-ink:\s*var\(--text\);[^}]*--runtime-paper:\s*var\(--bg\);[^}]*--runtime-surface:\s*var\(--surface\);[^}]*--runtime-line:\s*var\(--border\);[^}]*--runtime-muted:\s*var\(--text-muted\);[^}]*color:\s*var\(--runtime-ink\);/su);
assert.doesNotMatch(runtimeCss, /\.runtime-demo-shell\s*\{[^}]*(?:--runtime-paper:\s*#f4f4f1|--runtime-surface:\s*#fff(?:fff)?|--runtime-ink:\s*#181818)/su);
assert.match(runtimeCss, /\.runtime-demo-shell \.msg\.human \.msg-bubble\s*\{[^}]*color:\s*var\(--runtime-surface\);/su);
assert.match(collaborationCss, /\.runtime-demo-shell \.chat-composer\s*\{[^}]*background:\s*var\(--runtime-surface\);/su);
assert.doesNotMatch(collaborationCss, /(?:^|\n)\.chat-composer\s*\{[^}]*var\(--runtime-(?:ink|surface)\)/su);
assert.match(app, /visual-preferences-changed/u);
assert.match(app, /InteractionSoundControl/u);
assert.match(sound, /volume: 80/u);

console.log('Visual system gate passed: 3 styles, 25 palettes, shared window sync, square window controls, sound controls.');
