import type { AvatarFrameConfig } from '../types';

export interface AvatarFramePreset {
  id: string;
  name: string;
  badge: string;
  primary: string;
  secondary: string;
  borderStyle: 'solid' | 'double' | 'dashed';
  width: number;
  shadow?: string;
}

export const AVATAR_FRAME_PRESETS: AvatarFramePreset[] = [
  { id: 'standard', name: '标准员工', badge: '', primary: '#8e8e93', secondary: '#d1d1d6', borderStyle: 'solid', width: 2 },
  { id: 'excellent', name: '优秀员工', badge: '★', primary: '#ffb000', secondary: '#fff1a8', borderStyle: 'double', width: 3, shadow: '0 0 10px rgba(255,176,0,.42)' },
  { id: 'annual-star', name: '年度之星', badge: '✦', primary: '#ff375f', secondary: '#ffd60a', borderStyle: 'double', width: 3, shadow: '0 0 12px rgba(255,55,95,.42)' },
  { id: 'efficiency', name: '效率先锋', badge: '»', primary: '#0a84ff', secondary: '#64d2ff', borderStyle: 'solid', width: 3 },
  { id: 'creative', name: '创意大师', badge: '◆', primary: '#bf5af2', secondary: '#ff9f0a', borderStyle: 'dashed', width: 3 },
  { id: 'technical', name: '技术专家', badge: '<>', primary: '#30d158', secondary: '#64d2ff', borderStyle: 'double', width: 3 },
  { id: 'reliable', name: '可靠搭档', badge: '✓', primary: '#32ade6', secondary: '#30d158', borderStyle: 'solid', width: 3 },
  { id: 'core', name: '团队核心', badge: '●', primary: '#ff453a', secondary: '#ff9f0a', borderStyle: 'double', width: 3 },
  { id: 'hero', name: '项目英雄', badge: 'H', primary: '#ffd60a', secondary: '#ff453a', borderStyle: 'solid', width: 4, shadow: '0 0 11px rgba(255,214,10,.45)' },
  { id: 'guardian', name: '质量守护者', badge: '◇', primary: '#5e5ce6', secondary: '#64d2ff', borderStyle: 'double', width: 3 },
  { id: 'mentor', name: '团队导师', badge: 'M', primary: '#ac8e68', secondary: '#ffd60a', borderStyle: 'solid', width: 3 },
  { id: 'rapid', name: '极速响应', badge: '↯', primary: '#ff9f0a', secondary: '#ff453a', borderStyle: 'dashed', width: 3 },
  { id: 'quality', name: '品质标杆', badge: 'Q', primary: '#00c7be', secondary: '#30d158', borderStyle: 'double', width: 3 },
  { id: 'growth', name: '成长之星', badge: '↑', primary: '#30d158', secondary: '#ffd60a', borderStyle: 'solid', width: 3 },
  { id: 'focused', name: '深夜专注', badge: '◐', primary: '#5856d6', secondary: '#af52de', borderStyle: 'solid', width: 3, shadow: '0 0 10px rgba(88,86,214,.4)' },
  { id: 'slacking', name: '摸鱼员工', badge: '~', primary: '#8e8e93', secondary: '#64d2ff', borderStyle: 'dashed', width: 3 },
  { id: 'vacation', name: '休假中', badge: 'Z', primary: '#64d2ff', secondary: '#ffd60a', borderStyle: 'dashed', width: 2 },
  { id: 'field', name: '外勤执行', badge: '↗', primary: '#ff9f0a', secondary: '#8e8e93', borderStyle: 'solid', width: 3 },
  { id: 'intern', name: '实习员工', badge: 'N', primary: '#aeaeb2', secondary: '#d1d1d6', borderStyle: 'dashed', width: 2 },
  { id: 'emeritus', name: '荣誉员工', badge: 'E', primary: '#d4af37', secondary: '#8e8e93', borderStyle: 'double', width: 4 },
];

export function resolveAvatarFrame(config?: AvatarFrameConfig): AvatarFramePreset {
  const base = AVATAR_FRAME_PRESETS.find((item) => item.id === config?.presetId) ?? AVATAR_FRAME_PRESETS[0];
  if (config?.presetId !== 'custom') return base;
  return {
    id: 'custom', name: config.label?.trim() || '自定义标识', badge: '•',
    primary: config.primaryColor || '#0a84ff', secondary: config.secondaryColor || '#64d2ff',
    borderStyle: 'double', width: 3, shadow: `0 0 10px ${config.primaryColor || '#0a84ff'}55`,
  };
}
