import type { Employee } from '../../types';
import { getOfficeStationCount, repairEmployeeStations } from '../../data/officeStations';
import Workstation from './Workstation';

interface Props {
  employees: Employee[];
  isWorking: (emp: Employee) => boolean;
  onStationClick: (emp: Employee) => void;
}

/**
 * 正俯视办公室：4×3 工位网格平铺，无 3D 斜视。
 * 每个工位一块桌面，员工形象清晰可见。
 */
export default function OfficeView({ employees, isWorking, onStationClick }: Props) {
  // Keep old data with wrapped station indices visible before persistence migration finishes.
  const repairedEmployees = repairEmployeeStations(employees).employees;
  const stationMap = new Map<number, Employee>();
  for (const emp of repairedEmployees) {
    if (emp.stationIndex >= 0) {
      stationMap.set(emp.stationIndex, emp);
    }
  }

  const stations = [];
  const stationCount = getOfficeStationCount(repairedEmployees);
  const onlineCount = employees.filter((employee) => employee.isOnline).length;
  const workingCount = employees.filter((employee) => employee.isOnline && (employee.isWorking || isWorking(employee))).length;
  for (let i = 0; i < stationCount; i++) {
    const emp = stationMap.get(i);
    stations.push(
      <Workstation
        key={i}
        stationIndex={i}
        employee={emp ?? null}
        isWorking={emp ? isWorking(emp) : false}
        onClick={emp ? () => onStationClick(emp) : undefined}
      />
    );
  }

  return (
    <section className="office-workspace">
      <header className="office-overview">
        <div className="office-overview-copy">
          <span className="office-kicker">WORKSPACE</span>
          <h1>办公室</h1>
          <p>团队成员、当前状态与工作席位</p>
        </div>
        <div className="office-summary" aria-label="办公室状态">
          <div><strong>{employees.length}</strong><span>成员</span></div>
          <div><strong>{onlineCount}</strong><span>在线</span></div>
          <div className={workingCount ? 'is-active' : ''}><strong>{workingCount}</strong><span>工作中</span></div>
        </div>
      </header>
      <div className="office-container" role="region" aria-label={`办公室工位，共 ${stationCount} 个位置`} tabIndex={0}>
        <div className="office-grid" data-station-count={stationCount}>
          {stations}
        </div>
      </div>
    </section>
  );
}
