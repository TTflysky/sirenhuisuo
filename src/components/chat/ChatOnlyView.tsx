import { useEffect, useState } from 'react';
import { useStore } from '../../storeContext';
import DmChatApp from './DmChatApp';
import TeamChatApp from './TeamChatApp';
import AssistantChat from './AssistantChat';
import { fetchInitial } from '../../data/hermesClient';
import { BorderOutlined, CloseOutlined, LockOutlined, MessageOutlined, MinusOutlined, RobotOutlined, TeamOutlined, UnlockOutlined } from '@ant-design/icons';
import { APP_VERSION } from '../../appVersion';
import { APP_BRAND_NAME } from '../../brand';

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
  const { state, dispatch } = useStore();
  const { type, id } = parseChatHash(hash);
  const [locked, setLocked] = useState(false);
  const [teamHydrating, setTeamHydrating] = useState(type === 'team-chat' || type === 'team');
  const canLockToMain = type === 'dm-chat' || type === 'dm' || type === 'team-chat' || type === 'team';

  useEffect(() => {
    if (!canLockToMain) return;
    window.electronAPI?.getChatLock?.({ type: type === 'dm' ? 'dm-chat' : type === 'team' ? 'team-chat' : type, refId: id })
      .then(({ locked: value }) => setLocked(value))
      .catch(() => {});
  }, [canLockToMain, id, type]);

  useEffect(() => {
    if (type !== 'team-chat' && type !== 'team') return;
    if (state.teams.some((team) => team.id === id)) {
      setTeamHydrating(false);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let timer: number | undefined;
    const hydrate = () => {
      if (cancelled) return;
      const persisted = fetchInitial();
      const team = persisted.teams.find((item) => item.id === id);
      if (team) {
        dispatch({
          type: 'INIT',
          state: { ...state, employees: persisted.employees, teams: persisted.teams, projects: persisted.projects, taskRuns: persisted.taskRuns },
        });
        setTeamHydrating(false);
        return;
      }
      attempts += 1;
      if (attempts >= 8) {
        setTeamHydrating(false);
        return;
      }
      timer = window.setTimeout(hydrate, 120 * attempts);
    };
    hydrate();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [dispatch, id, state, type]);

  const toggleLock = async () => {
    const result = await window.electronAPI?.setChatLock?.({
      type: type === 'dm' ? 'dm-chat' : type === 'team' ? 'team-chat' : type as 'dm-chat' | 'team-chat',
      refId: id,
      locked: !locked,
    });
    if (result) setLocked(result.locked);
  };

  let title = '聊天';
  let subtitle = APP_BRAND_NAME;
  let titleIcon = <MessageOutlined />;
  if (type === 'dm-chat' || type === 'dm') {
    const emp = state.employees.find((e) => e.id === id);
    title = emp ? `与 ${emp.name} 私聊` : '员工私聊';
    subtitle = emp?.title ?? '员工对话';
  } else if (type === 'team-chat' || type === 'team') {
    const team = state.teams.find((t) => t.id === id);
    title = team?.name ?? '团队协作';
    subtitle = team ? `${team.memberIds.length} 名成员` : '团队对话';
    titleIcon = <TeamOutlined />;
  } else if (type === 'assistant-chat' || type === 'assistant') {
    title = '章北海助理';
    subtitle = '执行、调度与交付';
    titleIcon = <RobotOutlined />;
  }

  if ((type === 'team-chat' || type === 'team') && !state.teams.some((team) => team.id === id)) {
    return (
      <div className="chat-only-view chat-team-hydrating">
        <div className="chat-team-hydrating-card">
          <TeamOutlined />
          <strong>{teamHydrating ? '正在同步团队…' : '团队窗口无效'}</strong>
          <small>{teamHydrating ? '正在等待批准结果写入本地团队列表' : '这个窗口没有对应的团队记录，可以关闭后重新打开'}</small>
          {!teamHydrating && <button type="button" className="btn btn-sm" onClick={() => window.electronAPI?.close()}>关闭窗口</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-only-view">
      {/* 原生标题栏（可拖动） */}
      <div className="chat-only-titlebar">
        <div className="chat-window-heading">
          <span className="chat-window-icon">{titleIcon}</span>
          <span className="chat-only-title"><strong>{title}<span className="window-version-badge" title={`当前版本 v${APP_VERSION}`}>v{APP_VERSION}</span></strong><small>{subtitle}</small></span>
        </div>
        <div className="chat-only-traffic">
          {canLockToMain && <button type="button" className={`titlebar-btn window-control chat-window-lock ${locked ? 'is-locked' : ''}`} title={locked ? '解除与主界面的左侧联动' : '锁定到主界面的左侧'} aria-label={locked ? '解除聊天窗口联动' : '锁定聊天窗口联动'} onClick={() => void toggleLock()}>{locked ? <LockOutlined /> : <UnlockOutlined />}</button>}
          <button type="button" className="titlebar-btn window-control" title="最小化" aria-label="最小化聊天窗口" onClick={() => window.electronAPI?.minimize()}><MinusOutlined /></button>
          <button type="button" className="titlebar-btn window-control" title="最大化" aria-label="最大化聊天窗口" onClick={() => window.electronAPI?.toggleMax()}><BorderOutlined /></button>
          <button type="button" className="titlebar-btn window-control window-control-close" title="关闭" aria-label="关闭聊天窗口" onClick={() => window.electronAPI?.close()}><CloseOutlined /></button>
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
