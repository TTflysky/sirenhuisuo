import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const source = await fs.readFile('src/data/officeStations.ts', 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  fileName: 'src/data/officeStations.ts',
}).outputText;
const layout = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`);

const firstTwelve = Array.from({ length: 12 }, (_, stationIndex) => ({ stationIndex }));
assert.equal(layout.findFreeStation(firstTwelve), 12, '第 13 位员工必须进入新工位，不能覆盖 0 号工位');

const legacy = [...firstTwelve, { stationIndex: 0 }];
const repaired = layout.repairEmployeeStations(legacy);
assert.equal(repaired.changed, true, '旧版重复工位应被识别');
assert.deepEqual(repaired.employees.map((employee) => employee.stationIndex), [...Array(13).keys()]);
assert.equal(layout.getOfficeStationCount(repaired.employees), 999, '办公室默认必须预留 999 个工位');

const largeOffice = Array.from({ length: 999 }, (_, stationIndex) => ({ stationIndex }));
assert.equal(layout.findFreeStation(largeOffice), 999, '工位分配不得存在人数上限');
assert.equal(layout.getOfficeStationCount(largeOffice), 999, '999 名员工必须全部拥有独立工位');

const beyondReservedCapacity = Array.from({ length: 1001 }, (_, stationIndex) => ({ stationIndex }));
assert.equal(layout.findFreeStation(beyondReservedCapacity), 1001, '超过 999 人后仍须继续分配新工位');
assert.equal(layout.getOfficeStationCount(beyondReservedCapacity), 1001, '999 只是预设容量，不能成为员工人数上限');

const withAssistant = [{ stationIndex: -1 }, ...firstTwelve];
assert.equal(layout.findFreeStation(withAssistant), 12, '不在办公室落座的助手不得占用工位');

console.log(JSON.stringify({ passed: true, defaultStations: 999, testedEmployees: 1001, largeOfficeSeats: 1001 }, null, 2));
