/*
 * Imports the MIT-licensed Agency Agents Chinese role pack into a compact
 * TypeScript asset that is bundled with the desktop client. Usage:
 * node scripts/generate-expert-catalog.cjs <agency-agents-zh-directory>
 */
const fs = require('fs');
const path = require('path');

const sourceDir = process.argv[2];
if (!sourceDir || !fs.existsSync(sourceDir)) {
  throw new Error('Pass the extracted agency-agents-zh directory as the first argument.');
}

const listPath = path.join(sourceDir, 'AGENT-LIST.md');
const list = fs.readFileSync(listPath, 'utf8');
const fileIndex = new Map();

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) walk(full);
    if (entry.isFile() && entry.name.endsWith('.md')) fileIndex.set(entry.name.replace(/\.md$/u, ''), full);
  }
}

walk(sourceDir);

let department = '';
const entries = [];
for (const line of list.split(/\r?\n/u)) {
  const heading = line.match(/^##\s+(.+?)(?:\s+\([^)]*\))?\s*$/u);
  if (heading) {
    department = heading[1].trim();
    continue;
  }
  const row = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/u);
  if (!row) continue;
  const [, agentId, name, summary, sourceType] = row;
  const file = fileIndex.get(agentId);
  if (!file) throw new Error(`No role file found for ${agentId}`);
  const relativePath = path.relative(sourceDir, file).replace(/\\/gu, '/');
  const instructions = fs.readFileSync(file, 'utf8').replace(/^---[\s\S]*?---\s*/u, '').trim();
  entries.push({
    id: `agency:${agentId}`,
    agentId,
    name: name.trim(),
    title: name.trim(),
    domain: department,
    summary: summary.trim(),
    sourceType: sourceType.trim(),
    instructions,
    sourcePath: relativePath,
    sourceUrl: `https://github.com/jnMetaCode/agency-agents-zh/blob/main/${relativePath}`,
    license: 'MIT',
    sourceVersion: '2026-07-30',
  });
}

if (entries.length < 260) throw new Error(`Expected the complete role pack, found ${entries.length} entries.`);
const output = [
  '// Generated from the MIT-licensed jnMetaCode/agency-agents-zh role pack.',
  '// Do not edit by hand. Regenerate with scripts/generate-expert-catalog.cjs.',
  "import type { ExpertCatalogEntry } from '../types';",
  '',
  `export const AGENCY_EXPERT_CATALOG: ExpertCatalogEntry[] = ${JSON.stringify(entries, null, 2)};`,
  '',
].join('\n');
fs.writeFileSync(path.join(process.cwd(), 'src', 'data', 'generatedExpertCatalog.ts'), output, 'utf8');
console.log(`Generated ${entries.length} bundled expert profiles.`);
