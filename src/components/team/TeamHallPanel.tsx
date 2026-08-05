import { useMemo, useState } from 'react';
import { App, Button, Dropdown, Modal, Segmented, Tag } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  MoreOutlined,
  PlusOutlined,
  RollbackOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import type { Team } from '../../types';
import { useStore } from '../../storeContext';
import AgentAvatar from '../office/AgentAvatar';
import CreateTeamModal from '../sidebar/CreateTeamModal';
import RenameTeamModal from '../sidebar/RenameTeamModal';

type HallFilter = 'active' | 'archived' | 'all';

export default function TeamHallPanel() {
  const { state, dispatch, openTeamChat } = useStore();
  const { message } = App.useApp();
  const [filter, setFilter] = useState<HallFilter>('active');
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const openCreateTeam = async () => {
    if (!window.electronAPI?.openTool) {
      setShowCreateTeam(true);
      return;
    }
    const result = await window.electronAPI.openTool({ type: 'create-team' });
    if (!result.ok) setShowCreateTeam(true);
  };

  const teams = useMemo(() => {
    const source = filter === 'all'
      ? state.teams
      : state.teams.filter((team) => filter === 'archived' ? team.archived : !team.archived);
    return [...source].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [filter, state.teams]);

  const deleteTeam = (team: Team) => {
    Modal.confirm({
      title: `删除团队“${team.name}”？`,
      content: '团队聊天窗口和团队本身会被删除，任务运行记录会保留。此操作不可撤销。',
      okText: '删除团队',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        dispatch({ type: 'REMOVE_TEAM', id: team.id });
        message.success('团队已删除');
      },
    });
  };

  const menuItems = (team: Team): MenuProps['items'] => [
    { key: 'rename', icon: <EditOutlined />, label: '重命名', onClick: () => setRenamingId(team.id) },
    team.archived
      ? { key: 'restore', icon: <RollbackOutlined />, label: '取消归档', onClick: () => dispatch({ type: 'UPDATE_TEAM', id: team.id, partial: { archived: false, updatedAt: Date.now() } }) }
      : { key: 'archive', icon: <InboxOutlined />, label: '归档团队', onClick: () => dispatch({ type: 'UPDATE_TEAM', id: team.id, partial: { archived: true, updatedAt: Date.now() } }) },
    { type: 'divider' },
    { key: 'delete', icon: <DeleteOutlined />, danger: true, label: '删除团队', onClick: () => deleteTeam(team) },
  ];

  return (
    <main className="team-hall">
      <header className="team-hall-header">
        <div>
          <div className="team-hall-eyebrow"><TeamOutlined /> 团队空间</div>
          <h1>团队大厅</h1>
          <p>已创建的团队集中在这里，授权和组建流程由章北海助理直接在聊天窗口完成。</p>
        </div>
        <div className="team-hall-header-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void openCreateTeam()}>
          新建团队
          </Button>
        <Segmented
          value={filter}
          onChange={(value) => setFilter(value as HallFilter)}
          options={[
            { label: '活跃', value: 'active' },
            { label: '已归档', value: 'archived' },
            { label: '全部', value: 'all' },
          ]}
          />
        </div>
      </header>

      {teams.length === 0 ? (
        <section className="team-hall-empty">
          <TeamOutlined />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void openCreateTeam()}>
            新建团队
          </Button>
          <strong>{filter === 'archived' ? '暂无归档团队' : '暂无已创建团队'}</strong>
          <span>在助理聊天中提出任务，确认团队方案后，团队会出现在这里。</span>
        </section>
      ) : (
        <section className="team-hall-grid" aria-label="团队列表">
          {teams.map((team) => {
            const members = team.memberIds
              .map((id) => state.employees.find((employee) => employee.id === id))
              .filter((employee): employee is NonNullable<typeof employee> => !!employee);
            const latestRun = [...state.taskRuns]
              .filter((run) => run.teamId === team.id)
              .sort((a, b) => b.updatedAt - a.updatedAt)[0];
            const openTasks = (team.tasks ?? []).filter((task) => task.lane !== 'DONE').length;
            return (
              <article className={`team-hall-card ${team.archived ? 'is-archived' : ''}`} key={team.id}>
                <div className="team-hall-card-top">
                  <div className="team-hall-icon">{team.icon || <TeamOutlined />}</div>
                  <div className="team-hall-card-title">
                    <h2>{team.name}</h2>
                    <span>{members.length} 名成员{team.archived ? ' · 已归档' : ''}</span>
                  </div>
                  <Dropdown menu={{ items: menuItems(team) }} trigger={['click']}>
                    <Button type="text" className="team-hall-more" icon={<MoreOutlined />} aria-label={`管理${team.name}`} />
                  </Dropdown>
                </div>

                <div className="team-hall-members" aria-label={`${team.name}成员列表`}>
                  {members.length === 0 ? (
                    <span className="team-hall-no-members">暂无可显示成员</span>
                  ) : members.map((employee) => (
                    <div className="team-hall-member" key={employee.id} title={`${employee.name} · ${employee.title}`}>
                      <AgentAvatar employee={employee} size={44} />
                      <span>{employee.name}</span>
                    </div>
                  ))}
                </div>

                <p className="team-hall-description">{team.description || '暂未填写团队用途。可在团队设置中补充说明。'}</p>
                <div className="team-hall-meta">
                  <Tag color={team.archived ? 'default' : 'green'}>{team.archived ? '已归档' : '运行中'}</Tag>
                  <span>{openTasks ? `${openTasks} 项进行中` : latestRun ? '最近任务已记录' : '尚无进行中任务'}</span>
                </div>
                <Button block icon={<FolderOpenOutlined />} onClick={() => openTeamChat(team.id)}>
                  打开团队聊天
                </Button>
              </article>
            );
          })}
        </section>
      )}

      {renamingId && (
        <RenameTeamModal
          teamId={renamingId}
          currentName={state.teams.find((team) => team.id === renamingId)?.name ?? ''}
          onClose={() => setRenamingId(null)}
        />
      )}
      {showCreateTeam && <CreateTeamModal onClose={() => setShowCreateTeam(false)} />}
    </main>
  );
}
