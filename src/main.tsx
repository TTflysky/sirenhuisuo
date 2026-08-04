import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import './theme.css';
import App from './App';
import { StoreProvider } from './store';
import { deliverBus } from './ipcBus';
import { migrateToModelLibrary } from './data/hermesClient';
import { applyAppearanceSettings, loadAppearanceSettings } from './data/appearance';
import { applyVisualPreferences, loadVisualPreferences } from './data/visualSystem';
import { installInteractionSounds } from './data/interactionSound';
import { ensureBrandMigrationMarker } from './brand';

// 迁移旧设置到多模型库格式（如果还没有）
try { migrateToModelLibrary(); } catch {}
try { applyAppearanceSettings(loadAppearanceSettings()); } catch {}
try { applyVisualPreferences(loadVisualPreferences()); } catch {}
try { installInteractionSounds(); } catch {}
ensureBrandMigrationMarker();

// Every renderer window shares the same durable diagnostic ledger in the
// main process. UI failures remain available after a refresh or window close.
const diagnosticsRecord = typeof window !== 'undefined' ? window.electronAPI?.diagnosticsRecord : undefined;
if (diagnosticsRecord) {
  const reportRendererFailure = (operation: string, reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason || 'Unknown renderer error');
    void diagnosticsRecord({
      level: 'error', scope: 'renderer', operation, message,
      context: { href: window.location.href, stack: reason instanceof Error ? reason.stack : undefined },
    });
  };
  window.addEventListener('error', (event) => reportRendererFailure('window-error', event.error || event.message));
  window.addEventListener('unhandledrejection', (event) => reportRendererFailure('unhandled-rejection', event.reason));
}

// 注册窗口间广播监听：任意窗口经 main 进程转发来的消息，统一交给本地总线分发
if (typeof window !== 'undefined' && window.electronAPI?.onBroadcast) {
  window.electronAPI.onBroadcast((data) => {
    const channel = (data && (data as any).channel) as string;
    const payload = (data && (data as any).payload) as unknown;
    if (channel) deliverBus(channel, payload);
  });
}

// antd 主题：贴合现有「白调极简办公室」配色，圆角/字体与 theme.css 一致
const antdTheme = {
  token: {
    colorPrimary: 'var(--apple-accent)',
    colorInfo: 'var(--apple-accent)',
    borderRadius: 8,
    fontFamily: 'var(--ui-font-family)',
    colorBgContainer: 'var(--surface)',
    colorBgElevated: 'var(--surface-raised)',
    colorBorder: 'var(--border)',
    colorBorderSecondary: 'var(--border-light)',
    colorText: 'var(--text)',
    colorTextSecondary: 'var(--text-secondary)',
    colorTextTertiary: 'var(--text-muted)',
    controlHeight: 34,
  },
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider theme={antdTheme}>
      <AntApp className="app-root">
        <StoreProvider>
          <App />
        </StoreProvider>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
