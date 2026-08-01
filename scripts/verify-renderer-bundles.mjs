import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const assets = path.resolve('dist/assets');
const names = (await fs.readdir(assets)).filter((name) => name.endsWith('.js'));
const chunks = await Promise.all(names.map(async (name) => ({ name, bytes: (await fs.stat(path.join(assets, name))).size })));
const find = (prefix) => chunks.find((chunk) => chunk.name.startsWith(prefix));
const main = find('index-');
const catalog = find('expert-catalog-');
const react = find('react-vendor-');
const ui = find('ui-vendor-');

assert.ok(main, 'renderer main chunk is missing');
assert.ok(catalog, 'expert catalog must remain a dedicated data chunk');
assert.ok(react, 'React runtime must remain a dedicated vendor chunk');
assert.ok(ui, 'Ant Design runtime must remain a dedicated vendor chunk');
assert.ok(main.bytes < 1_500_000, `renderer main chunk grew to ${(main.bytes / 1024 / 1024).toFixed(2)} MB`);
assert.ok(catalog.bytes < 4_100_000, `expert catalog chunk grew to ${(catalog.bytes / 1024 / 1024).toFixed(2)} MB`);
assert.ok(chunks.every((chunk) => chunk.bytes < 4_100_000), 'a renderer chunk exceeded the phase C ceiling');

console.log(JSON.stringify({
  passed: true,
  chunks: chunks.sort((a, b) => b.bytes - a.bytes),
  mainReductionFromV31Percent: Number(((1 - main.bytes / 5_140_890) * 100).toFixed(1)),
}, null, 2));
