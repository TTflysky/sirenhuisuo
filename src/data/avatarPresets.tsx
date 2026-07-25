import type { ReactNode } from 'react';
import a01 from '../assets/avatars/avatar-01-red.png';
import a02 from '../assets/avatars/avatar-02-cyan.png';
import a03 from '../assets/avatars/avatar-03-green.png';
import a04 from '../assets/avatars/avatar-04-purple.png';
import a05 from '../assets/avatars/avatar-05-amber.png';
import a06 from '../assets/avatars/avatar-06-blue.png';
import a07 from '../assets/avatars/avatar-07-pink.png';
import a08 from '../assets/avatars/avatar-08-orange.png';
import a09 from '../assets/avatars/avatar-09-slate.png';
import a10 from '../assets/avatars/avatar-10-rose.png';
import member01 from '../assets/avatars/member-emp-1784688642878-q9x1l.png';
import member02 from '../assets/avatars/member-emp-1784712230779-gv8ry.png';
import member03 from '../assets/avatars/member-emp-1784875457261-wp6em.png';
import member04 from '../assets/avatars/member-emp-1784878178584-hvot4.png';
import member05 from '../assets/avatars/member-emp-1784881570164-qghbh.png';

// ===== 10 个 AI 生成的员工头像（黑色剪影小人 + 不同围巾色）=====
export interface AvatarPreset {
  key: string;
  label: string;
  src: string;   // 图片资源
  scarf: string; // 主题色（用于色环/标识）
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { key: 'member01', label: '会所成员 01', src: member01, scarf: '#e879a8' },
  { key: 'member02', label: '会所成员 02', src: member02, scarf: '#f59e0b' },
  { key: 'member03', label: '会所成员 03', src: member03, scarf: '#22c55e' },
  { key: 'member04', label: '会所成员 04', src: member04, scarf: '#a855f7' },
  { key: 'member05', label: '会所成员 05', src: member05, scarf: '#0ea5e9' },
  { key: 'a01', label: '红围巾', src: a01, scarf: '#ef4444' },
  { key: 'a02', label: '青围巾', src: a02, scarf: '#22d3ee' },
  { key: 'a03', label: '绿围巾', src: a03, scarf: '#22c55e' },
  { key: 'a04', label: '紫围巾', src: a04, scarf: '#a855f7' },
  { key: 'a05', label: '金围巾', src: a05, scarf: '#f59e0b' },
  { key: 'a06', label: '蓝围巾', src: a06, scarf: '#3b82f6' },
  { key: 'a07', label: '粉围巾', src: a07, scarf: '#ec4899' },
  { key: 'a08', label: '橙围巾', src: a08, scarf: '#f97316' },
  { key: 'a09', label: '灰围巾', src: a09, scarf: '#64748b' },
  { key: 'a10', label: '玫红围巾', src: a10, scarf: '#f43f5e' },
];

export const PRESET_KEYS = AVATAR_PRESETS.map((p) => p.key);

export function getPreset(key: string): AvatarPreset {
  return AVATAR_PRESETS.find((p) => p.key === key) ?? AVATAR_PRESETS[0];
}

// 渲染 AI 头像图片（圆形裁切）
export function renderPresetAvatar(key: string, size: number = 48): ReactNode {
  const preset = getPreset(key);
  return (
    <img
      src={preset.src}
      alt={preset.label}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        objectFit: 'cover',
        display: 'block',
        background: '#eef0f6',
      }}
    />
  );
}
