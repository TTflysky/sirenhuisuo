import { useState } from 'react';
import { Button, App } from 'antd';
import {
  type Connector,
  loadConnectors, saveConnectors,
  CONNECTOR_PRESETS,
} from '../../data/connectors';

/** 侧栏底部的连接器面板——紧凑版 */
export default function ConnectorPanel() {
  const { message } = App.useApp();
  const [connectors, setConnectors] = useState<Connector[]>(() => loadConnectors());
  const [expanded, setExpanded] = useState(false);

  const refresh = () => {
    const list = loadConnectors();
    setConnectors([...list]);
  };

  const handleAdd = () => {
    const existingIds = new Set(connectors.map(c => c.label));
    const next = CONNECTOR_PRESETS.find(p => !existingIds.has(p.label));
    if (!next) {
      message.info('所有预设连接器已添加');
      return;
    }
    const c: Connector = {
      id: `conn-${Date.now()}`,
      label: next.label,
      icon: next.icon,
      type: next.type,
      mcpServerName: next.mcpServerName,
      status: 'unknown',
    };
    const list = loadConnectors();
    list.push(c);
    saveConnectors(list);
    refresh();
    message.success(`已添加 ${next.label}`);
  };

  const handleRemove = (id: string) => {
    const list = loadConnectors().filter(c => c.id !== id);
    saveConnectors(list);
    refresh();
  };

  const statusIcon = (s: Connector['status']) => {
    if (s === 'connected') return '🟢';
    if (s === 'disconnected') return '🔴';
    return '⚪';
  };

  return (
    <div style={{
      borderTop: '1px solid var(--border-light)',
      marginTop: 'auto',
    }}>
      {/* 头部 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 14px', cursor: 'pointer',
          fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <span>🔌 连接器 {connectors.length > 0 && `(${connectors.length})`}</span>
        <span style={{ fontSize: 9 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '0 10px 8px', maxHeight: 200, overflowY: 'auto' }}>
          {connectors.length === 0 ? (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 0', textAlign: 'center' }}>
              暂无连接器
            </div>
          ) : (
            connectors.map(c => (
              <div
                key={c.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 8px', borderRadius: 6, marginBottom: 2,
                  fontSize: 11, background: 'var(--bg-deep)',
                }}
              >
                <span style={{ fontSize: 14, flexShrink: 0 }}>{c.icon}</span>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.label}
                </span>
                <span title={c.status === 'connected' ? '已连接' : c.status === 'disconnected' ? '断开' : '未知'}>
                  {statusIcon(c.status)}
                </span>
                <button
                  onClick={() => handleRemove(c.id)}
                  style={{
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    fontSize: 10, color: 'var(--text-muted)', padding: '2px 4px',
                    borderRadius: 4, lineHeight: 1, flexShrink: 0,
                  }}
                  title="移除"
                >✕</button>
              </div>
            ))
          )}
          <div style={{ marginTop: 6 }}>
            <Button size="small" block onClick={handleAdd} style={{ fontSize: 10, height: 24 }}>
              + 添加连接器
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
