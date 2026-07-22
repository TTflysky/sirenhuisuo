import TitleBar from './TitleBar';
import Dock from './Dock';
import AppWindow from './AppWindow';
import { useWindows } from './windowManager';
import { useStore } from '../store';

export default function DesktopShell() {
  const { windows } = useWindows();
  const { state } = useStore();

  return (
    <div className="desktop">
      <TitleBar />
      <div className="desktop-area">
        {windows.filter((w) => !w.minimized).map((w) => (
          <AppWindow key={w.id} win={w} />
        ))}
        {windows.length === 0 && (
          <div className="desktop-empty">
            <div className="de-logo">🔷</div>
            <h2>Hermes 主动协作桌面</h2>
            <p>点击下方 Dock 的图标打开办公室窗口</p>
            <p className="de-sub">
              后端状态：
              <span className={state.status.backendOnline ? 'led online' : 'led offline'} />
              {state.status.backendOnline ? '在线' : '离线（模拟）'} · 四人组已就位
            </p>
          </div>
        )}
      </div>
      <Dock />
    </div>
  );
}
