import { useState } from 'react';
import type { ThoughtChainStep } from '../../types';
import { CodeOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { getToolReport, summarizeToolResult } from '../../data/assistantPresentation';

export default function ThoughtChainView({ steps }: { steps: ThoughtChainStep[] }) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  return <div className="cot-wrap">
    <button className="cot-toggle" onClick={() => setOpen(!open)}><CodeOutlined /><span>执行过程</span><code>{steps.length}</code>{open ? <UpOutlined /> : <DownOutlined />}</button>
    {open && <div className="cot-steps">{steps.map((step, index) => <details key={index} className={`cot-step ${step.success ? 'cot-ok' : 'cot-err'}`}>
      <summary className="cot-step-head">
        <span className="cot-step-index">{index + 1}</span>
        <span className="cot-step-icon">{step.success ? '✓' : '!'}</span>
        <strong className="cot-step-title">{getToolReport(step.toolName, step.args)}</strong>
        <time>{new Date(step.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
        <DownOutlined className="cot-step-chevron" />
      </summary>
      <div className="cot-step-summary">{summarizeToolResult(step.toolName, step.result, step.success)}</div>
      <details className="cot-step-details">
        <summary>查看技术详情</summary>
        {step.args && <div className="cot-step-args"><span>输入参数</span><pre>{step.args.length > 1200 ? `${step.args.slice(0, 1200)}…` : step.args}</pre></div>}
        <div className="cot-step-result"><span>原始结果</span><pre>{step.result.length > 3000 ? `${step.result.slice(0, 3000)}…` : step.result}</pre></div>
      </details>
    </details>)}</div>}
  </div>;
}
