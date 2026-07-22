import type { Message, Role, RoleId } from '../types';

const HUMAN_COLOR = '#a855f7';
const MENTION_LABELS: Record<RoleId, string> = {
  pm: '@PM',
  planner: '@Planner',
  coder: '@Coder',
  checker: '@Checker',
  human: '@老汤',
};

function roleColor(roleId: RoleId, roles: Role[]): string {
  if (roleId === 'human') return HUMAN_COLOR;
  return roles.find((r) => r.id === roleId)?.color ?? '#888';
}

function roleMeta(roleId: RoleId, roles: Role[]): { name: string; title: string; initial: string } {
  if (roleId === 'human') return { name: '老汤', title: '你（真人）', initial: '我' };
  const r = roles.find((x) => x.id === roleId);
  return r ? { name: r.name, title: r.title, initial: r.initial } : { name: roleId, title: '', initial: '?' };
}

function renderContent(content: string, roles: Role[]) {
  const parts = content.split(/(@PM|@Planner|@Coder|@Checker|@老汤)/g);
  return parts.map((p, i) => {
    const id = (Object.keys(MENTION_LABELS) as RoleId[]).find((k) => MENTION_LABELS[k] === p);
    if (id) {
      return (
        <span key={i} className="mention" style={{ color: roleColor(id, roles) }}>
          {p}
        </span>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export default function MessageBubble({ message, roles }: { message: Message; roles: Role[] }) {
  const { name, title, initial } = roleMeta(message.roleId, roles);
  const color = roleColor(message.roleId, roles);
  const isHuman = message.roleId === 'human';
  const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className={`msg ${isHuman ? 'human' : ''}`}>
      <div className="avatar" style={{ background: color }}>
        {initial}
      </div>
      <div className="body">
        <div className="meta">
          <span className="name" style={{ color }}>
            {name}
          </span>
          <span className="title">{title}</span>
          {!isHuman && <span className="online-dot" />}
          <span className="time">{time}</span>
        </div>
        <div className="content">{renderContent(message.content, roles)}</div>
      </div>
    </div>
  );
}
