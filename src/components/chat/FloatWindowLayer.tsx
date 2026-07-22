import type { WinState } from '../../types';
import { useStore } from '../../store';
import TeamChatApp from './TeamChatApp';
import DmChatApp from './DmChatApp';
import AssistantChat from './AssistantChat';

interface Props {}

const MIN_W = 320;
const MIN_H = 220;

export default function FloatWindowLayer({}: Props) {
  const { state, closeWin, minimizeWin, dispatch } = useStore();

  // 边界约束：允许拖到屏幕任意位置，仅保证标题栏(36px)始终可达
  const clampPos = (id: string, x: number, y: number) => {
    const win = state.windows.find((w) => w.id === id);
    if (!win) return { x, y };
    // 全屏范围：保证至少露出 60px 宽度 + 标题栏 36px 高度
    const minX = -win.w + 60;
    const maxX = window.innerWidth - 60;
    const minY = -win.h + 36;   // 允许拖到屏幕上方，只留标题栏
    const maxY = window.innerHeight - 36;  // 允许拖到屏幕下方
    return {
      x: Math.max(minX, Math.min(maxX, x)),
      y: Math.max(minY, Math.min(maxY, y)),
    };
  };

  if (state.windows.length === 0) return null;

  return (
    <div className="float-layer">
      {state.windows.map((win: WinState) => (
        <div
          key={win.id}
          className="appwin"
          style={{
            left: win.x,
            top: win.y,
            width: win.w,
            height: win.h ? (win.minimized ? 36 : win.h) : undefined,
            zIndex: win.z,
            display: win.minimized ? undefined : 'flex',
          }}
        >
          {/* 标题栏（拖拽区） */}
          <div
            className="appwin-header"
            onMouseDown={(e) => {
              // 点击标题栏时将此窗口置于最前
              dispatch({ type: 'FOCUS_WIN', id: win.id });
              const startX = e.clientX - win.x;
              const startY = e.clientY - win.y;
              const onMouseMove = (ev: MouseEvent) => {
                const rawDx = ev.clientX - startX;
                const rawDy = ev.clientY - startY;
                const clamped = clampPos(win.id, rawDx, rawDy);
                const el = (e.target as HTMLElement).closest('.appwin') as HTMLElement | null;
                if (el) {
                  el.style.left = `${clamped.x}px`;
                  el.style.top = `${clamped.y}px`;
                }
              };
              const onMouseUp = (ev: MouseEvent) => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                const rawDx = ev.clientX - startX;
                const rawDy = ev.clientY - startY;
                const clamped = clampPos(win.id, rawDx, rawDy);
                dispatch({ type: 'MOVE_WIN', id: win.id, x: clamped.x, y: clamped.y });
              };
              document.addEventListener('mousemove', onMouseMove);
              document.addEventListener('mouseup', onMouseUp);
            }}
          >
            <span className="appwin-dot dot-close" onClick={() => closeWin(win.id)} />
            <span className="appwin-dot dot-minimize" onClick={() => minimizeWin(win.id)} />
            <span className="appwin-dot dot-maximize" />
            <span className="appwin-title-text">{win.icon} {win.title}</span>
          </div>

          {/* 内容区 */}
          {!win.minimized && (
            <div className="appwin-body">
              {win.kind === 'team-chat' && win.refId && <TeamChatApp teamId={win.refId} />}
              {win.kind === 'dm-chat' && win.refId && <DmChatApp empId={win.refId} />}
              {win.kind === 'assistant-chat' && <AssistantChat />}
              {win.kind === 'settings' && (
                <div style={{ padding: 16 }}>
                  <h3>⚙️ 设置</h3>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>设置面板开发中...</p>
                </div>
              )}
            </div>
          )}

          {/* 右下角缩放手柄 */}
          {!win.minimized && (
            <div
              className="appwin-resize"
              title="拖动缩放"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const startX = e.clientX;
                const startY = e.clientY;
                const startW = win.w;
                const startH = win.h ?? 400;
                const onMouseMove = (ev: MouseEvent) => {
                  const el = (e.target as HTMLElement).closest('.appwin') as HTMLElement | null;
                  if (!el) return;
                  const nw = Math.max(MIN_W, startW + (ev.clientX - startX));
                  const nh = Math.max(MIN_H, startH + (ev.clientY - startY));
                  el.style.width = `${nw}px`;
                  el.style.height = `${nh}px`;
                };
                const onMouseUp = (ev: MouseEvent) => {
                  document.removeEventListener('mousemove', onMouseMove);
                  document.removeEventListener('mouseup', onMouseUp);
                  const nw = Math.max(MIN_W, startW + (ev.clientX - startX));
                  const nh = Math.max(MIN_H, startH + (ev.clientY - startY));
                  dispatch({ type: 'RESIZE_WIN', id: win.id, w: nw, h: nh });
                };
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
