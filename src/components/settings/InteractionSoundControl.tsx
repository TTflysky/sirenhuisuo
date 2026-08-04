import { useState } from 'react';
import { AudioLines, Command as CommandIcon, Gamepad2, Joystick, Play, Volume2, VolumeX } from 'lucide-react';
import { Popover } from 'antd';
import {
  loadInteractionSoundSettings,
  playInteractionSound,
  saveInteractionSoundSettings,
  type InteractionSoundPreset,
  type InteractionSoundSettings,
} from '../../data/interactionSound';

export default function InteractionSoundControl() {
  const [settings, setSettings] = useState<InteractionSoundSettings>(loadInteractionSoundSettings);
  const [open, setOpen] = useState(false);
  const update = (partial: Partial<InteractionSoundSettings>, preview = false) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    saveInteractionSoundSettings(next);
    if (preview) playInteractionSound('select', { ...next, enabled: true });
  };

  const presets: Array<{ value: InteractionSoundPreset; label: string; icon: typeof Gamepad2 }> = [
    { value: 'fc', label: 'FC', icon: Gamepad2 },
    { value: 'mac', label: 'Mac', icon: CommandIcon },
    { value: 'arcade', label: '街机', icon: Joystick },
  ];
  const content = (
    <section className={`interaction-sound-panel${settings.enabled ? '' : ' is-muted'}`} aria-label="互动音效设置">
      <header>
        <div><span className="interaction-sound-eyebrow">SOUND FX</span><h3>互动音效</h3></div>
        <span className="interaction-sound-preset-label">{settings.preset.toUpperCase()}</span>
      </header>
      <div className="interaction-sound-presets" role="group" aria-label="音效风格">
        {presets.map(({ value, label, icon: Icon }) => <button key={value} type="button" className={settings.preset === value ? 'active' : ''} aria-pressed={settings.preset === value} onClick={() => update({ preset: value }, true)}><Icon /><span>{label}</span></button>)}
      </div>
      <div className="interaction-sound-enable-row">
        <span><AudioLines /><span><strong>互动音效</strong><small>点击和任务状态反馈</small></span></span>
        <button type="button" className={`interaction-sound-switch${settings.enabled ? ' is-on' : ''}`} role="switch" aria-checked={settings.enabled} aria-label="开启或关闭互动音效" onClick={() => update({ enabled: !settings.enabled })}><i /><b>{settings.enabled ? '已开启' : '已关闭'}</b></button>
      </div>
      <label className="interaction-sound-volume" htmlFor="interactionSoundVolume"><span><Volume2 />音量</span><strong>{settings.volume}%</strong></label>
      <input id="interactionSoundVolume" className="interaction-sound-range" type="range" min="0" max="100" step="1" value={settings.volume} disabled={!settings.enabled} onChange={(event) => update({ volume: Number(event.target.value) })} onPointerUp={() => playInteractionSound('tap')} />
      <button type="button" className="interaction-sound-test" data-sound-preview onClick={() => playInteractionSound('success', { ...settings, enabled: true })}><Play />试听确认音</button>
    </section>
  );

  return (
    <Popover trigger="click" placement="bottomRight" content={content} open={open} onOpenChange={setOpen} classNames={{ root: 'interaction-sound-popover' }}>
      <button className="titlebar-btn sound-toggle-btn" title="互动音效" aria-label="互动音效" aria-expanded={open}>
        {settings.enabled && settings.volume > 0 ? <Volume2 /> : <VolumeX />}
      </button>
    </Popover>
  );
}
