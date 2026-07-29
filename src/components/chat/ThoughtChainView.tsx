import { useEffect, useMemo, useState } from 'react';
import type { ThoughtChainStep } from '../../types';
import { CheckCircleOutlined, CodeOutlined, CopyOutlined, DownOutlined, FullscreenOutlined, UpOutlined, WarningOutlined } from '@ant-design/icons';
import { Modal } from 'antd';
import { getToolReport, summarizeToolResult } from '../../data/assistantPresentation';
import { copyToClipboard } from '../../utils/clipboard';

interface ThoughtChainViewProps {
  steps: ThoughtChainStep[];
  summary?: string;
  live?: boolean;
}

function visibleText(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}\n\n[内容较长，请使用“放大查看”阅读完整记录]` : value;
}

export default function ThoughtChainView({ steps, summary = '执行过程', live = false }: ThoughtChainViewProps) {
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [wrapResult, setWrapResult] = useState(true);
  const [copiedSection, setCopiedSection] = useState<'args' | 'result' | null>(null);
  const selectedStep = steps[Math.min(selectedIndex, Math.max(steps.length - 1, 0))];
  const failedCount = useMemo(() => steps.filter((step) => !step.success).length, [steps]);

  useEffect(() => {
    if (selectedIndex >= steps.length) setSelectedIndex(Math.max(steps.length - 1, 0));
  }, [selectedIndex, steps.length]);

  if (steps.length === 0) return null;

  const showDetail = (index = Math.max(steps.length - 1, 0)) => {
    setSelectedIndex(index);
    setDetailOpen(true);
  };
  const copySection = async (section: 'args' | 'result', value: string) => {
    if (await copyToClipboard(value)) {
      setCopiedSection(section);
      window.setTimeout(() => setCopiedSection((current) => current === section ? null : current), 1600);
    }
  };

  return <div className="cot-wrap">
    <div className="cot-toggle-row">
      <button className={`cot-toggle${live ? ' is-live' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <CodeOutlined /><span>{summary}</span>{failedCount > 0 && <em>{failedCount} 项失败</em>}<code>{steps.length}</code>{open ? <UpOutlined /> : <DownOutlined />}
      </button>
      {open && <button type="button" className="cot-open-detail" onClick={() => showDetail()} title="放大查看完整执行详情" aria-label="放大查看完整执行详情"><FullscreenOutlined /></button>}
    </div>
    {open && <div className="cot-steps">{steps.map((step, index) => <details key={index} className={`cot-step ${step.success ? 'cot-ok' : 'cot-err'}`}>
      <summary className="cot-step-head">
        <span className="cot-step-index">{index + 1}</span>
        <span className="cot-step-icon">{step.success ? <CheckCircleOutlined /> : <WarningOutlined />}</span>
        <strong className="cot-step-title">{getToolReport(step.toolName, step.args)}</strong>
        <time>{new Date(step.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
        <DownOutlined className="cot-step-chevron" />
      </summary>
      <div className="cot-step-summary">{summarizeToolResult(step.toolName, step.result, step.success)}</div>
      <details className="cot-step-details">
        <summary>查看技术详情</summary>
        {step.args && <div className="cot-step-args"><span>输入参数</span><pre>{visibleText(step.args, 1600)}</pre></div>}
        <div className="cot-step-result"><span>原始结果</span><pre>{visibleText(step.result, step.toolName === 'web_search' ? 12000 : 5000)}</pre></div>
        <button type="button" className="cot-step-expand" onClick={() => showDetail(index)}><FullscreenOutlined /> 放大查看</button>
      </details>
    </details>)}</div>}
    <Modal
      open={detailOpen}
      onCancel={() => setDetailOpen(false)}
      footer={null}
      width="min(1040px, calc(100vw - 32px))"
      centered
      destroyOnHidden
      className="cot-detail-modal"
      title={<span className="cot-detail-title"><CodeOutlined /><strong>执行详情</strong><small>{steps.length} 个步骤{failedCount > 0 ? `，${failedCount} 项失败` : ''}</small></span>}
    >
      <div className="cot-detail-layout">
        <nav className="cot-detail-nav" aria-label="执行步骤">
          {steps.map((step, index) => <button
            type="button"
            key={`${step.timestamp}-${index}`}
            className={index === selectedIndex ? 'is-selected' : ''}
            onClick={() => setSelectedIndex(index)}
            aria-current={index === selectedIndex ? 'step' : undefined}
          >
            <i className={step.success ? 'is-ok' : 'is-error'}>{step.success ? <CheckCircleOutlined /> : <WarningOutlined />}</i>
            <span><strong>{index + 1}. {getToolReport(step.toolName, step.args)}</strong><small>{new Date(step.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small></span>
          </button>)}
        </nav>
        {selectedStep && <article className="cot-detail-content">
          <header>
            <div><small>步骤 {selectedIndex + 1}</small><h3>{getToolReport(selectedStep.toolName, selectedStep.args)}</h3></div>
            <span className={selectedStep.success ? 'is-ok' : 'is-error'}>{selectedStep.success ? '执行成功' : '执行失败'}</span>
          </header>
          <p className="cot-detail-summary">{summarizeToolResult(selectedStep.toolName, selectedStep.result, selectedStep.success)}</p>
          {selectedStep.args && <section className="cot-detail-section">
            <div><strong>输入参数</strong><button type="button" onClick={() => void copySection('args', selectedStep.args)}><CopyOutlined /> {copiedSection === 'args' ? '已复制' : '复制'}</button></div>
            <pre className="is-raw">{selectedStep.args}</pre>
          </section>}
          <section className="cot-detail-section">
            <div><strong>原始结果</strong><span className="cot-detail-section-actions"><button type="button" aria-pressed={wrapResult} onClick={() => setWrapResult((value) => !value)}>{wrapResult ? '自动换行' : '原样显示'}</button><button type="button" onClick={() => void copySection('result', selectedStep.result)}><CopyOutlined /> {copiedSection === 'result' ? '已复制' : '复制'}</button></span></div>
            <pre className={wrapResult ? 'is-wrapped' : 'is-raw'}>{selectedStep.result || '这一步没有返回文字结果。'}</pre>
          </section>
        </article>}
      </div>
    </Modal>
  </div>;
}
