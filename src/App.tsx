import { useState, useEffect, useRef } from 'react';
import { Segmented, Button, Dropdown } from 'antd';
import {
  Blocks,
  Bot,
  Building2,
  ChartNoAxesCombined,
  CirclePlay,
  Layers3,
  Lock,
  Minus,
  Palette,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Settings,
  Square,
  UsersRound,
  X,
  Unlock,
} from 'lucide-react';
import type { Employee } from './types';
import type { UpdateStatus } from './electron.d';
import { useStore } from './storeContext';
import SidebarPanel from './components/sidebar/SidebarPanel';
import OfficeView from './components/office/OfficeView';
import SettingsModal from './components/settings/SettingsModal';
import Analytics from './components/analytics/Analytics';
import TeamHallPanel from './components/team/TeamHallPanel';
import ChatOnlyView from './components/chat/ChatOnlyView';
import ToolWindowView from './components/windows/ToolWindowView';
import EditEmployeeModal from './components/sidebar/EditEmployeeModal';
import SkillLibraryView from './components/skills/SkillLibraryView';
import InteractionSoundControl from './components/settings/InteractionSoundControl';
import { checkBackend } from './data/hermesClient';
import { APP_VERSION } from './appVersion';
import { BUS_CHANNELS, onBus, sendBus } from './ipcBus';
import { formatExecutionDuration } from './hooks/useAgentExecutionControl';
import { createUpgradeSnapshot } from './utils/configSync';
import { APP_BRAND_NAME, APP_PRODUCT_NAME } from './brand';
import {
  getVisualStyle,
  isVisualStyle,
  loadThemeForStyle,
  loadVisualPreferences,
  saveVisualPreferences,
  VISUAL_STYLE_OPTIONS,
  type VisualPreferences,
  type VisualStyle,
} from './data/visualSystem';

type View = 'office' | 'analytics' | 'team-hall' | 'skill-library';

interface AssistantActivity {
  state: 'idle' | 'running' | 'paused' | 'stopping';
  status: string;
  completedActions: number;
  elapsedSeconds: number;
  updatedAt: number;
}

export default function App() {
  const { state, openDmChat, openTeamChat, openAssistantChat, startTeamDemo, dispatch } = useStore();

  // ===== ALL hooks first (Rules of Hooks) =====
  const [showSettings, setShowSettings] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [view, setView] = useState<View>('office');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle', message: '点击检查更新' });
  const [assistantLocked, setAssistantLocked] = useState(false);
  const [assistantActivity, setAssistantActivity] = useState<AssistantActivity>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('hermes_office_assistant_activity') || 'null') as AssistantActivity | null;
      return value?.state ? value : { state: 'idle', status: '', completedActions: 0, elapsedSeconds: 0, updatedAt: 0 };
    } catch {
      return { state: 'idle', status: '', completedActions: 0, elapsedSeconds: 0, updatedAt: 0 };
    }
  });
  const [visualStyle, setVisualStyle] = useState<VisualStyle>(() => loadVisualPreferences().style);
  const [themeName, setThemeName] = useState<string>(() => loadVisualPreferences().theme);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const preferences = { style: visualStyle, theme: themeName };
    saveVisualPreferences(preferences);
    window.electronAPI?.broadcast?.('visual-preferences-changed', preferences);
  }, [themeName, visualStyle]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getUpgradeStatus || !api.recordUpgradeValidation) return;
    const timer = window.setTimeout(() => void (async () => {
      const status = await api.getUpgradeStatus();
      if (!status.ok || status.journal?.toVersion !== APP_VERSION || status.journal.status !== 'ready-to-install') return;
      let models = 0;
      try {
        const settings = JSON.parse(localStorage.getItem('hermes_office_settings') || '{}');
        models = Array.isArray(settings.modelLibrary) ? settings.modelLibrary.length : settings.model || settings.apiHost ? 1 : 0;
      } catch {}
      let workspaceReady = false;
      try { workspaceReady = Boolean(await api.getWorkspace()); } catch {}
      await api.recordUpgradeValidation({ ok: true, employees: state.employees.length, teams: state.teams.length, models, taskRuns: state.taskRuns.length, workspaceReady });
    })(), 1800);
    return () => window.clearTimeout(timer);
  }, [state.employees.length, state.taskRuns.length, state.teams.length]);

  useEffect(() => {
    const applyPreferences = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const preferences = value as Partial<VisualPreferences>;
      if (!isVisualStyle(preferences.style)) return;
      const theme = getVisualStyle(preferences.style).themes.some((option) => option.id === preferences.theme)
        ? preferences.theme!
        : loadThemeForStyle(preferences.style);
      setVisualStyle(preferences.style);
      setThemeName(theme);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'taiji_visual_style' || event.key?.startsWith('taiji_color_theme_')) {
        applyPreferences(loadVisualPreferences());
      }
    };
    window.addEventListener('storage', handleStorage);
    const unsubscribe = window.electronAPI?.onBroadcast?.((message) => {
      if (message.channel === 'visual-preferences-changed') applyPreferences(message.payload);
    });
    return () => {
      window.removeEventListener('storage', handleStorage);
      unsubscribe?.();
    };
  }, []);

  const chooseVisualStyle = (style: VisualStyle) => {
    setVisualStyle(style);
    setThemeName(loadThemeForStyle(style));
  };

  useEffect(() => {
    window.electronAPI?.getAssistantLock?.().then(({ locked }) => setAssistantLocked(locked)).catch(() => {});
  }, []);

  useEffect(() => onBus(BUS_CHANNELS.ASSISTANT_ACTIVITY_CHANGED, (payload) => {
    const next = payload as AssistantActivity;
    if (next && ['idle', 'running', 'paused', 'stopping'].includes(next.state)) setAssistantActivity(next);
  }), []);

  // 子窗口检测：原生聊天子窗口的 URL 附带 #chat 路由。
  // 仅在首次渲染时读一次 location.hash——主窗口永远不带 #chat（v0.1.13 已移除 hash fallback），
  // 只有 win:openChat 创建的子窗口才有 #chat hash。不需要 sessionStorage 验证。
  const [isChatWindow] = useState(
    () => typeof location !== 'undefined' && location.hash.startsWith('#chat'),
  );
  const [isSettingsWindow] = useState(
    () => typeof location !== 'undefined' && location.hash.startsWith('#settings'),
  );
  const [isToolWindow] = useState(
    () => typeof location !== 'undefined' && location.hash.startsWith('#tool'),
  );

  // 监听自动更新状态（仅在 Electron 桌面端生效）
  useEffect(() => {
    if (window.electronAPI?.onUpdateStatus) {
      unsubRef.current = window.electronAPI.onUpdateStatus((status) => {
        setUpdateStatus(status);
      });
    }
    return () => {
      unsubRef.current?.();
    };
  }, []);

  // ===== 如果是原生聊天子窗口，只渲染聊天视图 =====
  if (isChatWindow) {
    return <ChatOnlyView hash={location.hash} />;
  }
  if (isSettingsWindow) {
    return <SettingsModal standalone onClose={() => window.electronAPI?.close()} onSaved={() => checkBackend().then((online) => dispatch({ type: 'SET_STATUS', partial: { backendOnline: online } }))} />;
  }
  if (isToolWindow) {
    return <ToolWindowView hash={location.hash} />;
  }

  const handleStationClick = (emp: Employee) => openDmChat(emp.id);
  const handleStationEdit = async (emp: Employee) => {
    const result = await window.electronAPI?.openTool?.({ type: 'edit-employee', refId: emp.id });
    if (!result?.ok) setEditingEmployee(emp);
  };

  const handleDemo = () => {
    openTeamChat('team-opc');
    startTeamDemo('team-opc');
  };

  const handleSettingsSaved = () => {
    checkBackend().then((online) => {
      dispatch({ type: 'SET_STATUS', partial: { backendOnline: online } });
    });
  };

  const toggleAssistantLock = async () => {
    const result = await window.electronAPI?.setAssistantLock?.(!assistantLocked);
    if (result) setAssistantLocked(result.locked);
  };

  const controlAssistant = (command: 'pause' | 'resume' | 'stop') => {
    sendBus(BUS_CHANNELS.ASSISTANT_EXECUTION_COMMAND, { command, requestedAt: Date.now() });
  };

  const handleUpdateControl = async () => {
    if (updateStatus.status === 'downloaded') {
      const result = await window.electronAPI?.installUpdate(createUpgradeSnapshot());
      if (result && !result.ok) setUpdateStatus({ status: 'error', message: `更新前备份失败：${result.error ?? '未知错误'}` });
      return;
    }
    if (!['idle', 'not-available', 'error'].includes(updateStatus.status)) return;
    setUpdateStatus({ status: 'checking', message: '正在检查更新…' });
    const result = await window.electronAPI?.checkUpdate();
    if (result && !result.ok) setUpdateStatus({ status: 'error', message: `检查更新失败：${result.error ?? '未知错误'}。点击这里重试。` });
  };

  const progress = state.status.progress;

  return (
    <div className="app-shell">
      {/* 标题栏 */}
      <div className="titlebar">
        <div className="titlebar-left">
          <div className="titlebar-brand" aria-label={APP_PRODUCT_NAME}>
            <span className="titlebar-brand-mark"><Building2 /></span>
            <span className="titlebar-title">{APP_BRAND_NAME}</span>
            <span className="titlebar-version" title={`当前版本 v${APP_VERSION}`}>v{APP_VERSION}</span>
          </div>
          {/* 视图切换 */}
          <div className="view-tabs" style={{ marginLeft: 14 }}>
            <Segmented
              value={view}
              onChange={(v) => setView(v as View)}
              options={[
                { label: <span className="view-tab-label"><Building2 /><span>办公室</span></span>, value: 'office' },
                { label: <span className="view-tab-label"><ChartNoAxesCombined /><span>数据分析</span></span>, value: 'analytics' },
                { label: <span className="view-tab-label"><UsersRound /><span>团队大厅</span></span>, value: 'team-hall' },
                { label: <span className="view-tab-label"><Blocks /><span>技能库</span></span>, value: 'skill-library' },
              ]}
            />
          </div>
        </div>
        <div className="titlebar-right">
          {/* 全局进度条：AI 讨论时显示 */}
          {progress && (
            <div className="titlebar-progress" title={`正在 ${progress.teamName} 讨论中`}>
              <div className="progress-spinner" />
              <span className="progress-text">
                {progress.currentEmpName ? `${progress.currentEmpName} 思考中` : '准备中'}
                <span className="progress-step">{progress.step}/{progress.totalSteps}</span>
              </span>
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${(progress.step / progress.totalSteps) * 100}%` }} />
              </div>
            </div>
          )}
          {/* 自动更新状态 */}
          <button
            type="button"
            className={`update-status update-${updateStatus.status}`}
            title={updateStatus.message}
            onClick={() => void handleUpdateControl()}
            disabled={['checking', 'available', 'downloading'].includes(updateStatus.status)}
          >
            <RefreshCw className={updateStatus.status === 'checking' || updateStatus.status === 'downloading' ? 'is-spinning' : ''} />
            {updateStatus.status === 'idle' && '检查更新'}
            {updateStatus.status === 'checking' && '检查更新…'}
            {updateStatus.status === 'available' && '发现新版本'}
            {updateStatus.status === 'downloading' && `下载中 ${Math.round(updateStatus.percent ?? 0)}%`}
            {updateStatus.status === 'downloaded' && '重启安装更新'}
            {updateStatus.status === 'not-available' && '已是最新版 · 再检查'}
            {updateStatus.status === 'error' && '更新失败 · 重试'}
          </button>
          <span className="backend-status" title={state.status.backendOnline ? '默认模型连接正常' : '默认模型当前不可用'}>
            <i className={state.status.backendOnline ? 'is-online' : 'is-offline'} />
            <span>{state.status.backendOnline ? '模型可用' : '模型离线'}</span>
          </span>
          {assistantActivity.state !== 'idle' && (
            <div className={`assistant-background-status is-${assistantActivity.state}`} role="status" aria-live="polite">
              <button className="assistant-background-open" onClick={openAssistantChat} title="打开助手查看当前任务">
                <i />
                <span>
                  <strong>{assistantActivity.state === 'paused' ? '助手已暂停' : assistantActivity.state === 'stopping' ? '助手正在停止' : assistantActivity.status || '助手执行中'}</strong>
                  <small>已完成 {assistantActivity.completedActions} 个动作 · {formatExecutionDuration(assistantActivity.elapsedSeconds)}</small>
                </span>
              </button>
              <span className="assistant-background-controls">
                {assistantActivity.state === 'paused'
                  ? <button onClick={() => controlAssistant('resume')} title="继续后台任务" aria-label="继续后台任务"><CirclePlay /></button>
                  : <button onClick={() => controlAssistant('pause')} disabled={assistantActivity.state === 'stopping'} title="完成当前动作后暂停" aria-label="暂停后台任务"><PauseCircle /></button>}
                <button className="is-stop" onClick={() => controlAssistant('stop')} disabled={assistantActivity.state === 'stopping'} title="完成当前动作后停止" aria-label="停止后台任务"><Square /></button>
              </span>
            </div>
          )}
          <button
            className={`titlebar-btn assistant-launch-btn ${assistantActivity.state !== 'idle' ? 'is-busy' : ''}`}
            title="打开章北海助理"
            aria-label="打开章北海助理"
            onClick={openAssistantChat}
          >
            <Bot />
          </button>
          <button
            className={`titlebar-btn assistant-lock-btn ${assistantLocked ? 'is-locked' : ''}`}
            title={assistantLocked ? '解除助手与主界面的联动' : '锁定助手与主界面的联动'}
            aria-label={assistantLocked ? '解除助手窗口联动' : '锁定助手窗口联动'}
            onClick={() => void toggleAssistantLock()}
          >
            {assistantLocked ? <Lock /> : <Unlock />}
          </button>
          <Dropdown
            trigger={['click']}
            menu={{
              selectedKeys: [visualStyle],
              onClick: ({ key }) => chooseVisualStyle(key as VisualStyle),
              items: VISUAL_STYLE_OPTIONS.map((option) => ({
                key: option.id,
                label: <span className="visual-style-menu-item"><i data-style-preview={option.id} /><span><strong>{option.label}</strong><small>{option.description}</small></span></span>,
              })),
            }}
          >
            <button className="titlebar-btn visual-style-toggle-btn" title="选择界面风格" aria-label="选择界面风格">
              <Layers3 />
            </button>
          </Dropdown>
          <InteractionSoundControl />
          <Dropdown
            trigger={['click']}
            menu={{
              selectedKeys: [themeName],
              onClick: ({ key }) => setThemeName(key),
              items: getVisualStyle(visualStyle).themes.map((option) => ({
                key: option.id,
                label: <span className="theme-menu-item"><span className="theme-menu-swatches">{option.colors.map((color) => <i key={color} style={{ background: color }} />)}</span>{option.label}</span>,
              })),
            }}
          >
            <button className="titlebar-btn theme-toggle-btn" title={`${getVisualStyle(visualStyle).label}配色`} aria-label="选择界面配色">
              <Palette />
            </button>
          </Dropdown>
          <Button className="titlebar-command" size="small" icon={<PlayCircle />} onClick={handleDemo} disabled={state.status.demoRunning}>
            协作演示
          </Button>
          <button className="titlebar-btn" onClick={() => window.electronAPI?.openSettings?.() ?? setShowSettings(true)} title="设置" aria-label="打开设置">
            <Settings />
          </button>
          <div className="titlebar-actions">
            <button className="titlebar-btn window-control" title="最小化" aria-label="最小化" onClick={() => window.electronAPI?.minimize()}>
              <Minus />
            </button>
            <button className="titlebar-btn window-control" title="最大化" aria-label="最大化" onClick={() => window.electronAPI?.toggleMax()}>
              <Square />
            </button>
            <button className="titlebar-btn window-control window-control-close" title="关闭" aria-label="关闭" onClick={() => window.electronAPI?.close()}>
              <X />
            </button>
          </div>
        </div>
      </div>

      {/* 主体 */}
      <div className="app-body">
        {view === 'office' ? (
          <>
            <SidebarPanel />
            <OfficeView
              employees={state.employees}
              isWorking={(e) => e.isWorking}
              onStationClick={handleStationClick}
              onStationEdit={(employee) => void handleStationEdit(employee)}
            />
          </>
        ) : view === 'team-hall' ? (
          <TeamHallPanel />
        ) : view === 'skill-library' ? (
          <SkillLibraryView />
        ) : (
          <Analytics />
        )}
      </div>

      {/* 设置弹窗 */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} onSaved={handleSettingsSaved} />}
      {editingEmployee && <EditEmployeeModal employee={editingEmployee} onClose={() => setEditingEmployee(null)} />}
    </div>
  );
}
