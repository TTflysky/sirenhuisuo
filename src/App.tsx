import { useState, useEffect, useRef } from 'react';
import { Segmented, Button, Dropdown } from 'antd';
import {
  AppstoreOutlined,
  BarChartOutlined,
  BgColorsOutlined,
  BorderOutlined,
  CloseOutlined,
  HomeOutlined,
  MinusOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { Employee } from './types';
import type { UpdateStatus } from './electron.d';
import { useStore } from './store';
import SidebarPanel from './components/sidebar/SidebarPanel';
import OfficeView from './components/office/OfficeView';
import SettingsModal from './components/settings/SettingsModal';
import Analytics from './components/analytics/Analytics';
import AutopilotPanel from './components/autopilot/AutopilotPanel';
import ChatOnlyView from './components/chat/ChatOnlyView';
import SkillLibraryView from './components/skills/SkillLibraryView';
import { checkBackend } from './data/hermesClient';

type View = 'office' | 'analytics' | 'autopilot' | 'skill-library';
type ThemeName = 'light' | 'dark' | 'eye-care' | 'soft-gray' | 'ocean-blue' | 'quiet-blue' | 'glass-light' | 'glass-dark' | 'spruce' | 'graphite';

const THEME_OPTIONS: Array<{ value: ThemeName; label: string; color: string }> = [
  { value: 'light', label: '明亮', color: '#f7f8fb' },
  { value: 'dark', label: '深色', color: '#242529' },
  { value: 'eye-care', label: '护眼', color: '#dfe9dc' },
  { value: 'soft-gray', label: '柔和灰', color: '#e5e7eb' },
  { value: 'ocean-blue', label: '海湾蓝', color: '#cfe4f8' },
  { value: 'quiet-blue', label: '静谧蓝', color: '#365f91' },
  { value: 'glass-light', label: '玻璃晨光', color: 'rgba(236,246,255,.68)' },
  { value: 'glass-dark', label: '玻璃深夜', color: 'rgba(35,48,63,.72)' },
  { value: 'spruce', label: '云杉绿', color: '#294b43' },
  { value: 'graphite', label: '石墨', color: '#535861' },
];

export default function App() {
  const { state, openDmChat, openTeamChat, openAssistantChat, startTeamDemo, dispatch } = useStore();

  // ===== ALL hooks first (Rules of Hooks) =====
  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState<View>('office');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [themeName, setThemeName] = useState<ThemeName>(() => {
    const saved = localStorage.getItem('hermes_office_theme');
    return THEME_OPTIONS.some((option) => option.value === saved) ? saved as ThemeName : 'light';
  });
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = themeName;
    document.documentElement.dataset.colorMode = ['dark', 'quiet-blue', 'glass-dark', 'spruce', 'graphite'].includes(themeName) ? 'dark' : 'light';
    localStorage.setItem('hermes_office_theme', themeName);
    window.electronAPI?.broadcast?.('theme-changed', themeName);
  }, [themeName]);

  useEffect(() => {
    const applyTheme = (theme: unknown) => {
      if (THEME_OPTIONS.some((option) => option.value === theme)) setThemeName(theme as ThemeName);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'hermes_office_theme') applyTheme(event.newValue);
    };
    window.addEventListener('storage', handleStorage);
    const unsubscribe = window.electronAPI?.onBroadcast?.((message) => {
      if (message.channel === 'theme-changed') applyTheme(message.payload);
    });
    return () => {
      window.removeEventListener('storage', handleStorage);
      unsubscribe?.();
    };
  }, []);

  // 子窗口检测：原生聊天子窗口的 URL 附带 #chat 路由。
  // 仅在首次渲染时读一次 location.hash——主窗口永远不带 #chat（v0.1.13 已移除 hash fallback），
  // 只有 win:openChat 创建的子窗口才有 #chat hash。不需要 sessionStorage 验证。
  const [isChatWindow] = useState(
    () => typeof location !== 'undefined' && location.hash.startsWith('#chat'),
  );
  const [isSettingsWindow] = useState(
    () => typeof location !== 'undefined' && location.hash.startsWith('#settings'),
  );

  // 监听自动更新状态（仅在 Electron 桌面端生效）
  useEffect(() => {
    if (window.electronAPI?.onUpdateStatus) {
      unsubRef.current = window.electronAPI.onUpdateStatus((status) => {
        setUpdateStatus(status);
        if (status.status === 'not-available' || status.status === 'downloaded' || status.status === 'error') {
          setTimeout(() => setUpdateStatus(null), 8000);
        }
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

  const handleStationClick = (emp: Employee) => openDmChat(emp.id);

  const handleDemo = () => {
    openTeamChat('team-opc');
    startTeamDemo('team-opc');
  };

  const handleSettingsSaved = () => {
    checkBackend().then((online) => {
      dispatch({ type: 'SET_STATUS', partial: { backendOnline: online } });
    });
  };

  const progress = state.status.progress;

  return (
    <div className="app-shell">
      {/* 标题栏 */}
      <div className="titlebar">
        <div className="titlebar-left">
          <div className="titlebar-brand" aria-label="私人办公会所">
            <span className="titlebar-brand-mark"><AppstoreOutlined /></span>
            <span className="titlebar-title">私人办公会所</span>
          </div>
          {/* 视图切换 */}
          <div className="view-tabs" style={{ marginLeft: 14 }}>
            <Segmented
              value={view}
              onChange={(v) => setView(v as View)}
              options={[
                { label: <span className="view-tab-label"><HomeOutlined /><span>办公室</span></span>, value: 'office' },
                { label: <span className="view-tab-label"><BarChartOutlined /><span>数据分析</span></span>, value: 'analytics' },
                { label: <span className="view-tab-label"><ThunderboltOutlined /><span>自主办公</span></span>, value: 'autopilot' },
                { label: <span className="view-tab-label"><AppstoreOutlined /><span>技能库</span></span>, value: 'skill-library' },
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
          {updateStatus && (
            <div className={`update-status update-${updateStatus.status}`} title={updateStatus.message}
              onClick={() => updateStatus.status === 'downloaded' && window.electronAPI?.installUpdate()}
              style={updateStatus.status === 'downloaded' ? { cursor: 'pointer', textDecoration: 'underline' } : {}}
            >
              {updateStatus.status === 'checking' && '🔍 检查更新…'}
              {updateStatus.status === 'available' && '⬇️ 发现新版本'}
              {updateStatus.status === 'downloading' && `⬇️ 下载中 ${Math.round(updateStatus.percent ?? 0)}%`}
              {updateStatus.status === 'downloaded' && '🔄 点击重启安装更新'}
              {updateStatus.status === 'not-available' && '✅ 已是最新版'}
              {updateStatus.status === 'error' && '⚠️'}
            </div>
          )}
          <span className="backend-status" title={state.status.backendOnline ? '默认模型连接正常' : '默认模型当前不可用'}>
            <i className={state.status.backendOnline ? 'is-online' : 'is-offline'} />
            <span>{state.status.backendOnline ? '模型可用' : '模型离线'}</span>
          </span>
          <button
            className="titlebar-btn assistant-launch-btn"
            title="打开驴狗蛋助手"
            aria-label="打开驴狗蛋助手"
            onClick={openAssistantChat}
          >
            <RobotOutlined />
          </button>
          <Dropdown
            trigger={['click']}
            menu={{
              selectedKeys: [themeName],
              onClick: ({ key }) => setThemeName(key as ThemeName),
              items: THEME_OPTIONS.map((option) => ({
                key: option.value,
                label: <span className="theme-menu-item"><i style={{ background: option.color }} />{option.label}</span>,
              })),
            }}
          >
            <button className="titlebar-btn theme-toggle-btn" title="选择界面主题" aria-label="选择界面主题">
              <BgColorsOutlined />
            </button>
          </Dropdown>
          <Button className="titlebar-command" size="small" icon={<PlayCircleOutlined />} onClick={handleDemo} disabled={state.status.demoRunning}>
            协作演示
          </Button>
          <button className="titlebar-btn" onClick={() => window.electronAPI?.openSettings?.() ?? setShowSettings(true)} title="设置" aria-label="打开设置">
            <SettingOutlined />
          </button>
          <div className="titlebar-actions">
            <button className="titlebar-btn window-control" title="最小化" aria-label="最小化" onClick={() => window.electronAPI?.minimize()}>
              <MinusOutlined />
            </button>
            <button className="titlebar-btn window-control" title="最大化" aria-label="最大化" onClick={() => window.electronAPI?.toggleMax()}>
              <BorderOutlined />
            </button>
            <button className="titlebar-btn window-control window-control-close" title="关闭" aria-label="关闭" onClick={() => window.electronAPI?.close()}>
              <CloseOutlined />
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
            />
          </>
        ) : view === 'autopilot' ? (
          <AutopilotPanel />
        ) : view === 'skill-library' ? (
          <SkillLibraryView />
        ) : (
          <Analytics />
        )}
      </div>

      {/* 设置弹窗 */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} onSaved={handleSettingsSaved} />}
    </div>
  );
}
