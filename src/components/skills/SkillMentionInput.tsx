import { useEffect, useMemo, useRef, useState } from 'react';
import type { Skill, SkillReference } from '../../types';
import { listSkills, readSkill, skillReference } from '../../data/skills';

interface Props { value: string; onChange: (value: string) => void; onChangeEvent?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void; selected: SkillReference[]; onSelectedChange: (value: SkillReference[]) => void; onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void; onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void; disabled?: boolean; placeholder?: string; rows?: number; className?: string; ref?: React.RefObject<HTMLTextAreaElement | null>; }
export async function resolveSkillContext(refs: SkillReference[]): Promise<string> {
  const chosen = refs.slice(0, 5);
  const bodies = await Promise.all(chosen.map(async (ref) => { try { return await readSkill(ref.id); } catch { return null; } }));
  return bodies.filter(Boolean).map((skill) => `--- SKILL ${skill!.name} (${skill!.id}) ---\n${skill!.content.slice(0, 32000)}\n--- END SKILL ---`).join('\n');
}
export default function SkillMentionInput({ value, onChange, onChangeEvent, selected, onSelectedChange, onKeyDown, onPaste, disabled, placeholder, rows = 2, className = 'chat-input', ref }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]); const [open, setOpen] = useState(false); const [query, setQuery] = useState(''); const [idx, setIdx] = useState(0); const localRef = useRef<HTMLTextAreaElement>(null); const inputRef = ref ?? localRef;
  useEffect(() => { listSkills().then(setSkills).catch(() => setSkills([])); }, []);
  const candidates = useMemo(() => skills.filter((s) => !selected.some((x) => x.id === s.id) && `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8), [skills, selected, query]);
  const choose = (skill: Skill) => { onSelectedChange([...selected, skillReference(skill)].slice(0, 5)); const at = value.lastIndexOf('@'); onChange(at >= 0 ? `${value.slice(0, at)}${value.slice(at + skill.name.length + 1)} ` : `${value} `); setOpen(false); setQuery(''); inputRef.current?.focus(); };
  return <div style={{ position: 'relative', width: '100%' }}>
    {selected.length > 0 && <div className="attach-row">{selected.map((s) => <span className="attach-chip" key={s.id}>🧩 {s.name}<button className="attach-del" onClick={() => onSelectedChange(selected.filter((x) => x.id !== s.id))} title="移除技能">✕</button></span>)}</div>}
    <textarea ref={inputRef} className={className} value={value} disabled={disabled} rows={rows} placeholder={placeholder} onChange={(e) => { const v = e.target.value; onChange(v); onChangeEvent?.(e); const m = v.slice(0, e.target.selectionStart ?? v.length).match(/@([^@\s]*)$/); setOpen(!!m); setQuery(m?.[1] ?? ''); setIdx(0); }} onKeyDown={(e) => { if (open && candidates.length) { if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => (i + 1) % candidates.length); return; } if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => (i - 1 + candidates.length) % candidates.length); return; } if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(candidates[idx]); return; } if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; } } onKeyDown?.(e); }} onPaste={onPaste} />
    {open && candidates.length > 0 && <div className="mention-popup"><div className="mention-popup-head">选择技能</div>{candidates.map((s, i) => <button key={s.id} className={`mention-option ${i === idx ? 'active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => choose(s)}><span>🧩</span><div className="mention-option-info"><div className="mention-option-name">{s.name}</div><div className="mention-option-title">{s.description || s.source}</div></div></button>)}</div>}
  </div>;
}
