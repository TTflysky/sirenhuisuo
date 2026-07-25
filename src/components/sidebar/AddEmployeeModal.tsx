import { useState } from 'react';
import { UserAddOutlined } from '@ant-design/icons';
import type { AvatarFrameConfig, OpcRoleId } from '../../types';
import { useStore } from '../../store';
import EmployeeAppearanceFields from './EmployeeAppearanceFields';
import EmployeeAvatarPicker from './EmployeeAvatarPicker';
import { generateDistinctEmployeeColor } from '../../data/employeeColors';

interface Props {
  onClose: () => void;
}

export default function AddEmployeeModal({ onClose }: Props) {
  const { addEmployee, state } = useStore();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [role, setRole] = useState<OpcRoleId>('custom');
  const [avatar, setAvatar] = useState('member01');
  const [avatarKind, setAvatarKind] = useState<'preset' | 'custom'>('preset');
  const [prompt, setPrompt] = useState('');
  const [statusColor, setStatusColor] = useState(() => (
    generateDistinctEmployeeColor(state.employees.map((employee) => employee.statusColor))
  ));
  const [avatarFrame, setAvatarFrame] = useState<AvatarFrameConfig>({ presetId: 'standard' });

  const handleSubmit = () => {
    if (!name.trim()) {
      window.alert('请输入姓名');
      return;
    }
    addEmployee(
      name.trim(),
      title.trim() || role.toUpperCase(),
      role,
      avatar,
      avatarKind,
      statusColor,
      prompt.trim() || undefined,
      avatarFrame,
    );
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-box employee-editor-modal">
        <h2><UserAddOutlined /> 添加员工</h2>

        <div className="form-group">
          <label className="form-label">姓名 *</label>
          <input
            className="form-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="输入员工名字"
            autoFocus
          />
        </div>

        <div className="employee-editor-row">
          <div className="form-group">
            <label className="form-label">身份牌</label>
            <input
              className="form-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：架构师 / 测试工程师"
            />
          </div>
          <div className="form-group">
            <label className="form-label">角色</label>
            <select className="form-select" value={role} onChange={(event) => setRole(event.target.value as OpcRoleId)}>
              <option value="pm">PM 协调者</option>
              <option value="planner">Planner 规划者</option>
              <option value="coder">Coder 编码者</option>
              <option value="checker">Checker 审查者</option>
              <option value="custom">自定义</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">员工头像</label>
          <EmployeeAvatarPicker
            avatar={avatar}
            avatarKind={avatarKind}
            onChange={(nextAvatar, nextKind) => {
              setAvatar(nextAvatar);
              setAvatarKind(nextKind);
            }}
          />
        </div>

        <div className="form-group">
          <label className="form-label">个性提示词</label>
          <textarea
            className="form-textarea"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：你是一位严谨的测试工程师，表达简洁，习惯用数据和事实作答。"
            rows={3}
          />
        </div>

        <EmployeeAppearanceFields
          statusColor={statusColor}
          onStatusColorChange={setStatusColor}
          frame={avatarFrame}
          onFrameChange={setAvatarFrame}
          usedColors={state.employees.map((employee) => employee.statusColor)}
        />

        <div className="employee-editor-actions">
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSubmit}>确认添加</button>
        </div>
      </div>
    </div>
  );
}
