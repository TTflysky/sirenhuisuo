import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyVisualPreferences,
  getThemeForStyle,
  loadVisualPreferences,
  saveVisualPreferences,
  VISUAL_STYLE_OPTIONS,
} from '../../src/data/visualSystem';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('document', { documentElement: { dataset: {} } });
});

describe('production visual system', () => {
  it('ships the approved three styles and 25 palettes', () => {
    expect(VISUAL_STYLE_OPTIONS.map((style) => style.id)).toEqual(['original', 'pop', 'acid']);
    expect(VISUAL_STYLE_OPTIONS.reduce((sum, style) => sum + style.themes.length, 0)).toBe(25);
    expect(VISUAL_STYLE_OPTIONS.find((style) => style.id === 'original')?.themes).toHaveLength(11);
    expect(VISUAL_STYLE_OPTIONS.find((style) => style.id === 'pop')?.themes).toHaveLength(10);
    expect(VISUAL_STYLE_OPTIONS.find((style) => style.id === 'acid')?.themes).toHaveLength(4);
  });

  it('defaults new installations to pop while preserving per-style palettes', () => {
    expect(loadVisualPreferences()).toEqual({ style: 'pop', theme: 'classic' });
    saveVisualPreferences({ style: 'acid', theme: 'acid-cyan' });
    saveVisualPreferences({ style: 'pop', theme: 'retro' });
    expect(localStorage.getItem('taiji_color_theme_acid')).toBe('acid-cyan');
    expect(loadVisualPreferences()).toEqual({ style: 'pop', theme: 'retro' });
  });

  it('rejects palettes from another style and updates root contrast mode', () => {
    expect(getThemeForStyle('acid', 'classic')).toBe('acid-lime');
    applyVisualPreferences({ style: 'acid', theme: 'acid-magenta' });
    expect(document.documentElement.dataset).toMatchObject({ visualStyle: 'acid', theme: 'acid-magenta', colorMode: 'dark' });
  });
});

