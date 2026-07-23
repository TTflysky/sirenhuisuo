import { useEffect, useMemo, useState } from 'react';
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
        setExpanded(null);
        setBody('');
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

      <div style={{ flex: 1, overflow: 'auto' }}>
        {filtered.map((skill) => (
          <div key={skill.id} className="skill-card-wrap">
            <div className={`skill-card ${expanded === skill.id ? 'skill-card--open' : ''}`}>
              <button
                className="skill-card-main"
                onClick={() => toggle(skill)}
                type="button"
              >
                <span className="skill-card-icon">🧩</span>
                <div className="skill-card-info">
                  <div className="skill-card-name">{skill.name}</div>
                  <div className="skill-card-desc">{skill.description || '暂无说明'}</div>
                  <div className="skill-card-meta">
                    {skill.source}{skill.version ? ` · v${skill.version}` : ''}
                  </div>
                </div>
                <span className="skill-card-arrow">
                  {expanded === skill.id ? '▾' : '▸'}
                </span>
              </button>
              <div className="skill-card-actions">
                {deleting === skill.id ? (
                  <>
                    <button
                      className="skill-del-btn skill-del-btn--confirm"
                      onClick={(e) => { e.stopPropagation(); confirmDelete(skill); }}
                      title="确认删除"
                    >
                      确认删除
                    </button>
                    <button className="skill-del-btn" onClick={cancelDelete} title="取消">
                      ✕
                    </button>
                  </>
                ) : (
                  <button
                    className="skill-del-btn"
                    onClick={(e) => { e.stopPropagation(); confirmDelete(skill); }}
                    title="删除技能"
                  >
                    🗑
                  </button>
                )}
              </div>
            </div>
            {expanded === skill.id && (
              <div className="skill-detail">
                <pre className="skill-detail-body">{body || '加载中…'}</pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
