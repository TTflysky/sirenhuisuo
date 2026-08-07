import { useEffect, useState } from 'react';
import { Button, Select, Spin, Tag } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined, DownloadOutlined, ExperimentOutlined, PlayCircleOutlined, ReloadOutlined, RobotOutlined, StopOutlined, ThunderboltOutlined, WarningOutlined } from '@ant-design/icons';
import type { AutonomyEvaluationMetric, AutonomyEvaluationSummary, OperationDiagnosticEntry, RuntimeDashboard, RuntimeTelemetryEvent } from '../../electron';
import { runSystemDiagnostics, type SystemDiagnosticItem, type SystemDiagnosticReport } from '../../diagnostics/systemDiagnostics';
import { optimizeSystemDiagnostics, type DiagnosticOptimizationResult } from '../../diagnostics/diagnosticOptimizer';
import { getModelCapabilities, loadSettings, saveSettings } from '../../data/hermesClient';
import type { UpdateStatus } from '../../electron.d';
import { APP_VERSION } from '../../appVersion';
import { createUpgradeSnapshot } from '../../utils/configSync';

type TargetTab = NonNullable<SystemDiagnosticItem['settingsTab']>;

const capabilityLabels: Record<string, string> = {
  chat_model: '聊天模型', image_generation: '图片生成', web_page: '指定网页', skillhub: 'SkillHub',
  knowledge_base: '知识库', email: '邮件', github: 'GitHub', generic_http: 'HTTP', mcp: 'MCP',
};
const capabilityStateLabels: Record<string, { label: string; color: string }> = {
  available: { label: '真实可用', color: 'green' }, missing_config: { label: '缺配置', color: 'default' },
  not_tested: { label: '未测试', color: 'gold' }, authentication_failed: { label: '鉴权失败', color: 'red' },
  rate_limited: { label: '被限流', color: 'orange' }, protocol_error: { label: '协议错误', color: 'red' },
  invalid_content: { label: '内容无效', color: 'red' }, unavailable: { label: '不可用', color: 'red' },
};
const autonomyMetricLabels: Array<{ key: string; label: string; inverse?: boolean }> = [
  { key: 'completionRate', label: '完成率' },
  { key: 'misexecutionRate', label: '误执行率', inverse: true },
  { key: 'recoveryRate', label: '恢复率' },
  { key: 'memoryHitCorrectness', label: '记忆命中正确率' },
  { key: 'crossProjectContaminationRate', label: '跨项目污染率', inverse: true },
  { key: 'skillReuseSuccessRate', label: 'Skill 复用成功率' },
  { key: 'unnecessaryToolCalls', label: '无必要工具调用' },
];
const autonomyStatus = (status?: string) => status === 'passed' ? { label: '通过', color: 'green' }
  : status === 'failed' ? { label: '失败', color: 'red' }
    : status === 'blocked' ? { label: '阻塞', color: 'gold' } : { label: '待观察', color: 'default' };
const formatAutonomyMetric = (metric?: AutonomyEvaluationMetric, inverse = false) => {
  if (!metric) return '样本不足';
  if (typeof metric.total === 'number') return metric.toolCalls ? `${metric.total} 次 · 每百次 ${metric.perHundredCalls ?? 0}` : `${metric.total} 次`;
  if (!metric.denominator) return '样本不足';
  const value = typeof metric.percent === 'number' ? `${metric.percent}%` : '样本不足';
  return `${value} · ${metric.numerator ?? 0}/${metric.denominator}${inverse ? '' : ''}`;
};
const formatAutonomyDuration = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
};
const formatAutonomyAgo = (timestamp: number | undefined, now: number) => {
  if (!timestamp) return '尚未采集';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  return seconds < 2 ? '刚刚' : `${seconds} 秒前`;
};

export default function DiagnosticsTab({ onNavigate }: { onNavigate: (tab: TargetTab) => void }) {
  const [report, setReport] = useState<SystemDiagnosticReport>();
  const [running, setRunning] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimization, setOptimization] = useState<DiagnosticOptimizationResult>();
  const [settings, setSettings] = useState(() => loadSettings());
  const [error, setError] = useState('');
  const [operationSummary, setOperationSummary] = useState<{ total: number; errors: number; recoverable: number; latest: OperationDiagnosticEntry[] }>();
  const [runtimeDashboard, setRuntimeDashboard] = useState<RuntimeDashboard>();
  const [telemetryBusy, setTelemetryBusy] = useState(false);
  const [telemetryExporting, setTelemetryExporting] = useState(false);
  const [autonomySummary, setAutonomySummary] = useState<AutonomyEvaluationSummary>();
  const [autonomyBusy, setAutonomyBusy] = useState(false);
  const [autonomyNow, setAutonomyNow] = useState(() => Date.now());
  const [exporting, setExporting] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle', message: '点击检查更新' });

  const run = async () => {
    setRunning(true);
    setError('');
    try {
      const [systemReport, diagnostics, autonomy, telemetry] = await Promise.all([
        runSystemDiagnostics(),
        window.electronAPI?.diagnosticsSummary?.() ?? Promise.resolve(undefined),
        window.electronAPI?.autonomyEvaluationSummary?.() ?? Promise.resolve(undefined),
        window.electronAPI?.telemetryDashboard?.() ?? Promise.resolve(undefined),
      ]);
      setReport(systemReport);
      if (diagnostics?.ok) setOperationSummary(diagnostics);
      if (autonomy?.ok) setAutonomySummary(autonomy);
      if (telemetry?.ok) setRuntimeDashboard(telemetry);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setRunning(false); }
  };
  const refreshTelemetry = async () => {
    setTelemetryBusy(true);
    try {
      const result = await window.electronAPI?.telemetryDashboard?.();
      if (!result?.ok) setError(result?.error || '读取运行监控失败');
      else setRuntimeDashboard(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setTelemetryBusy(false); }
  };
  const exportTelemetry = async () => {
    setTelemetryExporting(true);
    try {
      const result = await window.electronAPI?.telemetryExport?.();
      if (result && !result.ok) setError(result.error || '导出运行问题包失败');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setTelemetryExporting(false); }
  };
  const exportDiagnostics = async () => {
    setExporting(true);
    try {
      const result = await window.electronAPI?.diagnosticsExport?.();
      if (result && !result.ok) setError(result.error || '导出失败');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setExporting(false); }
  };
  const refreshAutonomy = async () => {
    setAutonomyBusy(true);
    try {
      const result = await window.electronAPI?.autonomyEvaluationSummary?.();
      if (!result?.ok) setError(result?.error || '读取陪跑评测失败');
      else {
        setAutonomySummary(result);
        setAutonomyNow(Date.now());
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setAutonomyBusy(false); }
  };
  const startAutonomy = async () => {
    setAutonomyBusy(true);
    try {
      const result = await window.electronAPI?.autonomyEvaluationStart?.({ label: `V5.8 陪跑 ${new Date().toLocaleString('zh-CN')}`, targetMinutes: 480 });
      const summary = result?.summary ?? result;
      if (!summary?.ok) setError(summary?.error || '启动陪跑失败');
      else {
        setAutonomySummary(summary);
        setAutonomyNow(Date.now());
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setAutonomyBusy(false); }
  };
  const completeAutonomy = async () => {
    setAutonomyBusy(true);
    try {
      const result = await window.electronAPI?.autonomyEvaluationComplete?.({ sessionId: autonomySummary?.activeSession?.sessionId });
      const summary = result?.summary ?? result;
      if (!summary?.ok) setError(summary?.error || '结束陪跑失败');
      else {
        setAutonomySummary(summary);
        setAutonomyNow(Date.now());
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setAutonomyBusy(false); }
  };
  const exportAutonomy = async () => {
    setAutonomyBusy(true);
    try {
      const result = await window.electronAPI?.autonomyEvaluationExport?.();
      if (result && !result.ok) setError(result.error || '导出陪跑报告失败');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setAutonomyBusy(false); }
  };
  const runAutonomyBaseline = async () => {
    setAutonomyBusy(true);
    try {
      const result = await window.electronAPI?.autonomyEvaluationRunBaseline?.();
      const summary = result?.summary ?? result;
      if (!summary?.ok) setError(summary?.error || '内置自动验收失败');
      else {
        setAutonomySummary(summary);
        setAutonomyNow(Date.now());
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setAutonomyBusy(false); }
  };
  const selectDiagnosticModel = (modelId: string) => {
    const next = loadSettings();
    next.diagnosticModelId = modelId || undefined;
    saveSettings(next);
    setSettings(next);
    setOptimization(undefined);
  };
  const optimize = async () => {
    setOptimizing(true);
    setError('');
    setOptimization(undefined);
    try {
      const result = await optimizeSystemDiagnostics(report);
      setOptimization(result);
      setReport(result.report);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOptimizing(false);
    }
  };
  const handleUpdateControl = async () => {
    const api = window.electronAPI;
    if (!api) {
      setUpdateStatus({ status: 'error', message: '当前运行环境不支持自动更新，请使用桌面客户端' });
      return;
    }
    if (updateStatus.status === 'downloaded') {
      const result = await api.installUpdate(createUpgradeSnapshot());
      if (result && !result.ok) setUpdateStatus({ status: 'error', message: `更新前备份失败：${result.error ?? '未知错误'}` });
      return;
    }
    if (!['idle', 'not-available', 'error'].includes(updateStatus.status)) return;
    setUpdateStatus({ status: 'checking', message: '正在检查更新…' });
    const result = await api.checkUpdate();
    if (result && !result.ok) setUpdateStatus({ status: 'error', message: `检查更新失败：${result.error ?? '未知错误'}。点击这里重试。` });
  };
  useEffect(() => {
    void run();
    const api = window.electronAPI;
    if (!api) return undefined;
    let active = true;
    const currentStatus = api.getUpdateStatus?.();
    void currentStatus?.then((status) => {
      if (active && status) setUpdateStatus(status);
    }).catch(() => {});
    const unsubscribe = api.onUpdateStatus?.((status) => setUpdateStatus(status));
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const activeAutonomySession = autonomySummary?.activeSession;
  const selectedAutonomySession = activeAutonomySession ?? autonomySummary?.selectedSession ?? autonomySummary?.latestSession;
  useEffect(() => {
    if (!activeAutonomySession?.sessionId) return undefined;
    let active = true;
    const updateClock = () => setAutonomyNow(Date.now());
    const poll = async () => {
      try {
        const result = await window.electronAPI?.autonomyEvaluationSummary?.();
        if (active && result?.ok) {
          setAutonomySummary(result);
          updateClock();
        }
      } catch { /* The visible timer still proves the page is active; IPC errors are reported on manual refresh. */ }
    };
    updateClock();
    const clockTimer = window.setInterval(updateClock, 1000);
    const pollTimer = window.setInterval(() => { void poll(); }, 5000);
    return () => {
      active = false;
      window.clearInterval(clockTimer);
      window.clearInterval(pollTimer);
    };
  }, [activeAutonomySession?.sessionId]);

  useEffect(() => {
    const timer = window.setInterval(() => { void refreshTelemetry(); }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  return <div className="settings-content-page diagnostics-page">
    <header className="diagnostics-header">
      <div><h2>诊断中心</h2><span>一次检查模型、连接器、Skill、任务内核、记忆复盘、工作区和权限</span></div>
      <div className="diagnostics-header-actions">
        <Button icon={<ReloadOutlined />} onClick={() => void run()} disabled={running || optimizing}>重新检查</Button>
        <Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void exportDiagnostics()}>导出错误日志</Button>
      </div>
    </header>
    <section className={`diagnostics-update-panel update-${updateStatus.status}`}>
      <div className="diagnostics-update-copy">
        <div className="diagnostics-update-title"><ReloadOutlined className={updateStatus.status === 'checking' || updateStatus.status === 'downloading' ? 'is-spinning' : ''} /><div><strong>应用更新</strong><span>当前版本 v{APP_VERSION}{updateStatus.version ? ` · 目标版本 v${updateStatus.version}` : ''}</span></div></div>
        <small>{updateStatus.message}</small>
      </div>
      <div className="diagnostics-update-action">
        {updateStatus.status === 'downloading' && <span className="diagnostics-update-progress">{Math.round(updateStatus.percent ?? 0)}%</span>}
        <button
          type="button"
          className={`update-status update-${updateStatus.status}`}
          title={updateStatus.message}
          onClick={() => void handleUpdateControl()}
          disabled={['checking', 'available', 'downloading'].includes(updateStatus.status)}
        >
          <ReloadOutlined className={updateStatus.status === 'checking' || updateStatus.status === 'downloading' ? 'is-spinning' : ''} />
          {updateStatus.status === 'idle' && '检查更新'}
          {updateStatus.status === 'checking' && '检查更新…'}
          {updateStatus.status === 'available' && '正在下载'}
          {updateStatus.status === 'downloading' && '下载中'}
          {updateStatus.status === 'downloaded' && '重启安装更新'}
          {updateStatus.status === 'not-available' && '已是最新版 · 再检查'}
          {updateStatus.status === 'error' && '更新失败 · 重试'}
        </button>
      </div>
    </section>
    <section className="diagnostics-optimizer-bar">
      <RobotOutlined />
      <div><strong>诊断优化模型</strong><span>{settings.diagnosticModelId ? '已指定专用模型' : '尚未指定'}</span></div>
      <Select
        value={settings.diagnosticModelId}
        placeholder="选择模型"
        onChange={selectDiagnosticModel}
        options={(settings.modelLibrary ?? []).filter((model) => getModelCapabilities(model).includes('chat')).map((model) => ({ value: model.id, label: `${model.label} · ${model.model ?? '未填写模型名'}` }))}
      />
      <Button type="primary" icon={<ThunderboltOutlined />} loading={optimizing} disabled={running || !settings.diagnosticModelId} onClick={() => void optimize()}>一键诊断并优化</Button>
    </section>
    {running && !report && <div className="diagnostics-loading"><Spin /><span>正在逐项做真实检查…</span></div>}
    {error && <div className="error-banner">检查失败：{error}</div>}
    {operationSummary && <section className={`diagnostics-summary ${operationSummary.errors ? 'warning' : 'ready'}`}>
      <strong>操作错误日志</strong>
      <span>已记录 {operationSummary.total} 条，错误 {operationSummary.errors} 条，可恢复 {operationSummary.recoverable} 条</span>
      <small>所有窗口共用；导出后可直接发送给排查人员。</small>
      {operationSummary.latest.slice(0, 2).map((entry) => <div key={entry.id} className="diagnostic-log-preview"><Tag color={entry.recoverable ? 'gold' : 'red'}>{entry.failureClass}</Tag><span>{entry.operation}: {entry.message}</span></div>)}
    </section>}
    {runtimeDashboard && <section className="runtime-monitor-panel">
      <header>
        <div>
          <strong><ClockCircleOutlined /> 运行监控台</strong>
          <span>{runtimeDashboard.project ? `${runtimeDashboard.project.title} · ${runtimeDashboard.project.phase}` : '当前没有可观察的项目'}</span>
        </div>
        <div className="runtime-monitor-actions">
          <Button size="small" icon={<ReloadOutlined />} loading={telemetryBusy} onClick={() => void refreshTelemetry()}>刷新</Button>
          <Button size="small" icon={<DownloadOutlined />} loading={telemetryExporting} onClick={() => void exportTelemetry()}>导出问题包</Button>
        </div>
      </header>
      <div className="runtime-monitor-metrics">
        <article><span>正在执行</span><strong>{runtimeDashboard.counts.running}</strong><small>{runtimeDashboard.counts.queued} 项等待前置条件</small></article>
        <article className={runtimeDashboard.counts.waitingUser ? 'is-warning' : ''}><span>需要你决定</span><strong>{runtimeDashboard.approvals.length}</strong><small>{runtimeDashboard.waitingConditions.length} 项缺少有效审批</small></article>
        <article><span>步骤进度</span><strong>{runtimeDashboard.counts.completedSteps}/{runtimeDashboard.counts.totalSteps}</strong><small>{runtimeDashboard.counts.completed} 个任务完成</small></article>
        <article><span>交付证据</span><strong>{runtimeDashboard.counts.verifiedArtifacts}/{runtimeDashboard.counts.artifacts}</strong><small>已验证 / 全部产物</small></article>
      </div>
      {(runtimeDashboard.approvals.length > 0 || runtimeDashboard.waitingConditions.length > 0) && <div className="runtime-decision-zone">
        <div className="runtime-section-heading"><strong>需要你决定</strong><span>这里只展示真正需要人工处理的事项</span></div>
        {runtimeDashboard.approvals.map((approval) => <article className="runtime-decision-card" key={`${approval.taskId}-${approval.approvalId}`}>
          <WarningOutlined />
          <div><strong>{approval.title}</strong><p>{approval.reason}</p><span>{approval.requestedBy} · {approval.scope}</span></div>
        </article>)}
        {runtimeDashboard.waitingConditions.map((condition) => <article className="runtime-decision-card is-invalid" key={condition.taskId}>
          <CloseCircleOutlined />
          <div><strong>{condition.title}</strong><p>{condition.reason}</p><span>系统没有生成有效审批卡，不能要求你盲目点击继续</span></div>
        </article>)}
      </div>}
      <div className="runtime-active-work">
        <div className="runtime-section-heading"><strong>当前工作</strong><span>{runtimeDashboard.activeWork.length ? `${runtimeDashboard.activeWork.length} 位负责人正在产生结果` : '没有员工正在执行'}</span></div>
        {runtimeDashboard.activeWork.length ? runtimeDashboard.activeWork.map((work) => <article key={`${work.taskId}-${work.stepId}`}>
          <i />
          <div><strong>{work.actorName} · {work.title}</strong><p>{work.activity}</p></div>
          <time>{new Date(work.startedAt).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}</time>
        </article>) : <p className="runtime-empty-state">当前没有真实运行中的步骤。排队、暂停和等待依赖不会显示成“工作中”。</p>}
      </div>
      {runtimeDashboard.project?.lastMeaningfulAction && <div className="runtime-latest-action"><span>最近有效进展</span><strong>{runtimeDashboard.project.lastMeaningfulAction}</strong></div>}
      <details className="runtime-technical-details">
        <summary>技术详情 · {runtimeDashboard.technical.telemetryEvents} 条事件 · {runtimeDashboard.technical.errors} 个错误</summary>
        <div className="runtime-monitor-timeline">
          {runtimeDashboard.technical.latest.length ? runtimeDashboard.technical.latest.slice(0, 12).map((event: RuntimeTelemetryEvent) => <article key={event.eventId} className={`runtime-event runtime-event-${event.severity}`}>
            <time>{new Date(event.occurredAt).toLocaleTimeString('zh-CN', { hour12: false })}</time>
            <Tag color={event.severity === 'error' ? 'red' : event.severity === 'warning' ? 'gold' : 'blue'}>{event.type}</Tag>
            <div><strong>{event.public?.summary || '运行事件'}</strong><span>{[event.status, event.actorId, event.modelId, event.durationMs ? `${Math.round(event.durationMs)}ms` : undefined].filter(Boolean).join(' · ') || '已记录'}</span></div>
          </article>) : <p>尚无技术事件。</p>}
        </div>
      </details>
      <small className="runtime-monitor-notice">展示的是公开执行摘要和可审计证据，不包含模型隐藏推理、密钥或附件正文。</small>
    </section>}
    {autonomySummary && <section className="autonomy-evaluation-panel">
      <header>
        <div>
          <strong><ExperimentOutlined /> 自治陪跑评测</strong>
          <span>{activeAutonomySession ? `进行中 · ${formatAutonomyDuration(autonomyNow - activeAutonomySession.startedAt)} · 最近采集 ${formatAutonomyAgo(activeAutonomySession.lastCaptureAt ?? activeAutonomySession.updatedAt, autonomyNow)}` : selectedAutonomySession?.mode === 'automated' ? `内置自动验收已完成 · ${autonomySummary.coverage?.observed ?? 0}/${autonomySummary.coverage?.total ?? 24} 场景已覆盖` : autonomySummary.latestSession ? `最近一轮已结束 · ${autonomySummary.coverage?.observed ?? 0}/${autonomySummary.coverage?.total ?? 24} 场景已观察` : '尚未开始'}</span>
          {activeAutonomySession && <small className="autonomy-live-status"><i /> 自动采集运行中：每 5 秒读取本机任务、记忆和 Skill 账本，不需要创建专门测试任务。</small>}
        </div>
        <div className="autonomy-evaluation-actions">
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void refreshAutonomy()} loading={autonomyBusy}>刷新</Button>
          <Button size="small" icon={<ExperimentOutlined />} onClick={() => void runAutonomyBaseline()} loading={autonomyBusy} disabled={Boolean(activeAutonomySession)}>一键验收 24 项</Button>
          {activeAutonomySession
            ? <Button size="small" icon={<StopOutlined />} onClick={() => void completeAutonomy()} loading={autonomyBusy}>结束真实陪跑</Button>
            : <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => void startAutonomy()} loading={autonomyBusy}>开始真实陪跑</Button>}
          <Button size="small" icon={<DownloadOutlined />} onClick={() => void exportAutonomy()} loading={autonomyBusy}>导出</Button>
        </div>
      </header>
      <div className="autonomy-metrics">
        {autonomyMetricLabels.map((item) => <article key={item.key}><span>{item.label}</span><strong>{formatAutonomyMetric(autonomySummary.metrics?.[item.key], item.inverse)}</strong></article>)}
      </div>
      <div className="autonomy-coverage">
        <div><strong>场景覆盖</strong><span>{autonomySummary.coverage?.observed ?? 0}/{autonomySummary.coverage?.total ?? 24} · 通过 {autonomySummary.coverage?.passed ?? 0} · 失败 {autonomySummary.coverage?.failed ?? 0} · 阻塞 {autonomySummary.coverage?.blocked ?? 0}</span></div>
        <p className="autonomy-coverage-note">{activeAutonomySession ? '待观察表示本轮还没有发生对应的真实行为，不会用历史任务或模拟结果填充。' : selectedAutonomySession?.mode === 'automated' ? '这一轮是隔离的内置自动基准，用于一次性验证 24 项链路；它不替代真实陪跑成绩。' : '选择“开始真实陪跑”后，系统会持续采集本轮之后的新证据。'}</p>
        <div className="autonomy-scenario-grid">
          {autonomySummary.coverage?.scenarios.map((scenario) => {
            const state = autonomyStatus(scenario.latest?.status);
            const note = scenario.latest?.note ? `：${scenario.latest.note}` : '：等待本轮对应的真实行为';
            return <article key={scenario.id} title={`${scenario.title} · ${state.label}${note}`}><Tag color={state.color}>{state.label}</Tag><span>{scenario.title}</span></article>;
          })}
        </div>
      </div>
      {autonomySummary.latestObservations?.length ? <div className="autonomy-observations">
        {autonomySummary.latestObservations.slice(0, 3).map((observation) => <div key={observation.observationId}><Tag color={autonomyStatus(observation.status).color}>{autonomyStatus(observation.status).label}</Tag><span>{observation.note || observation.scenarioId}</span></div>)}
      </div> : null}
    </section>}
    {report && <>
      <div className={`diagnostics-summary ${report.blocked ? 'blocked' : report.warning ? 'warning' : 'ready'}`}>
        <strong>{report.blocked ? '有项目会阻止任务完成' : report.warning ? '基础能力可用，还有项目需要确认' : '当前基础能力全部可用'}</strong>
        <span>{report.ready} 项可用 · {report.warning} 项提醒 · {report.blocked} 项缺失</span>
        <small>检查时间：{new Date(report.checkedAt).toLocaleTimeString('zh-CN')}</small>
      </div>
      {optimization && <section className="diagnostics-optimization-result">
        <header><div><strong>{optimization.summary}</strong><span>{optimization.modelLabel}</span></div><small>完成后已自动复检</small></header>
        <div>{optimization.actions.map((action, index) => <article className={`is-${action.status}`} key={`${action.area}-${index}`}>
          {action.status === 'fixed' ? <CheckCircleOutlined /> : action.status === 'failed' ? <CloseCircleOutlined /> : <WarningOutlined />}
          <div><strong>{action.title}</strong><p>{action.detail}</p></div>
        </article>)}</div>
      </section>}
      <section className="external-capability-matrix">
        <header>
          <div><strong>外部能力真实矩阵</strong><span>只认真实调用和有效响应；保存配置、安装或发现不会显示为可用</span></div>
          <small>{report.externalCapabilities.summary.available}/{report.externalCapabilities.summary.total} 可用 · {report.externalCapabilities.summary.recovered} 次恢复</small>
        </header>
        <div>
          {report.externalCapabilities.entries.map((entry) => {
            const state = capabilityStateLabels[entry.state] ?? capabilityStateLabels.unavailable;
            return <article key={entry.id}>
              <div><strong>{entry.label}</strong><span>{capabilityLabels[entry.kind] ?? entry.kind}</span></div>
              <Tag className={`capability-state-tag is-${entry.state}`} color={state.color}>{state.label}</Tag>
              <small>{entry.checkedAt ? `上次真实检查：${new Date(entry.checkedAt).toLocaleString('zh-CN')}` : '尚无真实调用证据'}{entry.recoveryCount ? ` · 已恢复 ${entry.recoveryCount} 次` : ''}</small>
              <p>{entry.lastDetail || entry.resourceIdentity || '等待在对应功能中完成最小真实调用'}</p>
            </article>;
          })}
        </div>
      </section>
      <div className="diagnostics-list">
        {report.items.map((item) => <section className={`diagnostic-item ${item.status}`} key={item.id}>
          <div className="diagnostic-state" title={item.status === 'ready' ? '可用' : item.status === 'warning' ? '需要确认' : '不可用'}>
            {item.status === 'ready' ? <CheckCircleOutlined /> : item.status === 'warning' ? <WarningOutlined /> : <CloseCircleOutlined />}
          </div>
          <div className="diagnostic-copy">
            <div><strong>{item.title}</strong><span>{item.status === 'ready' ? '可用' : item.status === 'warning' ? '需确认' : '缺配置'}</span></div>
            <h3>{item.summary}</h3>
            <p>{item.detail}</p>
            <small>下一步：{item.action}</small>
          </div>
          {item.settingsTab && item.status !== 'ready' && <Button size="small" onClick={() => onNavigate(item.settingsTab!)}>去处理</Button>}
        </section>)}
      </div>
    </>}
  </div>;
}
