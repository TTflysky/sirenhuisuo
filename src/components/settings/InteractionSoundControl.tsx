import { useState } from 'react';
import { MutedOutlined, PlayCircleOutlined, SoundOutlined } from '@ant-design/icons';
import { Popover, Segmented, Slider, Switch } from 'antd';
import {
  loadInteractionSoundSettings,
  playInteractionSound,
  saveInteractionSoundSettings,
  type InteractionSoundPreset,
  type InteractionSoundSettings,
} from '../../data/interactionSound';

export default function InteractionSoundControl() {
  const [settings, setSettings] = useState<InteractionSoundSettings>(loadInteractionSoundSettings);
  const update = (partial: Partial<InteractionSoundSettings>, preview = false) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    saveInteractionSoundSettings(next);
    if (preview) playInteractionSound('select', { ...next, enabled: true });
  };

  const content = (
    <section className="interaction-sound-panel" aria-label="互动音效设置">
      <header><div><strong>互动音效</strong><small>FC、Mac 与街机反馈</small></div><Switch size="small" checked={settings.enabled} onChange={(enabled) => update({ enabled })} /></header>
      <Segmented block value={settings.preset} options={[{ label: 'FC', value: 'fc' }, { label: 'Mac', value: 'mac' }, { label: '街机', value: 'arcade' }]} onChange={(preset) => update({ preset: preset as InteractionSoundPreset }, true)} />
      <div className="interaction-sound-volume"><span>音量</span><strong>{settings.volume}%</strong></div>
      <Slider value={settings.volume} disabled={!settings.enabled} onChange={(volume) => update({ volume })} onChangeComplete={() => playInteractionSound('tap')} />
      <button type="button" data-sound-preview onClick={() => playInteractionSound('success', { ...settings, enabled: true })}><PlayCircleOutlined /> 试听确认音</button>
    </section>
  );

  return (
    <Popover trigger="click" placement="bottomRight" content={content}>
      <button className="titlebar-btn sound-toggle-btn" title="互动音效" aria-label="互动音效">
        {settings.enabled && settings.volume > 0 ? <SoundOutlined /> : <MutedOutlined />}
      </button>
    </Popover>
  );
}

