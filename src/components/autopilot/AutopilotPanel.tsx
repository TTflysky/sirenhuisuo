import { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store';
import {
  recommendProjects, runAutopilot,
  type ProjectPlan, type AutopilotContext,
} from '../../engine/autopilot';
import { loadSettings, saveSettings } from '../../data/hermesClient';

interface LogLine { kind: 'phase' | 'thought' | 'tool' | 'obs' | 'msg' | 'err'; text: string; }

export default function AutopilotPanel() {
  const { state } = useStore();
  const [recos, setRecos] = useState<ProjectPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [customGoal, setCustomGoal] = useState('');
  const [autoPilot, setAutoPilot] = useState<boolean>(() => loadSettings().autoPilot ?? false);
  const [workspace, setWorkspace] = useState<string>('');
  const [log, setLog] = useState<LogLine[]>([]);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const stopRef = useRef(false);

  useEffect(() => { window.electronAPI?.getWorkspace?.().then((p: string) => setWorkspace(p)).catch(() => {}); }, []);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [log]);

  const buildContext = (): AutopilotContext => ({
    teams: state.teams.map((t) => ({
      name: t.name,
      members: t.memberIds.map((id) => state.employees.find((e) => e.id === id)?.name ?? id),
      openTasks: (t.tasks ?? []).filter((tk) => tk.lane !== 'DONE').map((tk) => tk.title),
    })),
    backendOnline: state.status.backendOnline,
    model: loadSettings().model,
  });

  const push = (kind: LogLine['kind'], text: string) => setLog((l) => [...l, { kind, text }]);

  const doRecommend = async () => {
    setLoading(true);
    setRecos([]);
    push('phase', '💡 正在分析你的画像与办公室现状，推荐可做项目…');
    try {
      const list = await recommendProjects(buildContext());
      setRecos(list);
      if (list.length === 0) push('err', '未获得推荐（可能未配置模型或模型未返回 JSON）。');
      else push('phase', `✨ 推荐了 ${list.length} 个项目：`);
      // 自主模式：自动执行第一个
      if (autoPilot && list.length > 0) {
        setTimeout(() => runProject(list[0]), 600);
      }
    } catch (e: any) {
      push('err', `推荐失败：${e?.message ?? '未知错误'}`);
    } finally {
      setLoading(false);
    }
  };

  const runProject = async (plan: ProjectPlan) => {
    if (running) return;
    stopRef.current = false;
    setRunning(true);
    setLog([]);
    setRecos([]);
    try {
      await runAutopilot(plan, {
        onPhase: (t) => push('phase', t),
        onThought: (t) => push('thought', t),
        onToolCall: (name, args) => push('tool', `🔧 ${name}(${args.slice(0, 160)})`),
        onObservation: (t) => push('obs', t),
        onMessage: (t) => push('msg', t),
        onDone: (t) => push('msg', `【总结】\n${t}`),
        onError: (t) => push('err', t),
        shouldStop: () => stopRef.current,
      });
    } finally {
      setRunning(false);
    }
  };

  const runCustom = () => {
    const goal = customGoal.trim();
    if (!goal) return;
    const plan: ProjectPlan = {
      title: goal.slice(0, 40),
      rationale: '用户直接下达的需求',
      steps: [goal],
      expectedOutputs: ['按需求产出'],
    };
    runProject(plan);
  };

  const toggleAuto = () => {
    const next = !autoPilot;
    setAutoPilot(next);
    const s = loadSettings();
    saveSettings({ ...s, autoPilot: next });
  };

  return (
    <div className="autopilot">
      <div className="autopilot-head">
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>🤖 自主办公</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            AI 团队基于你的画像与现状自主思考、推荐项目，并自动写代码 / 跑命令 / 验证，直到完成。
          </p>
        </div>
        <label className="autopilot-toggle">
          <input type="checkbox" checked={autoPilot} onChange={toggleAuto} disabled={running} />
          <span>🚀 自主模式（推荐后自动执行）</span>
        </label>
      </div>

      {/* 控制区 */}
      <div className="autopilot-controls">
        <button className="btn btn-primary" onClick={doRecommend} disabled={loading || running}>
          {loading ? '分析中…' : '✨ 让 AI 推荐项目'}
        </button>
        <div className="autopilot-custom">
          <input
            className="form-input"
            value={customGoal}
            onChange={(e) => setCustomGoal(e.target.value)}
            placeholder="或直接使用我的需求，例如：做一个计算房贷的网页小工具"
            disabled={running}
            onKeyDown={(e) => { if (e.key === 'Enter') runCustom(); }}
          />
          <button className="btn" onClick={runCustom} disabled={running || !customGoal.trim()}>▶ 执行</button>
        </div>
        {workspace && (
          <button className="btn btn-sm" onClick={() => window.electronAPI?.openPath(workspace)} title={workspace}>
            📂 打开工作区
          </button>
        )}
      </div>

      {/* 推荐项目卡片 */}
      {recos.length > 0 && !running && (
        <div className="autopilot-recos">
          {recos.map((p, i) => (
            <div className="autopilot-card" key={i}>
              <div className="autopilot-card-title">{p.title}</div>
              {p.rationale && <div className="autopilot-card-rationale">{p.rationale}</div>}
              {p.steps.length > 0 && (
                <ol className="autopilot-card-steps">
                  {p.steps.map((s, j) => <li key={j}>{s}</li>)}
                </ol>
              )}
              {p.expectedOutputs.length > 0 && (
                <div className="autopilot-card-out">预期产出：{p.expectedOutputs.join('、')}</div>
              )}
              <div className="autopilot-card-actions">
                <button className="btn btn-sm btn-primary" onClick={() => runProject(p)}>🚀 执行</button>
                <button className="btn btn-sm" onClick={() => { setCustomGoal(p.title); }}>📝 改成我的需求</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 执行日志 */}
      {(running || log.length > 0) && (
        <div className="autopilot-log">
          <div className="autopilot-log-head">
            <span>执行日志</span>
            {running && <span className="progress-spinner" style={{ marginLeft: 8 }} />}
          </div>
          <div className="autopilot-log-body">
            {log.map((l, i) => (
              <div key={i} className={`autopilot-log-line autopilot-${l.kind}`}>{l.text}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
