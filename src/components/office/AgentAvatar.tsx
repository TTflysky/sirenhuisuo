import type { Employee } from '../../types';
import { renderPresetAvatar } from '../../data/avatarPresets';

interface Props {
  employee: Employee;
  size?: number;
}

export default function AgentAvatar({ employee, size = 40 }: Props) {
  if (employee.avatarKind === 'custom') {
    return (
      <div
        style={{
          width: size, height: size, borderRadius: '50%',
          overflow: 'hidden', border: '2px solid var(--border)',
          background: '#fff',
        }}
      >
        <img
          src={employee.avatar}
          alt={employee.name}
          style={{ width: size, height: size, objectFit: 'cover' }}
        />
      </div>
    );
  }

  return <>{renderPresetAvatar(employee.avatar, size)}</>;
}
