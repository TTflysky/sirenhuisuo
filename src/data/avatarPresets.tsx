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
import pixelPet01 from '../assets/avatars/pixel-pet-01.png';
import pixelPet02 from '../assets/avatars/pixel-pet-02.png';
import pixelPet03 from '../assets/avatars/pixel-pet-03.png';
import pixelPet04 from '../assets/avatars/pixel-pet-04.png';
import pixelPet05 from '../assets/avatars/pixel-pet-05.png';

export type AvatarPresetGroupId = 'office' | 'pixel' | 'classic';

export interface AvatarPresetGroup {
  id: AvatarPresetGroupId;
  label: string;
  description: string;
}

export interface AvatarPreset {
  key: string;
  label: string;
  src: string;
  scarf: string;
  group: AvatarPresetGroupId;
  pixelated?: boolean;
}

export const AVATAR_PRESET_GROUPS: AvatarPresetGroup[] = [
  { id: 'office', label: '会所角色', description: '当前会所成员形象' },
  { id: 'pixel', label: '在线像素', description: 'DiceBear Pixel Art 在线头像，选中后保存到本地' },
  { id: 'classic', label: '经典头像', description: '简洁中性的角色头像' },
];

export const AVATAR_PRESETS: AvatarPreset[] = [
  { key: 'member01', label: '会所猫员工', src: member01, scarf: '#e879a8', group: 'office' },
  { key: 'member02', label: '会所犬员工', src: member02, scarf: '#f59e0b', group: 'office' },
  { key: 'member03', label: '会所鸡员工', src: member03, scarf: '#22c55e', group: 'office' },
  { key: 'member04', label: '会所兔员工', src: member04, scarf: '#a855f7', group: 'office' },
  { key: 'member05', label: '会所鹿员工', src: member05, scarf: '#0ea5e9', group: 'office' },
  { key: 'pixelPet01', label: '像素猫员工', src: pixelPet01, scarf: '#e879a8', group: 'pixel', pixelated: true },
  { key: 'pixelPet02', label: '像素犬员工', src: pixelPet02, scarf: '#f59e0b', group: 'pixel', pixelated: true },
  { key: 'pixelPet03', label: '像素鸡员工', src: pixelPet03, scarf: '#22c55e', group: 'pixel', pixelated: true },
  { key: 'pixelPet04', label: '像素兔员工', src: pixelPet04, scarf: '#a855f7', group: 'pixel', pixelated: true },
  { key: 'pixelPet05', label: '像素鹿员工', src: pixelPet05, scarf: '#0ea5e9', group: 'pixel', pixelated: true },
  { key: 'a01', label: '红围巾', src: a01, scarf: '#ef4444', group: 'classic' },
  { key: 'a02', label: '青围巾', src: a02, scarf: '#22d3ee', group: 'classic' },
  { key: 'a03', label: '绿围巾', src: a03, scarf: '#22c55e', group: 'classic' },
  { key: 'a04', label: '紫围巾', src: a04, scarf: '#a855f7', group: 'classic' },
  { key: 'a05', label: '金围巾', src: a05, scarf: '#f59e0b', group: 'classic' },
  { key: 'a06', label: '蓝围巾', src: a06, scarf: '#3b82f6', group: 'classic' },
  { key: 'a07', label: '粉围巾', src: a07, scarf: '#ec4899', group: 'classic' },
  { key: 'a08', label: '橙围巾', src: a08, scarf: '#f97316', group: 'classic' },
  { key: 'a09', label: '灰围巾', src: a09, scarf: '#64748b', group: 'classic' },
  { key: 'a10', label: '玫红围巾', src: a10, scarf: '#f43f5e', group: 'classic' },
];

export const PRESET_KEYS = AVATAR_PRESETS.map((preset) => preset.key);

export function getPreset(key: string): AvatarPreset {
  return AVATAR_PRESETS.find((preset) => preset.key === key) ?? AVATAR_PRESETS[0];
}

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
        imageRendering: preset.pixelated ? 'pixelated' : 'auto',
      }}
    />
  );
}
