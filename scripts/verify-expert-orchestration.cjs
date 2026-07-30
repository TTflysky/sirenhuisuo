const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const catalogSource = fs.readFileSync(path.join(root, 'src', 'data', 'generatedExpertCatalog.ts'), 'utf8');
const matched = catalogSource.match(/AGENCY_EXPERT_CATALOG: ExpertCatalogEntry\[\] = (\[[\s\S]*\]);\s*$/u);
assert(matched, 'Generated expert catalog is not a parseable data array');
const catalog = JSON.parse(matched[1]);
assert(catalog.length >= 268, `Expected the complete expert roster, found ${catalog.length}`);
assert.equal(new Set(catalog.map((expert) => expert.id)).size, catalog.length, 'Expert IDs must be unique');
assert(catalog.every((expert) => expert.license === 'MIT' && expert.sourceUrl && expert.instructions), 'Every expert must keep license, source and bundled instructions');
assert(catalog.some((expert) => expert.agentId === 'engineering-multi-agent-systems-architect'), 'Missing multi-agent systems architect');
assert(catalog.some((expert) => expert.agentId === 'design-ui-designer'), 'Missing UI designer');
const officeMigrationBytes = Buffer.byteLength(JSON.stringify(catalog.map((expert, index) => ({
  id: expert.id,
  catalogId: expert.id,
  source: 'catalog',
  name: expert.name,
  title: expert.domain,
  prompt: `${expert.summary}\n\n专业工作规则：\n${expert.instructions}`,
  stationIndex: index,
}))));
assert(officeMigrationBytes < 4_500_000, `Full expert office migration is too large for conservative local storage limits: ${officeMigrationBytes}`);

const store = fs.readFileSync(path.join(root, 'src', 'store.tsx'), 'utf8');
assert(store.includes('employeePlanningPool'), 'Project composition must consider the built-in expert catalog');
assert(store.includes('taskExecutionSyncMembers'), 'Adding experts to a live team must refresh the native execution roster');
const adapter = fs.readFileSync(path.join(root, 'electron', 'nativeExecutionAdapter.cjs'), 'utf8');
assert(adapter.includes('async function syncMembers'), 'Native adapter must support roster synchronization');
assert(adapter.includes('memberRosterVersion'), 'Roster changes must be versioned for audit and recovery');
const catalogAdapter = fs.readFileSync(path.join(root, 'src', 'data', 'expertCatalog.ts'), 'utf8');
const initialLoad = fs.readFileSync(path.join(root, 'src', 'data', 'hermesClient.ts'), 'utf8');
const stations = fs.readFileSync(path.join(root, 'src', 'data', 'officeStations.ts'), 'utf8');
assert(catalogAdapter.includes('materializeCatalogEmployees'), 'Catalog experts must be materialized into real office employees');
assert(catalogAdapter.includes('avatarFrame: { presetId:'), 'Catalog employees must receive stable avatar frames');
assert(initialLoad.includes('materializeCatalogEmployees(employees)'), 'Client initialization must migrate every missing catalog expert');
assert(stations.includes('DEFAULT_OFFICE_STATIONS = 24'), 'Office must not render the old fixed 999 empty desks');

console.log(`Expert orchestration verification passed: ${catalog.length} bundled MIT-licensed experts, ${officeMigrationBytes} bytes for the office roster, catalog composition and live roster synchronization present.`);
