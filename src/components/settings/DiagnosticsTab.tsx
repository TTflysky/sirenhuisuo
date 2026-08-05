import { useEffect, useState } from 'react';
import { Button, Select, Spin, Tag } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, DownloadOutlined, ReloadOutlined, RobotOutlined, ThunderboltOutlined, WarningOutlined } from '@ant-design/icons';
import type { OperationDiagnosticEntry } from '../../electron';
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

export default function DiagnosticsTab({ onNavigate }: { onNavigate: (tab: TargetTab) => void }) {
  const [report, setReport] = useState<SystemDiagnosticReport>();
  const [running, setRunning] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimization, setOptimization] = useState<DiagnosticOptimizationResult>();
  const [settings, setSettings] = useState(() => loadSettings());
  const [error, setError] = useState('');
  const [operationSummary, setOperationSummary] = useState<{ total: number; errors: number; recoverable: number; latest: OperationDiagnosticEntry[] }>();
  const [exporting, setExporting] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle', message: '点击检查更新' });

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
