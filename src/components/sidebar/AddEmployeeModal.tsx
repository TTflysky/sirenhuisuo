import React, { useState, useRef } from 'react';
import type { OpcRoleId, AvatarFrameConfig } from '../../types';
import { useStore } from '../../store';
import { AVATAR_PRESETS, renderPresetAvatar } from '../../data/avatarPresets';
import EmployeeAppearanceFields from './EmployeeAppearanceFields';
import { generateDistinctEmployeeColor } from '../../data/employeeColors';

interface Props {
  onClose: () => void;
}

export default function AddEmployeeModal({ onClose }: Props) {
  const { addEmployee, state } = useStore();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [role, setRole] = useState<OpcRoleId>('custom');
  const [avatarKey, setAvatarKey] = useState('a06');
  const [customAvatar, setCustomAvatar] = useState('');
  const [prompt, setPrompt] = useState('');
  const [statusColor, setStatusColor] = useState(() => generateDistinctEmployeeColor(state.employees.map((employee) => employee.statusColor)));
  const [avatarFrame, setAvatarFrame] = useState<AvatarFrameConfig>({ presetId: 'standard' });
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024) {
      alert('图片过大，请压缩到 200KB 以内');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setCustomAvatar(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = () => {
    if (!name.trim()) return alert('请输入名字');
    const kind = customAvatar ? 'custom' : 'preset';
    const avatar = customAvatar || avatarKey;
    addEmployee(name.trim(), title.trim() || role.toUpperCase(), role, avatar, kind as 'preset' | 'custom', statusColor, prompt.trim() || undefined, avatarFrame);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <h2>👤 添加员工</h2>

        <div className="form-group">
          <label className="form-label">姓名 *</label>
          <input
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入员工名字"
            autoFocus
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">身份牌</label>
            <input
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如：架构师 / 测试工程师"
            />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">角色</label>
            <select className="form-select" value={role} onChange={(e) => setRole(e.target.value as OpcRoleId)}>
              <option value="pm">PM 协调者</option>
              <option value="planner">Planner 规划者</option>
              <option value="coder">Coder 编码者</option>
              <option value="checker">Checker 审查者</option>
              <option value="custom">自定义</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">头像（选择预设或上传自定义）</label>
          <div className="avatar-grid">
            {AVATAR_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`avatar-preset-option ${avatarKey === p.key && !customAvatar ? 'selected' : ''}`}
                onClick={() => { setAvatarKey(p.key); setCustomAvatar(''); }}
                title={p.label}
              >
                {renderPresetAvatar(p.key, 40)}
              </button>
            ))}
          </div>
          <button
            className="btn btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => fileRef.current?.click()}
          >
            📷 上传自定义头像
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
          {customAvatar && (
            <img src={customAvatar} alt="预览" style={{ width: 48, height: 48, borderRadius: '50%', marginTop: 6 }} />
          )}
        </div>

        {/* 个性提示词 */}
        <div className="form-group">
          <label className="form-label">个性提示词（人设/说话风格）</label>
          <textarea
            className="form-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：你是一个严谨的测试工程师，说话简洁，喜欢用数据和事实回复。"
            rows={3}
          />
        </div>

        {/* 角色色预览 */}
        <EmployeeAppearanceFields statusColor={statusColor} onStatusColorChange={setStatusColor} frame={avatarFrame} onFrameChange={setAvatarFrame} usedColors={state.employees.map((employee) => employee.statusColor)} />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSubmit}>确认添加</button>
        </div>
      </div>
    </div>
  );
}
