import { CheckOutlined, CloseOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import type { TaskApprovalContract } from '../../types';

interface Props {
  approval: TaskApprovalContract;
  busy?: boolean;
  onDecision: (decision: 'approved' | 'rejected') => void;
}

function ResourceList({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return <div className="execution-approval-resources"><strong>{label}</strong>{values.map((value) => <span key={value}>{value}</span>)}</div>;
}

export default function ExecutionApprovalCard({ approval, busy, onDecision }: Props) {
  const pending = approval.status === 'pending';
  return (
    <section className={`execution-approval-card status-${approval.status}`}>
      <header>
        <span className="execution-approval-icon"><SafetyCertificateOutlined /></span>
        <div><small>需要你的决定</small><h3>{approval.title}</h3></div>
        <span className="execution-approval-owner"><UserOutlined />{approval.requestedByName}</span>
      </header>
      <div className="execution-approval-purpose"><strong>为什么需要</strong><p>{approval.purpose}</p></div>
      <div className="execution-approval-action"><strong>准备执行</strong><p>{approval.action}</p></div>
      <div className="execution-approval-scope">
        <ResourceList label="将读取" values={approval.reads} />
        <ResourceList label="将写入" values={approval.writes} />
      </div>
      <div className="execution-approval-risks"><strong>需要注意</strong>{approval.risks.map((risk) => <span key={risk}>{risk}</span>)}</div>
      <div className="execution-approval-effects">
        <p><b>允许后：</b>{approval.approveEffect}</p>
        <p><b>拒绝后：</b>{approval.rejectEffect}</p>
      </div>
      {pending ? <div className="execution-approval-actions">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onDecision('rejected')}><CloseOutlined />拒绝并换路线</button>
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => onDecision('approved')}><CheckOutlined />{busy ? '正在处理…' : '允许本次操作'}</button>
      </div> : <div className="execution-approval-decided">{approval.status === 'approved' || approval.status === 'consumed' ? '已允许' : '已拒绝'}</div>}
    </section>
  );
}
