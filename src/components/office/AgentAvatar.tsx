import type { Employee } from '../../types';
import { renderPresetAvatar } from '../../data/avatarPresets';
import { resolveAvatarFrame } from '../../data/avatarFrames';

interface Props {
  employee: Employee;
  size?: number;
}

export default function AgentAvatar({ employee, size = 40 }: Props) {
  const frame = resolveAvatarFrame(employee.avatarFrame);
  const image = employee.avatarKind === 'custom'
    ? <img src={employee.avatar} alt={employee.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    : renderPresetAvatar(employee.avatar, size);
  const badgeSize = Math.max(11, Math.round(size * .3));
  const gap = size >= 48 ? 3 : 1;
  return <span className="agent-avatar-frame" title={frame.name} style={{ width: size, height: size, padding: gap, borderColor: frame.primary, borderStyle: frame.borderStyle, borderWidth: frame.width, outline: `1px solid ${frame.secondary}`, outlineOffset: 1, boxShadow: frame.shadow, background: 'var(--surface)' }}>
    {image}
    {frame.badge && <span className="agent-avatar-badge" style={{ width: badgeSize, height: badgeSize, fontSize: Math.max(7, badgeSize * .55), background: frame.primary, color: '#fff' }}>{frame.badge}</span>}
  </span>;
}
