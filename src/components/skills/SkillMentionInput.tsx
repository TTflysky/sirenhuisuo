import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, RefObject } from 'react';
import type { Skill, SkillReference } from '../../types';
import { listSkills, readSkill, skillReference } from '../../data/skills';

interface Props { value: string; onChange: (value: string) => void; onChangeEvent?: (event: ChangeEvent<HTMLTextAreaElement>) => void; selected: SkillReference[]; onSelectedChange: (value: SkillReference[]) => void; onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void; onPaste?: (e: ClipboardEvent<HTMLTextAreaElement>) => void; disabled?: boolean; placeholder?: string; rows?: number; className?: string; ref?: RefObject<HTMLTextAreaElement | null>; }
export async function resolveSkillContext(refs: SkillReference[]): Promise<string> {
  const chosen = refs.slice(0, 5);
  const bodies = await Promise.all(chosen.map(async (ref) => { try { return await readSkill(ref.id); } catch { return null; } }));
  return bodies.filter(Boolean).map((skill) => `--- SKILL ${skill!.name} (${skill!.id}) ---\n${skill!.content.slice(0, 32000)}\n--- END SKILL ---`).join('\n');
}
const MIN_POPUP_HEIGHT = 300;
const MAX_POPUP_HEIGHT = 600;
export default function SkillMentionInput({ value, onChange, onChangeEvent, selected, onSelectedChange, onKeyDown, onPaste, disabled, placeholder, rows = 2, className = 'chat-input', ref }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]); const [open, setOpen] = useState(false); const [query, setQuery] = useState(''); const [idx, setIdx] = useState(0); const [popupHeight, setPopupHeight] = useState(380);
  const localRef = useRef<HTMLTextAreaElement>(null); const inputRef = ref ?? localRef;
  const dragRef = useRef<{ y: number; height: number } | null>(null);
  useEffect(() => { listSkills().then(setSkills).catch(() => setSkills([])); }, []);
  useEffect(() => {
    const move = (event: PointerEvent) => { if (!dragRef.current) return; const next = dragRef.current.height + dragRef.current.y - event.clientY; setPopupHeight(Math.max(MIN_POPUP_HEIGHT, Math.min(MAX_POPUP_HEIGHT, next))); };
    const stop = () => { dragRef.current = null; document.body.classList.remove('skill-picker-resizing'); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
  }, []);
  const candidates = useMemo(() => skills.filter((s) => !selected.some((x) => x.id === s.id) && `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8), [skills, selected, query]);
  const choose = (skill: Skill) => { onSelectedChange([...selected, skillReference(skill)].slice(0, 5)); const at = value.lastIndexOf('@'); onChange(at >= 0 ? `${value.slice(0, at)}${value.slice(at + skill.name.length + 1)} ` : `${value} `); setOpen(false); setQuery(''); inputRef.current?.focus(); };
  return <div style={{ position: 'relative', width: '100%' }}>
    {selected.length > 0 && <div className="mention-selected-row">{selected.map((s) => <span className="mention-selected-chip" key={s.id}>🧩 {s.name}<button className="attach-del" onClick={() => onSelectedChange(selected.filter((x) => x.id !== s.id))} title="移除技能">✕</button></span>)}</div>}
    <textarea ref={inputRef} className={className} value={value} disabled={disabled} rows={rows} placeholder={placeholder} onChange={(e) => { const v = e.target.value; onChange(v); onChangeEvent?.(e); const m = v.slice(0, e.target.selectionStart ?? v.length).match(/@([^@\s]*)$/); setOpen(!!m); setQuery(m?.[1] ?? ''); setIdx(0); }} onKeyDown={(e) => { if (open && candidates.length) { if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => (i + 1) % candidates.length); return; } if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => (i - 1 + candidates.length) % candidates.length); return; } if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(candidates[idx]); return; } if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; } } onKeyDown?.(e); }} onPaste={onPaste} />
    {open && candidates.length > 0 && <div className="mention-popup" style={{ height: popupHeight }}>
      <div className="mention-popup-resize" role="separator" aria-label="调整技能列表高度" title="拖动调整展示区域" onPointerDown={(event) => { event.preventDefault(); dragRef.current = { y: event.clientY, height: popupHeight }; document.body.classList.add('skill-picker-resizing'); }} />
      <div className="mention-popup-head">选择技能 <span>拖动上沿调整 · 回车确认</span></div>
      <div className="mention-popup-grid">
        {candidates.map((s, i) => <button key={s.id} className={`mention-card ${i === idx ? 'active' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => choose(s)}>
          <span className="mention-card-icon">🧩</span>
          <div className="mention-card-body">
            <div className="mention-card-name">{s.name}</div>
            <div className="mention-card-desc">{s.description || s.source}</div>
          </div>
          <span className="mention-card-badge">{s.source.slice(0, 6)}</span>
        </button>)}
      </div>
    </div>}
  </div>;
}
