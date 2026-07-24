import React, { useEffect, useMemo, useState } from 'react';
import { DeleteOutlined, DownloadOutlined, ExportOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import type { Skill } from '../../types';
import { deleteSkill, installSkill, listSkills, readSkill } from '../../data/skills';

type SkillTab = 'built-in' | 'mine' | 'market';

const SKILL_MARKETS = [
  {
    name: 'Hermes Agent Skills',
    host: 'hermesagent.org.cn',
    url: 'https://hermesagent.org.cn/skills',
    summary: 'Hermes Agent 官方中文技能目录与内置技能速查。',
    detail: '适合查看 Hermes 内置技能分类、用途说明和上游生态资源。',
  },
  {
    name: 'SkillHub',
    host: 'skillhub.cn',
    url: 'https://www.skillhub.cn/',
    summary: '中文 AI Skill 社区，提供精选、分类与趋势内容。',
    detail: '适合按办公、开发、内容和自动化场景浏览中文技能。',
  },
  {
    name: 'SkillsMP',
    host: 'skillsmp.com',
    url: 'https://skillsmp.com/zh',
    summary: '中文 Agent Skills 市场，支持搜索和分类浏览。',
    detail: '可按职业、用途和作者筛选，适合从具体工作目标反查技能。',
  },
  {
    name: 'Skills.sh',
    host: 'skills.sh',
    url: 'https://skills.sh/',
    summary: '开放 Agent Skills 生态目录，聚合热门与趋势技能。',
    detail: '适合开发工具、自动化和通用 Agent 工作流的技能发现。',
  },
  {
    name: 'Anthropic Skills',
    host: 'github.com/anthropics/skills',
    url: 'https://github.com/anthropics/skills',
    summary: 'Agent Skills 的官方开源示例与规范实现。',
    detail: '适合查看技能目录结构、SKILL.md 写法和可复用参考实现。',
  },
];

export default function SkillLibraryView() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [tab, setTab] = useState<SkillTab>('built-in');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [installUrl, setInstallUrl] = useState('');
  const [installing, setInstalling] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try { setSkills(await listSkills()); }
    catch (e) { setError(e instanceof Error ? e.message : '技能扫描失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const builtInCount = skills.filter((skill) => skill.scope !== 'mine').length;
  const mineCount = skills.filter((skill) => skill.scope === 'mine').length;
  const visibleSkills = useMemo(() => {
    if (tab === 'market') return [];
    const scoped = skills.filter((skill) => tab === 'mine' ? skill.scope === 'mine' : skill.scope !== 'mine');
    const needle = query.trim().toLowerCase();
    return needle ? scoped.filter((skill) => `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(needle)) : scoped;
  }, [skills, query, tab]);

  const toggle = async (skill: Skill) => {
    if (expanded === skill.id) { setExpanded(null); setBody(''); return; }
    setExpanded(skill.id);
    setBody('');
    try { setBody((await readSkill(skill.id)).content); }
    catch (e) { setBody(e instanceof Error ? e.message : '读取失败'); }
  };

  const confirmDelete = async (skill: Skill) => {
    if (deleting !== skill.id) { setDeleting(skill.id); return; }
    try {
      await deleteSkill(skill.id);
      if (expanded === skill.id) { setExpanded(null); setBody(''); }
      setSkills((prev) => prev.filter((item) => item.id !== skill.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally { setDeleting(null); }
  };

  const handleInstall = async () => {
    if (!installUrl.trim()) { setError('请填写 SKILL.md 或 GitHub 仓库地址'); return; }
    setInstalling(true);
    setError('');
    setNotice('');
    try {
      const installed = await installSkill(installUrl.trim());
      setInstallUrl('');
      await refresh();
      setTab('mine');
      setNotice(`已安装 ${installed.name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '技能安装失败');
    } finally { setInstalling(false); }
  };

  const openMarket = async (url: string) => {
    const result = await window.electronAPI?.openExternal?.(url);
    if (result && !result.ok) setError(result.error ?? '无法打开外部网站');
    else if (!window.electronAPI) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="skill-library-view">
      <header className="skill-library-page-head">
        <div>
          <h2>技能</h2>
          <span>{skills.length} 个已安装</span>
        </div>
        <button className="btn btn-sm" onClick={() => void refresh()} disabled={loading} title="刷新技能">
          <ReloadOutlined />
        </button>
      </header>

      <nav className="skill-library-tabs" aria-label="技能分类">
        <button className={tab === 'built-in' ? 'active' : ''} onClick={() => setTab('built-in')}>内置 Skill <span>{builtInCount}</span></button>
        <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>我的 Skill <span>{mineCount}</span></button>
        <button className={tab === 'market' ? 'active' : ''} onClick={() => setTab('market')}>Skill 商城</button>
      </nav>

      {(tab === 'mine' || tab === 'market') && (
        <div className="skill-install-bar">
          <DownloadOutlined />
          <input value={installUrl} onChange={(event) => setInstallUrl(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void handleInstall()} placeholder="SKILL.md 或 GitHub 仓库地址" />
          <button className="btn btn-sm btn-primary" onClick={() => void handleInstall()} disabled={installing}>{installing ? '安装中' : '一键安装'}</button>
        </div>
      )}

      {error && <div className="error-banner">{error}<button onClick={() => setError('')}>×</button></div>}
      {notice && <div className="skill-success-banner">{notice}<button onClick={() => setNotice('')}>×</button></div>}

      {tab === 'market' ? (
        <div className="skill-market-grid">
          {SKILL_MARKETS.map((market) => (
            <article className="skill-market-card" key={market.url}>
              <div className="skill-market-title"><strong>{market.name}</strong><code>{market.host}</code></div>
              <h3>{market.summary}</h3>
              <p>{market.detail}</p>
              <button onClick={() => void openMarket(market.url)}>打开 {market.name} <ExportOutlined /></button>
            </article>
          ))}
        </div>
      ) : (
        <>
          <label className="skill-library-search">
            <SearchOutlined />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索技能" />
          </label>
          {!loading && visibleSkills.length === 0 && <div className="skill-library-empty">{query ? '没有匹配的技能' : tab === 'mine' ? '暂无我的 Skill' : '暂无内置 Skill'}</div>}
          <div className="skill-grid">
            {visibleSkills.map((skill) => (
              <React.Fragment key={skill.id}>
                <div className={`skill-grid-card ${expanded === skill.id ? 'skill-grid-card--open' : ''}`}>
                  {skill.scope === 'mine' && <button className="skill-grid-card-actions" onClick={() => void confirmDelete(skill)} title={deleting === skill.id ? '再次点击确认删除' : '删除技能'}><DeleteOutlined />{deleting === skill.id && <span>确认</span>}</button>}
                  <button className="skill-grid-card-main" onClick={() => void toggle(skill)}>
                    <div className="skill-grid-card-icon">S</div>
                    <div className="skill-grid-card-name">{skill.name}</div>
                    <div className="skill-grid-card-desc">{skill.description || '暂无说明'}</div>
                    <div className="skill-grid-card-meta">{skill.source}{skill.version ? ` · v${skill.version}` : ''}</div>
                  </button>
                </div>
                {expanded === skill.id && <div className="skill-grid-detail"><pre className="skill-grid-detail-body">{body || '加载中…'}</pre></div>}
              </React.Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
