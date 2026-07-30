import { useEffect, useRef, useState } from 'react';
import { DragOutlined, UserAddOutlined } from '@ant-design/icons';
import type { AvatarFrameConfig, OpcRoleId } from '../../types';
import { useStore } from '../../storeContext';
import EmployeeAppearanceFields from './EmployeeAppearanceFields';
import EmployeeAvatarPicker from './EmployeeAvatarPicker';
import { generateDistinctEmployeeColor } from '../../data/employeeColors';

interface Props {
  onClose: () => void;
  standalone?: boolean;
}

export default function AddEmployeeModal({ onClose, standalone = false }: Props) {
  const { addEmployee, state } = useStore();
  const modalRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
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

  useEffect(() => {
    const keepVisible = () => {
      const rect = modalRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 12;
      const dx = Math.min(Math.max(0, margin - rect.left), window.innerWidth - margin - rect.right);
      const dy = Math.min(Math.max(0, margin - rect.top), window.innerHeight - margin - rect.bottom);
      if (dx || dy) setOffset((current) => ({ x: current.x + dx, y: current.y + dy }));
    };
    const handleKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('resize', keepVisible);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', keepVisible);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const startDragging = (event: React.PointerEvent<HTMLHeadingElement>) => {
    if (event.button !== 0) return;
    const rect = modalRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    const start = { clientX: event.clientX, clientY: event.clientY, ...offset };
    const unshifted = {
      left: rect.left - offset.x,
      right: rect.right - offset.x,
      top: rect.top - offset.y,
      bottom: rect.bottom - offset.y,
    };
    const margin = 12;
    const handleMove = (moveEvent: PointerEvent) => {
      const proposedX = start.x + moveEvent.clientX - start.clientX;
      const proposedY = start.y + moveEvent.clientY - start.clientY;
      setOffset({
        x: Math.min(Math.max(proposedX, margin - unshifted.left), window.innerWidth - margin - unshifted.right),
        y: Math.min(Math.max(proposedY, margin - unshifted.top), window.innerHeight - margin - unshifted.bottom),
      });
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
  };

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
      <div
        ref={modalRef}
        className="modal-box employee-editor-modal"
        style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-employee-title"
      >
        <h2 id="add-employee-title" className={`employee-editor-titlebar ${standalone ? 'is-native-drag' : ''}`} onPointerDown={standalone ? undefined : startDragging} onDoubleClick={standalone ? undefined : () => setOffset({ x: 0, y: 0 })}>
          <span><UserAddOutlined /> 添加员工</span>
          <DragOutlined className="employee-editor-drag-icon" />
        </h2>

        <div className="employee-editor-body">

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
            employeeName={name}
            employeeTitle={title}
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
    </div>
  );
}
