import type { Employee } from '../../types';
import { MAX_STATIONS } from '../../types';
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
  // 工位→员工映射
  const stationMap = new Map<number, Employee>();
  for (const emp of employees) {
    if (emp.stationIndex >= 0 && emp.stationIndex < MAX_STATIONS) {
      stationMap.set(emp.stationIndex, emp);
    }
  }

  const stations = [];
  for (let i = 0; i < MAX_STATIONS; i++) {
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
    <div className="office-container">
      <div className="office-grid">
        {stations}
      </div>
    </div>
  );
}
