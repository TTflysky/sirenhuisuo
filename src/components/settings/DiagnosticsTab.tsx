import { useEffect, useState } from 'react';
import { Button, Select, Spin, Tag } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, DownloadOutlined, ReloadOutlined, RobotOutlined, ThunderboltOutlined, WarningOutlined } from '@ant-design/icons';
import type { OperationDiagnosticEntry } from '../../electron';
import { runSystemDiagnostics, type SystemDiagnosticItem, type SystemDiagnosticReport } from '../../diagnostics/systemDiagnostics';
import { optimizeSystemDiagnostics, type DiagnosticOptimizationResult } from '../../diagnostics/diagnosticOptimizer';
import { loadSettings, saveSettings } from '../../data/hermesClient';

type TargetTab = NonNullable<SystemDiagnosticItem['settingsTab']>;

export default function DiagnosticsTab({ onNavigate }: { onNavigate: (tab: TargetTab) => void }) {
  const [report, setReport] = useState<SystemDiagnosticReport>();
  const [running, setRunning] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimization, setOptimization] = useState<DiagnosticOptimizationResult>();
  const [settings, setSettings] = useState(() => loadSettings());
  const [error, setError] = useState('');
  const [operationSummary, setOperationSummary] = useState<{ total: number; errors: number; recoverable: number; latest: OperationDiagnosticEntry[] }>();
  const [exporting, setExporting] = useState(false);

  const run = async () => {
    setRunning(true);
    setError('');
    try {
      const [systemReport, diagnostics] = await Promise.all([
        runSystemDiagnostics(),
        window.electronAPI?.diagnosticsSummary?.() ?? Promise.resolve(undefined),
      ]);
      setReport(systemReport);
      if (diagnostics?.ok) setOperationSummary(diagnostics);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setRunning(false); }
  };
  const exportDiagnostics = async () => {
    setExporting(true);
    try {
      const result = await window.electronAPI?.diagnosticsExport?.();
      if (result && !result.ok) setError(result.error || '导出失败');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setExporting(false); }
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
  useEffect(() => { void run(); }, []);

  return <div className="settings-content-page diagnostics-page">
    <header className="diagnostics-header">
      <div><h2>诊断中心</h2><span>一次检查模型、连接器、Skill、任务内核、记忆复盘、工作区和权限</span></div>
      <div className="diagnostics-header-actions">
        <Button icon={<ReloadOutlined />} onClick={() => void run()} disabled={running || optimizing}>重新检查</Button>
        <Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void exportDiagnostics()}>导出错误日志</Button>
      </div>
    </header>
    <section className="diagnostics-optimizer-bar">
      <RobotOutlined />
      <div><strong>诊断优化模型</strong><span>{settings.diagnosticModelId ? '已指定专用模型' : '尚未指定'}</span></div>
      <Select
        value={settings.diagnosticModelId}
        placeholder="选择模型"
        onChange={selectDiagnosticModel}
        options={(settings.modelLibrary ?? []).map((model) => ({ value: model.id, label: `${model.label} · ${model.model ?? '未填写模型名'}` }))}
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
