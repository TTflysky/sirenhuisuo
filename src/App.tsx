import { useState, useEffect, useRef } from 'react';
import { Segmented, Button } from 'antd';
import { BulbOutlined, MoonOutlined } from '@ant-design/icons';
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

export default function App() {
  const { state, openDmChat, openTeamChat, startTeamDemo, dispatch } = useStore();

  // ===== ALL hooks first (Rules of Hooks) =====
  const [showSettings, setShowSettings] = useState(false);
  const [view, setView] = useState<View>('office');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('hermes_office_theme') === 'dark');
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
    localStorage.setItem('hermes_office_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // 子窗口检测：原生聊天子窗口的 URL 附带 #chat 路由。
  // 仅在首次渲染时读一次 location.hash——主窗口永远不带 #chat（v0.1.13 已移除 hash fallback），
  // 只有 win:openChat 创建的子窗口才有 #chat hash。不需要 sessionStorage 验证。
  const [isChatWindow] = useState(
    () => typeof location !== 'undefined' && location.hash.startsWith('#chat'),
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 标题栏 */}
      <div className="titlebar">
        <div className="titlebar-left">
          <span style={{ fontSize: 16 }}>🏢</span>
          <span className="titlebar-title">私人办公会所</span>
          {/* 视图切换 */}
          <div className="view-tabs" style={{ marginLeft: 14 }}>
            <Segmented
              value={view}
              onChange={(v) => setView(v as View)}
              options={[
                { label: '🏢 办公室', value: 'office' },
                { label: '📊 数据分析', value: 'analytics' },
                { label: '🤖 自主办公', value: 'autopilot' },
                { label: '🧩 技能库', value: 'skill-library' },
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
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {state.status.backendOnline ? '🟢 默认模型可用' : '🔴 默认模型不可用'}
          </span>
          <button
            className="titlebar-btn theme-toggle-btn"
            title={darkMode ? '切换到白天模式' : '切换到黑夜模式'}
            onClick={() => setDarkMode((value) => !value)}
          >
            {darkMode ? <BulbOutlined /> : <MoonOutlined />}
          </button>
          <Button size="small" onClick={handleDemo} disabled={state.status.demoRunning}>
            ▶ 演示 OPC 协作
          </Button>
          <Button size="small" onClick={() => setShowSettings(true)} title="API 接口配置">
            ⚙️ 设置
          </Button>
          <div className="titlebar-actions">
            <button className="titlebar-btn" title="最小化" onClick={() => window.electronAPI?.minimize()}>
              —
            </button>
            <button className="titlebar-btn" title="最大化" onClick={() => window.electronAPI?.toggleMax()}>
              ▢
            </button>
            <button className="titlebar-btn" title="关闭" onClick={() => window.electronAPI?.close()}>
              ✕
            </button>
          </div>
        </div>
      </div>

      {/* 主体 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
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
