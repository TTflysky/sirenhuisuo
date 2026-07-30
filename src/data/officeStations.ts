import type { Employee } from '../types';

/** Keep a modest amount of empty space without rendering hundreds of fake desks. */
export const DEFAULT_OFFICE_STATIONS = 24;

type StationEmployee = Pick<Employee, 'stationIndex'>;

export function findFreeStation(employees: StationEmployee[]): number {
  const occupied = new Set(
    employees
      .map((employee) => employee.stationIndex)
      .filter((stationIndex) => Number.isSafeInteger(stationIndex) && stationIndex >= 0),
  );
  let stationIndex = 0;
  while (occupied.has(stationIndex)) stationIndex += 1;
  return stationIndex;
}

/** Repairs legacy wrapped or duplicate indices while keeping every employee's seat stable where possible. */
export function repairEmployeeStations<T extends StationEmployee>(employees: T[]): { employees: T[]; changed: boolean } {
  const occupied = new Set<number>();
  let changed = false;

  const repaired = employees.map((employee) => {
    if (Number.isSafeInteger(employee.stationIndex) && employee.stationIndex < 0) return employee;

    let stationIndex = employee.stationIndex;
    if (!Number.isSafeInteger(stationIndex) || stationIndex < 0 || occupied.has(stationIndex)) {
      stationIndex = 0;
      while (occupied.has(stationIndex)) stationIndex += 1;
    }

    occupied.add(stationIndex);
    if (stationIndex === employee.stationIndex) return employee;
    changed = true;
    return { ...employee, stationIndex };
  });

  return { employees: repaired, changed };
}

export function getOfficeStationCount(employees: StationEmployee[]): number {
  const highestStationIndex = employees.reduce(
    (highest, employee) => employee.stationIndex >= 0 ? Math.max(highest, employee.stationIndex) : highest,
    -1,
  );
  const requiredStations = Math.max(DEFAULT_OFFICE_STATIONS, highestStationIndex + 1);
  return requiredStations;
}
