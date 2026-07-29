export type FontKey = 'youyuan' | 'noto-sans' | 'noto-serif' | 'source-han-regular' | 'source-han-light' | 'source-han-bold';
export type FontSizeKey = 'small' | 'standard' | 'large' | 'extra-large';

export interface AppearanceSettings {
  font: FontKey;
  fontSize: FontSizeKey;
}

export const FONT_OPTIONS: Array<{ value: FontKey; label: string; family: string }> = [
  { value: 'youyuan', label: '幼圆', family: "'Hermes YouYuan', 'YouYuan', '幼圆', sans-serif" },
  { value: 'noto-sans', label: 'Noto Sans 简体中文', family: "'Hermes Noto Sans SC', sans-serif" },
  { value: 'noto-serif', label: 'Noto Serif 简体中文', family: "'Hermes Noto Serif SC', serif" },
  { value: 'source-han-regular', label: '思源黑体 常规', family: "'Hermes Source Han Sans Regular', sans-serif" },
  { value: 'source-han-light', label: '思源黑体 纤细', family: "'Hermes Source Han Sans Light', sans-serif" },
  { value: 'source-han-bold', label: '思源黑体 粗体', family: "'Hermes Source Han Sans Bold', sans-serif" },
];

export const FONT_SIZE_OPTIONS: Array<{ value: FontSizeKey; label: string; factor: number }> = [
  { value: 'small', label: '小', factor: 0.9 },
  { value: 'standard', label: '标准', factor: 1 },
  { value: 'large', label: '大', factor: 1.1 },
  { value: 'extra-large', label: '特大', factor: 1.2 },
];

const STORAGE_KEY = 'hermes_office_appearance';
const DEFAULT_SETTINGS: AppearanceSettings = { font: 'youyuan', fontSize: 'standard' };

export function loadAppearanceSettings(): AppearanceSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<AppearanceSettings>;
    const font = FONT_OPTIONS.some((option) => option.value === parsed.font) ? parsed.font! : DEFAULT_SETTINGS.font;
    const fontSize = FONT_SIZE_OPTIONS.some((option) => option.value === parsed.fontSize) ? parsed.fontSize! : DEFAULT_SETTINGS.fontSize;
    return { font, fontSize };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function applyAppearanceSettings(settings: AppearanceSettings) {
  const font = FONT_OPTIONS.find((option) => option.value === settings.font) ?? FONT_OPTIONS[0];
  const size = FONT_SIZE_OPTIONS.find((option) => option.value === settings.fontSize) ?? FONT_SIZE_OPTIONS[1];
  document.documentElement.style.setProperty('--ui-font-family', font.family);
  document.documentElement.style.setProperty('--ui-font-scale', String(size.factor));
  document.documentElement.dataset.fontSize = size.value;
  // Do not zoom the whole BrowserWindow: fixed toolbars, grids and sidebars
  // would scale with the text and become geometrically distorted.
  window.electronAPI?.setZoomFactor?.(1);
}

export function saveAppearanceSettings(settings: AppearanceSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  applyAppearanceSettings(settings);
}
