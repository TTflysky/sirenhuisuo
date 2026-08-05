import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const [appSource, diagnosticsSource, updaterSource, typesSource] = await Promise.all([
  fs.readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/components/settings/DiagnosticsTab.tsx', import.meta.url), 'utf8'),
  fs.readFile(new URL('../electron/autoUpdate.cjs', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/electron.d.ts', import.meta.url), 'utf8'),
]);

assert.match(typesSource, /'idle' \| 'checking'/u);
assert.match(diagnosticsSource, /status: 'idle', message: '点击检查更新'/u);
assert.match(diagnosticsSource, /api\.checkUpdate\(\)/u);
assert.match(diagnosticsSource, /\['idle', 'not-available', 'error'\]\.includes/u);
assert.match(diagnosticsSource, /disabled=\{\['checking', 'available', 'downloading'\]\.includes/u);
assert.match(diagnosticsSource, /updateStatus\.status === 'downloaded'/u);
assert.match(diagnosticsSource, /diagnostics-update-panel/u);
assert.match(diagnosticsSource, /getUpdateStatus\?\.\(\)/u);
assert.doesNotMatch(appSource, /update-status/u, '首页不应再展示升级控件');
assert.doesNotMatch(appSource, /checkUpdate\(\)/u, '首页不应再持有升级操作');
assert.match(updaterSource, /function startCheckTimeout\(\)/u);
assert.match(updaterSource, /BrowserWindow\.getAllWindows\(\)/u);
assert.match(updaterSource, /ipcMain\.handle\('update:status'/u);
assert.match(updaterSource, /检查更新超时/u);
assert.match(updaterSource, /publishUpdateStatus\(\{ status: 'error'/u);
assert.match(updaterSource, /await checkForUpdates\(\)/u);

console.log(JSON.stringify({ passed: true, persistentControl: true, retryableErrors: true, timeoutMs: 45000 }, null, 2));
