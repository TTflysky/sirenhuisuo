import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, RefObject } from 'react';
import type { Skill, SkillReference } from '../../types';
import { listSkills, readSkill, skillInstructionText, skillReference } from '../../data/skills';
import { BUS_CHANNELS, onBus } from '../../ipcBus';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onChangeEvent?: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  selected: SkillReference[];
  onSelectedChange: (value: SkillReference[]) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  className?: string;
  ref?: RefObject<HTMLTextAreaElement | null>;
}

export async function resolveSkillContext(refs: SkillReference[]): Promise<string> {
  const chosen = refs.slice(0, 5);
  const bodies = await Promise.all(chosen.map(async (ref) => {
    try { return await readSkill(ref.id); } catch { return null; }
  }));
  return bodies
    .filter(Boolean)
    .map((skill) => `--- SKILL ${skill!.name} (${skill!.id}) ---\n${skillInstructionText(skill!, 60000)}\n--- END SKILL ---`)
    .join('\n');
}

const MIN_POPUP_HEIGHT = 300;
const MAX_POPUP_HEIGHT = 600;
const MAX_VISIBLE_SKILLS = 100;

export default function SkillMentionInput({
  value,
  onChange,
  onChangeEvent,
  selected,
  onSelectedChange,
  onKeyDown,
  onPaste,
  disabled,
  placeholder,
  rows = 2,
  className = 'chat-input',
  ref,
}: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);
  const [popupHeight, setPopupHeight] = useState(380);
  const [popupPosition, setPopupPosition] = useState({ left: 12, bottom: 80, width: 460 });
  const localRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = ref ?? localRef;
  const dragRef = useRef<{ y: number; height: number } | null>(null);

  const refreshSkills = useCallback(async () => {
    setLoading(true);
    listSkills()
      .then(setSkills)
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { void refreshSkills(); }, [refreshSkills]);
  useEffect(() => onBus(BUS_CHANNELS.SKILLS_CHANGED, () => { void refreshSkills(); }), [refreshSkills]);
  useEffect(() => {
    const refreshOnFocus = () => { void refreshSkills(); };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, [refreshSkills]);

  useEffect(() => {
    if (!open) return undefined;
    const placePopup = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 460), Math.max(280, window.innerWidth - 24));
      setPopupPosition({
        left: Math.max(12, Math.min(rect.left + (rect.width - width) / 2, window.innerWidth - width - 12)),
        bottom: Math.max(12, window.innerHeight - rect.top + 8),
        width,
      });
    };
    placePopup();
    window.addEventListener('resize', placePopup);
    window.addEventListener('scroll', placePopup, true);
    return () => {
      window.removeEventListener('resize', placePopup);
      window.removeEventListener('scroll', placePopup, true);
    };
  }, [inputRef, open]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragRef.current) return;
      const next = dragRef.current.height + dragRef.current.y - event.clientY;
      setPopupHeight(Math.max(MIN_POPUP_HEIGHT, Math.min(MAX_POPUP_HEIGHT, next)));
    };
    const stop = () => {
      dragRef.current = null;
      document.body.classList.remove('skill-picker-resizing');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
  }, []);

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return skills
      .filter((skill) => !selected.some((item) => item.id === skill.id))
      .filter((skill) => !needle || `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(needle))
      .slice(0, MAX_VISIBLE_SKILLS);
  }, [query, selected, skills]);

  const choose = (skill: Skill) => {
    onSelectedChange([...selected, skillReference(skill)].slice(0, 5));
    const at = value.lastIndexOf('@');
    onChange(at >= 0 ? `${value.slice(0, at)}${value.slice(at + skill.name.length + 1)} ` : `${value} `);
    setOpen(false);
    setQuery('');
    inputRef.current?.focus();
  };

  const handlePickerKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): boolean => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      inputRef.current?.focus();
      return true;
    }
    if (!candidates.length) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIdx((current) => (current + 1) % candidates.length);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIdx((current) => (current - 1 + candidates.length) % candidates.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      choose(candidates[idx]);
      return true;
    }
    return false;
  };

  const picker = open ? createPortal(
    <div
      className="mention-popup mention-skill-popup"
      style={{ height: popupHeight, left: popupPosition.left, bottom: popupPosition.bottom, width: popupPosition.width }}
    >
      <div
        className="mention-popup-resize"
        role="separator"
        aria-label="调整技能列表高度"
        title="拖动调整展示区域"
        onPointerDown={(event) => {
          event.preventDefault();
          dragRef.current = { y: event.clientY, height: popupHeight };
          document.body.classList.add('skill-picker-resizing');
        }}
      />
      <div className="mention-popup-head">
        <strong>选择技能</strong>
        <span>输入关键词筛选 · 回车确认</span>
      </div>
      <label className="mention-skill-search">
        <span aria-hidden="true">⌕</span>
        <input
          value={query}
          onChange={(event) => { setQuery(event.target.value); setIdx(0); }}
          onKeyDown={handlePickerKeyDown}
          placeholder="搜索技能名称、说明或来源"
          aria-label="搜索技能"
        />
      </label>
      <div className="mention-popup-grid">
        {loading ? <div className="mention-skill-empty">正在读取技能库…</div> : candidates.length ? candidates.map((skill, index) => (
          <button
            key={skill.id}
            type="button"
            className={`mention-card ${index === idx ? 'active' : ''}`}
            onMouseEnter={() => setIdx(index)}
            onClick={() => choose(skill)}
          >
            <span className="mention-card-icon">🧩</span>
            <div className="mention-card-body">
              <div className="mention-card-name">{skill.name}</div>
              <div className="mention-card-desc">{skill.description || skill.source}</div>
            </div>
            <span className="mention-card-badge">{skill.source.slice(0, 6)}</span>
          </button>
        )) : <div className="mention-skill-empty">没有匹配的技能</div>}
      </div>
    </div>,
    document.body,
  ) : null;

  return <div style={{ position: 'relative', width: '100%' }}>
    {selected.length > 0 && <div className="mention-selected-row">
      {selected.map((skill) => <span className="mention-selected-chip" key={skill.id}>
        🧩 {skill.name}
        <button className="attach-del" type="button" onClick={() => onSelectedChange(selected.filter((item) => item.id !== skill.id))} title="移除技能">×</button>
      </span>)}
    </div>}
    <textarea
      ref={inputRef}
      className={className}
      value={value}
      disabled={disabled}
      rows={rows}
      placeholder={placeholder}
      onChange={(event) => {
        const nextValue = event.target.value;
        onChange(nextValue);
        onChangeEvent?.(event);
        const match = nextValue.slice(0, event.target.selectionStart ?? nextValue.length).match(/@([^@\s]*)$/);
        setOpen(!!match);
        setQuery(match?.[1] ?? '');
        setIdx(0);
      }}
      onKeyDown={(event) => {
        if (open && handlePickerKeyDown(event)) return;
        onKeyDown?.(event);
      }}
      onPaste={onPaste}
    />
    {picker}
  </div>;
}
