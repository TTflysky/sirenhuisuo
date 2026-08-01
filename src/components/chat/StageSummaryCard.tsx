import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, DownOutlined, ExclamationCircleOutlined, RightOutlined, UserOutlined } from '@ant-design/icons';
import { useState } from 'react';
import type { TaskStageSummary } from '../../types';

interface Props {
  summary: TaskStageSummary;
}

export default function StageSummaryCard({ summary }: Props) {
  const [expanded, setExpanded] = useState(false);
  const statusLabel = summary.status === 'completed' ? '阶段完成' : summary.status === 'blocked' ? '阶段等待处理' : '阶段执行失败';
  const StatusIcon = summary.status === 'completed' ? CheckCircleOutlined : summary.status === 'blocked' ? ExclamationCircleOutlined : CloseCircleOutlined;
  const seconds = Math.max(0, Math.floor((summary.durationMs ?? 0) / 1000));
  const duration = seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return (
    <section className={`stage-summary-card status-${summary.status}`}>
      <header className="stage-summary-head">
        <span className="stage-summary-icon"><StatusIcon /></span>
        <div>
          <small>{statusLabel}{summary.durationMs != null ? ` · ${duration}` : ''}</small>
          <h3>{summary.stageTitle}</h3>
        </div>
        <span className="stage-summary-owner"><UserOutlined />{summary.ownerName}</span>
      </header>

      <div className="stage-summary-grid">
        <div><strong>解决什么</strong><p>{summary.problem}</p></div>
        <div><strong>为什么这样做</strong><p>{summary.rationale}</p></div>
        <div><strong>已经做到</strong>{summary.completed.map((item) => <p key={item}>{item}</p>)}</div>
        <div><strong>还没有做</strong><p>{summary.remaining.length ? summary.remaining.join('、') : '当前计划没有剩余阶段。'}</p></div>
      </div>

      {summary.evidence.length > 0 && <div className="stage-summary-evidence">
        <strong>可核对结果</strong>
        {summary.evidence.map((item) => <span key={item}>✓ {item}</span>)}
      </div>}

      <div className="stage-summary-next">
        <RightOutlined />
        <div><strong>下一步{summary.nextOwnerName ? ` · ${summary.nextOwnerName}` : ''}</strong><p>{summary.nextAction}</p></div>
      </div>

      <button type="button" className="stage-summary-toggle" onClick={() => setExpanded((value) => !value)}>
        {expanded ? <DownOutlined /> : <ClockCircleOutlined />}
        {expanded ? '收起操作过程' : `查看操作过程（${summary.operations.length}）`}
      </button>
      {expanded && <div className="stage-summary-operations">
        {summary.operations.length ? summary.operations.map((operation, index) => (
          <div key={`${operation.ts}-${index}`} className={operation.success ? 'is-success' : 'is-failed'}>
            <time>{new Date(operation.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
            <span>{operation.detail}</span>
          </div>
        )) : <p>这个阶段没有需要展示的工具操作。</p>}
      </div>}
    </section>
  );
}
