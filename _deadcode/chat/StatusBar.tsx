import { useStore } from '../store';

export default function StatusBar() {
  const { state, startDemo, reset } = useStore();
  const { backendOnline, demoRunning } = state.status;
  return (
    <div className="statusbar">
      <div className="brand">
        <span className="dot">●</span> Hermes 主动协作空间
      </div>
      <div className="status-indicator">
        <span className={`led ${backendOnline ? 'online' : 'offline'}`} />
        {backendOnline ? '后端在线' : '离线（模拟）'}
      </div>
      <div className="spacer" />
      <button className="btn primary" onClick={startDemo} disabled={demoRunning}>
        {demoRunning ? '协作进行中…' : '▶ 演示主动协作'}
      </button>
      <button className="btn" onClick={reset}>
        ⟲ 重置
      </button>
    </div>
  );
}
