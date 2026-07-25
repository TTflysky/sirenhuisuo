import { useState } from 'react';
import type { ThoughtChainStep } from '../../types';

export default function ThoughtChainView({ steps }: { steps: ThoughtChainStep[] }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  return <div className="cot-wrap">
    <button className="cot-toggle" onClick={() => setOpen(!open)}>执行过程 ({steps.length} 步) {open ? '▲' : '▼'}</button>
    {open && <div className="cot-steps">{steps.map((step, index) => <div key={index} className={`cot-step ${step.success ? 'cot-ok' : 'cot-err'}`}>
      <div className="cot-step-head"><span className="cot-step-icon">{step.success ? '✓' : '!'}</span><code className="cot-step-tool">{step.toolName}</code></div>
      {step.args && <div className="cot-step-args">参数：<code>{step.args.length > 300 ? `${step.args.slice(0, 300)}…` : step.args}</code></div>}
      <div className="cot-step-result">{step.result.length > 800 ? `${step.result.slice(0, 800)}…` : step.result}</div>
    </div>)}</div>}
  </div>;
}
