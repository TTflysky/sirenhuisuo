import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SearchOutlined, ThunderboltOutlined, CloseOutlined } from '@ant-design/icons';
import type { Skill, SkillReference } from '../../types';
import { listSkills, skillReference } from '../../data/skills';
import { BUS_CHANNELS, onBus } from '../../ipcBus';

interface Props {
  selected: SkillReference[];
  onSelectedChange: (value: SkillReference[]) => void;
  disabled?: boolean;
}

export default function SkillPickerButton({ selected, onSelectedChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, bottom: 52, width: 420 });
  const refreshSkills = () => {
    setLoading(true);
    void listSkills().then(setSkills).catch(() => setSkills([])).finally(() => setLoading(false));
  };

  useEffect(() => onBus(BUS_CHANNELS.SKILLS_CHANGED, refreshSkills), []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    refreshSkills();
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(460, window.innerWidth - 24);
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), bottom: Math.max(12, window.innerHeight - rect.top + 7), width });
    };
    place();
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', closeOnOutside);
    return () => { window.removeEventListener('resize', place); document.removeEventListener('pointerdown', closeOnOutside); };
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return skills.filter((skill) => !needle || `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(needle));
  }, [skills, query]);

  const toggle = (skill: Skill) => {
    const exists = selected.some((item) => item.id === skill.id);
    onSelectedChange(exists ? selected.filter((item) => item.id !== skill.id) : [...selected, skillReference(skill)].slice(0, 5));
  };

  return <>
    <button ref={buttonRef} type="button" className={`btn btn-sm skill-toolbar-btn${selected.length ? ' active' : ''}`} disabled={disabled} onClick={() => setOpen((value) => !value)} title="选择技能">
      <ThunderboltOutlined /> 技能{selected.length ? ` ${selected.length}` : ''}
    </button>
    {open && createPortal(<div ref={panelRef} className="skill-library-popover" style={position}>
      <div className="skill-library-head"><strong>选择技能</strong><span>最多 5 个</span><button className="icon-btn" onClick={() => setOpen(false)} title="关闭"><CloseOutlined /></button></div>
      <label className="skill-library-search"><SearchOutlined /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能名称、说明或来源" /></label>
      {!!selected.length && <div className="skill-library-selected">{selected.map((skill) => <button key={skill.id} onClick={() => onSelectedChange(selected.filter((item) => item.id !== skill.id))}>{skill.name} ×</button>)}</div>}
      <div className="skill-library-list">
        {loading ? <div className="skill-library-empty">正在读取技能库…</div> : filtered.length ? filtered.map((skill) => {
          const active = selected.some((item) => item.id === skill.id);
          return <button key={skill.id} className={`skill-library-item${active ? ' selected' : ''}`} onClick={() => toggle(skill)}><span className="skill-library-check">{active ? '✓' : '+'}</span><span><strong>{skill.name}</strong><small>{skill.description || skill.source}</small></span></button>;
        }) : <div className="skill-library-empty">没有匹配的技能</div>}
      </div>
    </div>, document.body)}
  </>;
}
