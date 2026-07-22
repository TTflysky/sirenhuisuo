import { useState, useEffect } from 'react';
import { Modal, Tabs, Switch, Input, Select, Button, Alert, Space, App } from 'antd';
import {
  loadSettings, saveSettings, testConnection,
  PROVIDER_PRESETS, getProvider, resolveApiBase, type AppSettings,
  loadUserProfile, saveUserProfile,
  loadUserMemory, saveUserMemory, type UserMemoryItem,
} from '../../data/hermesClient';

type Tab = 'model' | 'profile' | 'memory';

interface Props {
  onClose: () => void;
  onSaved?: () => void;
}

export default function SettingsModal({ onClose, onSaved }: Props) {
  const [tab, setTab] = useState<Tab>('model');

  const items = [
    { key: 'model', label: '🧠 模型配置', children: <ModelSettingsTab onSaved={onSaved} onClose={onClose} /> },
    { key: 'profile', label: '👤 用户画像', children: <ProfileTab /> },
    { key: 'memory', label: '📝 长期记忆', children: <MemoryTab /> },
  ];

  return (
    <Modal
      open
      onCancel={onClose}
      footer={null}
      width={560}
      title="⚙️ 设置"
      destroyOnClose
      styles={{ body: { paddingTop: 8 } }}
    >
      <Tabs activeKey={tab} onChange={(k) => setTab(k as Tab)} items={items} />
    </Modal>
  );
}

// ===== 模型配置标签 =====
function ModelSettingsTab({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [provider, setProvider] = useState('deepseek');
  const [host, setHost] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [autoDiscuss, setAutoDiscuss] = useState(false);
  const [autoPilot, setAutoPilot] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    const s = loadSettings();
    setAutoDiscuss(s.autoDiscuss ?? false);
    setAutoPilot(s.autoPilot ?? false);
    const p = s.provider ?? 'deepseek';
    setProvider(p);
    setApiKey(s.apiKey ?? '');
    if (p === 'custom') {
      setHost(s.apiHost ?? '');
      setModel(s.model ?? '');
    } else {
      const preset = getProvider(p);
      setHost(s.apiHost || preset.baseUrl);
      setModel(s.model || preset.defaultModel);
    }
  }, []);

  const onProviderChange = (key: string) => {
    setProvider(key);
    setTestResult(null);
    if (key === 'custom') return;
    const preset = getProvider(key);
    setHost(preset.baseUrl);
    setModel(preset.defaultModel);
  };

  const isCustom = provider === 'custom';

  const buildSettings = (): AppSettings => ({
    provider,
    apiHost: host.trim(),
    apiKey: apiKey.trim() || undefined,
    model: model.trim() || undefined,
    autoDiscuss,
    autoPilot,
  });

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    saveSettings(buildSettings());
    const r = await testConnection();
    setTestResult(r);
    setTesting(false);
  };

  const handleSave = () => {
    saveSettings(buildSettings());
    onSaved?.();
    onClose();
  };

  const preview = resolveApiBase(buildSettings()) || '（未填写地址）';

  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>大模型接口配置</h3>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--text)' }}>服务商</div>
        <Select
          value={provider}
          onChange={onProviderChange}
          style={{ width: '100%' }}
          options={PROVIDER_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--text)' }}>
          API 地址（base_url）{!isCustom && <span style={{ color: 'var(--text-muted)' }}>（已按服务商自动填入，可改）</span>}
        </div>
        <Input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="如 https://api.deepseek.com 或 http://localhost:8000/v1"
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--text)' }}>模型名</div>
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="如 deepseek-chat / qwen-plus / glm-4-flash"
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: 'var(--text)' }}>
          API Key{getProvider(provider).needsKey ? '' : '（可选）'}
        </div>
        <Input.Password
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={getProvider(provider).needsKey ? '填入该服务商的 API Key' : '留空则不携带鉴权头'}
        />
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16, fontSize: 12 }}
        message={<span>请求地址：<code style={{ fontSize: 12 }}>{preview}</code></span>}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>团队协作触发方式</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {autoDiscuss ? '自动：发消息/任务后 AI 团队自动讨论（消耗较多 token）' : '手动：点「发起讨论」按钮才触发（省 token）'}
          </div>
        </div>
        <Switch checked={autoDiscuss} onChange={(c) => setAutoDiscuss(c)} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>自主办公模式</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {autoPilot ? '开启：AI 推荐项目后自动执行最佳项目' : '关闭：推荐项目后需手动点「执行」'}
          </div>
        </div>
        <Switch checked={autoPilot} onChange={(c) => setAutoPilot(c)} />
      </div>

      {testResult && (
        <Alert
          type={testResult.ok ? 'success' : 'error'}
          showIcon
          style={{ marginBottom: 16, fontSize: 12 }}
          message={testResult.message}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={handleTest} loading={testing} disabled={!host.trim()}>
          🔌 测试连接
        </Button>
        <Button type="primary" onClick={handleSave} disabled={!host.trim()}>
          保存设置
        </Button>
      </div>
    </div>
  );
}

// ===== 用户画像标签 =====
function ProfileTab() {
  const [text, setText] = useState(() => loadUserProfile());
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    saveUserProfile(text.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>👤 用户画像</h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        描述你的身份、偏好、沟通风格、技术背景等。AI 会在每次对话时参考画像，提供更贴合你的回复。
        <br />
        系统也会在对话中自动提炼你的习惯和思维模式，更新到画像中。
      </p>
      <Input.TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`示例：
- 我是一个独立开发者，主要用 TypeScript 和 React
- 偏好简洁务实的沟通风格
- 对代码质量要求高，喜欢通过讨论确认方向后再实现
- 技术栈：Electron + Next.js + Vite + pnpm`}
        rows={10}
        style={{ fontFamily: 'inherit', fontSize: 13 }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <Button type="primary" onClick={handleSave}>
          {saved ? '✅ 已保存' : '保存画像'}
        </Button>
      </div>
    </div>
  );
}

// ===== 长期记忆标签 =====
function MemoryTab() {
  const { modal } = App.useApp();
  const [items, setItems] = useState<UserMemoryItem[]>(() => loadUserMemory());
  const [newText, setNewText] = useState('');

  const handleAdd = () => {
    const t = newText.trim();
    if (!t) return;
    const newItem: UserMemoryItem = { ts: Date.now(), content: t, source: '手动添加' };
    const next = [...items, newItem];
    saveUserMemory(next);
    setItems(next);
    setNewText('');
  };

  const handleDelete = (idx: number) => {
    const next = items.filter((_, i) => i !== idx);
    saveUserMemory(next);
    setItems(next);
  };

  const handleClearAll = () => {
    modal.confirm({
      title: '清空所有长期记忆？',
      content: '此操作不可撤销。',
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        saveUserMemory([]);
        setItems([]);
      },
    });
  };

  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
        📝 长期记忆
        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
          共 {items.length} 条
        </span>
      </h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        每次对话后系统会自动提炼你的习惯和思维模式追加到记忆。你也可以手动添加或删除。
      </p>

      <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
        <Input
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onPressEnter={handleAdd}
          placeholder="记录一条关于用户的信息…"
        />
        <Button type="primary" onClick={handleAdd} disabled={!newText.trim()}>添加</Button>
      </Space.Compact>

      <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        {items.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            暂无记忆。开始对话后系统会自动提炼用户信息。
          </div>
        )}
        {items.map((item, i) => (
          <div
            key={i}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px',
              borderBottom: i < items.length - 1 ? '1px solid var(--border-light)' : 'none',
              fontSize: 12,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ color: 'var(--text)' }}>{item.content}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                {new Date(item.ts).toLocaleString('zh-CN')} · 来源：{item.source}
              </div>
            </div>
            <Button
              size="small"
              type="text"
              danger
              onClick={() => handleDelete(i)}
              title="删除"
              style={{ flexShrink: 0, fontSize: 12 }}
            >
              ✕
            </Button>
          </div>
        ))}
      </div>

      {items.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <Button size="small" danger onClick={handleClearAll}>
            🗑 清空所有记忆
          </Button>
        </div>
      )}
    </div>
  );
}
