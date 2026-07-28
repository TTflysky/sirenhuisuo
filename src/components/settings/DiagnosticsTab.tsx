import { useEffect, useState } from 'react';
import { Button, Spin } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import { runSystemDiagnostics, type SystemDiagnosticItem, type SystemDiagnosticReport } from '../../diagnostics/systemDiagnostics';

type TargetTab = NonNullable<SystemDiagnosticItem['settingsTab']>;

export default function DiagnosticsTab({ onNavigate }: { onNavigate: (tab: TargetTab) => void }) {
  const [report, setReport] = useState<SystemDiagnosticReport>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setRunning(true);
    setError('');
    try { setReport(await runSystemDiagnostics()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setRunning(false); }
  };
  useEffect(() => { void run(); }, []);

  return <div className="settings-content-page diagnostics-page">
    <header className="diagnostics-header">
      <div><h2>诊断中心</h2><span>一次检查模型、连接器、Skill、任务内核、记忆复盘、工作区和权限</span></div>
      <Button icon={<ReloadOutlined />} onClick={() => void run()} disabled={running}>重新检查</Button>
    </header>
    {running && !report && <div className="diagnostics-loading"><Spin /><span>正在逐项做真实检查…</span></div>}
    {error && <div className="error-banner">检查失败：{error}</div>}
    {report && <>
      <div className={`diagnostics-summary ${report.blocked ? 'blocked' : report.warning ? 'warning' : 'ready'}`}>
        <strong>{report.blocked ? '有项目会阻止任务完成' : report.warning ? '基础能力可用，还有项目需要确认' : '当前基础能力全部可用'}</strong>
        <span>{report.ready} 项可用 · {report.warning} 项提醒 · {report.blocked} 项缺失</span>
        <small>检查时间：{new Date(report.checkedAt).toLocaleTimeString('zh-CN')}</small>
      </div>
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
