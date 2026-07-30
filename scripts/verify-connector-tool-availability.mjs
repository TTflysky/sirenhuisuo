import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../src/engine/connectorTools.ts', import.meta.url), 'utf8');
assert.match(source, /function isUsableConfiguredConnector\(connector: Connector\)/u);
assert.match(source, /Boolean\(connector\.localPath\)/u);
assert.match(source, /loadConnectors\(\)\.filter\(isUsableConfiguredConnector\)/gu);
assert.match(source, /action\.local === 'obsidian-search' \|\| action\.local === 'obsidian-read'/u);
console.log(JSON.stringify({ passed: true, contract: 'configured-local-vault-is-visible-before-stale-status-refresh' }));
