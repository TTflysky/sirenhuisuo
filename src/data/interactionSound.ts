export type InteractionSoundPreset = 'fc' | 'mac' | 'arcade';
export type InteractionSoundKind = 'tap' | 'select' | 'success' | 'danger';

export interface InteractionSoundSettings {
  enabled: boolean;
  volume: number;
  preset: InteractionSoundPreset;
}

const STORAGE_KEY = 'taiji_interaction_sound';
const DEFAULT_SETTINGS: InteractionSoundSettings = { enabled: true, volume: 80, preset: 'mac' };
let audioContext: AudioContext | undefined;

export function loadInteractionSoundSettings(): InteractionSoundSettings {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<InteractionSoundSettings>;
    return {
      enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_SETTINGS.enabled,
      volume: Number.isFinite(value.volume) ? Math.max(0, Math.min(100, Number(value.volume))) : DEFAULT_SETTINGS.volume,
      preset: ['fc', 'mac', 'arcade'].includes(value.preset ?? '') ? value.preset! : DEFAULT_SETTINGS.preset,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveInteractionSoundSettings(settings: InteractionSoundSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function tone(start: number, frequency: number, duration: number, type: OscillatorType, level: number, endFrequency = frequency) {
  if (!audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), start + Math.min(0.008, duration / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
}

export function playInteractionSound(kind: InteractionSoundKind = 'tap', override?: InteractionSoundSettings) {
  const settings = override ?? loadInteractionSoundSettings();
  if (!settings.enabled || settings.volume <= 0 || typeof AudioContext === 'undefined') return;
  audioContext ??= new AudioContext();
  if (audioContext.state === 'suspended') void audioContext.resume();
  const now = audioContext.currentTime + 0.006;
  const level = (settings.volume / 100) * 0.055;

  if (settings.preset === 'fc') {
    const notes = kind === 'success' ? [659, 988, 1318] : kind === 'danger' ? [220, 165] : kind === 'select' ? [523, 784] : [784];
    notes.forEach((frequency, index) => tone(now + index * 0.045, frequency, 0.052, 'square', level * 0.62));
    return;
  }
  if (settings.preset === 'arcade') {
    if (kind === 'danger') {
      tone(now, 190, 0.16, 'square', level * 0.7, 85);
      return;
    }
    const notes = kind === 'success' ? [392, 784, 1174] : kind === 'select' ? [330, 660] : [260];
    notes.forEach((frequency, index) => tone(now + index * 0.055, frequency, kind === 'tap' ? 0.045 : 0.075, 'sawtooth', level * 0.52, frequency * (kind === 'tap' ? 1.35 : 1)));
    return;
  }
  if (kind === 'danger') tone(now, 330, 0.14, 'triangle', level * 0.8, 210);
  else if (kind === 'success') {
    tone(now, 660, 0.12, 'sine', level, 740);
    tone(now + 0.07, 990, 0.16, 'sine', level * 0.8, 1180);
  } else tone(now, kind === 'select' ? 540 : 620, kind === 'select' ? 0.09 : 0.055, 'sine', level * 0.78, kind === 'select' ? 880 : 760);
}

export function installInteractionSounds() {
  const handleClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button, a, [role="button"]') : null;
    if (!target || target.matches(':disabled, [aria-disabled="true"]') || target.closest('[data-sound-preview]')) return;
    const kind: InteractionSoundKind = target.classList.contains('danger') || target.className.includes('danger') || target.className.includes('stop')
      ? 'danger'
      : target.className.includes('primary') || target.className.includes('approve') || target.className.includes('send')
        ? 'success'
        : target.getAttribute('role') === 'menuitem' || target.getAttribute('aria-pressed') !== null
          ? 'select'
          : 'tap';
    playInteractionSound(kind);
  };
  document.addEventListener('click', handleClick, true);
  return () => document.removeEventListener('click', handleClick, true);
}

