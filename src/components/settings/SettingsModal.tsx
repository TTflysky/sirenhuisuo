import { useEffect, useRef, useState } from 'react';
import { Modal, Switch, Input, Select, Button, Space, App, Tag, Tooltip, Segmented } from 'antd';
import {
  ApiOutlined, BgColorsOutlined, CloudSyncOutlined, DatabaseOutlined, FolderOpenOutlined, RobotOutlined,
  BorderOutlined, CloseOutlined, DeleteOutlined, MergeCellsOutlined, MinusOutlined,
  ScheduleOutlined, SafetyCertificateOutlined, SettingOutlined, UserOutlined,
} from '@ant-design/icons';
import {
  loadSettings, saveSettings,
  APPROVAL_MODE_OPTIONS, getExecutionPolicy, saveExecutionPolicy,
  PROVIDER_PRESETS, getModelCapabilities, getProvider, type AppSettings,
  type ModelEntry,
  testModelConnection, fetchAvailableModels, migrateToModelLibrary,
  loadUserProfile, saveUserProfile,
  getReviewModel,
} from '../../data/hermesClient';
import {
  loadUserMemory, saveUserMemory, organizeUserMemory, upsertUserMemory, reviewUserMemory,
  memoryQualitySummary, memoryReviewState, USER_MEMORY_CATEGORY_LABELS,
  type UserMemoryCategory, type UserMemoryItem,
} from '../../data/userMemory';
import type { ModelConfig } from '../../types';
import type { LayeredMemoryEntry, MemoryProposal, LearningReviewItem } from '../../electron';
import { useStore } from '../../storeContext';
import { KnowledgeConnectorManager } from '../sidebar/ConnectorPanel';
import { DEFAULT_ASSISTANT_PROMPT, DEFAULT_PROMPT_VERSION, PERSONA_MIGRATION_APPENDIX } from './AssistantSettingsModal';
import { getAssistantPrompt, saveAssistantPrompt } from '../../data/assistantPrompt';
import { applySyncProfile, createSyncProfile, restoreUpgradeSnapshot } from '../../utils/configSync';
import {
  FONT_OPTIONS, FONT_SIZE_OPTIONS, loadAppearanceSettings, saveAppearanceSettings,
  type AppearanceSettings,
} from '../../data/appearance';
import { APP_VERSION } from '../../appVersion';
import DiagnosticsTab from './DiagnosticsTab';
import { APP_BRAND_NAME, APP_PRODUCT_NAME } from '../../brand';
import { loadTaskLearnings, saveTaskLearnings, type TaskLearning } from '../../engine/taskLearningMemory';
import { loadLayeredMemorySnapshot } from '../../data/layeredMemory';

type Tab = 'diagnostics' | 'model' | 'profile' | 'appearance' | 'knowledge' | 'workspace' | 'memory' | 'persona' | 'automation' | 'backup';

interface Props {
  onClose: () => void;
  onSaved?: () => void;
  standalone?: boolean;
}

export default function SettingsModal({ onClose, onSaved, standalone = false }: Props) {
  const [tab, setTab] = useState<Tab>('diagnostics');
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const sections: Array<{ title: string; items: Array<{ key: Tab; label: string; icon: React.ReactNode }> }> = [
    { title: '配置', items: [
      { key: 'diagnostics', label: '诊断中心', icon: <SafetyCertificateOutlined /> },
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

  const page = tab === 'diagnostics' ? <DiagnosticsTab onNavigate={(target) => setTab(target)} />
    : tab === 'model' ? <ModelSettingsTab onSaved={onSaved} onClose={onClose} />
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
        <div className="settings-center-brand" onPointerDown={standalone ? undefined : startDrag} title={standalone ? '设置中心' : '按住拖动设置窗口'}><SettingOutlined /><div><strong>设置</strong><small>{APP_PRODUCT_NAME} <span className="window-version-badge">v{APP_VERSION}</span></small></div></div>
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
        <span><SettingOutlined /> 设置 <span className="window-version-badge" title={`当前版本 v${APP_VERSION}`}>v{APP_VERSION}</span></span>
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
      <strong>{APP_PRODUCT_NAME}</strong>
      <span>清晰阅读 Skill 说明、任务消息和设置内容。</span>
      <code>{APP_BRAND_NAME} Office · Aa 123</code>
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
  const [prompt, setPrompt] = useState(() => getAssistantPrompt(DEFAULT_ASSISTANT_PROMPT, DEFAULT_PROMPT_VERSION, PERSONA_MIGRATION_APPENDIX));
  const [saved, setSaved] = useState(false);
  const save = () => { saveAssistantPrompt(prompt, DEFAULT_PROMPT_VERSION); setSaved(true); setTimeout(() => setSaved(false), 1500); };
  return <div className="settings-content-page"><header><h2>助理人格</h2><span>与章北海助理窗口共用同一份角色、工具和调度规则</span></header><Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={16} /><div className="settings-page-actions"><Button onClick={() => setPrompt(DEFAULT_ASSISTANT_PROMPT)}>应用新版默认人格</Button><Button type="primary" onClick={save}>{saved ? '已保存' : '保存人格'}</Button></div></div>;
}

function AutomationTab() {
  const [settings, setSettings] = useState(() => loadSettings());
  const change = (key: 'autoDiscuss' | 'autoPilot' | 'memoryWriteApproval', value: boolean) => { const next = { ...loadSettings(), [key]: value }; saveSettings(next); setSettings(next); };
  const changeFollowUp = (followUpMode: 'queue' | 'steer') => { const next = { ...loadSettings(), followUpMode }; saveSettings(next); setSettings(next); };
  const policy = getExecutionPolicy(settings);
  const changePolicy = (update: Parameters<typeof saveExecutionPolicy>[0]) => setSettings(saveExecutionPolicy(update));
  return <div className="settings-content-page"><header><h2>执行策略</h2><span>团队讨论、自主办公、工具审批与运行中跟进</span></header><div className="settings-field"><label>跟进行为</label><Segmented block value={settings.followUpMode ?? 'steer'} options={[{ label: '排队', value: 'queue' }, { label: '引导', value: 'steer' }]} onChange={(value) => changeFollowUp(value as 'queue' | 'steer')} /><small>引导会在当前模型或工具的安全边界先回答新消息，再结合上下文调整计划；暂停中的任务回答后仍保持暂停。排队则在当前任务结束后单独处理。</small></div><div className="settings-switch-row"><div><strong>文件与命令沙盒</strong><small>{policy.sandboxEnabled ? '已开启：文件和命令只能使用客户端工作区。' : '已关闭：命令可访问沙盒外的本机路径，请仅在确认任务来源时使用。'}</small></div><Switch checked={policy.sandboxEnabled} onChange={(sandboxEnabled) => changePolicy({ sandboxEnabled })} /></div><div className="settings-field"><label>命令执行审批</label><Segmented block value={policy.approvalMode} options={APPROVAL_MODE_OPTIONS.map(({ value, label }) => ({ value, label }))} onChange={(approvalMode) => changePolicy({ approvalMode: approvalMode as typeof policy.approvalMode })} /><small>{APPROVAL_MODE_OPTIONS.find((option) => option.value === policy.approvalMode)?.description}</small></div><div className="settings-field"><label>连接器与外部授权审批</label><Segmented block value={policy.connectorApprovalMode} options={APPROVAL_MODE_OPTIONS.map(({ value, label }) => ({ value, label }))} onChange={(connectorApprovalMode) => changePolicy({ connectorApprovalMode: connectorApprovalMode as typeof policy.connectorApprovalMode })} /><small>连接测试、知识库和外部服务使用独立审批档位。密码、验证码、付费、删除和对外发送始终需要你单独确认。</small></div><div className="settings-switch-row"><div><strong>敏感信息保护</strong><small>API Key、Token、密码和验证码会从工具报告中隐藏；禁止把明文凭据写进命令。</small></div><Tag color="green">始终开启</Tag></div><div className="settings-switch-row"><div><strong>记忆建议审核</strong><small>开启后，独立审查模型提出的新判断需要你批准；真实任务中已验收的工具路线仍会自动沉淀。</small></div><Switch checked={settings.memoryWriteApproval !== false} onChange={(value) => change('memoryWriteApproval', value)} /></div><div className="settings-switch-row"><div><strong>自动 Skill 保护</strong><small>复盘只能创建隔离草案；批准后才能安装，且不能后台修改内置或手动 Skill。</small></div><Tag color="green">始终审核</Tag></div><div className="settings-switch-row"><div><strong>自动讨论</strong><small>收到任务后自动组织团队讨论</small></div><Switch checked={settings.autoDiscuss ?? false} onChange={(value) => change('autoDiscuss', value)} /></div><div className="settings-switch-row"><div><strong>自主办公</strong><small>确认项目后自动推进执行流程</small></div><Switch checked={settings.autoPilot ?? false} onChange={(value) => change('autoPilot', value)} /></div></div>;
}

function BackupTab() {
  const { message } = App.useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [upgrade, setUpgrade] = useState<UpgradeJournal | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  useEffect(() => { void window.electronAPI?.getUpgradeStatus?.().then((result) => { if (result.ok) setUpgrade(result.journal ?? null); }); }, []);
  const exportProfile = async () => {
    const profile = await createSyncProfile();
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `taiji-sync-v${APP_VERSION}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    message.success('同步配置已导出，API Key 和密码没有写入文件');
  };
  const importProfile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try { const result = applySyncProfile(JSON.parse(await file.text())); message.success(`已导入 ${result.employees} 名员工、${result.teams} 个团队、${result.models} 个模型、${result.memories} 条记忆和 ${result.taskLearnings} 条任务经验`); location.reload(); }
    catch (error) { message.error(error instanceof Error ? error.message : '导入失败'); }
  };
  const rollback = async () => {
    const api = window.electronAPI;
    if (!api?.prepareRollback || !api.readUpgradeBackup || !api.rollbackUpgrade) return;
    setRollingBack(true);
    try {
      const prepared = await api.prepareRollback();
      if (!prepared.ok) throw new Error(prepared.error || '旧安装包下载或校验失败，当前配置没有改动');
      const backup = await api.readUpgradeBackup();
      if (!backup.ok || !backup.snapshot) throw new Error(backup.error || '没有可恢复的配置备份');
      restoreUpgradeSnapshot(backup.snapshot);
      const result = await api.rollbackUpgrade();
      if (!result.ok) throw new Error(result.error || '回滚安装包没有启动');
      message.success(`旧安装包已校验，配置已恢复，正在启动 v${backup.fromVersion} 安装包`);
    } catch (error) { message.error(error instanceof Error ? error.message : String(error)); setRollingBack(false); }
  };
  return <div className="settings-content-page"><header><h2>备份迁移</h2><span>工作区备份、配置同步、升级验证与本机回滚</span></header><div className="settings-action-list"><div><div><strong>导出工作区</strong><small>任务文件和产出物 ZIP</small></div><Button onClick={() => void window.electronAPI?.fsExportZip?.()}>导出</Button></div><div><div><strong>导出同步配置</strong><small>员工、团队、模型、连接器、人格、画像、分层记忆和任务经验；不含本机密钥</small></div><Button onClick={() => void exportProfile()}>导出</Button></div><div><div><strong>导入同步配置</strong><small>恢复完整办公室配置与智能体记忆；API Key 仍需在本机填写</small></div><Button onClick={() => fileRef.current?.click()}>导入</Button><input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importProfile(event)} /></div>{upgrade && <div><div><strong>最近一次升级</strong><small>v{upgrade.fromVersion} → v{upgrade.toVersion} · {upgrade.status === 'validated' ? '数据验证通过' : upgrade.status === 'validation-failed' ? '数据验证失败，可回滚' : upgrade.status === 'rollback-prepared' ? '旧安装包已校验' : upgrade.status === 'rolling-back' ? '正在回滚' : '已创建更新前备份'}</small></div><Button danger disabled={rollingBack || upgrade.status === 'rolling-back'} onClick={() => void rollback()}>{rollingBack ? '准备回滚中' : `回滚到 v${upgrade.fromVersion}`}</Button></div>}</div></div>;
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
  const [editContextWindow, setEditContextWindow] = useState('');

  const library = settings.modelLibrary ?? [];
  const activeId = settings.activeModelId;
  const assistantId = settings.assistantModelId;
  const reviewId = settings.reviewModelId;
  const diagnosticId = settings.diagnosticModelId;
  const imageId = settings.imageModelId;
  const diagnosticModels = library.filter((model) => getModelCapabilities(model).includes('chat'));
  const imageModels = library.filter((model) => getModelCapabilities(model).includes('image'));
  const selectedDiagnosticId = diagnosticModels.some((model) => model.id === diagnosticId) ? diagnosticId : undefined;
  const selectedImageId = imageModels.some((model) => model.id === imageId) ? imageId : undefined;

  const startAdd = () => {
    setEditingId('__new__');
    setEditLabel('');
    setEditProvider('deepseek');
    const preset = getProvider('deepseek');
    setEditHost(preset.baseUrl);
    setEditModel(preset.defaultModel);
    setEditApiKey('');
    setEditContextWindow('');
    setAvailableModels([]);
  };

  const startAddGptImage2 = () => {
    setEditingId('__new__');
    setEditLabel('GPT Image 2');
    setEditProvider('openai');
    setEditHost(getProvider('openai').baseUrl);
    setEditModel('gpt-image-2');
    setEditApiKey('');
    setEditContextWindow('');
    setAvailableModels(['gpt-image-2']);
  };

  const startEdit = (entry: ModelEntry) => {
    setEditingId(entry.id);
    setEditLabel(entry.label);
    setEditProvider(entry.provider ?? 'deepseek');
    setEditHost(entry.apiHost ?? '');
    setEditApiKey(entry.apiKey ?? '');
    setEditModel(entry.model ?? '');
    setEditContextWindow(entry.contextWindowTokens ? String(entry.contextWindowTokens) : '');
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
    const contextWindowTokens = Math.round(Number(editContextWindow));
    const config: ModelConfig = {
      provider: editProvider,
      apiHost: editHost.trim(),
      apiKey: editApiKey.trim() || undefined,
      model: editModel.trim() || undefined,
      contextWindowTokens: Number.isFinite(contextWindowTokens) && contextWindowTokens > 0 ? contextWindowTokens : undefined,
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
    if (s.reviewModelId === id) s.reviewModelId = undefined;
    if (s.diagnosticModelId === id) s.diagnosticModelId = undefined;
    if (s.imageModelId === id) s.imageModelId = undefined;
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
      s.contextWindowTokens = entry.contextWindowTokens;
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
      s.assistantModelConfig = { provider: entry.provider, apiHost: entry.apiHost, apiKey: entry.apiKey, model: entry.model, contextWindowTokens: entry.contextWindowTokens };
    }
    saveSettings(s);
    setSettings({ ...s });
    message.success('已设为助理模型');
  };

  const handleSetReview = (id?: string) => {
    const s = loadSettings();
    s.reviewModelId = id;
    saveSettings(s);
    setSettings({ ...s });
    message.success(id ? '已设为独立审查模型' : '已关闭模型复盘；确定性任务经验仍会保留');
  };

  const handleSetSpecialModel = (key: 'diagnosticModelId' | 'imageModelId', id?: string) => {
    const s = loadSettings();
    const requiredCapability = key === 'diagnosticModelId' ? 'chat' : 'image';
    const entry = id ? s.modelLibrary?.find((model) => model.id === id) : undefined;
    if (id && (!entry || !getModelCapabilities(entry).includes(requiredCapability))) {
      message.error(key === 'diagnosticModelId' ? '诊断优化需要选择聊天模型' : '头像生图需要选择图片模型');
      return;
    }
    s[key] = id;
    saveSettings(s);
    setSettings({ ...s });
    message.success(id ? (key === 'diagnosticModelId' ? '已设为诊断优化模型' : '已设为员工头像生图模型') : '已取消专用模型指派');
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
          lastCompatibilityReport: r.compatibility,
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
        <Space size="small">
          <Button size="small" onClick={startAddGptImage2}>GPT Image 2</Button>
          <Button size="small" type="primary" onClick={startAdd}>➕ 添加模型</Button>
        </Space>
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
                {getModelCapabilities(entry).includes('image') && <Tag color="magenta" style={{ fontSize: 10, margin: 0, lineHeight: '18px' }}>IMAGE</Tag>}
                {entry.id === activeId && <Tag color="blue" style={{ fontSize: 10, margin: 0, lineHeight: '18px' }}>全局</Tag>}
                {entry.id === assistantId && <Tag color="purple" style={{ fontSize: 10, margin: 0, lineHeight: '18px' }}>助理</Tag>}
                {entry.id === reviewId && <Tag color="cyan" style={{ fontSize: 10, margin: 0, lineHeight: '18px' }}>审查</Tag>}
                {entry.id === diagnosticId && <Tag color="gold" style={{ fontSize: 10, margin: 0, lineHeight: '18px' }}>诊断</Tag>}
                {entry.id === imageId && <Tag color="magenta" style={{ fontSize: 10, margin: 0, lineHeight: '18px' }}>生图</Tag>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {entry.model ?? '未设置模型名'} · {getProvider(entry.provider).label}
              </div>
              <div style={{ fontSize: 10, marginTop: 3, color: entry.contextWindowTokens ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                {entry.contextWindowTokens ? `上下文上限 ${entry.contextWindowTokens.toLocaleString()} tokens` : '上下文上限未设置'}
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
              {entry.lastCompatibilityReport && (
                <div style={{ fontSize: 10, marginTop: 2, color: 'var(--text-secondary)', whiteSpace: 'normal' }}>
                  兼容矩阵：{entry.lastCompatibilityReport.status === 'compatible' ? '已通过' : entry.lastCompatibilityReport.status === 'partial' ? '部分能力待验证' : '存在阻塞'}
                  {entry.lastCompatibilityReport.nextActions.length ? ` · ${entry.lastCompatibilityReport.nextActions[0]}` : ''}
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
        <Space wrap style={{ marginBottom: 16 }}>
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
          <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 8 }}>独立审查：</span>
          <Select
            size="small"
            value={reviewId ?? '__none__'}
            onChange={(value) => handleSetReview(value === '__none__' ? undefined : value)}
            style={{ width: 180 }}
            options={[{ value: '__none__', label: '不调用模型复盘' }, ...library.map((model) => ({ value: model.id, label: model.label }))]}
          />
          <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 8 }}>诊断优化：</span>
          <Select
            size="small"
            value={selectedDiagnosticId ?? '__none__'}
            onChange={(value) => handleSetSpecialModel('diagnosticModelId', value === '__none__' ? undefined : value)}
            style={{ width: 180 }}
            options={[{ value: '__none__', label: '未指定' }, ...diagnosticModels.map((model) => ({ value: model.id, label: model.label }))]}
          />
          <span style={{ fontSize: 12, fontWeight: 500, marginLeft: 8 }}>头像生图：</span>
          <Select
            size="small"
            value={selectedImageId ?? '__none__'}
            onChange={(value) => handleSetSpecialModel('imageModelId', value === '__none__' ? undefined : value)}
            style={{ width: 180 }}
            options={[{ value: '__none__', label: '未指定' }, ...imageModels.map((model) => ({ value: model.id, label: model.label }))]}
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
          <Input
            type="number"
            min={1}
            step={1024}
            value={editContextWindow}
            onChange={(e) => setEditContextWindow(e.target.value)}
            placeholder="上下文上限（tokens，例如 32768；接口未提供时请查模型官方说明后填写）"
            suffix="tokens"
            style={{ marginBottom: 4 }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.45 }}>
            未填写时，聊天窗口会如实显示“未获知上限”；不会根据模型名称猜测容量。
          </div>
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
  const { state } = useStore();
  const [items, setItems] = useState<UserMemoryItem[]>(() => loadUserMemory());
  const [taskLearnings, setTaskLearnings] = useState<TaskLearning[]>(() => loadTaskLearnings());
  const [newText, setNewText] = useState('');
  const [layeredEntries, setLayeredEntries] = useState<LayeredMemoryEntry[]>([]);
  const [memoryProposals, setMemoryProposals] = useState<MemoryProposal[]>([]);
  const [layeredUsage, setLayeredUsage] = useState<Record<string, { current: number; max: number; percent: number }>>({});
  const [learningReviews, setLearningReviews] = useState<LearningReviewItem[]>([]);
  const [layeredScope, setLayeredScope] = useState<LayeredMemoryEntry['scope']>('organization');
  const [layeredScopeId, setLayeredScopeId] = useState('default');
  const [layeredText, setLayeredText] = useState('');
  const [refreshingLayered, setRefreshingLayered] = useState(false);

  const refreshLayered = async () => {
    setRefreshingLayered(true);
    try {
      const [snapshot, reviews] = await Promise.all([
        loadLayeredMemorySnapshot(),
        window.electronAPI?.learningReviewStatus?.(),
      ]);
      setLayeredEntries(snapshot.entries);
      setMemoryProposals(snapshot.proposals);
      setLayeredUsage(snapshot.usage);
      setLearningReviews(reviews?.ok ? reviews.items ?? [] : []);
    } finally { setRefreshingLayered(false); }
  };

  useEffect(() => { void refreshLayered(); }, []);

  useEffect(() => {
    if (layeredScope === 'team' && !state.teams.some((team) => team.id === layeredScopeId)) setLayeredScopeId(state.teams[0]?.id ?? 'default');
    if (layeredScope === 'employee' && !state.employees.some((employee) => employee.id === layeredScopeId)) setLayeredScopeId(state.employees[0]?.id ?? 'default');
    if (layeredScope === 'organization' || layeredScope === 'user') setLayeredScopeId('default');
  }, [layeredScope, layeredScopeId, state.employees, state.teams]);

  const visibleLayeredEntries = layeredEntries.filter((entry) => entry.scope === layeredScope
    && ((layeredScope === 'organization' || layeredScope === 'user') || entry.scopeId === layeredScopeId));
  const pendingProposals = memoryProposals.filter((proposal) => proposal.status === 'pending');
  const selectedUsage = layeredUsage[`${layeredScope}:${layeredScopeId}`] ?? { current: 0, max: 0, percent: 0 };
  const legacyMemoryQuality = memoryQualitySummary(items);

  const addLayeredMemory = async () => {
    const content = layeredText.trim();
    if (!content) return;
    const result = await window.electronAPI?.memoryUpsert?.({
      scope: layeredScope, scopeId: layeredScopeId, employeeId: layeredScope === 'employee' ? layeredScopeId : undefined,
      category: layeredScope === 'user' ? 'preference' : 'lesson', content, source: '手动添加', sourceType: 'manual', importance: 5, confidence: 1,
    });
    if (!result?.ok) { message.error(result?.error || '分层记忆添加失败'); return; }
    setLayeredText('');
    message.success(result.action === 'ignored' ? '已有相同记忆' : '分层记忆已保存');
    await refreshLayered();
  };

  const removeLayeredMemory = async (entryId: string) => {
    const result = await window.electronAPI?.memoryRemove?.({ entryId, reason: '用户在记忆中心删除' });
    if (!result?.ok) { message.error(result?.error || '删除失败'); return; }
    await refreshLayered();
  };

  const reviewMemoryProposal = async (proposalId: string, decision: 'approve' | 'reject') => {
    const result = await window.electronAPI?.memoryReviewProposal?.({ proposalId, decision });
    if (!result?.ok) { message.error(result?.error || '审核失败'); return; }
    message.success(decision === 'approve' ? '记忆建议已批准并写入' : '记忆建议已拒绝');
    await refreshLayered();
  };

  const processLearningReviews = async () => {
    const reviewModelConfig = getReviewModel();
    if (!reviewModelConfig) { message.warning('请先在“模型”页选择独立审查模型'); return; }
    const result = await window.electronAPI?.learningReviewProcess?.({ reviewModelConfig, memoryWriteApproval: loadSettings().memoryWriteApproval !== false });
    if (!result?.ok) { message.error(result?.error || '任务复盘启动失败'); return; }
    message.success(`复盘队列已处理 ${result.processed ?? 0} 项`);
    await refreshLayered();
  };

  const retryLearningReview = async (itemId: string) => {
    const reviewModelConfig = getReviewModel();
    if (!reviewModelConfig) { message.warning('请先在“模型”页选择独立审查模型'); return; }
    const result = await window.electronAPI?.learningReviewRetry?.({ itemId, reviewModelConfig, memoryWriteApproval: loadSettings().memoryWriteApproval !== false });
    if (!result?.ok) { message.error(result?.error || '复盘重试失败'); return; }
    message.success('已重新处理这项复盘');
    await refreshLayered();
  };

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

  const handleReviewMemory = (fingerprint?: string) => {
    if (!fingerprint) return;
    setItems(reviewUserMemory(fingerprint));
    message.success('已确认这条记忆仍然有效，并重新计算下次复核时间');
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

  const handleClearTaskLearnings = () => {
    modal.confirm({
      title: '清空所有任务经验？',
      content: '这不会删除用户画像和长期偏好，只会清除执行路线的成功与失败经验。',
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        saveTaskLearnings([]);
        setTaskLearnings([]);
      },
    });
  };

  return (
    <div className="settings-content-page memory-settings-page">
      <header><h2>记忆与学习</h2><span>管理团队共享经验、员工独立经验和任务复盘</span></header>
      <div className="memory-status-strip" aria-label="记忆与复盘状态">
        <div><strong>{layeredEntries.length}</strong><span>分层记忆</span></div>
        <div><strong>{pendingProposals.length}</strong><span>待审核建议</span></div>
        <div><strong>{learningReviews.filter((item) => item.status === 'queued' || item.status === 'processing').length}</strong><span>正在复盘</span></div>
        <div><strong>{learningReviews.filter((item) => item.status === 'failed' || item.status === 'waiting_model').length}</strong><span>需要处理</span></div>
      </div>
      <section className="settings-memory-section settings-memory-layered">
        <div className="settings-memory-section-head">
          <div><h3>分层记忆</h3><p>团队共享经验供全队复用；员工个人经验只提供给对应员工。组织与用户层负责跨团队规则和使用偏好。</p></div>
          <Button size="small" loading={refreshingLayered} onClick={() => void refreshLayered()}>刷新</Button>
        </div>
        <Segmented block value={layeredScope} options={[{ label: `组织 ${layeredEntries.filter((entry) => entry.scope === 'organization').length}`, value: 'organization' }, { label: `团队 ${layeredEntries.filter((entry) => entry.scope === 'team').length}`, value: 'team' }, { label: `员工 ${layeredEntries.filter((entry) => entry.scope === 'employee').length}`, value: 'employee' }, { label: `用户 ${layeredEntries.filter((entry) => entry.scope === 'user').length}`, value: 'user' }]} onChange={(value) => setLayeredScope(value as LayeredMemoryEntry['scope'])} />
        {layeredScope === 'team' && <Select style={{ width: '100%', marginTop: 8 }} value={layeredScopeId} options={state.teams.map((team) => ({ value: team.id, label: team.name }))} onChange={setLayeredScopeId} placeholder="选择团队" />}
        {layeredScope === 'employee' && <Select showSearch optionFilterProp="label" style={{ width: '100%', marginTop: 8 }} value={layeredScopeId} options={state.employees.map((employee) => ({ value: employee.id, label: `${employee.name} · ${employee.title}` }))} onChange={setLayeredScopeId} placeholder="选择员工" />}
        <div className={`memory-capacity${selectedUsage.percent >= 80 ? ' is-warning' : ''}`}><div><span>当前层容量</span><small>{selectedUsage.current} / {selectedUsage.max || '未读取'} 字符</small></div><div><i style={{ width: `${Math.min(100, selectedUsage.percent)}%` }} /></div></div>
        <Space.Compact style={{ width: '100%', marginTop: 8 }}><Input value={layeredText} onChange={(event) => setLayeredText(event.target.value)} onPressEnter={() => void addLayeredMemory()} placeholder="手动添加一条可长期复用的原子事实" /><Button type="primary" disabled={!layeredText.trim()} onClick={() => void addLayeredMemory()}>添加</Button></Space.Compact>
        <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginTop: 10 }}>
          {visibleLayeredEntries.length === 0 && <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>这个记忆层还没有内容。</div>}
          {visibleLayeredEntries.map((entry, index) => <div key={entry.id} style={{ display: 'flex', gap: 8, padding: '9px 11px', borderBottom: index < visibleLayeredEntries.length - 1 ? '1px solid var(--border-light)' : 'none' }}><div style={{ flex: 1, minWidth: 0 }}><div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 3 }}><Tag>{entry.category}</Tag><Tag>{entry.sourceType === 'task-review' ? '已验收任务' : entry.sourceType === 'review-model' ? '独立审查' : entry.sourceType === 'legacy' ? '旧版迁移' : '手动'}</Tag><Tag color={entry.confidence >= 0.9 ? 'green' : 'default'}>可信度 {Math.round(entry.confidence * 100)}%</Tag></div><div style={{ fontSize: 12, color: 'var(--text)' }}>{entry.content}</div><small style={{ color: 'var(--text-muted)' }}>{entry.source} · {new Date(entry.updatedAt).toLocaleString('zh-CN')}</small></div><Button size="small" type="text" danger icon={<DeleteOutlined />} title="删除这条记忆" aria-label="删除这条记忆" onClick={() => void removeLayeredMemory(entry.id)} /></div>)}
        </div>
      </section>

      {(pendingProposals.length > 0 || learningReviews.some((item) => item.status !== 'completed')) && <section className="settings-memory-section memory-review-section">
        <div className="settings-memory-section-head"><div><h3>复盘与审核</h3><p>已验收路线会直接沉淀；独立模型提出的新判断必须经过审核。复盘失败不影响原任务结果。</p></div><Button size="small" onClick={() => void processLearningReviews()}>处理全部</Button></div>
        {learningReviews.filter((item) => item.status !== 'completed').slice(-8).map((item) => <div className="memory-review-row" key={item.id}><div><Tag color={item.status === 'failed' ? 'red' : item.status === 'waiting_model' ? 'orange' : 'blue'}>{item.status === 'waiting_model' ? '等待审查模型' : item.status === 'failed' ? '复盘失败' : item.status === 'processing' ? '复盘中' : '待复盘'}</Tag><span>{item.taskId}</span>{item.lastError && <small>{item.lastError}</small>}</div>{(item.status === 'failed' || item.status === 'waiting_model') && <Button size="small" onClick={() => void retryLearningReview(item.id)}>重试</Button>}</div>)}
        {pendingProposals.map((proposal) => <div className="memory-proposal-row" key={proposal.id}><div><strong>{proposal.summary}</strong><p>{proposal.update.content}</p><small>{proposal.update.scope === 'employee' ? '员工记忆' : proposal.update.scope === 'team' ? '团队记忆' : proposal.update.scope === 'user' ? '用户记忆' : '组织记忆'}</small></div><Space><Button size="small" type="primary" onClick={() => void reviewMemoryProposal(proposal.id, 'approve')}>批准</Button><Button size="small" onClick={() => void reviewMemoryProposal(proposal.id, 'reject')}>拒绝</Button></Space></div>)}
      </section>}

      <section className="settings-memory-section memory-legacy-section">
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
        旧版长期记忆（兼容）
        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
          共 {items.length} 条
        </span>
      </h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        系统只保留以后仍然有用的稳定事实，并自动去重、归并和更新冲突信息；一次性任务、闲聊、工具报错和未确认推测不会写入。
      </p>
      <div className="memory-quality-strip">
        <span>有效 {legacyMemoryQuality.active}</span>
        <span className={legacyMemoryQuality.reviewDue ? 'is-warning' : ''}>待复核 {legacyMemoryQuality.reviewDue}</span>
        <span>低可信 {legacyMemoryQuality.lowConfidence}</span>
      </div>

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
                {memoryReviewState(item) === 'review_due' && <Tag color="volcano">已到复核时间</Tag>}
              </div>
              <div style={{ color: 'var(--text)' }}>{item.content}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                更新于 {new Date(item.updatedAt ?? item.ts).toLocaleString('zh-CN')} · 来源：{item.source}
              </div>
              {item.lastChangeReason && <div className="memory-change-reason">{item.lastChangeReason}</div>}
              {memoryReviewState(item) === 'review_due' && <Button size="small" type="link" style={{ padding: 0, height: 22 }} onClick={() => handleReviewMemory(item.fingerprint)}>确认仍然有效</Button>}
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
      </section>

      <section className="settings-memory-section memory-legacy-section">
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
          任务经验
          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
            共 {taskLearnings.length} 条
          </span>
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          每次真实执行后记录可行路线、失败路线和阻塞类型。相似任务会先读取这里的经验，再决定第一步和验收方式。
        </p>
        <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
          {taskLearnings.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              暂无任务经验。完成一次带工具的实际任务后，这里会出现可复用记录。
            </div>
          )}
          {[...taskLearnings].reverse().map((item, index) => (
            <div
              key={item.id}
              style={{
                padding: '10px 12px',
                borderBottom: index < taskLearnings.length - 1 ? '1px solid var(--border-light)' : 'none',
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
                <Tag color={item.outcome === 'completed' ? 'green' : item.outcome === 'stopped' ? 'default' : 'orange'}>
                  {item.outcome === 'completed' ? '已验收' : item.outcome === 'stopped' ? '已停止' : '曾受阻'}
                </Tag>
                <Tag>复用记录 {item.uses} 次</Tag>
                {item.successfulTools.length > 0 && <Tag color="blue">可行路线 {item.successfulTools.join(' → ')}</Tag>}
              </div>
              <div style={{ color: 'var(--text)', fontWeight: 500 }}>{item.goal}</div>
              {item.lesson && <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>{item.lesson}</div>}
              {item.failedTools.length > 0 && (
                <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                  避免原样重复：{item.failedTools.join('、')}{item.failureLabels.length ? ` · ${item.failureLabels.join('、')}` : ''}
                </div>
              )}
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                更新于 {new Date(item.updatedAt).toLocaleString('zh-CN')}
              </div>
            </div>
          ))}
        </div>
        {taskLearnings.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <Button size="small" danger icon={<DeleteOutlined />} onClick={handleClearTaskLearnings}>
              清空任务经验
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
