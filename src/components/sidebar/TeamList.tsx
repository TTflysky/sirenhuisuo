import { useState } from 'react';
import { Dropdown, Modal, App } from 'antd';
import type { MenuProps } from 'antd';
import type { Team } from '../../types';
import { useStore } from '../../store';
import RenameTeamModal from './RenameTeamModal';

interface Props {
  onTeamClick: (teamId: string) => void;
  onNewTeam: () => void;
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function TeamList({ onTeamClick, onNewTeam, collapsed = false, onToggle }: Props) {
  const { state, dispatch } = useStore();
  const { message } = App.useApp();
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const activeTeams = state.teams.filter((t) => !t.archived);
  const archivedTeams = state.teams.filter((t) => t.archived);

  const handleDelete = (team: Team) => {
    Modal.confirm({
      title: `删除「${team.name}」？`,
      content: '团队及聊天记录将被永久删除，不可撤销。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        dispatch({ type: 'REMOVE_TEAM', id: team.id });
        message.success('已删除');
      },
    });
  };

  const handleRename = (team: Team) => {
    setRenamingId(team.id);
  };

  const handleArchive = (team: Team) => {
    dispatch({ type: 'UPDATE_TEAM', id: team.id, partial: { archived: true } });
    message.success(`${team.name} 已归档`);
  };

  const handleUnarchive = (team: Team) => {
    dispatch({ type: 'UPDATE_TEAM', id: team.id, partial: { archived: false } });
    message.success(`${team.name} 已恢复`);
  };

  const buildMenuItems = (team: Team): MenuProps['items'] => [
    { key: 'rename', label: '✏️ 重命名', onClick: () => handleRename(team) },
    ...(team.archived
      ? [{ key: 'unarchive', label: '📂 取消归档', onClick: () => handleUnarchive(team) }]
      : [{ key: 'archive', label: '📦 归档', onClick: () => handleArchive(team) }]
    ),
    { type: 'divider' as const },
    { key: 'delete', label: '🗑 删除', danger: true, onClick: () => handleDelete(team) },
  ];

  return (
    <>
      <div className="sidebar-section">
        <div className="sidebar-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>团队</span>
          <span className="sidebar-section-actions">
            {!collapsed && <button className="btn btn-sm" style={{ padding: '2px 8px', fontSize: 10 }} onClick={onNewTeam}>+ 新建</button>}
            <button className="sidebar-fold-btn" onClick={onToggle} title={collapsed ? '展开团队' : '折叠团队'}>{collapsed ? '⌄' : '⌃'}</button>
          </span>
        </div>
        {!collapsed && activeTeams.length === 0 && archivedTeams.length === 0 && (
          <div style={{ padding: 8, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>暂无团队</div>
        )}
        {!collapsed && activeTeams.map((team: Team) => (
          <TeamItem
            key={team.id}
            team={team}
            onClick={() => onTeamClick(team.id)}
            menuItems={buildMenuItems(team)}
          />
        ))}

        {/* 已归档团队 */}
        {!collapsed && archivedTeams.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div
              className="sidebar-section-label"
              style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 12px' }}
            >
              📦 已归档 ({archivedTeams.length})
            </div>
            {archivedTeams.map((team: Team) => (
              <TeamItem
                key={team.id}
                team={team}
                onClick={() => onTeamClick(team.id)}
                menuItems={buildMenuItems(team)}
                archived
              />
            ))}
          </div>
        )}
      </div>

      {renamingId && (
        <RenameTeamModal
          teamId={renamingId}
          currentName={state.teams.find((t) => t.id === renamingId)?.name ?? ''}
          onClose={() => setRenamingId(null)}
        />
      )}
    </>
  );
}

/** 单个团队行：点击打开团队，悬停按钮弹出操作菜单 */
function TeamItem({
  team,
  onClick,
  menuItems,
  archived,
}: {
  team: Team;
  onClick: () => void;
  menuItems: MenuProps['items'];
  archived?: boolean;
}) {
  return (
    <div
      className="employee-card"
      style={{
        margin: '2px 8px',
        width: 'calc(100% - 16px)',
        border: 'none',
        background: 'transparent',
        textAlign: 'left',
        cursor: 'pointer',
        opacity: archived ? 0.55 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: 0,
      }}
      onClick={onClick}
    >
      <span style={{ fontSize: 16 }}>{team.icon ?? '👥'}</span>
      <div className="emp-info" style={{ flex: 1 }}>
        <div className="emp-name">{team.name}</div>
        <div className="emp-title" style={{ fontSize: 10 }}>
          {team.memberIds.length} 人{archived ? ' · 已归档' : ''}
        </div>
      </div>
      {/* 操作菜单按钮 */}
      <Dropdown menu={{ items: menuItems }} trigger={['click']}>
        <span
          className="emp-edit-btn"
          title="团队操作"
          onClick={(e) => e.stopPropagation()}
          style={{ flexShrink: 0 }}
        >
          ⋯
        </span>
      </Dropdown>
    </div>
  );
}
