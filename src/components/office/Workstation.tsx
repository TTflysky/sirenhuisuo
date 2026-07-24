import type { Employee } from '../../types';
import AgentAvatar from './AgentAvatar';

interface Props {
  stationIndex: number;
  employee: Employee | null;
  isWorking: boolean;
  onClick?: () => void;
}

/**
 * 纯头像工位卡：大圆形头像（角色色环）+ 名字 + 身份牌 + 状态点。
 * 无桌椅显示器，干净网格。点击员工弹私聊。
 */
export default function Workstation({ stationIndex, employee, isWorking, onClick }: Props) {
  const hasEmp = employee !== null;

  return (
    <div
      className={`station-card ${hasEmp ? 'occupied' : 'empty'}`}
      data-role={employee?.role}
      onClick={onClick}
      title={hasEmp ? `${employee.name} - ${employee.title}` : `空位 #${stationIndex + 1}`}
    >
      {hasEmp ? (
        <>
          {/* 头像 + 角色色环 + 状态点 */}
          <div className="station-avatar-ring">
            <AgentAvatar employee={employee} size={72} />
            <span className={`station-status ${!employee.isOnline ? 'offline' : isWorking || employee.isWorking ? 'busy' : 'idle'}`} />
          </div>
          <div className="station-name">{employee.name}</div>
          <div className="station-title" style={{ color: employee.statusColor }}>{employee.title}</div>
        </>
      ) : (
        <div className="station-empty-slot">
          <div className="station-empty-circle">+</div>
          <div className="station-empty-text">空位</div>
        </div>
      )}
    </div>
  );
}
