export default function TitleBar() {
  const api = (window as Window).electronAPI;
  return (
    <div className="titlebar">
      <div className="tb-brand">
        <span className="tb-logo">🔷</span>
        <span>Hermes 主动协作桌面系统</span>
        <span className="tb-sub">OPC 四角色 · 主动型智能体办公室</span>
      </div>
      <div className="tb-controls">
        {api ? (
          <>
            <button className="tb-btn" title="最小化" onClick={() => api.minimize()}>
              —
            </button>
            <button className="tb-btn" title="最大化" onClick={() => api.toggleMax()}>
              ▢
            </button>
            <button className="tb-btn close" title="关闭" onClick={() => api.close()}>
              ✕
            </button>
          </>
        ) : (
          <span className="tb-hint">（浏览器预览模式 · 无原生窗口控制）</span>
        )}
      </div>
    </div>
  );
}
