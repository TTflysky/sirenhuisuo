import type { SkillReference, SkillUsageEvidence } from '../../types';

interface Props {
  refs?: SkillReference[];
  evidence?: SkillUsageEvidence[];
}

const actionLabel: Record<SkillUsageEvidence['action'], string> = {
  matched: '已选择',
  read: '已读取规则',
  'read-failed': '读取失败',
  searched: '已检索',
  installed: '已安装',
  called: '已调用',
  produced: '已产出',
  accepted: '已验收',
  rejected: '未通过验收',
  skipped: '已跳过',
};

export default function MessageSkillEvidence({ refs = [], evidence = [] }: Props) {
  if (!refs.length && !evidence.length) return null;
  const names = [...new Map([
    ...refs.map((ref) => [ref.id, ref.name] as const),
    ...evidence.map((item) => [item.skillId ?? item.skillName ?? item.toolName ?? 'skill', item.skillName ?? item.skillId ?? item.toolName ?? 'Skill'] as const),
  ]).entries()];
  return (
    <div className="msg-skill-evidence" aria-label="技能使用证据">
      <div className="msg-skill-evidence-head"><span>技能证据</span><small>发现、规则、调用、产出和验收分开记录</small></div>
      <div className="msg-skill-evidence-list">
        {names.map(([id, name]) => {
          const latest = [...evidence].reverse().find((item) => (item.skillId ?? item.skillName) === id || item.skillName === name);
          const action = latest?.action ?? 'matched';
          return <span className={`msg-skill-evidence-item is-${action}`} key={id} title={latest?.detail ?? latest?.reason ?? name}>
            <i>{action === 'read-failed' || action === 'rejected' ? '!' : ['read', 'called', 'produced', 'accepted'].includes(action) ? '✓' : '·'}</i> {name} · {actionLabel[action]}
          </span>;
        })}
      </div>
    </div>
  );
}
