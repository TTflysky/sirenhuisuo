import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => fs.readFile(new URL(path, root), 'utf8');
const lines = (source) => source.split(/\r?\n/u).length;

const [store, reducer, persistence, theme, resource, main, packageJson] = await Promise.all([
  read('src/store.tsx'),
  read('src/store/appStateReducer.ts'),
  read('src/store/appStatePersistence.ts'),
  read('src/theme.css'),
  read('src/engine/resourceContract.mjs'),
  read('electron/main.cjs'),
  read('package.json').then(JSON.parse),
]);

assert.match(store, /reduceAppState/u);
assert.match(store, /persistAppStateTransition/u);
assert.doesNotMatch(reducer, /localStorage|saveEmployees|saveTeams|saveTaskRuns/u);
assert.match(persistence, /saveEmployees/u);
assert(lines(store) < 2300, `store.tsx remains too large: ${lines(store)} lines`);

const stylePaths = ['core', 'collaboration', 'appearance', 'settings', 'workspace'];
for (const name of stylePaths) {
  assert.match(theme, new RegExp(`styles/${name}\\.css`, 'u'));
  const source = await read(`src/styles/${name}.css`);
  assert(source.trim().length > 200, `${name}.css is unexpectedly empty`);
}
assert(lines(theme) <= 8, 'theme.css must remain an import-only manifest');

for (const kind of ['web', 'file', 'attachment', 'skill', 'connector', 'employee', 'task']) {
  assert(resource.includes(`'${kind}'`), `Resource kind missing: ${kind}`);
}
assert.match(main, /createWebResourceAcquirer/u);
assert.match(main, /createBrowserPageReader/u);
assert(packageJson.scripts['test:run']);
assert(packageJson.scripts['test:coverage']);

console.log(JSON.stringify({
  passed: true,
  storeLines: lines(store),
  reducerLines: lines(reducer),
  persistenceLines: lines(persistence),
  styleModules: stylePaths.length,
}, null, 2));
