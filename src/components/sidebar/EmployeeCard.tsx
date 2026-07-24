import type { Employee, DiscussionProgress, Team } from '../../types';
import AgentAvatar from '../office/AgentAvatar';
import { resolveAvatarFrame } from '../../data/avatarFrames';

interface Props {
  employee: Employee;
  isWorking?: boolean;
  progress?: DiscussionProgress;  // 当前是否在团队 AI 讨论中
  teams?: Team[];                  // 员工所属团队（用于显示"在 X 团队"）
  onClick: () => void;
  onEdit?: (emp: Employee) => void;  // 编辑回调
}

export default function EmployeeCard({ employee, isWorking, progress, teams, onClick, onEdit }: Props) {
  const frame = resolveAvatarFrame(employee.avatarFrame);
  const isInDiscussion = !!progress && progress.currentEmpId === employee.id;
  const statusColor = !employee.isOnline
    ? 'var(--offline)'
    : isInDiscussion || isWorking || employee.isWorking
      ? 'var(--busy)'
      : 'var(--online)';

  // 员工当前状态描述
  const statusText = isInDiscussion
    ? `💭 在 ${progress?.teamName} 思考中 (${progress?.step}/${progress?.totalSteps})`
    : !employee.isOnline
      ? '离线'
      : isWorking || employee.isWorking
        ? '工作中'
        : '空闲';

  // 员工所属团队（取第一个）
  const myTeam = teams?.find((t) => t.memberIds.includes(employee.id));

  return (
    <div className="employee-card" data-role={employee.role} onClick={onClick}>
      <div className="emp-avatar-wrap">
        <AgentAvatar employee={employee} size={26} />
        <div className="emp-status-dot" style={{ background: statusColor }} />
      </div>
      <div className="emp-info">
        <div className="emp-name" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {employee.name}
          {employee.modelConfig && (
            <span className="emp-model-badge" title="使用独立模型配置">🔄</span>
          )}
        </div>
        <div className="emp-title" style={{ color: employee.statusColor }}>{employee.title}</div>
        <div className="emp-frame-title" style={{ color: frame.primary }}>{frame.name}</div>
        <div className="emp-work">
          {isInDiscussion && (
            <span className="emp-work-busy">● {statusText}</span>
          )}
          {!isInDiscussion && (isWorking || employee.isWorking) && (
            <span className="emp-work-busy">● 工作中</span>
          )}
          {!isInDiscussion && !isWorking && !employee.isWorking && myTeam && (
            <span className="emp-work-team">在 {myTeam.icon ?? '👥'} {myTeam.name}</span>
          )}
          {!isInDiscussion && !isWorking && !employee.isWorking && !myTeam && (
            <span className="emp-work-idle">空闲</span>
          )}
        </div>
      </div>
      {onEdit && (
        <button
          className="emp-edit-btn"
          title="编辑员工配置"
          onClick={(e) => { e.stopPropagation(); onEdit(employee); }}
        >
          ✏️
        </button>
      )}
    </div>
  );
}
