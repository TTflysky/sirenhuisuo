import { useEffect, useMemo, useState } from 'react';
import {
  contentTypeIcon,
  formatOutputSize,
  kindIcon,
  loadOutputsByScope,
  openOutputInBrowser,
  OUTPUT_CATEGORY_META,
  removeOutput,
  type OutputCategory,
  type OutputRecord,
  type OutputScope,
} from '../../data/outputs';
import { onBus, BUS_CHANNELS } from '../../ipcBus';

interface Props {
  scope: OutputScope;
  maxHeight?: number;
  selectedFilename?: string | null;
  onBack?: () => void;
}

export default function ChatOutputsPanel({ scope, maxHeight = 500, selectedFilename, onBack }: Props) {
  const [outputs, setOutputs] = useState<OutputRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<OutputCategory>>(() => new Set(['final']));

  useEffect(() => {
    const refresh = () => {
      const next = loadOutputsByScope(scope).sort((a, b) => a.filename.localeCompare(b.filename, 'zh-CN'));
      setOutputs(next);
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : null);
    };

    refresh();
    return onBus(BUS_CHANNELS.OUTPUTS_CHANGED, (payload) => {
      const changedScope = typeof payload === 'object' && payload !== null && 'scope' in payload
        ? (payload as { scope?: string }).scope
        : undefined;
      if (!changedScope || changedScope === scope || changedScope === 'global') refresh();
    });
  }, [scope]);

  const selected = useMemo(
    () => outputs.find((item) => item.id === selectedId) ?? null,
    [outputs, selectedId],
  );
  const grouped = useMemo(() => (['final', 'working', 'reference'] as OutputCategory[]).map((category) => ({
    category,
    outputs: outputs.filter((output) => (output.category ?? 'final') === category),
  })).filter((group) => group.outputs.length > 0), [outputs]);

  useEffect(() => {
    if (!selectedFilename) return;
    const matched = outputs.find((output) => output.filename === selectedFilename);
    if (!matched) return;
    setSelectedId(matched.id);
    setExpandedGroups((current) => new Set([...current, matched.category ?? 'final']));
    window.setTimeout(() => document.querySelector(`[data-output-id="${CSS.escape(matched.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
  }, [outputs, selectedFilename]);

  const handleRemove = (output: OutputRecord) => {
    removeOutput(output.id);
    setOutputs((current) => current.filter((item) => item.id !== output.id));
  };

  const toggleGroup = (category: OutputCategory) => setExpandedGroups((current) => {
    const next = new Set(current);
    if (next.has(category)) next.delete(category); else next.add(category);
    return next;
  });

  if (outputs.length === 0) {
    return (
      <div className="chat-outputs-panel">
        <div className="chat-outputs-preview-head chat-outputs-empty-head">{onBack && <button type="button" className="chat-outputs-back" onClick={onBack}>← 返回聊天</button>}<strong>产出物</strong></div>
        <div className="chat-outputs-empty">
          <span className="chat-outputs-empty-icon">{kindIcon('default')}</span>
          <span className="chat-outputs-empty-text">暂无交付文件</span>
          <span className="chat-outputs-empty-hint">员工保存成功的文档、代码和项目文件会显示在这里。</span>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-outputs-panel">
      <div className={`chat-outputs-list ${selected ? 'with-preview' : ''}`} style={{ maxHeight }}>
        <div className="chat-outputs-list-head">
          {onBack && <button type="button" className="chat-outputs-back" onClick={onBack}>← 返回聊天</button>}
          <span>交付文件 ({outputs.length})</span>
        </div>
        {grouped.map(({ category, outputs: groupOutputs }) => <section className="chat-outputs-group" key={category}>
          <button type="button" className="chat-outputs-group-head" onClick={() => toggleGroup(category)} aria-expanded={expandedGroups.has(category)}>
            <span className="chat-outputs-group-chevron">{expandedGroups.has(category) ? '⌄' : '›'}</span>
            <span><strong>{OUTPUT_CATEGORY_META[category].label}</strong><small>{OUTPUT_CATEGORY_META[category].description}</small></span>
            <code>{groupOutputs.length}</code>
          </button>
          {expandedGroups.has(category) && groupOutputs.map((output) => (
          <div
            className={`chat-outputs-item ${output.id === selectedId ? 'active' : ''}`}
            key={output.id}
            data-output-id={output.id}
            onClick={() => setSelectedId((current) => current === output.id ? null : output.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') setSelectedId((current) => current === output.id ? null : output.id);
            }}
          >
            <span className="chat-outputs-item-icon">{contentTypeIcon(output.contentType)}</span>
            <span className="chat-outputs-item-info">
              <span className="chat-outputs-item-title-row">
                <span className="chat-outputs-item-title">{fileBasename(output.filename)}</span>
                <span className="chat-outputs-item-type">{fileTypeLabel(output.filename)}</span>
              </span>
              <span className="chat-outputs-item-meta">
                {fileDirectory(output.filename)}{fileDirectory(output.filename) ? ' · ' : ''}{formatOutputSize(output)} · {formatOutputTime(output.ts)}
              </span>
            </span>
            <button
              className="chat-outputs-item-open"
              title={output.diskPath ? '用系统程序打开文件' : '打开预览'}
              onClick={(event) => {
                event.stopPropagation();
                openOutputInBrowser(output);
              }}
            >
              ↗
            </button>
            <button
              className="chat-outputs-item-del"
              title="从交付文件列表移除"
              onClick={(event) => {
                event.stopPropagation();
                handleRemove(output);
              }}
            >
              ×
            </button>
          </div>
          ))}
        </section>)}
      </div>

      {selected && (
        <div className="chat-outputs-preview">
          <div className="chat-outputs-preview-head">
            <button type="button" className="chat-outputs-back" onClick={() => setSelectedId(null)}>⌄ 收起预览</button>
            <span className="chat-outputs-preview-title" title={selected.filename}>
              {selected.filename}
            </span>
            <button
              className="chat-outputs-item-open"
              title={selected.diskPath ? '用系统程序打开文件' : '打开预览'}
              onClick={() => openOutputInBrowser(selected)}
            >
              ↗
            </button>
          </div>
          <div className="chat-outputs-preview-body">
            {selected.contentType === 'image' && selected.dataUrl ? (
              <img src={selected.dataUrl} alt={selected.title} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : selected.contentType === 'markdown' ? (
              <div className="outputs-markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.content) }} />
            ) : selected.contentType === 'url' ? (
              <a href={selected.content.trim()} target="_blank" rel="noreferrer">{selected.content.trim()}</a>
            ) : selected.diskPath && selected.content.startsWith('文件已保存到工作区') ? (
              <div className="chat-outputs-binary-preview"><span>{contentTypeIcon(selected.contentType)}</span><strong>{fileBasename(selected.filename)}</strong><small>{formatOutputSize(selected)}</small><button type="button" onClick={() => openOutputInBrowser(selected)}>打开文件</button></div>
            ) : (
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{selected.content}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function fileBasename(filename: string): string {
  return filename.replace(/\\/g, '/').split('/').pop() || filename;
}

function fileDirectory(filename: string): string {
  const normalized = filename.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '';
}

function fileTypeLabel(filename: string): string {
  const name = fileBasename(filename);
  const extension = name.includes('.') ? name.split('.').pop() : 'FILE';
  return (extension || 'FILE').toUpperCase();
}

function formatOutputTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderMarkdown(value: string): string {
  let html = escapeHtml(value);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br />');
  return `<p>${html}</p>`;
}
