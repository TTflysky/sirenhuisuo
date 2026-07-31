const assert = require('assert');
const fs = require('fs');

const limits = {
  'electron/nativeExecutionAdapter.cjs': 2200,
  'src/data/hermesClient.ts': 2300,
  'src/store.tsx': 2550,
  'src/theme.css': 3850,
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
assert.doesNotMatch(adapter, /function inferStepDeliverableType/u, 'deliverable policy must not move back into the adapter');
assert.doesNotMatch(adapter, /function compensationNeedsApproval/u, 'compensation policy must not move back into the adapter');
const client = fs.readFileSync('src/data/hermesClient.ts', 'utf8');
assert.match(client, /from '\.\/userMemory'/u, 'user memory persistence must remain extracted');
assert.match(client, /from '\.\.\/engine\/imageRequest\.mjs'/u, 'image request routing must remain extracted');

console.log(JSON.stringify({ passed: true, lines }, null, 2));
