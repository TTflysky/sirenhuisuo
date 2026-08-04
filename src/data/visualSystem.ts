export type VisualStyle = 'original' | 'pop' | 'acid';

export interface VisualThemeOption {
  id: string;
  label: string;
  colors: [string, string, string];
  dark?: boolean;
}

export interface VisualStyleOption {
  id: VisualStyle;
  label: string;
  description: string;
  themes: VisualThemeOption[];
}

export interface VisualPreferences {
  style: VisualStyle;
  theme: string;
}

export const VISUAL_STYLE_OPTIONS: VisualStyleOption[] = [
  {
    id: 'original', label: '原版商务', description: '克制、清晰、轻量',
    themes: [
      { id: 'light', label: '明亮', colors: ['#f7f8fb', '#ffffff', '#315f91'] },
      { id: 'dark', label: '深色', colors: ['#202124', '#303136', '#4b9cff'], dark: true },
      { id: 'eye-care', label: '护眼', colors: ['#e8eee6', '#f4f7f2', '#3f7d5b'] },
      { id: 'soft-gray', label: '柔和灰', colors: ['#eceef1', '#ffffff', '#4b73a9'] },
      { id: 'ocean-blue', label: '海湾蓝', colors: ['#e8f2fb', '#f7fbff', '#1677c8'] },
      { id: 'quiet-blue', label: '静谧蓝', colors: ['#1e2c3c', '#30465c', '#67b7ff'], dark: true },
      { id: 'glass-light', label: '玻璃晨光', colors: ['#dfeaf3', '#f9fcff', '#087fc1'] },
      { id: 'glass-dark', label: '玻璃深夜', colors: ['#17212b', '#344555', '#70c5ff'], dark: true },
      { id: 'spruce', label: '云杉绿', colors: ['#20332f', '#355149', '#6bc89f'], dark: true },
      { id: 'graphite', label: '石墨', colors: ['#303238', '#464a52', '#8ab4f8'], dark: true },
      { id: 'cyberpunk', label: '霓虹赛博', colors: ['#070a12', '#20e3ff', '#ff4fd8'], dark: true },
    ],
  },
  {
    id: 'pop', label: '波普漫画', description: '粗描边、网点、活力色',
    themes: [
      { id: 'classic', label: '经典波普', colors: ['#f23b31', '#ffd83d', '#28cde3'] },
      { id: 'mono', label: '黑白网点', colors: ['#222222', '#bbbbbb', '#f5f5f5'] },
      { id: 'retro', label: '复古印刷', colors: ['#d94332', '#eabf45', '#4c9ea8'] },
      { id: 'soda', label: '海盐汽水', colors: ['#ff5b5b', '#ffe86a', '#4dd7f3'] },
      { id: 'mint', label: '薄荷草莓', colors: ['#ff5c8a', '#ffe08a', '#73e2c1'] },
      { id: 'citrus', label: '柑橘天空', colors: ['#ff6038', '#ffc928', '#67d7f0'] },
      { id: 'arcade', label: '街机霓虹', colors: ['#ff477e', '#ffd166', '#20c9c3'] },
      { id: 'blueprint', label: '蓝图工坊', colors: ['#ff4d4d', '#ffd447', '#3f8efc'] },
      { id: 'mango', label: '芒果海岸', colors: ['#ef476f', '#ffd23f', '#00b4d8'] },
      { id: 'newsprint', label: '报刊油墨', colors: ['#c83232', '#d9c887', '#476a6f'] },
    ],
  },
  {
    id: 'acid', label: '酸性暗黑', description: '强对比、霓虹、杂志感',
    themes: [
      { id: 'acid-lime', label: '核能青柠', colors: ['#070908', '#d8ff65', '#88dca0'], dark: true },
      { id: 'acid-magenta', label: '电击洋红', colors: ['#080609', '#ff4fd8', '#b967ff'], dark: true },
      { id: 'acid-cyan', label: '液态冰蓝', colors: ['#05090a', '#46e8ff', '#67ffcf'], dark: true },
      { id: 'acid-orange', label: '警戒橙', colors: ['#090705', '#ff9d3d', '#ffe45c'], dark: true },
    ],
  },
];

const STYLE_KEY = 'taiji_visual_style';
const THEME_KEY_PREFIX = 'taiji_color_theme_';
const LEGACY_THEME_KEY = 'hermes_office_theme';
const DEFAULT_THEME: Record<VisualStyle, string> = { original: 'light', pop: 'classic', acid: 'acid-lime' };

export function isVisualStyle(value: unknown): value is VisualStyle {
  return VISUAL_STYLE_OPTIONS.some((option) => option.id === value);
}

export function getVisualStyle(style: VisualStyle) {
  return VISUAL_STYLE_OPTIONS.find((option) => option.id === style) ?? VISUAL_STYLE_OPTIONS[1];
}

export function getThemeForStyle(style: VisualStyle, requested?: unknown) {
  const catalog = getVisualStyle(style).themes;
  return catalog.find((theme) => theme.id === requested)?.id ?? DEFAULT_THEME[style];
}

export function loadThemeForStyle(style: VisualStyle) {
  const saved = localStorage.getItem(`${THEME_KEY_PREFIX}${style}`)
    ?? (style === 'original' ? localStorage.getItem(LEGACY_THEME_KEY) : null);
  return getThemeForStyle(style, saved);
}

export function loadVisualPreferences(): VisualPreferences {
  const storedStyle = localStorage.getItem(STYLE_KEY);
  const style = isVisualStyle(storedStyle) ? storedStyle : 'pop';
  return { style, theme: loadThemeForStyle(style) };
}

export function applyVisualPreferences(preferences: VisualPreferences) {
  const style = isVisualStyle(preferences.style) ? preferences.style : 'pop';
  const theme = getThemeForStyle(style, preferences.theme);
  const option = getVisualStyle(style).themes.find((entry) => entry.id === theme);
  document.documentElement.dataset.visualStyle = style;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.colorMode = option?.dark ? 'dark' : 'light';
}

export function saveVisualPreferences(preferences: VisualPreferences) {
  const style = isVisualStyle(preferences.style) ? preferences.style : 'pop';
  const theme = getThemeForStyle(style, preferences.theme);
  localStorage.setItem(STYLE_KEY, style);
  localStorage.setItem(`${THEME_KEY_PREFIX}${style}`, theme);
  if (style === 'original') localStorage.setItem(LEGACY_THEME_KEY, theme);
  applyVisualPreferences({ style, theme });
}

