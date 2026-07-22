import { useState } from 'react';
import { useStore } from '../../store';

interface Props {
  onClose: () => void;
}

export default function CreateTeamModal({ onClose }: Props) {
  const { createTeam, state } = useStore();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('🏢');
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const toggleMember = (id: string) => {
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const handleSubmit = () => {
    if (!name.trim()) return alert('请输入团队名称');
    createTeam(name.trim(), icon, memberIds);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <h2>🏢 新建团队</h2>

        <div style={{ display: 'flex', gap: 10 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">团队名称 *</label>
            <input
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如：前端开发组"
              autoFocus
            />
          </div>
          <div className="form-group" style={{ flex: 0.4 }}>
            <label className="form-label">图标</label>
            <input
              className="form-input"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={2}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">选择成员（可多选）</label>
          <div className="checkbox-group">
            {state.employees.map((emp) => (
              <label key={emp.id} className="checkbox-item">
                <input
                  type="checkbox"
                  checked={memberIds.includes(emp.id)}
                  onChange={() => toggleMember(emp.id)}
                />
                <span>{emp.name}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>{emp.title}</span>
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onClose}>取消</button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={!name.trim() || memberIds.length === 0}
          >
            创建团队 ({memberIds.length})
          </button>
        </div>
      </div>
    </div>
  );
}
