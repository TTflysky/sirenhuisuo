import { useRef, useState } from 'react';
import {
  DoubleLeftOutlined,
  DoubleRightOutlined,
  DownOutlined,
  ReloadOutlined,
  TeamOutlined,
  UpOutlined,
  UserAddOutlined,
  UserOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useStore } from '../../store';
import type { Employee } from '../../types';
import EmployeeCard from './EmployeeCard';
import TeamList from './TeamList';
import AddEmployeeModal from './AddEmployeeModal';
import CreateTeamModal from './CreateTeamModal';
import EditEmployeeModal from './EditEmployeeModal';
import AssistantModelSelector from './AssistantModelSelector';
import ConnectorPanel from './ConnectorPanel';
import { applySyncProfile } from '../../utils/configSync';

type Filter = 'all' | 'online' | 'working' | 'idle';

export default function SidebarPanel() {
  const { state, openTeamChat, openDmChat } = useStore();
  const [collapsed, setCollapsed] = useState(false);
  const [employeesCollapsed, setEmployeesCollapsed] = useState(() => localStorage.getItem('hermes_office_sidebar_employees_collapsed') === '1');
  const [teamsCollapsed, setTeamsCollapsed] = useState(() => localStorage.getItem('hermes_office_sidebar_teams_collapsed') === '1');
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem('hermes_office_sidebar_width')) || 260);
  const [employeeHeight, setEmployeeHeight] = useState(() => Number(localStorage.getItem('hermes_office_sidebar_employee_height')) || 300);
  const [filter, setFilter] = useState<Filter>('all');
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const syncInputRef = useRef<HTMLInputElement>(null);

  const openToolWindow = async (options: import('../../electron').OpenToolOptions, fallback: () => void) => {
    if (!window.electronAPI?.openTool) { fallback(); return; }
    const result = await window.electronAPI.openTool(options);
    if (!result.ok) fallback();
  };

  const startSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const initial = sidebarWidth;
    const move = (moveEvent: PointerEvent) => setSidebarWidth(Math.max(210, Math.min(420, initial + moveEvent.clientX - startX)));
    const end = (endEvent: PointerEvent) => {
      const next = Math.max(210, Math.min(420, initial + endEvent.clientX - startX));
      setSidebarWidth(next);
      localStorage.setItem('hermes_office_sidebar_width', String(next));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };

  const startSectionResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const initial = employeeHeight;
    const move = (moveEvent: PointerEvent) => setEmployeeHeight(Math.max(130, Math.min(520, initial + moveEvent.clientY - startY)));
    const end = (endEvent: PointerEvent) => {
      const next = Math.max(130, Math.min(520, initial + endEvent.clientY - startY));
      setEmployeeHeight(next);
      localStorage.setItem('hermes_office_sidebar_employee_height', String(next));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };

  const toggleEmployees = () => setEmployeesCollapsed((value) => {
    localStorage.setItem('hermes_office_sidebar_employees_collapsed', value ? '0' : '1');
    return !value;
  });
  const toggleTeams = () => setTeamsCollapsed((value) => {
    localStorage.setItem('hermes_office_sidebar_teams_collapsed', value ? '0' : '1');
    return !value;
  });

  const handleSyncImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const profile = JSON.parse(await file.text()) as unknown;
      if (!confirm('导入员工、团队和模型配置？现有这些配置会被替换，聊天记录不会删除。')) return;
      const result = applySyncProfile(profile);
      alert(`同步配置已导入：${result.employees} 名员工、${result.teams} 个团队、${result.models} 个模型。API Key 需要在本机设置中重新填写。`);
      location.reload();
    } catch (error) {
      alert(`同步配置导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  let filtered = state.employees;
  if (filter === 'online') filtered = filtered.filter((e) => e.isOnline);
  else if (filter === 'working') filtered = filtered.filter((e) => e.isWorking);
  else if (filter === 'idle') filtered = filtered.filter((e) => e.isOnline && !e.isWorking);

  return (
    <>
      <div className={`sidebar ${collapsed ? 'collapsed' : ''}`} style={collapsed ? undefined : { width: sidebarWidth, minWidth: sidebarWidth }}>
        <div className="sidebar-header">
          {!collapsed && <h3><UserOutlined /> 员工</h3>}
          <AssistantModelSelector />
          <button
            className="btn btn-sm sidebar-collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? '展开' : '收起'}
          >
            {collapsed ? <DoubleRightOutlined /> : <DoubleLeftOutlined />}
          </button>
        </div>

        {!collapsed && (
          <>
            <div className={`sidebar-resizable-panel employee-panel ${employeesCollapsed ? 'is-collapsed' : ''}`} style={employeesCollapsed ? undefined : { height: employeeHeight }}>
              <div className="sidebar-section-heading">
                <span>员工列表 <small>{filtered.length}</small></span>
                <button className="sidebar-fold-btn" onClick={toggleEmployees} title={employeesCollapsed ? '展开员工' : '折叠员工'} aria-label={employeesCollapsed ? '展开员工' : '折叠员工'}>{employeesCollapsed ? <DownOutlined /> : <UpOutlined />}</button>
              </div>
              {!employeesCollapsed && <div className="sidebar-section sidebar-filter-section" style={{ paddingTop: 6 }}>
              {(['all', 'online', 'working', 'idle'] as Filter[]).map((f) => (
                <button
                  key={f}
                  className={`sidebar-filter-btn ${filter === f ? 'active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {{ all: '全部', online: '在线', working: '工作中', idle: '空闲' }[f]}
                </button>
              ))}
              </div>}

            {/* 员工列表 */}
              {!employeesCollapsed && <div className="sidebar-section employee-list-section" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {filtered.map((emp) => (
                <EmployeeCard
                  key={emp.id}
                  employee={emp}
                  isWorking={state.status.demoRunning && emp.isWorking}
                  progress={state.status.progress}
                  teams={state.teams}
                  onClick={() => openDmChat(emp.id)}
                  onEdit={(employee) => void openToolWindow({ type: 'edit-employee', refId: employee.id }, () => setEditingEmployee(employee))}
                />
              ))}
              {filtered.length === 0 && (
                <div style={{ textAlign: 'center', padding: 20, fontSize: 12, color: 'var(--text-muted)' }}>暂无员工</div>
              )}
              </div>}
            </div>

            {!employeesCollapsed && !teamsCollapsed && <div className="sidebar-section-resizer" onPointerDown={startSectionResize} title="拖动调整员工与团队区域高度" />}

            {/* 团队列表 */}
            <div className={`sidebar-resizable-panel team-panel ${teamsCollapsed ? 'is-collapsed' : ''}`}>
              <TeamList onTeamClick={openTeamChat} onNewTeam={() => void openToolWindow({ type: 'create-team' }, () => setShowNewTeam(true))} collapsed={teamsCollapsed} onToggle={toggleTeams} />
            </div>

            {/* 连接器区域 */}
            <ConnectorPanel />

            {/* 底部操作 */}
            <div className="sidebar-footer">
              <button className="btn btn-sm btn-primary sidebar-add-employee" onClick={() => void openToolWindow({ type: 'add-employee' }, () => setShowAddEmp(true))}>
                <UserAddOutlined /> 添加员工
              </button>
              <input ref={syncInputRef} type="file" accept="application/json,.json" hidden onChange={handleSyncImport} />
              <div className="sidebar-footer-tools">
                <button className="btn btn-sm" title="导入员工、团队和模型同步配置" onClick={() => syncInputRef.current?.click()}>
                  <UploadOutlined /> 同步
                </button>
                <button className="btn btn-sm" onClick={() => void openToolWindow({ type: 'create-team' }, () => setShowNewTeam(true))} title="新建团队">
                  <TeamOutlined /> 团队
                </button>
                <button
                  className="btn btn-sm"
                  title="清空缓存并重置为初始员工"
                  onClick={() => {
                    if (confirm('清空所有本地数据（员工/团队/聊天）并恢复初始状态？')) {
                      Object.keys(localStorage)
                        .filter((k) => k.startsWith('hermes_office'))
                        .forEach((k) => localStorage.removeItem(k));
                      location.reload();
                    }
                  }}
                >
                  <ReloadOutlined /> 重置
                </button>
              </div>
            </div>
          </>
        )}
        {!collapsed && <div className="sidebar-width-resizer" onPointerDown={startSidebarResize} title="拖动调整侧栏宽度" />}
      </div>

      {/* Modals */}
      {showAddEmp && <AddEmployeeModal onClose={() => setShowAddEmp(false)} />}
      {showNewTeam && <CreateTeamModal onClose={() => setShowNewTeam(false)} />}
      {editingEmployee && (
        <EditEmployeeModal
          employee={editingEmployee}
          onClose={() => setEditingEmployee(null)}
        />
      )}
    </>
  );
}
