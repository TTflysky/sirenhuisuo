import { useState } from 'react';
import { Modal, Tabs, Switch, Input, Select, Button, Space, App, Tag, Tooltip } from 'antd';
import {
  loadSettings, saveSettings,
  PROVIDER_PRESETS, getProvider, type AppSettings,
  type ModelEntry,
  testModelConnection, migrateToModelLibrary,
  loadUserProfile, saveUserProfile,
  loadUserMemory, saveUserMemory, type UserMemoryItem,
} from '../../data/hermesClient';
import type { ModelConfig } from '../../types';
import { useStore } from '../../store';

type Tab = 'model' | 'profile' | 'memory';

interface Props {
  onClose: () => void;
  onSaved?: () => void;
}

export default function SettingsModal({ onClose, onSaved }: Props) {
  const [tab, setTab] = useState<Tab>('model');

  const items = [
    { key: 'model', label: '🧠 模型库', children: <ModelSettingsTab onSaved={onSaved} onClose={onClose} /> },
    { key: 'profile', label: '👤 用户画像', children: <ProfileTab /> },
    { key: 'memory', label: '📝 长期记忆', children: <MemoryTab /> },
  ];

  return (
    <Modal
      open
      onCancel={onClose}
      footer={null}
      width={580}
      title="⚙️ 设置"
      destroyOnClose
      styles={{ body: { paddingTop: 8 } }}
    >
      <Tabs activeKey={tab} onChange={(k) => setTab(k as Tab)} items={items} />
    </Modal>
  );
}

// ===== 模型库标签 =====
function ModelSettingsTab({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const { dispatch } = useStore();
  const { message } = App.useApp();
  const [settings, setSettings] = useState<AppSettings>(() => {
    migrateToModelLibrary();
    return loadSettings();
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  // 编辑状态
  const [editLabel, setEditLabel] = useState('');
  const [editProvider, setEditProvider] = useState('deepseek');
  const [editHost, setEditHost] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [editModel, setEditModel] = useState('');

  const library = settings.modelLibrary ?? [];
  const activeId = settings.activeModelId;
  const assistantId = settings.assistantModelId;

  const startAdd = () => {
    setEditingId('__new__');
    setEditLabel('');
    setEditProvider('deepseek');
    const preset = getProvider('deepseek');
    setEditHost(preset.baseUrl);
    setEditModel(preset.defaultModel);
    setEditApiKey('');
  };

  const startEdit = (entry: ModelEntry) => {
    setEditingId(entry.id);
    setEditLabel(entry.label);
    setEditProvider(entry.provider ?? 'deepseek');
    setEditHost(entry.apiHost ?? '');
    setEditApiKey(entry.apiKey ?? '');
    setEditModel(entry.model ?? '');
  };

  const handleProviderChange = (key: string) => {
    setEditProvider(key);
    if (key === 'custom') return;
    const preset = getProvider(key);
    setEditHost(preset.baseUrl);
    setEditModel(preset.defaultModel);
  };

  const handleSaveEntry = () => {
    if (!editHost.trim()) {
      message.warning('请填写 API 地址');
      return;
    }
    const config: ModelConfig = {
      provider: editProvider,
      apiHost: editHost.trim(),
      apiKey: editApiKey.trim() || undefined,
      model: editModel.trim() || undefined,
    };

    const s = loadSettings();
    if (!s.modelLibrary) s.modelLibrary = [];

    if (editingId === '__new__') {
      const entry: ModelEntry = {
        ...config,
        id: `model-${Date.now()}`,
        label: editLabel.trim() || editModel.trim() || getProvider(editProvider).label,
      };
      s.modelLibrary.push(entry);
      if (!s.activeModelId) s.activeModelId = entry.id;
    } else {
      const idx = s.modelLibrary.findIndex(m => m.id === editingId);
      if (idx >= 0) {
        s.modelLibrary[idx] = {
          ...s.modelLibrary[idx],
          ...config,
          label: editLabel.trim() || editModel.trim() || s.modelLibrary[idx].label,
        };
      }
    }

    saveSettings(s);
    setSettings({ ...s });
    setEditingId(null);
    message.success(editingId === '__new__' ? '模型已添加' : '模型已更新');
  };

  const handleDelete = (id: string) => {
    const s = loadSettings();
    if (!s.modelLibrary) return;
    s.modelLibrary = s.modelLibrary.filter(m => m.id !== id);
    if (s.activeModelId === id) {
      s.activeModelId = s.modelLibrary[0]?.id;
    }
    if (s.assistantModelId === id) {
      s.assistantModelId = undefined;
    }
    saveSettings(s);
    setSettings({ ...s });
    message.success('已删除');
  };

  const handleSetActive = (id: string) => {
    const s = loadSettings();
    s.activeModelId = id;
    // 同步旧字段以兼容
    const entry = s.modelLibrary?.find(m => m.id === id);
    if (entry) {
      s.provider = entry.provider;
      s.apiHost = entry.apiHost;
      s.apiKey = entry.apiKey;
      s.model = entry.model;
    }
    saveSettings(s);
    setSettings({ ...s });
    onSaved?.();
    message.success('已设为全局默认');
  };

  const handleSetAssistant = (id: string) => {
    const s = loadSettings();
    s.assistantModelId = id;
    // 同步旧字段
    const entry = s.modelLibrary?.find(m => m.id === id);
    if (entry) {
      s.assistantModelConfig = { provider: entry.provider, apiHost: entry.apiHost, apiKey: entry.apiKey, model: entry.model };
    }
    saveSettings(s);
    setSettings({ ...s });
    message.success('已设为助理模型');
  };

  const handleTest = async (entry: ModelEntry) => {
    setTesting(entry.id);
    const r = await testModelConnection(entry);
    const s = loadSettings();
    if (s.modelLibrary) {
      const idx = s.modelLibrary.findIndex(m => m.id === entry.id);
      if (idx >= 0) {
        s.modelLibrary[idx] = {
          ...s.modelLibrary[idx],
          tested: r.ok ? 'ok' : 'fail',
          lastTested: Date.now(),
          lastLatencyMs: r.latencyMs,
          lastHttpStatus: r.httpStatus,
          lastTestMessage: r.message,
          lastTestEndpoint: r.endpoint,
        };
        saveSettings(s);
        setSettings({ ...s });
      }
    }
    setTesting(null);
    if (entry.id === s.activeModelId) {
      dispatch({ type: 'SET_STATUS', partial: { backendOnline: r.ok } });
    }
    if (r.ok) message.success(`✓ ${entry.label}：${r.message}`);
    else message.error(`✗ ${entry.label}：${r.message}`);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>模型库</h3>
        <Button size="small" type="primary" onClick={startAdd}>➕ 添加模型</Button>
      </div>

      {/* 模型列表 */}
      <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 12, border: '1px solid var(--border-light)', borderRadius: 8 }}>
        {library.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            模型库为空，点击「➕ 添加模型」开始配置
          </div>
        )}
        {library.map((entry) => (
          <div
            key={entry.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
              borderBottom: '1px solid var(--border-light)',
              background: entry.id === activeId ? 'rgba(26,31,54,0.04)' : 'transparent',
            }}
          >
            {/* 测试状态指示灯 */}
            <Tooltip title={entry.lastTestMessage ?? (entry.tested === 'ok' ? '连接正常' : entry.tested === 'fail' ? '连接失败' : '未测试')}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: entry.tested === 'ok' ? '#52c41a' : entry.tested === 'fail' ? '#ff4d4f' : '#d9d9d9',
                boxShadow: entry.tested === 'ok' ? '0 0 6px #52c41a' : 'none',
              }} />
            </Tooltip>

            {/* 名称 + 模型 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {entry.label}
                {entry.id === activeId && <Tag color="blue" style={{ fontSize: 10, margin: 0, lineHeight: '18px' }}>全局</Tag>}
                {entry.id === assistantId && <Tag color="purple" style={{ fontSize: 10, margin: 0, lineHeight: '18px' }}>助理</Tag>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {entry.model ?? '未设置模型名'} · {getProvider(entry.provider).label}
              </div>
              {entry.lastTestMessage && (
                <div style={{ fontSize: 10, marginTop: 3, color: entry.tested === 'ok' ? 'var(--online)' : 'var(--danger)', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                  {entry.lastTestMessage}
                </div>
              )}
              {entry.lastTestEndpoint && (
                <div style={{ fontSize: 10, marginTop: 2, color: 'var(--text-muted)', whiteSpace: 'normal', wordBreak: 'break-all' }}>
                  {entry.lastTestEndpoint}{entry.lastTested ? ` · ${new Date(entry.lastTested).toLocaleString()}` : ''}
                </div>
              )}
            </div>

            {/* 操作按钮 */}
            <Space size="small">
              <Button size="small" onClick={() => handleTest(entry)} loading={testing === entry.id}>测试</Button>
              <Button size="small" onClick={() => startEdit(entry)}>编辑</Button>
              <Button size="small" type="text" danger onClick={() => handleDelete(entry.id)}>删除</Button>
            </Space>
          </div>
        ))}
      </div>

      {/* 设置为默认/助理 */}
      {library.length > 0 && (
        <Space style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 500 }}>全局默认：</span>
          <Select
            size="small"
            value={activeId}
            onChange={handleSetActive}
            style={{ width: 160 }}
            options={library.map(m => ({ value: m.id, label: m.label }))}
          />
          <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 8 }}>助理：</span>
          <Select
            size="small"
            value={assistantId ?? '__none__'}
            onChange={(v) => v === '__none__' ? null : handleSetAssistant(v)}
            style={{ width: 160 }}
            options={[
              { value: '__none__', label: '跟随全局' },
              ...library.map(m => ({ value: m.id, label: m.label })),
            ]}
          />
        </Space>
      )}

      {/* 编辑/添加表单 */}
      {editingId && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            {editingId === '__new__' ? '➕ 添加新模型' : '✏️ 编辑模型'}
          </div>
          <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
            <Input
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              placeholder="模型显示名（如 DeepSeek 主力）"
              style={{ width: '100%' }}
            />
          </Space.Compact>
          <div style={{ marginBottom: 8 }}>
            <Select
              value={editProvider}
              onChange={handleProviderChange}
              style={{ width: '100%' }}
              options={PROVIDER_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
            />
          </div>
          <Input
            value={editHost}
            onChange={(e) => setEditHost(e.target.value)}
            placeholder="API 地址，如 https://api.deepseek.com"
            style={{ marginBottom: 8 }}
          />
          <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
            <Input
              value={editModel}
              onChange={(e) => setEditModel(e.target.value)}
              placeholder="模型名，如 deepseek-chat"
              style={{ width: '50%' }}
            />
            <Input.Password
              value={editApiKey}
              onChange={(e) => setEditApiKey(e.target.value)}
              placeholder="API Key"
              style={{ width: '50%' }}
            />
          </Space.Compact>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button size="small" onClick={() => setEditingId(null)}>取消</Button>
            <Button size="small" type="primary" onClick={handleSaveEntry}>保存</Button>
          </div>
        </div>
      )}

      {/* 开关 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, borderTop: '1px solid var(--border-light)', paddingTop: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>团队协作触发方式</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {settings.autoDiscuss ? '自动：发消息/任务后 AI 团队自动讨论' : '手动：点「发起讨论」按钮才触发'}
          </div>
        </div>
        <Switch
          checked={settings.autoDiscuss ?? false}
          onChange={(c) => {
            const s = loadSettings();
            s.autoDiscuss = c;
            saveSettings(s);
            setSettings({ ...s });
          }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>自主办公模式</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {settings.autoPilot ? '开启：AI 推荐项目后自动执行' : '关闭：推荐项目后需手动点「执行」'}
          </div>
        </div>
        <Switch
          checked={settings.autoPilot ?? false}
          onChange={(c) => {
            const s = loadSettings();
            s.autoPilot = c;
            saveSettings(s);
            setSettings({ ...s });
          }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>关闭</Button>
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
