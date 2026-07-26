import { useState, useEffect } from 'react';
import { Select, Popover, App } from 'antd';
import {
  loadSettings, saveSettings,
  getProvider, getAssistantModel, getActiveModel,
  type ModelEntry,
} from '../../data/hermesClient';

/** 助理机器人模型选择器：侧栏只显示模型名 + 下拉切换 */
export default function AssistantModelSelector() {
  const { message } = App.useApp();
  const [settings, setSettings] = useState(() => loadSettings());

  // 从 AppSettings.modelLibrary 加载
  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const library: ModelEntry[] = settings.modelLibrary ?? [];
  const assistantId = settings.assistantModelId ?? '__global__';

  // 当前显示的模型名
  const assistantMc = getAssistantModel();
  const activeMc = getActiveModel();
  const displayModel = assistantMc.model || activeMc.model || getProvider(assistantMc.provider).defaultModel || '未配置';

  const handleChange = (value: string) => {
    const s = loadSettings();
    if (value === '__global__') {
      s.assistantModelId = undefined;
      // 清除旧字段
      delete s.assistantModelConfig;
    } else {
      s.assistantModelId = value;
      const entry = s.modelLibrary?.find(m => m.id === value);
      if (entry) {
        s.assistantModelConfig = { provider: entry.provider, apiHost: entry.apiHost, apiKey: entry.apiKey, model: entry.model, contextWindowTokens: entry.contextWindowTokens };
      }
    }
    saveSettings(s);
    setSettings({ ...s });
    message.success(value === '__global__' ? '助理已跟随全局模型' : '助理模型已切换');
  };

  // 没有模型库时不显示选择器
  if (library.length === 0) {
    return (
      <button
        className="btn btn-sm"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: 140, overflow: 'hidden' }}
        title="点击右上角 ⚙️ 设置添加模型"
        onClick={() => message.info('请先在设置中添加模型')}
      >
        <span style={{ fontSize: 11 }}>🧠</span>
        <span style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
          {displayModel}
        </span>
      </button>
    );
  }

  const content = (
    <div style={{ width: 240, padding: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>🤖 助理模型</div>
      <Select
        value={assistantId}
        onChange={handleChange}
        style={{ width: '100%' }}
        options={[
          { value: '__global__', label: '跟随全局默认' },
          ...library.map(m => ({ value: m.id, label: `${m.label}${m.tested === 'ok' ? ' ✓' : ''}` })),
        ]}
      />
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
        员工未配模型时默认使用此模型
      </div>
    </div>
  );

  return (
    <Popover content={content} trigger="click" placement="bottomLeft" overlayStyle={{ zIndex: 200 }}>
      <button
        className="btn btn-sm"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          maxWidth: 140, overflow: 'hidden',
        }}
        title="点击切换助理模型"
      >
        <span style={{ fontSize: 11 }}>🧠</span>
        <span
          style={{
            fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis', minWidth: 0,
          }}
        >
          {displayModel}
        </span>
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>▼</span>
      </button>
    </Popover>
  );
}
