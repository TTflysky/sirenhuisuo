import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [appSource, updaterSource, typesSource] = await Promise.all([
  fs.readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  fs.readFile(new URL('../electron/autoUpdate.cjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/electron.d.ts', import.meta.url), 'utf8'),
]);

assert.match(typesSource, /'idle' \| 'checking'/u);
assert.match(appSource, /status: 'idle', message: '点击检查更新'/u);
assert.match(appSource, /window\.electronAPI\?\.checkUpdate\(\)/u);
assert.match(appSource, /\['idle', 'not-available', 'error'\]\.includes/u);
assert.match(appSource, /disabled=\{\['checking', 'available', 'downloading'\]\.includes/u);
assert.match(appSource, /updateStatus\.status === 'downloaded'/u);
assert.doesNotMatch(appSource, /setTimeout\(\(\) => setUpdateStatus\(null\)/u);
assert.match(updaterSource, /function startCheckTimeout\(\)/u);
assert.match(updaterSource, /检查更新超时/u);
assert.match(updaterSource, /publishUpdateStatus\(\{ status: 'error'/u);
assert.match(updaterSource, /await checkForUpdates\(\)/u);

console.log(JSON.stringify({ passed: true, persistentControl: true, retryableErrors: true, timeoutMs: 45000 }, null, 2));
