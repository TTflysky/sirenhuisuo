import { useStore } from '../../store';
import DmChatApp from './DmChatApp';
import TeamChatApp from './TeamChatApp';
import AssistantChat from './AssistantChat';

interface Props {
  hash: string;
}

/** 解析 #chat?type=dm&id=xxx 形式的 hash 参数 */
function parseChatHash(hash: string): { type: string; id: string } {
  try {
    const q = hash.replace(/^#chat\??/, '');
    const p = new URLSearchParams(q);
    return { type: p.get('type') || '', id: p.get('id') || '' };
  } catch {
    return { type: '', id: '' };
  }
}

/**
 * 原生聊天窗口专用视图（独立 Electron BrowserWindow）。
 * 标题栏用 -webkit-app-region:drag 实现窗口拖动，可拖到屏幕任意位置。
 */
export default function ChatOnlyView({ hash }: Props) {
  const { state } = useStore();
  const { type, id } = parseChatHash(hash);

  let title = '聊天';
  if (type === 'dm-chat' || type === 'dm') {
    const emp = state.employees.find((e) => e.id === id);
    title = emp ? `💬 与 ${emp.name} 私聊` : '💬 私聊';
  } else if (type === 'team-chat' || type === 'team') {
    const team = state.teams.find((t) => t.id === id);
    title = team ? `${team.icon ?? '💬'} ${team.name}` : '💬 团队';
  } else if (type === 'assistant-chat' || type === 'assistant') {
    title = '🤖 Hermes 助手';
  }

  return (
    <div className="chat-only-view">
      {/* 原生标题栏（可拖动） */}
      <div className="chat-only-titlebar">
        <span className="chat-only-title">{title}</span>
        <div className="chat-only-traffic">
          <button type="button" className="titlebar-btn" title="最小化" aria-label="最小化聊天窗口" onClick={() => window.electronAPI?.minimize()}>—</button>
          <button type="button" className="titlebar-btn" title="关闭" aria-label="关闭聊天窗口" onClick={() => window.electronAPI?.close()}>✕</button>
        </div>
      </div>

      {/* 聊天主体 */}
      <div className="chat-only-body">
        {type === 'dm-chat' || type === 'dm' ? (
          <DmChatApp empId={id} />
        ) : type === 'team-chat' || type === 'team' ? (
          <TeamChatApp teamId={id} />
        ) : type === 'assistant-chat' || type === 'assistant' ? (
          <AssistantChat />
        ) : (
          <div style={{ padding: 20, color: 'var(--text-muted)' }}>未知聊天类型</div>
        )}
      </div>
    </div>
  );
}
