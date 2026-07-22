import { MENTIONABLE } from '../mockData';

export default function MentionPicker({ onPick }: { onPick: (label: string) => void }) {
  return (
    <div className="mention-pop">
      {MENTIONABLE.map((m) => (
        <button key={m.id} onClick={() => onPick(m.label)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}
