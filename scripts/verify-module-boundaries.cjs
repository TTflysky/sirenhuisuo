const assert = require('assert');
const fs = require('fs');

const limits = {
  'electron/nativeExecutionAdapter.cjs': 2150,
  'src/data/hermesClient.ts': 2200,
  'src/store.tsx': 2300,
  'src/theme.css': 8,
  'src/styles/core.css': 500,
  'src/styles/collaboration.css': 1500,
  'src/styles/appearance.css': 500,
  'src/styles/settings.css': 400,
  'src/styles/workspace.css': 1800,
};
const lines = {};
for (const [file, maximum] of Object.entries(limits)) {
  const source = fs.readFileSync(file, 'utf8');
  const count = source.split(/\r?\n/u).length;
  lines[file] = count;
  assert.ok(count <= maximum, `${file} grew to ${count} lines; boundary is ${maximum}`);
}

const adapter = fs.readFileSync('electron/nativeExecutionAdapter.cjs', 'utf8');
assert.match(adapter, /require\('\.\/nativeExecutionPolicy\.cjs'\)/u, 'native execution policy must remain extracted');
assert.match(adapter, /require\('\.\/nativeExecutionProjection\.cjs'\)/u, 'native execution public projection must remain extracted');
assert.doesNotMatch(adapter, /semanticState:\s*projectExecutionState/u, 'native job projection must not move back into the adapter');
assert.doesNotMatch(adapter, /function inferStepDeliverableType/u, 'deliverable policy must not move back into the adapter');
assert.doesNotMatch(adapter, /function compensationNeedsApproval/u, 'compensation policy must not move back into the adapter');
const client = fs.readFileSync('src/data/hermesClient.ts', 'utf8');
assert.match(client, /from '\.\/userMemory'/u, 'user memory persistence must remain extracted');
assert.match(client, /from '\.\.\/engine\/imageRequest\.mjs'/u, 'image request routing must remain extracted');
assert.match(client, /from '\.\/appStateStorage'/u, 'app state persistence must remain extracted');
assert.doesNotMatch(client, /function cleanChatMessages/u, 'chat persistence must not move back into the client');
const store = fs.readFileSync('src/store.tsx', 'utf8');
assert.match(store, /from '\.\/store\/nativeEmployeeProjection'/u, 'native employee status projection must remain extracted');
assert.doesNotMatch(store, /for \(const step of run\.steps\)/u, 'worker presence projection must not move back into the store');

console.log(JSON.stringify({ passed: true, lines }, null, 2));
