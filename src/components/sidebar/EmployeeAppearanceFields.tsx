import type { AvatarFrameConfig } from '../../types';
import { AVATAR_FRAME_PRESETS, resolveAvatarFrame } from '../../data/avatarFrames';
import { ColorPicker } from 'antd';

interface Props {
  statusColor: string;
  onStatusColorChange: (color: string) => void;
  frame: AvatarFrameConfig;
  onFrameChange: (frame: AvatarFrameConfig) => void;
}

export default function EmployeeAppearanceFields({ statusColor, onStatusColorChange, frame, onFrameChange }: Props) {
  const current = resolveAvatarFrame(frame);
  return <>
    <div className="form-group">
      <label className="form-label">员工标识色</label>
      <div className="employee-color-picker">
        <ColorPicker value={statusColor} showText onChangeComplete={(color) => onStatusColorChange(color.toHexString())} />
        <span className="employee-color-preview" style={{ background: statusColor }} />
        <code>{statusColor.toUpperCase()}</code>
      </div>
    </div>
    <div className="form-group">
      <label className="form-label">头像身份边框</label>
      <div className="avatar-frame-grid">
        {AVATAR_FRAME_PRESETS.map((preset) => <button key={preset.id} type="button" className={`avatar-frame-option${frame.presetId === preset.id ? ' selected' : ''}`} onClick={() => onFrameChange({ presetId: preset.id })} title={preset.name}>
          <span style={{ borderColor: preset.primary, borderStyle: preset.borderStyle, boxShadow: preset.shadow }}>{preset.badge || '·'}</span><small>{preset.name}</small>
        </button>)}
        <button type="button" className={`avatar-frame-option${frame.presetId === 'custom' ? ' selected' : ''}`} onClick={() => onFrameChange({ presetId: 'custom', primaryColor: frame.primaryColor || statusColor, secondaryColor: frame.secondaryColor || '#64d2ff', label: frame.label || '自定义' })} title="自定义边框"><span style={{ borderColor: frame.primaryColor || statusColor }}>+</span><small>自定义</small></button>
      </div>
      {frame.presetId === 'custom' && <div className="avatar-frame-custom">
        <input type="color" value={frame.primaryColor || statusColor} onChange={(event) => onFrameChange({ ...frame, primaryColor: event.target.value })} aria-label="自定义边框主色" />
        <input type="color" value={frame.secondaryColor || '#64d2ff'} onChange={(event) => onFrameChange({ ...frame, secondaryColor: event.target.value })} aria-label="自定义边框辅色" />
        <input className="form-input" value={frame.label || ''} onChange={(event) => onFrameChange({ ...frame, label: event.target.value })} placeholder="边框称号" maxLength={12} />
      </div>}
      <div className="avatar-frame-current">当前：<strong>{current.name}</strong></div>
    </div>
  </>;
}
