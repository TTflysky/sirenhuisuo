import { useMemo, useState } from 'react';
import { CheckOutlined, SearchOutlined, UserAddOutlined } from '@ant-design/icons';
import { Button, Empty, Input, Modal, message } from 'antd';
import { useStore } from '../../storeContext';
import AgentAvatar from '../office/AgentAvatar';
import { AGENCY_EXPERT_CATALOG, expertToEmployee, searchableExpertCatalog } from '../../data/expertCatalog';

interface Props {
  teamId: string;
  onClose: () => void;
}

export default function ManageTeamMembersModal({ teamId, onClose }: Props) {
  const { state, addTeamMembers } = useStore();
  const team = state.teams.find((item) => item.id === teamId);
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const currentIds = useMemo(() => new Set(team?.memberIds ?? []), [team?.memberIds]);
  const availableEmployees = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return state.employees.filter((employee) => {
      if (currentIds.has(employee.id)) return false;
      if (!keyword) return true;
      return employee.name.toLowerCase().includes(keyword) || employee.title.toLowerCase().includes(keyword);
    });
  }, [currentIds, query, state.employees]);
  const catalogExperts = useMemo(() => searchableExpertCatalog(query)
    .filter((expert) => !currentIds.has(expert.id) && !state.employees.some((employee) => employee.id === expert.id)), [currentIds, query, state.employees]);
  const availableTotal = state.employees.filter((employee) => !currentIds.has(employee.id)).length + AGENCY_EXPERT_CATALOG.filter((expert) => !currentIds.has(expert.id) && !state.employees.some((employee) => employee.id === expert.id)).length;
  const currentMembers = (team?.memberIds ?? [])
    .map((id) => state.employees.find((employee) => employee.id === id))
    .filter((employee): employee is NonNullable<typeof employee> => employee !== undefined);

  const toggle = (employeeId: string) => {
    setSelectedIds((current) => current.includes(employeeId)
      ? current.filter((id) => id !== employeeId)
      : [...current, employeeId]);
  };

  const submit = () => {
    const added = addTeamMembers(teamId, selectedIds);
    if (!added.length) {
      message.info('没有可添加的新成员');
      return;
    }
    message.success(`已添加 ${added.length} 名成员`);
    onClose();
  };

  return (
    <Modal
      open
      onCancel={onClose}
      title={<span className="team-members-modal-title"><UserAddOutlined />添加团队成员</span>}
      width={520}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="add" type="primary" icon={<UserAddOutlined />} disabled={!selectedIds.length} onClick={submit}>
          添加 {selectedIds.length ? `(${selectedIds.length})` : ''}
        </Button>,
      ]}
    >
      {!team ? <Empty description="团队不存在或已被删除" /> : <div className="team-members-modal-body">
        <section className="team-members-current" aria-label="当前团队成员">
          <div className="team-members-section-head"><strong>当前成员</strong><span>{currentMembers.length} 人</span></div>
          <div className="team-members-current-list">
            {currentMembers.map((employee) => (
              <span key={employee.id} className="team-members-current-item" title={`${employee.name} - ${employee.title}`}>
                <AgentAvatar employee={employee} size={28} /><span>{employee.name}</span>
              </span>
            ))}
          </div>
        </section>
        <section className="team-members-available" aria-label="可添加员工">
          <div className="team-members-section-head"><strong>选择要加入的员工</strong><span>{availableTotal} 人可选</span></div>
          <Input prefix={<SearchOutlined />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或身份" allowClear />
          <div className="team-members-picker">
            {availableEmployees.map((employee) => {
              const selected = selectedIds.includes(employee.id);
              return (
                <button key={employee.id} type="button" className={`team-members-picker-item${selected ? ' is-selected' : ''}`} onClick={() => toggle(employee.id)}>
                  <AgentAvatar employee={employee} size={34} />
                  <span><strong>{employee.name}</strong><small>{employee.title}</small></span>
                  <i aria-hidden="true">{selected && <CheckOutlined />}</i>
                </button>
              );
            })}
            {!availableEmployees.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? '没有匹配的员工' : '所有员工都已在团队中'} />}
          </div>
        </section>
        <section className="team-members-available team-members-catalog" aria-label="内置专家目录">
          <div className="team-members-section-head"><strong>内置专家目录</strong><span>{catalogExperts.length} 人可选，无人数上限</span></div>
          <div className="team-members-picker">
            {catalogExperts.map((expert, index) => {
              const employee = expertToEmployee(expert, state.employees.length + index);
              const selected = selectedIds.includes(expert.id);
              return (
                <button key={expert.id} type="button" className={`team-members-picker-item${selected ? ' is-selected' : ''}`} onClick={() => toggle(expert.id)} title={`${expert.domain} · ${expert.summary}`}>
                  <AgentAvatar employee={employee} size={34} />
                  <span><strong>{expert.name}</strong><small>{expert.domain} · {expert.summary}</small></span>
                  <i aria-hidden="true">{selected && <CheckOutlined />}</i>
                </button>
              );
            })}
            {!catalogExperts.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的内置专家" />}
          </div>
        </section>
      </div>}
    </Modal>
  );
}
