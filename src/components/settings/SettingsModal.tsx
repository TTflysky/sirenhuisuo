import { useEffect, useRef, useState } from 'react';
import { Modal, Switch, Input, Select, Button, Space, App, Tag, Tooltip, Segmented } from 'antd';
import {
  ApiOutlined, BgColorsOutlined, CloudSyncOutlined, DatabaseOutlined, FolderOpenOutlined, RobotOutlined,
  BorderOutlined, CloseOutlined, DeleteOutlined, MergeCellsOutlined, MinusOutlined,
  ScheduleOutlined, SettingOutlined, UserOutlined,
} from '@ant-design/icons';
import {
  loadSettings, saveSettings,
  PROVIDER_PRESETS, getProvider, type AppSettings,
  type ModelEntry,
  testModelConnection, fetchAvailableModels, migrateToModelLibrary,
  loadUserProfile, saveUserProfile,
  loadUserMemory, saveUserMemory, organizeUserMemory, upsertUserMemory,
  USER_MEMORY_CATEGORY_LABELS, type UserMemoryCategory, type UserMemoryItem,
} from '../../data/hermesClient';
import type { ModelConfig } from '../../types';
import { useStore } from '../../store';
import { KnowledgeConnectorManager } from '../sidebar/ConnectorPanel';
import { DEFAULT_ASSISTANT_PROMPT, getAssistantPrompt, saveAssistantPrompt } from './AssistantSettingsModal';
import { applySyncProfile } from '../../utils/configSync';
import {
  FONT_OPTIONS, FONT_SIZE_OPTIONS, loadAppearanceSettings, saveAppearanceSettings,
  type AppearanceSettings,
} from '../../data/appearance';

type Tab = 'model' | 'profile' | 'appearance' | 'knowledge' | 'workspace' | 'memory' | 'persona' | 'automation' | 'backup';

interface Props {
  onClose: () => void;
  onSaved?: () => void;
  standalone?: boolean;
}

export default function SettingsModal({ onClose, onSaved, standalone = false }: Props) {
  const [tab, setTab] = useState<Tab>('model');
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const sections: Array<{ title: string; items: Array<{ key: Tab; label: string; icon: React.ReactNode }> }> = [
    { title: '配置', items: [
      { key: 'model', label: '模型', icon: <ApiOutlined /> },
      { key: 'profile', label: '用户画像', icon: <UserOutlined /> },
      { key: 'appearance', label: '外观', icon: <BgColorsOutlined /> },
      { key: 'knowledge', label: '知识库', icon: <DatabaseOutlined /> },
      { key: 'workspace', label: '工作区', icon: <FolderOpenOutlined /> },
      { key: 'memory', label: '记忆', icon: <CloudSyncOutlined /> },
      { key: 'persona', label: '人格', icon: <RobotOutlined /> },
    ] },
    { title: '自动化', items: [{ key: 'automation', label: '执行策略', icon: <ScheduleOutlined /> }] },
    { title: '备份与恢复', items: [{ key: 'backup', label: '备份迁移', icon: <SettingOutlined /> }] },
  ];

  const page = tab === 'model' ? <ModelSettingsTab onSaved={onSaved} onClose={onClose} />
    : tab === 'profile' ? <ProfileTab />
    : tab === 'appearance' ? <AppearanceTab />
    : tab === 'knowledge' ? <KnowledgeSettingsPage />
    : tab === 'workspace' ? <WorkspaceTab />
    : tab === 'memory' ? <MemoryTab />
    : tab === 'persona' ? <PersonaTab />
    : tab === 'automation' ? <AutomationTab />
    : <BackupTab />;

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, input, textarea, select, [role="combobox"], .ant-select, .ant-switch')) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = dragOffset;
    const move = (moveEvent: PointerEvent) => setDragOffset({
      x: origin.x + moveEvent.clientX - startX,
      y: origin.y + moveEvent.clientY - startY,
    });
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  };

  const content = (
    <div className="settings-center">
      <aside className="settings-center-nav">
        <div className="settings-center-brand" onPointerDown={standalone ? undefined : startDrag} title={standalone ? '设置中心' : '按住拖动设置窗口'}><SettingOutlined /><div><strong>设置</strong><small>私人办公会所</small></div></div>
        {sections.map((section) => <div className="settings-nav-section" key={section.title}>
          <div className="settings-nav-title">{section.title}</div>
          {section.items.map((item) => <button className={tab === item.key ? 'active' : ''} key={item.key} onClick={() => setTab(item.key)}>{item.icon}<span>{item.label}</span><code>/{item.key}</code></button>)}
        </div>)}
      </aside>
      <main className={`settings-center-content settings-page-${tab}`} onPointerDown={standalone ? undefined : startDrag}>{page}</main>
    </div>
  );

  if (standalone) {
    return <div className="settings-standalone">
      <div className="settings-native-titlebar">
        <span><SettingOutlined /> 设置</span>
        <div className="settings-native-actions">
          <button className="titlebar-btn window-control" title="最小化" aria-label="最小化" onClick={() => window.electronAPI?.minimize()}><MinusOutlined /></button>
          <button className="titlebar-btn window-control" title="最大化" aria-label="最大化" onClick={() => window.electronAPI?.toggleMax()}><BorderOutlined /></button>
          <button className="titlebar-btn window-control window-control-close" title="关闭" aria-label="关闭" onClick={onClose}><CloseOutlined /></button>
        </div>
      </div>
      {content}
    </div>;
  }

  return (
    <Modal
      open
      onCancel={onClose}
      footer={null}
      width={980}
      title={null}
      destroyOnClose
      className="settings-center-modal"
      styles={{ body: { padding: 0, height: 'min(720px, calc(100vh - 90px))', overflow: 'hidden' } }}
      modalRender={(modal) => <div className="settings-modal-drag-shell" style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}>{modal}</div>}
    >
      {content}
    </Modal>
  );
}

function AppearanceTab() {
  const [settings, setSettings] = useState<AppearanceSettings>(() => loadAppearanceSettings());
  const selectedFont = FONT_OPTIONS.find((option) => option.value === settings.font) ?? FONT_OPTIONS[0];
  const update = (partial: Partial<AppearanceSettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    saveAppearanceSettings(next);
  };
  return <div className="settings-content-page appearance-settings-page">
    <header><h2>外观</h2><span>客户端字体与界面字号</span></header>
    <div className="settings-field"><label>字体</label><Select value={settings.font} options={FONT_OPTIONS.map(({ value, label }) => ({ value, label }))} onChange={(font) => update({ font })} /></div>
    <div className="settings-field"><label>字体大小</label><Segmented block value={settings.fontSize} options={FONT_SIZE_OPTIONS.map(({ value, label }) => ({ value, label }))} onChange={(fontSize: string | number) => update({ fontSize: fontSize as AppearanceSettings['fontSize'] })} /></div>
    <div className="appearance-font-preview" style={{ fontFamily: selectedFont.family }}>
      <strong>私人办公会所</strong>
      <span>清晰阅读 Skill 说明、任务消息和设置内容。</span>
      <code>Hermes Office · Aa 123</code>
    </div>
  </div>;
}

function KnowledgeSettingsPage() {
  return <div className="settings-content-page"><header><h2>知识库</h2><span>网页内容与 Obsidian Vault</span></header><KnowledgeConnectorManager /></div>;
}

function WorkspaceTab() {
  const [workspace, setWorkspace] = useState('');
  useEffect(() => { void window.electronAPI?.getWorkspace?.().then(setWorkspace); }, []);
  return <div className="settings-content-page"><header><h2>工作区</h2><span>员工任务文件与产出物目录</span></header><div className="settings-field"><label>目录</label><div className="knowledge-path-row"><Input value={workspace} readOnly /><Button icon={<FolderOpenOutlined />} onClick={() => workspace && void window.electronAPI?.openPath?.(workspace)}>打开</Button></div></div></div>;
}

function PersonaTab() {
  const [prompt, setPrompt] = useState(() => getAssistantPrompt());
  const [saved, setSaved] = useState(false);
  const save = () => { saveAssistantPrompt(prompt); setSaved(true); setTimeout(() => setSaved(false), 1500); };
  return <div className="settings-content-page"><header><h2>助理人格</h2><span>与驴狗蛋助手窗口共用同一份角色、工具和调度规则</span></header><Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={16} /><div className="settings-page-actions"><Button onClick={() => setPrompt(DEFAULT_ASSISTANT_PROMPT)}>应用新版默认人格</Button><Button type="primary" onClick={save}>{saved ? '已保存' : '保存人格'}</Button></div></div>;
}

function AutomationTab() {
  const [settings, setSettings] = useState(() => loadSettings());
  const change = (key: 'autoDiscuss' | 'autoPilot', value: boolean) => { const next = { ...loadSettings(), [key]: value }; saveSettings(next); setSettings(next); };
  const changeFollowUp = (followUpMode: 'queue' | 'steer') => { const next = { ...loadSettings(), followUpMode }; saveSettings(next); setSettings(next); };
  return <div className="settings-content-page"><header><h2>执行策略</h2><span>团队讨论、自主办公与运行中跟进</span></header><div className="settings-field"><label>跟进行为</label><Segmented block value={settings.followUpMode ?? 'steer'} options={[{ label: '排队', value: 'queue' }, { label: '引导', value: 'steer' }]} onChange={(value) => changeFollowUp(value as 'queue' | 'steer')} /><small>引导会把新消息加入当前运行并调整后续工具与步骤；排队会在当前回复完成后处理。</small></div><div className="settings-switch-row"><div><strong>自动讨论</strong><small>收到任务后自动组织团队讨论</small></div><Switch checked={settings.autoDiscuss ?? false} onChange={(value) => change('autoDiscuss', value)} /></div><div className="settings-switch-row"><div><strong>自主办公</strong><small>确认项目后自动推进执行流程</small></div><Switch checked={settings.autoPilot ?? false} onChange={(value) => change('autoPilot', value)} /></div></div>;
}

function BackupTab() {
  const { message } = App.useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const importProfile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try { const result = applySyncProfile(JSON.parse(await file.text())); message.success(`已导入 ${result.employees} 名员工、${result.teams} 个团队、${result.models} 个模型`); location.reload(); }
    catch (error) { message.error(error instanceof Error ? error.message : '导入失败'); }
  };
  return <div className="settings-content-page"><header><h2>备份迁移</h2><span>工作区备份与脱敏配置导入</span></header><div className="settings-action-list"><div><div><strong>导出工作区</strong><small>任务文件和产出物 ZIP</small></div><Button onClick={() => void window.electronAPI?.fsExportZip?.()}>导出</Button></div><div><div><strong>导入同步配置</strong><small>员工、团队、模型和连接器</small></div><Button onClick={() => fileRef.current?.click()}>导入</Button><input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importProfile(event)} /></div></div></div>;
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
  const [fetchingModels, setFetchingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

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
    setAvailableModels([]);
  };

  const startEdit = (entry: ModelEntry) => {
    setEditingId(entry.id);
    setEditLabel(entry.label);
    setEditProvider(entry.provider ?? 'deepseek');
    setEditHost(entry.apiHost ?? '');
    setEditApiKey(entry.apiKey ?? '');
    setEditModel(entry.model ?? '');
    setAvailableModels(entry.model ? [entry.model] : []);
  };

  const handleProviderChange = (key: string) => {
    setEditProvider(key);
    if (key === 'custom') return;
    const preset = getProvider(key);
    setEditHost(preset.baseUrl);
    setEditModel(preset.defaultModel);
  };

  const handleFetchModels = async () => {
    if (!editHost.trim()) {
      message.warning('请先填写 API 地址');
      return;
    }
    setFetchingModels(true);
    const result = await fetchAvailableModels({ provider: editProvider, apiHost: editHost.trim(), apiKey: editApiKey.trim() || undefined });
    setFetchingModels(false);
    if (!result.ok) {
      message.error(`${result.message}${result.endpoint ? `（${result.endpoint}）` : ''}`);
      return;
    }
    setAvailableModels(result.models);
    if (!result.models.includes(editModel)) setEditModel(result.models[0]);
    message.success(result.message);
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
            <Select
              showSearch
              allowClear
              value={editModel || undefined}
              onChange={(value) => setEditModel(value ?? '')}
              placeholder="点击“获取模型”后选择"
              style={{ width: '50%' }}
              options={availableModels.map((model) => ({ value: model, label: model }))}
            />
            <Input.Password
              value={editApiKey}
              onChange={(e) => setEditApiKey(e.target.value)}
              placeholder="API Key"
              style={{ width: '50%' }}
            />
          </Space.Compact>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -3, marginBottom: 8 }}>
            <Button size="small" onClick={() => void handleFetchModels()} loading={fetchingModels}>↻ 获取当前 API 的模型</Button>
          </div>
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
        这里由你主动维护，系统不会用对话推测覆盖它；自动提炼的内容会进入“长期记忆”等待筛选和归并。
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
  const { modal, message } = App.useApp();
  const [items, setItems] = useState<UserMemoryItem[]>(() => loadUserMemory());
  const [newText, setNewText] = useState('');

  const handleAdd = () => {
    const t = newText.trim();
    if (!t) return;
    const result = upsertUserMemory({ ts: Date.now(), content: t, source: '手动添加', importance: 5, confidence: 1 });
    setItems(result.items);
    setNewText('');
    message[result.action === 'ignored' ? 'info' : 'success'](result.action === 'ignored' ? '已有相同记忆，未重复添加' : result.action === 'updated' ? '已归并到相似记忆' : '已加入长期记忆');
  };

  const handleOrganize = () => {
    const before = items.length;
    const next = organizeUserMemory(items);
    saveUserMemory(next);
    setItems(next);
    message.success(`整理完成：归并 ${before - next.length} 条重复或相似记忆，保留 ${next.length} 条`);
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
        长期记忆
        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
          共 {items.length} 条
        </span>
      </h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        系统只保留以后仍然有用的稳定事实，并自动去重、归并和更新冲突信息；一次性任务、闲聊、工具报错和未确认推测不会写入。
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

      <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        {items.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            暂无有效长期记忆。系统会从后续对话中筛选值得长期保留的信息。
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
              <div style={{ display: 'flex', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                <Tag color="blue">{USER_MEMORY_CATEGORY_LABELS[(item.category ?? 'identity') as UserMemoryCategory]}</Tag>
                <Tag color={(item.importance ?? 3) >= 4 ? 'gold' : 'default'}>重要性 {item.importance ?? 3}/5</Tag>
                {(item.confidence ?? 0.8) < 0.75 && <Tag color="orange">待确认</Tag>}
              </div>
              <div style={{ color: 'var(--text)' }}>{item.content}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                更新于 {new Date(item.updatedAt ?? item.ts).toLocaleString('zh-CN')} · 来源：{item.source}
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
              <DeleteOutlined />
            </Button>
          </div>
        ))}
      </div>

      {items.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
          <Button size="small" icon={<MergeCellsOutlined />} onClick={handleOrganize}>
            整理现有记忆
          </Button>
          <Button size="small" danger onClick={handleClearAll}>
            <DeleteOutlined /> 清空所有记忆
          </Button>
        </div>
      )}
    </div>
  );
}
