import { type MouseEvent } from 'react';
import { APPS, useWindows, type WinState } from './windowManager';

export default function AppWindow({ win }: { win: WinState }) {
  const { focus, close, minimize, move, resize } = useWindows();
  const def = APPS.find((a) => a.key === win.key)!;

  const onHeaderDown = (e: MouseEvent<HTMLDivElement>) => {
    focus(win.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = win.x;
    const oy = win.y;
    const onMove = (ev: globalThis.MouseEvent) => {
      move(win.id, ox + ev.clientX - sx, Math.max(0, oy + ev.clientY - sy));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onResizeDown = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    focus(win.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const ow = win.w;
    const oh = win.h;
    const onMove = (ev: globalThis.MouseEvent) => {
      resize(win.id, Math.max(360, ow + ev.clientX - sx), Math.max(280, oh + ev.clientY - sy));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const renderBody = () => {
    switch (win.key) {
      case 'chat':
        return <ChatAppBody />;
      case 'kanban':
        return <KanbanAppBody />;
      case 'tasks':
        return <TasksAppBody />;
      case 'settings':
        return <SettingsAppBody />;
      default:
        return null;
    }
  };

  return (
    <div
      className="appwin"
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }}
      onMouseDown={() => focus(win.id)}
    >
      <div className="aw-header" onMouseDown={onHeaderDown}>
        <span className="aw-icon">{def.icon}</span>
        <span className="aw-title">{def.title}</span>
        <div className="aw-actions">
          <button className="aw-btn" title="最小化" onClick={() => minimize(win.id)}>
            —
          </button>
          <button className="aw-btn close" title="关闭" onClick={() => close(win.id)}>
            ✕
          </button>
        </div>
      </div>
      <div className="aw-body">{renderBody()}</div>
      <div className="aw-resize" onMouseDown={onResizeDown} title="拖拽缩放" />
    </div>
  );
}

// 延迟引入避免循环依赖：通过动态 import 在 render 时取用
import ChatAppBody from '../apps/ChatApp';
import KanbanAppBody from '../apps/KanbanApp';
import TasksAppBody from '../apps/TasksApp';
import SettingsAppBody from '../apps/SettingsApp';
