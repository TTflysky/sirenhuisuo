import { useEffect, useMemo, useState } from 'react';
import {
  contentTypeIcon,
  formatOutputSize,
  kindIcon,
  loadOutputsByScope,
  openOutputInBrowser,
  removeOutput,
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

  useEffect(() => {
    const refresh = () => {
      const next = loadOutputsByScope(scope).sort((a, b) => b.ts - a.ts);
      setOutputs(next);
      setSelectedId((current) => current && next.some((item) => item.id === current)
        ? current
        : next[0]?.id ?? null);
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

  useEffect(() => {
    if (!selectedFilename) return;
    const matched = outputs.find((output) => output.filename === selectedFilename);
    if (!matched) return;
    setSelectedId(matched.id);
    window.setTimeout(() => document.querySelector(`[data-output-id="${CSS.escape(matched.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0);
  }, [outputs, selectedFilename]);

  const handleRemove = (output: OutputRecord) => {
    removeOutput(output.id);
    setOutputs((current) => current.filter((item) => item.id !== output.id));
  };

  if (outputs.length === 0) {
    return (
      <div className="chat-outputs-panel">
        <div className="chat-outputs-preview-head chat-outputs-empty-head"><button type="button" className="chat-outputs-back" onClick={onBack} disabled={!onBack}>← 返回聊天</button><strong>产出物</strong></div>
        <div className="chat-outputs-empty">
          <span className="chat-outputs-empty-icon">{kindIcon('default')}</span>
          <span className="chat-outputs-empty-text">No outputs yet</span>
          <span className="chat-outputs-empty-hint">Generated files and task summaries will appear here.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-outputs-panel">
      <div className="chat-outputs-list" style={{ maxHeight }}>
        <div className="chat-outputs-list-head">
          {onBack && <button type="button" className="chat-outputs-back" onClick={onBack}>← 返回聊天</button>}
          <span>产出物 ({outputs.length})</span>
        </div>
        {outputs.map((output) => (
          <div
            className={`chat-outputs-item ${output.id === selectedId ? 'active' : ''}`}
            key={output.id}
            data-output-id={output.id}
            onClick={() => setSelectedId(output.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') setSelectedId(output.id);
            }}
          >
            <span className="chat-outputs-item-icon">{contentTypeIcon(output.contentType)}</span>
            <span className="chat-outputs-item-info">
              <span className="chat-outputs-item-title">{output.title || output.filename}</span>
              <span className="chat-outputs-item-meta">
                {output.filename} · {formatOutputSize(output)}
              </span>
            </span>
            <button
              className="chat-outputs-item-open"
              title="Open in browser"
              onClick={(event) => {
                event.stopPropagation();
                openOutputInBrowser(output);
              }}
            >
              ↗
            </button>
            <button
              className="chat-outputs-item-del"
              title="Delete output"
              onClick={(event) => {
                event.stopPropagation();
                handleRemove(output);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {selected && (
        <div className="chat-outputs-preview">
          <div className="chat-outputs-preview-head">
            {onBack && <button type="button" className="chat-outputs-back" onClick={onBack}>← 返回聊天</button>}
            <span className="chat-outputs-preview-title" title={selected.filename}>
              {selected.filename}
            </span>
            <button
              className="chat-outputs-item-open"
              title="Open in browser"
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
            ) : (
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{selected.content}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
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
