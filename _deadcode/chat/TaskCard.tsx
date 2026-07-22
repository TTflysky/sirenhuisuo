import { LANES, type Task, type Role, type Lane } from '../types';

export default function TaskCard({
  task,
  assignee,
  lane,
  onAdvance,
}: {
  task: Task;
  assignee?: Role;
  lane: Lane;
  onAdvance: (l: Lane) => void;
}) {
  const idx = LANES.indexOf(lane);
  const next = idx < LANES.length - 1 ? LANES[idx + 1] : null;
  const color = assignee?.color ?? '#888';
  return (
    <div className="task">
      <div className="t-title">
        <span className="bar" style={{ background: color }} />
        {task.title}
      </div>
      <div className="t-meta">
        {assignee ? `${assignee.name} · ${assignee.title}` : '未分配'}
        {task.acceptance ? ` · 验收: ${task.acceptance}` : ''}
      </div>
      {next && (
        <button className="advance" onClick={() => onAdvance(next)}>
          推进 ▸ {next}
        </button>
      )}
    </div>
  );
}
