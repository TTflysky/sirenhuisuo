import type { Team } from '../../types';
import { useStore } from '../../store';

interface Props {
  onTeamClick: (teamId: string) => void;
  onNewTeam: () => void;
}

export default function TeamList({ onTeamClick, onNewTeam }: Props) {
  const { state } = useStore();

  return (
    <div className="sidebar-section">
      <div className="sidebar-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>团队</span>
        <button className="btn btn-sm" style={{ padding: '2px 8px', fontSize: 10 }} onClick={onNewTeam}>+ 新建</button>
      </div>
      {state.teams.map((team: Team) => (
        <button
          key={team.id}
          className="employee-card"
          style={{ margin: '2px 8px', width: 'calc(100% - 16px)', border: 'none', background: 'transparent', textAlign: 'left' }}
          onClick={() => onTeamClick(team.id)}
        >
          <span style={{ fontSize: 16 }}>{team.icon ?? '👥'}</span>
          <div className="emp-info">
            <div className="emp-name">{team.name}</div>
            <div className="emp-title" style={{ fontSize: 10 }}>{team.memberIds.length} 人</div>
          </div>
        </button>
      ))}
    </div>
  );
}
