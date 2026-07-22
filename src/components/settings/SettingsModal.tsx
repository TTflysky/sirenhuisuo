import { useState, useEffect } from 'react';
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

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ width: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <h2>⚙️ 设置</h2>

        {/* 标签栏 */}
        <div className="settings-tabs" style={{ display: 'flex', gap: 2, marginBottom: 14, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
          {([
            { key: 'model', label: '🧠 模型配置' },
            { key: 'profile', label: '👤 用户画像' },
            { key: 'memory', label: '📝 长期记忆' },
          ] as { key: Tab; label: string }[]).map((t) => (
            <button
              key={t.key}
              className={`settings-tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
              style={{
                padding: '6px 16px', border: 'none', borderRadius: '8px 8px 0 0',
                background: tab === t.key ? 'var(--bg-deep)' : 'transparent',
                color: tab === t.key ? 'var(--text)' : 'var(--text-muted)',
                fontWeight: tab === t.key ? 600 : 400, cursor: 'pointer', fontSize: 13,
                transition: 'all 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 2px' }}>
          {tab === 'model' && <ModelSettingsTab onSaved={onSaved} onClose={onClose} />}
          {tab === 'profile' && <ProfileTab />}
          {tab === 'memory' && <MemoryTab />}
        </div>
      </div>
    </div>
  );
}

// ===== 模型配置标签 =====
function ModelSettingsTab({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [provider, setProvider] = useState('deepseek');
  const [host, setHost] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [autoDiscuss, setAutoDiscuss] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    const s = loadSettings();
    setAutoDiscuss(s.autoDiscuss ?? false);
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
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'var(--text)' }}>大模型接口配置</h3>

      <div className="form-group">
        <label className="form-label">服务商</label>
        <div className="provider-grid">
          {PROVIDER_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`provider-option ${provider === p.key ? 'selected' : ''}`}
              onClick={() => onProviderChange(p.key)}
              title={p.desc}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">
          API 地址（base_url）{!isCustom && <span className="form-hint">已按服务商自动填入，可改</span>}
        </label>
        <input
          className="form-input"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="如 https://api.deepseek.com 或 http://localhost:8000/v1"
        />
      </div>

      <div className="form-group">
        <label className="form-label">模型名</label>
        <input
          className="form-input"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="如 deepseek-chat / qwen-plus / glm-4-flash"
        />
      </div>

      <div className="form-group">
        <label className="form-label">API Key{getProvider(provider).needsKey ? '' : '（可选）'}</label>
        <input
          className="form-input"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={getProvider(provider).needsKey ? '填入该服务商的 API Key' : '留空则不携带鉴权头'}
        />
      </div>

      <div className="api-preview">
        <span className="api-preview-label">请求地址：</span>
        <code className="api-preview-url">{preview}</code>
      </div>

      <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label className="form-label" style={{ margin: 0, flex: 1 }}>
          团队协作触发方式
          <span className="form-hint" style={{ display: 'block', marginTop: 2 }}>
            {autoDiscuss ? '自动：发消息/任务后 AI 团队自动讨论（消耗较多 token）' : '手动：点「发起讨论」按钮才触发（省 token）'}
          </span>
        </label>
        <button
          type="button"
          className={`toggle-switch ${autoDiscuss ? 'on' : ''}`}
          onClick={() => setAutoDiscuss(!autoDiscuss)}
          title={autoDiscuss ? '点击切换为手动' : '点击切换为自动'}
        >
          <span className="toggle-knob" />
        </button>
      </div>

      {testResult && (
        <div className={`api-test-result ${testResult.ok ? 'ok' : 'fail'}`}>
          {testResult.message}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button className="btn" onClick={handleTest} disabled={testing || !host.trim()}>
          {testing ? '测试中…' : '🔌 测试连接'}
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={!host.trim()}>
          保存设置
        </button>
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
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>👤 用户画像</h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        描述你的身份、偏好、沟通风格、技术背景等。AI 会在每次对话时参考画像，提供更贴合你的回复。
        <br />
        系统也会在对话中自动提炼你的习惯和思维模式，更新到画像中。
      </p>
      <textarea
        className="form-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`示例：
- 我是一个独立开发者，主要用 TypeScript 和 React
- 偏好简洁务实的沟通风格
- 对代码质量要求高，喜欢通过讨论确认方向后再实现
- 技术栈：Electron + Next.js + Vite + pnpm`}
        rows={10}
        style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <button className="btn btn-primary" onClick={handleSave}>
          {saved ? '✅ 已保存' : '保存画像'}
        </button>
      </div>
    </div>
  );
}

// ===== 长期记忆标签 =====
function MemoryTab() {
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
    if (confirm('确认清空所有长期记忆？')) {
      saveUserMemory([]);
      setItems([]);
    }
  };

  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>
        📝 长期记忆
        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
          共 {items.length} 条
        </span>
      </h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        每次对话后系统会自动提炼你的习惯和思维模式追加到记忆。你也可以手动添加或删除。
      </p>

      {/* 添加新记忆 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <input
          className="form-input"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="记录一条关于用户的信息…"
          style={{ flex: 1 }}
        />
        <button className="btn btn-sm btn-primary" onClick={handleAdd} disabled={!newText.trim()}>添加</button>
      </div>

      {/* 记忆列表 */}
      <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
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
            <button
              className="btn btn-sm"
              style={{ flexShrink: 0, fontSize: 10, padding: '2px 6px' }}
              onClick={() => handleDelete(i)}
              title="删除"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {items.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="btn btn-sm" onClick={handleClearAll} style={{ color: 'var(--error)' }}>
            🗑 清空所有记忆
          </button>
        </div>
      )}
    </div>
  );
}
