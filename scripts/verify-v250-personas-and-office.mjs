import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (file) => fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const [catalog, client, app, office, workstation, sidebar, teamHall] = await Promise.all([
  read('src/data/expertCatalog.ts'),
  read('src/data/hermesClient.ts'),
  read('src/App.tsx'),
  read('src/components/office/OfficeView.tsx'),
  read('src/components/office/Workstation.tsx'),
  read('src/components/sidebar/SidebarPanel.tsx'),
  read('src/components/team/TeamHallPanel.tsx'),
]);

assert.match(catalog, /prompt: catalogPrompt\(expert\)/u, '新增专家必须使用精简职责提示词');
assert.match(catalog, /soul: expert\.instructions/u, '新增专家必须将完整规则写入 soul');
assert.match(catalog, /normalizeCatalogEmployeePersonas/u, '必须保留目录专家人格迁移');
assert.match(catalog, /legacyCatalogPrompt/u, '迁移必须能识别旧版混写的提示词');
assert.match(client, /normalizeCatalogEmployeePersonas\(employees\)/u, '启动时必须执行目录员工人格迁移');

assert.match(office, /onStationEdit/u, '办公室必须向工牌传递编辑操作');
assert.match(workstation, /employee-id-settings/u, '办公室工牌必须显示员工设置按钮');
assert.match(app, /type: 'edit-employee'/u, '办公室设置按钮必须打开员工设置窗口');

assert.doesNotMatch(sidebar, /<TeamList/u, '左侧边栏不得再渲染团队列表');
assert.doesNotMatch(sidebar, /team-panel/u, '左侧边栏不得保留团队展示面板');
assert.match(teamHall, /团队大厅/u, '团队大厅必须继续作为团队管理入口');
assert.match(teamHall, /删除团队/u, '团队大厅必须保留删除操作');
assert.match(teamHall, /归档团队/u, '团队大厅必须保留归档操作');

console.log(JSON.stringify({
  passed: true,
  checks: ['catalog-persona-separation', 'legacy-persona-migration', 'office-settings', 'team-hall-only'],
}, null, 2));
