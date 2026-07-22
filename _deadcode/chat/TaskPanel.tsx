import { useStore } from '../store';
import { LANES } from '../types';
import TaskCard from './TaskCard';

export default function TaskPanel() {
  const { state, advanceTask } = useStore();
  const roleOf = (id: string) => state.roles.find((r) => r.id === id);
  return (
    <div className="tasks">
      <h3>任务侧栏</h3>
      {LANES.map((lane) => {
        const items = state.tasks.filter((t) => t.lane === lane);
        return (
          <div className="lane" key={lane}>
            <div className="lane-head">
              {lane} <span className="count">{items.length}</span>
            </div>
            {items.length === 0 && <div className="empty">— 空 —</div>}
            {items.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                assignee={roleOf(t.assignee)}
                lane={lane}
                onAdvance={(l) => advanceTask(t.id, l)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
