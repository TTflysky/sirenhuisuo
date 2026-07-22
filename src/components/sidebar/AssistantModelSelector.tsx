import { useState, useEffect } from 'react';
import { Select, Input, Button, Popover, Space, App } from 'antd';
import type { ModelConfig } from '../../types';
import {
  loadSettings, saveSettings,
  PROVIDER_PRESETS, getProvider,
} from '../../data/hermesClient';

/** 助理机器人模型选择器：办公页侧栏可直接为助手切换模型 */
export default function AssistantModelSelector() {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);

  // 本地编辑状态
  const [provider, setProvider] = useState('deepseek');
  const [apiHost, setApiHost] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('');

  // 从 AppSettings.assistantModelConfig 加载
  useEffect(() => {
    if (!open) return;
    const s = loadSettings();
    const mc = s.assistantModelConfig;
    if (!mc) {
      // 未设置助理模型 → 预填全局设置的值
      setProvider(s.provider ?? 'deepseek');
      setApiHost(s.apiHost ?? '');
      setApiKey(s.apiKey ?? '');
      setModelName(s.model ?? '');
    } else {
      setProvider(mc.provider ?? s.provider ?? 'deepseek');
      setApiHost(mc.apiHost ?? s.apiHost ?? '');
      setApiKey(mc.apiKey ?? s.apiKey ?? '');
      setModelName(mc.model ?? s.model ?? '');
    }
  }, [open]);

  const getLabel = (): string => {
    const s = loadSettings();
    const mc = s.assistantModelConfig;
    const m = mc?.model || s.model || '';
    if (m) return m;
    const p = mc?.provider || s.provider || 'deepseek';
    return getProvider(p).defaultModel || p;
  };

  const handleProviderChange = (key: string) => {
    setProvider(key);
    if (key === 'custom') return;
    const preset = getProvider(key);
    if (!apiHost || apiHost === getProvider(provider).baseUrl) {
      setApiHost(preset.baseUrl);
    }
    if (!modelName || modelName === getProvider(provider).defaultModel) {
      setModelName(preset.defaultModel);
    }
  };

  const handleSave = () => {
    const config: ModelConfig = {};
    if (provider) config.provider = provider;
    if (apiHost.trim()) config.apiHost = apiHost.trim();
    if (apiKey.trim()) config.apiKey = apiKey.trim();
    if (modelName.trim()) config.model = modelName.trim();

    const s = loadSettings();
    s.assistantModelConfig = config;
    saveSettings(s);
    message.success('助理模型已更新');
    setOpen(false);
  };

  const handleReset = () => {
    const s = loadSettings();
    delete s.assistantModelConfig;
    saveSettings(s);
    message.success('已恢复为全局模型');
    setOpen(false);
  };

  const currentLabel = getLabel();

  const content = (
    <div style={{ width: 280, padding: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>🤖 助理机器人模型配置</div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>服务商</div>
        <Select
          value={provider}
          onChange={handleProviderChange}
          style={{ width: '100%' }}
          size="small"
          options={PROVIDER_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>API 地址</div>
        <Input
          size="small"
          value={apiHost}
          onChange={(e) => setApiHost(e.target.value)}
          placeholder="如 https://api.deepseek.com"
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>API Key</div>
        <Input.Password
          size="small"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="助理专用 Key（留空用全局）"
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>模型名</div>
        <Input
          size="small"
          value={modelName}
          onChange={(e) => setModelName(e.target.value)}
          placeholder="如 deepseek-chat / qwen-plus"
        />
      </div>

      <div style={{ textAlign: 'right', borderTop: '1px solid var(--border-light)', paddingTop: 10 }}>
        <Space>
          <Button size="small" onClick={handleReset} danger type="text">恢复全局</Button>
          <Button size="small" onClick={() => setOpen(false)}>取消</Button>
          <Button size="small" type="primary" onClick={handleSave}>保存</Button>
        </Space>
      </div>
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      content={content}
      trigger="click"
      placement="bottomLeft"
      overlayStyle={{ zIndex: 200 }}
    >
      <button
        className="btn btn-sm"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          maxWidth: 140, overflow: 'hidden',
        }}
        title="助理机器人模型配置（员工未设模型时默认使用此模型）"
      >
        <span style={{ fontSize: 11 }}>🧠</span>
        <span
          style={{
            fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis', minWidth: 0,
          }}
        >
          {currentLabel}
        </span>
        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>▼</span>
      </button>
    </Popover>
  );
}
