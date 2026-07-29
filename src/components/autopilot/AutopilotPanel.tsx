import { useState, useRef, useEffect } from 'react';
import { Switch, Button, Input, Space } from 'antd';
import { useStore } from '../../storeContext';
import { recommendProjects, type ProjectPlan, type AutopilotContext } from '../../engine/autopilot';
import { loadSettings, saveSettings } from '../../data/hermesClient';

interface LogLine { kind: 'phase' | 'thought' | 'tool' | 'obs' | 'msg' | 'err'; text: string; }

export default function AutopilotPanel() {
  const { state, createProjectDraft, approveProject, archiveProject, openTeamChat } = useStore();
  const [recos, setRecos] = useState<ProjectPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [running] = useState(false);
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
        setTimeout(() => proposeProject(list[0]), 600);
      }
    } catch (e: any) {
      push('err', `推荐失败：${e?.message ?? '未知错误'}`);
    } finally {
      setLoading(false);
    }
  };

  const proposeProject = (plan: ProjectPlan) => {
    createProjectDraft({ title: plan.title, request: plan.steps.join('\n') || plan.title, steps: plan.steps, expectedOutputs: plan.expectedOutputs });
    push('phase', `已生成项目草案「${plan.title}」，等待你批准后才会创建团队并调用成员。`);
    setRecos([]);
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
    proposeProject(plan);
  };

  const toggleAuto = () => {
    const next = !autoPilot;
    setAutoPilot(next);
    const s = loadSettings();
    saveSettings({ ...s, autoPilot: next });
  };

  const exportZip = async () => {
    if (!workspace) return;
    push('phase', '📦 正在打包工作区为 zip…');
    try {
      const res = await window.electronAPI?.fsExportZip();
      if (res?.ok && res.path) {
        push('msg', `✅ 已导出到：${res.path}`);
        await window.electronAPI?.openPath(res.path);
      } else {
        push('err', `导出失败：${res?.error ?? '未知错误'}`);
      }
    } catch (e: any) {
      push('err', `导出失败：${e?.message ?? '未知错误'}`);
    }
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
        <label className="autopilot-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <Switch checked={autoPilot} onChange={toggleAuto} disabled={running} />
          <span>🚀 自主模式（推荐后自动执行）</span>
        </label>
      </div>

      {/* 控制区 */}
      <div className="autopilot-controls">
        <Button type="primary" onClick={doRecommend} loading={loading} disabled={running}>
          ✨ 让 AI 推荐项目
        </Button>
        <Space.Compact style={{ flex: 1, minWidth: 240 }}>
          <Input
            value={customGoal}
            onChange={(e) => setCustomGoal(e.target.value)}
            onPressEnter={runCustom}
            placeholder="或直接使用我的需求，例如：做一个计算房贷的网页小工具"
            disabled={running}
          />
          <Button onClick={runCustom} disabled={running || !customGoal.trim()}>▶ 执行</Button>
        </Space.Compact>
        {running && (
          <Button danger onClick={() => { stopRef.current = true; push('phase', '⛔ 正在停止…'); }} title="停止当前自主执行">
            🛑 停止
          </Button>
        )}
        {workspace && (
          <>
            <Button size="small" onClick={exportZip} disabled={running} title="把工作区打包成 zip，方便交付">📦 导出工作区</Button>
            <Button size="small" onClick={() => window.electronAPI?.openPath(workspace)} title={workspace}>
              📂 打开工作区
            </Button>
          </>
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
                <Button size="small" type="primary" onClick={() => proposeProject(p)}>📌 创建项目草案</Button>
                <Button size="small" onClick={() => { setCustomGoal(p.title); }}>📝 改成我的需求</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {state.projects.length > 0 && (
        <div className="autopilot-recos" style={{ marginTop: 14 }}>
          {state.projects.slice().reverse().map((project) => {
            const members = project.members.map((member) => {
              const employee = state.employees.find((item) => item.id === member.employeeId);
              return `${employee?.name ?? '已删除成员'}：${member.reason}`;
            });
            return <div className="autopilot-card" key={project.id}>
              <div className="autopilot-card-title">{project.title} <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{project.status === 'awaiting_approval' ? '待批准' : project.status === 'running' ? '执行中' : project.status === 'archived' ? '已归档' : project.status}</span></div>
              <div className="autopilot-card-rationale">{project.request}</div>
              <div className="autopilot-card-out">成员选择：{members.join('；') || '未找到在线成员'}</div>
              {project.steps.length > 0 && <ol className="autopilot-card-steps">{project.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
              <div className="autopilot-card-actions">
                {project.status === 'awaiting_approval' && <Button size="small" type="primary" disabled={!project.members.length} onClick={() => approveProject(project.id)}>批准并组建团队</Button>}
                {project.teamId && <Button size="small" onClick={() => openTeamChat(project.teamId!)}>打开项目团队</Button>}
                {project.status !== 'archived' && <Button size="small" onClick={() => archiveProject(project.id)}>归档</Button>}
              </div>
            </div>;
          })}
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
