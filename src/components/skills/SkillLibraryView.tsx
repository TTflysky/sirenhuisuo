import React, { useEffect, useMemo, useState } from 'react';
import { DeleteOutlined, DownloadOutlined, ExportOutlined, ReloadOutlined, RollbackOutlined, SearchOutlined } from '@ant-design/icons';
import type { Skill } from '../../types';
import { deleteSkill, inspectSkillSource, installSkill, listSkills, readSkill, repairSkill } from '../../data/skills';
import type { SkillCandidate, SkillDraft, SkillRollout, SkillSourceInspection } from '../../electron';

type SkillTab = 'built-in' | 'mine' | 'drafts' | 'market';

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
  const [inspection, setInspection] = useState<SkillSourceInspection | null>(null);
  const [repairing, setRepairing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<SkillDraft[]>([]);
  const [candidates, setCandidates] = useState<SkillCandidate[]>([]);
  const [rollouts, setRollouts] = useState<SkillRollout[]>([]);
  const [reviewingDraft, setReviewingDraft] = useState<string | null>(null);
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const [installed, draftResult, lifecycleResult] = await Promise.all([listSkills(), window.electronAPI?.skillDrafts?.(), window.electronAPI?.skillLifecycle?.()]);
      setSkills(installed);
      if (draftResult?.ok) setDrafts(draftResult.drafts ?? []);
      if (lifecycleResult?.ok) {
        setCandidates(lifecycleResult.candidates ?? []);
        setRollouts(lifecycleResult.rollouts ?? []);
      }
    }
    catch (e) { setError(e instanceof Error ? e.message : '技能扫描失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const builtInCount = skills.filter((skill) => skill.scope !== 'mine').length;
  const mineCount = skills.filter((skill) => skill.scope === 'mine').length;
  const visibleSkills = useMemo(() => {
    if (tab === 'market' || tab === 'drafts') return [];
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
      if (!inspection) {
        const checked = await inspectSkillSource(installUrl.trim());
        setInspection(checked);
        setNotice('来源检查完成，请确认要求后安装。');
        return;
      }
      const installed = await installSkill(installUrl.trim());
      setInstallUrl('');
      setInspection(null);
      await refresh();
      setTab('mine');
      setNotice(`已安装 ${installed.name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '技能安装失败');
    } finally { setInstalling(false); }
  };

  const handleRepair = async (skill: Skill) => {
    setRepairing(skill.id);
    setError('');
    try {
      await repairSkill(skill.id);
      await refresh();
      setNotice(`${skill.name} 已从记录的来源重新安装并检查`);
    } catch (e) { setError(e instanceof Error ? e.message : '技能修复失败'); }
    finally { setRepairing(null); }
  };

  const openMarket = async (url: string) => {
    const result = await window.electronAPI?.openExternal?.(url);
    if (result && !result.ok) setError(result.error ?? '无法打开外部网站');
    else if (!window.electronAPI) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const reviewDraft = async (draft: SkillDraft, decision: 'approve' | 'reject') => {
    setReviewingDraft(draft.id);
    setError('');
    try {
      const result = await window.electronAPI?.reviewSkillDraft?.({ draftId: draft.id, decision });
      if (!result?.ok) throw new Error(result?.error || 'Skill 草案审核失败');
      setNotice(decision === 'approve' ? `${draft.name} 已通过校验并安装` : `${draft.name} 草案已拒绝`);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Skill 草案审核失败'); }
    finally { setReviewingDraft(null); }
  };

  const rollbackSkill = async (skill: Skill) => {
    setRollingBack(skill.id);
    setError('');
    try {
      const result = await window.electronAPI?.rollbackAutoSkill?.({ skillId: skill.id });
      if (!result?.ok) throw new Error(result?.error || '自动 Skill 回滚失败');
      setNotice(`${skill.name} 已回滚到上一份通过审批的版本`);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '自动 Skill 回滚失败'); }
    finally { setRollingBack(null); }
  };

  const rolloutFor = (skill: Skill) => rollouts.find((item) => item.skillName.toLocaleLowerCase() === skill.name.toLocaleLowerCase());
  const pendingDrafts = drafts.filter((draft) => draft.status === 'pending');
  const collectingCandidates = candidates.filter((candidate) => ['collecting', 'eligible', 'validation_failed'].includes(candidate.status));

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
        <button className={tab === 'drafts' ? 'active' : ''} onClick={() => setTab('drafts')}>学习与审批 <span>{pendingDrafts.length + collectingCandidates.length}</span></button>
        <button className={tab === 'market' ? 'active' : ''} onClick={() => setTab('market')}>Skill 商城</button>
      </nav>

      {(tab === 'mine' || tab === 'market') && (
        <div className="skill-install-bar">
          <DownloadOutlined />
          <input value={installUrl} onChange={(event) => { setInstallUrl(event.target.value); setInspection(null); }} onKeyDown={(event) => event.key === 'Enter' && void handleInstall()} placeholder="SKILL.md 或 GitHub 仓库地址" />
          <button className="btn btn-sm btn-primary" onClick={() => void handleInstall()} disabled={installing}>{installing ? '处理中' : inspection ? '确认安装' : '检查要求'}</button>
        </div>
      )}

      {inspection && <div className="skill-install-inspection">
        <div><strong>{inspection.name}</strong><span>{inspection.installMode === 'directory' ? '完整目录' : inspection.installMode === 'zip' ? 'ZIP 技能包' : '单文件安装'}</span></div>
        {inspection.description && <p>{inspection.description}</p>}
        <dl>
          <div><dt>环境变量</dt><dd>{inspection.requirements.environmentVariables.join('、') || '无明确要求'}</dd></div>
          <div><dt>外部软件</dt><dd>{inspection.requirements.externalSoftware.join('、') || '无明确要求'}</dd></div>
          <div><dt>账号授权</dt><dd>{inspection.requirements.accountRequired ? '需要' : '未声明'}</dd></div>
        </dl>
      </div>}

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
      ) : tab === 'drafts' ? (
        <div className="skill-learning-view">
          {pendingDrafts.length === 0 && collectingCandidates.length === 0 && <div className="skill-library-empty">暂无候选或待审核草案。单次任务不会直接生成 Skill；至少两个独立任务通过真实验收后才会进入审批。</div>}
          {pendingDrafts.map((draft) => {
            const open = expandedDraft === draft.id;
            return <article className={`skill-review-card${open ? ' is-open' : ''}`} key={draft.id}>
              <button className="skill-review-card-head" onClick={() => setExpandedDraft(open ? null : draft.id)}>
                <span className={`skill-risk-badge is-${draft.risk ?? 'low'}`}>{draft.risk === 'high' ? '高风险' : draft.risk === 'medium' ? '中风险' : '低风险'}</span>
                <span><strong>{draft.name}</strong><small>{draft.reason || draft.description || '跨任务复盘生成的待审核 Skill'}</small></span>
                <span className="skill-review-card-count">{draft.taskIds?.length ?? 0} 个来源任务</span>
              </button>
              {open && <div className="skill-review-detail">
                <dl className="skill-review-facts">
                  <div><dt>动作</dt><dd>{draft.action === 'create' ? '新建自动 Skill' : draft.action === 'replace' ? `替换 ${draft.targetSkillName}` : `精确更新 ${draft.targetSkillName}`}</dd></div>
                  <div><dt>工具路线</dt><dd>{draft.route?.join(' → ') || '未记录'}</dd></div>
                  <div><dt>权限</dt><dd>{draft.permissions?.join('、') || '无需额外权限'}</dd></div>
                  <div><dt>灰度</dt><dd>前 {draft.rollout?.targetInvocations ?? 5} 次调用，失败 {draft.rollout?.failureLimit ?? 2} 次自动停用</dd></div>
                </dl>
                <section><h4>来源任务与证据</h4><p>{draft.taskIds?.join('、') || '无任务 ID'}</p><p>{draft.evidenceIds?.join('、') || '没有独立证据 ID'}</p></section>
                <section><h4>验证报告</h4><div className="skill-validation-list">{draft.validation?.checks.map((check) => <span className={check.status === 'passed' ? 'passed' : 'failed'} key={check.id}><b>{check.status === 'passed' ? '通过' : '失败'}</b>{check.label}<small>{check.message}</small></span>)}</div></section>
                <section><h4>Skill 正文</h4><pre>{draft.content || '没有正文'}</pre></section>
                <section><h4>变更 Diff</h4><pre>{draft.diff || '没有 Diff'}</pre></section>
                <div className="skill-review-actions"><button className="btn btn-sm btn-primary" disabled={reviewingDraft === draft.id || draft.validation?.passed === false} onClick={() => void reviewDraft(draft, 'approve')}>批准并灰度启用</button><button className="btn btn-sm" disabled={reviewingDraft === draft.id} onClick={() => void reviewDraft(draft, 'reject')}>拒绝</button></div>
              </div>}
            </article>;
          })}
          {collectingCandidates.length > 0 && <section className="skill-candidate-section"><h3>仍在积累证据</h3>{collectingCandidates.map((candidate) => <div className="skill-candidate-row" key={candidate.candidateId}>
            <span><strong>{candidate.name}</strong><small>{candidate.status === 'validation_failed' ? '编译验证未通过' : candidate.eligibility?.reasons.join('；') || '等待更多独立任务'}</small></span>
            <span>{candidate.independentTaskCount}/{2} 个任务</span><span>成功率 {Math.round(candidate.successRate * 100)}%</span><span>路线相似度 {Math.round(candidate.routeSimilarity * 100)}%</span>
          </div>)}</section>}
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
                  {skill.scope === 'mine' && <div className="skill-grid-card-actions">
                    {skill.origin === 'auto' && <button onClick={() => void rollbackSkill(skill)} title="回滚自动 Skill" disabled={rollingBack === skill.id}><RollbackOutlined />{rollingBack === skill.id && <span>回滚中</span>}</button>}
                    {(skill.health === 'broken' || skill.health === 'limited') && <button onClick={() => void handleRepair(skill)} title="从原来源重新安装" disabled={repairing === skill.id}><ReloadOutlined />{repairing === skill.id && <span>修复中</span>}</button>}
                    <button onClick={() => void confirmDelete(skill)} title={deleting === skill.id ? '再次点击确认删除' : '删除技能'}><DeleteOutlined />{deleting === skill.id && <span>确认</span>}</button>
                  </div>}
                  <button className="skill-grid-card-main" onClick={() => void toggle(skill)}>
                    <div className="skill-grid-card-icon">S</div>
                    <div className="skill-grid-card-name">{skill.name}</div>
                    <div className="skill-grid-card-desc">{skill.description || '暂无说明'}</div>
                    <div className="skill-grid-card-meta">{skill.source}{skill.version ? ` · v${skill.version}` : ''}</div>
                    {skill.origin === 'auto' && <div className={`skill-grid-card-warning health-${rolloutFor(skill)?.status === 'disabled' ? 'broken' : 'setup'}`}>{rolloutFor(skill)?.status === 'canary' ? `灰度 ${rolloutFor(skill)?.successes ?? 0}/${rolloutFor(skill)?.targetInvocations ?? 5}` : rolloutFor(skill)?.status === 'disabled' ? '灰度失败已停用' : rolloutFor(skill)?.status === 'active' ? '灰度通过' : '自动 Skill'}</div>}
                    {skill.health && skill.health !== 'ready' && <div className={`skill-grid-card-warning health-${skill.health}`} title={skill.healthMessage}>{skill.health === 'broken' ? '已隔离' : skill.health === 'limited' ? '不完整' : '需配置'}</div>}
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
