import { useRef, useState } from 'react';
import { UploadOutlined } from '@ant-design/icons';
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
  const { state, openTeamChat, openDmChat, openAssistantChat } = useStore();
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const syncInputRef = useRef<HTMLInputElement>(null);

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
      <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          {!collapsed && <h3>👥 员工</h3>}
          <button className="btn btn-sm" onClick={openAssistantChat} title="打开章北海助理" style={{ marginRight: 4 }}>
            🤖 助手
          </button>
          <AssistantModelSelector />
          <button
            className="btn btn-sm"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? '展开' : '收起'}
          >
            {collapsed ? '▶' : '◀'}
          </button>
        </div>

        {!collapsed && (
          <>
            {/* 状态筛选 */}
            <div className="sidebar-section" style={{ paddingTop: 6 }}>
              {(['all', 'online', 'working', 'idle'] as Filter[]).map((f) => (
                <button
                  key={f}
                  style={{
                    padding: '4px 12px', margin: '0 8px', border: 'none',
                    background: filter === f ? 'var(--bg-deep)' : 'transparent',
                    borderRadius: 6, cursor: 'pointer', fontSize: 11,
                    color: filter === f ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: filter === f ? 600 : 400,
                    transition: 'all 0.15s',
                  }}
                  onClick={() => setFilter(f)}
                >
                  {{ all: '全部', online: '在线 🟢', working: '工作中 💪', idle: '空闲 😴' }[f]}
                </button>
              ))}
            </div>

            {/* 员工列表 */}
            <div className="sidebar-section" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {filtered.map((emp) => (
                <EmployeeCard
                  key={emp.id}
                  employee={emp}
                  isWorking={state.status.demoRunning && emp.isWorking}
                  progress={state.status.progress}
                  teams={state.teams}
                  onClick={() => openDmChat(emp.id)}
                  onEdit={setEditingEmployee}
                />
              ))}
              {filtered.length === 0 && (
                <div style={{ textAlign: 'center', padding: 20, fontSize: 12, color: 'var(--text-muted)' }}>暂无员工</div>
              )}
            </div>

            {/* 团队列表 */}
            <TeamList onTeamClick={openTeamChat} onNewTeam={() => setShowNewTeam(true)} />

            {/* 连接器区域 */}
            <ConnectorPanel />

            {/* 底部操作 */}
            <div style={{ padding: '10px 14px', display: 'flex', gap: 8 }}>
              <button className="btn btn-sm" title="导入员工、团队和模型同步配置" onClick={() => syncInputRef.current?.click()}>
                <UploadOutlined /> 同步
              </button>
              <input ref={syncInputRef} type="file" accept="application/json,.json" hidden onChange={handleSyncImport} />
              <button className="btn btn-sm btn-primary" style={{ flex: 1 }} onClick={() => setShowAddEmp(true)}>
                + 添加员工
              </button>
              <button
                className="btn btn-sm"
                onClick={() => setShowNewTeam(true)}
                title="新建团队"
              >
                + 团队
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
                ↺
              </button>
            </div>
          </>
        )}
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
