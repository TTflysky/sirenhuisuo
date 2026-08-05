import { useState, type CSSProperties } from 'react';
import { EllipsisOutlined, MessageOutlined, SwapOutlined } from '@ant-design/icons';
import type { Employee } from '../../types';
import AgentAvatar from './AgentAvatar';
import { resolveAvatarFrame } from '../../data/avatarFrames';
import { employeeBadgeProfile } from '../../data/employeeProfiles';

const POP_EMPLOYEE_ACCENTS = [
  'var(--pop-yellow)',
  'var(--pop-cyan)',
  'var(--pop-red)',
  'var(--pop-green)',
] as const;

interface Props {
  stationIndex: number;
  employee: Employee | null;
  isWorking: boolean;
  onClick?: () => void;
  onEdit?: () => void;
}

/**
 * 纯头像工位卡：大圆形头像（角色色环）+ 名字 + 身份牌 + 状态点。
 * 无桌椅显示器，干净网格。点击员工弹私聊。
 */
export default function Workstation({ stationIndex, employee, isWorking, onClick, onEdit }: Props) {
  const [flipped, setFlipped] = useState(false);
  const hasEmp = employee !== null;
  const frame = employee ? resolveAvatarFrame(employee.avatarFrame) : null;
  const profile = employee ? employeeBadgeProfile(employee) : null;
  const employeeAccentIndex = employee
    ? Math.abs((employee.stationIndex >= 0 ? employee.stationIndex : stationIndex) % POP_EMPLOYEE_ACCENTS.length)
    : 0;
  const employeeAccent = employee ? POP_EMPLOYEE_ACCENTS[employeeAccentIndex] : POP_EMPLOYEE_ACCENTS[0];
  const cardStyle = hasEmp ? ({ '--employee-accent': employeeAccent } as CSSProperties) : undefined;
  const statusLabel = !employee?.isOnline ? '离线' : isWorking || employee.isWorking ? '工作中' : '空闲';
  const openChat = () => onClick?.();
  const flip = (event: React.MouseEvent) => {
    event.stopPropagation();
    setFlipped((value) => !value);
  };

  return (
    <div
      className={`station-card ${hasEmp ? 'occupied employee-id-card' : 'empty'}${flipped ? ' is-flipped' : ''}`}
      data-role={employee?.role}
      style={cardStyle}
      title={hasEmp ? `${employee.name} - ${employee.title}` : `空位 #${stationIndex + 1}`}
    >
      {hasEmp ? (
        <>
          <div className="employee-id-strap" aria-hidden><i /></div>
          <button type="button" className="employee-id-settings" onClick={(event) => { event.stopPropagation(); onEdit?.(); }} title={`编辑${employee.name}的设置`} aria-label={`编辑${employee.name}的设置`}><EllipsisOutlined /></button>
          <button type="button" className="employee-id-flip" onClick={flip} title={flipped ? '查看工牌正面' : '查看详细能力'} aria-label={flipped ? '查看工牌正面' : '查看详细能力'}><SwapOutlined /></button>
          <div className="employee-id-inner">
            <section
              className="employee-id-face employee-id-front"
              aria-hidden={flipped}
              aria-label={`打开与${employee.name}的私聊`}
              onClick={!flipped ? openChat : undefined}
              onKeyDown={(event) => {
                if (!flipped && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  openChat();
                }
              }}
              role="button"
              tabIndex={flipped ? -1 : 0}
            >
              <div className="employee-id-meta"><span>TAIJI STAFF · {String(stationIndex + 1).padStart(2, '0')}</span><i className={!employee.isOnline ? 'offline' : isWorking || employee.isWorking ? 'busy' : 'idle'} /></div>
              <div className="employee-id-identity">
                <div className="station-avatar-ring">
                  <AgentAvatar employee={employee} size={58} />
                  <span className={`station-status ${!employee.isOnline ? 'offline' : isWorking || employee.isWorking ? 'busy' : 'idle'}`} />
                </div>
                <div><div className="station-name">{employee.name}</div><div className="station-title">{employee.title}</div><div className="station-frame-title" style={{ color: frame?.primary }}>{frame?.name}</div></div>
              </div>
              <p className="employee-id-summary">{profile?.summary}</p>
              <div className="employee-id-abilities">{profile?.abilities.slice(0, 3).map((ability) => <span key={ability}>{ability}</span>)}</div>
              <div className="employee-id-foot"><span>{statusLabel}</span><span>TAIJI OFFICE</span></div>
            </section>
            <section className="employee-id-face employee-id-back" aria-hidden={!flipped}>
              <div className="employee-id-back-heading"><div><strong>{employee.name}</strong><span>{employee.title}</span></div><small>能力档案</small></div>
              <p>{profile?.detail}</p>
              <div className="employee-id-abilities is-detail">{profile?.abilities.map((ability) => <span key={ability}>{ability}</span>)}</div>
              <button type="button" className="employee-id-chat" tabIndex={flipped ? 0 : -1} onClick={(event) => { event.stopPropagation(); openChat(); }}><MessageOutlined /> 打开私聊</button>
            </section>
          </div>
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
