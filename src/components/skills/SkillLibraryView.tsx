import React, { useEffect, useMemo, useState } from 'react';
import type { Skill } from '../../types';
import { listSkills, readSkill, deleteSkill } from '../../data/skills';

export default function SkillLibraryView() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true); setError('');
    try { setSkills(await listSkills()); }
    catch (e) { setError(e instanceof Error ? e.message : '技能扫描失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);

  const filtered = useMemo(
    () => skills.filter((s) =>
      `${s.name} ${s.description} ${s.source}`.toLowerCase().includes(query.toLowerCase())
    ),
    [skills, query],
  );

  const toggle = async (skill: Skill) => {
    if (expanded === skill.id) { setExpanded(null); setBody(''); return; }
    setExpanded(skill.id); setBody('');
    try { setBody((await readSkill(skill.id)).content); }
    catch (e) { setBody(e instanceof Error ? e.message : '读取失败'); }
  };

  const confirmDelete = async (skill: Skill) => {
    if (deleting === skill.id) {
      try {
        await deleteSkill(skill.id);
        if (expanded === skill.id) { setExpanded(null); setBody(''); }
        setDeleting(null);
        setSkills((prev) => prev.filter((s) => s.id !== skill.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : '删除失败');
        setDeleting(null);
      }
    } else {
      setDeleting(skill.id);
    }
  };

  const cancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(null);
  };

  return (
    <div style={{ flex: 1, padding: 24, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>技能库</h2>
        <button className="btn btn-sm" onClick={refresh} disabled={loading}>↻ 刷新</button>
        <input
          className="form-input"
          style={{ maxWidth: 320, marginLeft: 'auto' }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索技能名称、说明或来源"
        />
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button style={{ marginLeft: 12 }} onClick={() => setError('')}>✕</button>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>
          {skills.length === 0 ? '暂无已安装技能' : '没有匹配的技能'}
        </div>
      )}

      <div className="skill-grid">
        {filtered.map((skill) => (
          <React.Fragment key={skill.id}>
            <div className={`skill-grid-card ${expanded === skill.id ? 'skill-grid-card--open' : ''}`}>
              <button
                className="skill-grid-card-actions"
                onClick={(e) => { e.stopPropagation(); confirmDelete(skill); }}
                title="删除技能"
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--text-muted)', padding: 2, lineHeight: 1 }}
                type="button"
              >
                {deleting === skill.id ? (
                  <span style={{ color: '#ef4444', fontWeight: 600, fontSize: 11 }}>确认</span>
                ) : '🗑'}
              </button>
              {deleting === skill.id && (
                <button
                  onClick={cancelDelete}
                  style={{ position: 'absolute', top: 8, right: 38, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', padding: 2, lineHeight: 1 }}
                  title="取消"
                  type="button"
                >
                  ✕
                </button>
              )}
              <button
                onClick={() => toggle(skill)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit', padding: 0, width: '100%', minWidth: 0 }}
                type="button"
              >
                <div className="skill-grid-card-icon">🧩</div>
                <div className="skill-grid-card-name">{skill.name}</div>
                <div className="skill-grid-card-desc">{skill.description || '暂无说明'}</div>
                <div className="skill-grid-card-meta">
                  {skill.source}{skill.version ? ` · v${skill.version}` : ''}
                </div>
              </button>
            </div>
            {expanded === skill.id && (
              <div className="skill-grid-detail">
                <pre className="skill-grid-detail-body">{body || '加载中…'}</pre>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

