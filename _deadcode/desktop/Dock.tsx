import { APPS, useWindows } from './windowManager';

export default function Dock() {
  const { windows, open, minimize, focus } = useWindows();
  const isOpen = (key: string) => windows.some((w) => w.key === key && !w.minimized);

  const onDock = (key: (typeof APPS)[number]['key']) => {
    const w = windows.find((x) => x.key === key);
    if (!w) {
      open(key);
    } else if (w.minimized) {
      focus(w.id);
      minimize(w.id); // toggle back to visible
    } else {
      minimize(w.id);
    }
  };

  return (
    <div className="dock">
      {APPS.map((a) => (
        <button
          key={a.key}
          className={`dock-item ${isOpen(a.key) ? 'active' : ''}`}
          onClick={() => onDock(a.key)}
          title={a.title}
        >
          <span className="dock-icon">{a.icon}</span>
          <span className="dock-label">{a.title}</span>
        </button>
      ))}
      <div className="dock-sep" />
      <div className="dock-tip">点击图标打开窗口 · 再次点击最小化</div>
    </div>
  );
}
