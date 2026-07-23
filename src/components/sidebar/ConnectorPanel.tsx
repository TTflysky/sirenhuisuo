import { useState } from 'react';
import { Button, App } from 'antd';
import {
  type Connector,
  loadConnectors, saveConnectors,
  CONNECTOR_PRESETS, checkConnector, updateConnector,
} from '../../data/connectors';
import ConnectorConfigModal from './ConnectorConfigModal';

/** 侧栏底部的连接器面板——支持配置、测试、启用 */
export default function ConnectorPanel() {
  const { message } = App.useApp();
  const [connectors, setConnectors] = useState<Connector[]>(() => loadConnectors());
  const [expanded, setExpanded] = useState(false);
  const [configConnector, setConfigConnector] = useState<Connector | null>(null);

  const refresh = () => {
    const list = loadConnectors();
    setConnectors([...list]);
  };

  /** 添加连接器 */
  const handleAdd = () => {
    const existingIds = new Set(connectors.map(c => c.mcpServerName));
    const next = CONNECTOR_PRESETS.find(p => !existingIds.has(p.mcpServerName));
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
      enabled: false,
      baseUrl: next.baseUrl,
    };
    const list = loadConnectors();
    list.push(c);
    saveConnectors(list);
    refresh();
    message.success(`已添加 ${next.label}`);
  };

  /** 删除连接器 */
  const handleRemove = (id: string) => {
    const list = loadConnectors().filter(c => c.id !== id);
    saveConnectors(list);
    refresh();
  };

  /** 切换启用 */
  const handleToggle = (id: string, enabled: boolean) => {
    updateConnector(id, { enabled });
    refresh();
  };

  /** 测试连接 */
  const handleTest = async (c: Connector) => {
    message.loading({ content: `正在测试 ${c.label}...`, key: 'test' });
    const result = await checkConnector(c);
    updateConnector(c.id, { status: result.status, error: result.error, lastChecked: Date.now() });
    refresh();
    if (result.status === 'connected') {
      message.success({ content: `${c.label} 连接成功`, key: 'test' });
    } else {
      message.warning({ content: `${c.label}: ${result.error ?? '连接失败'}`, key: 'test' });
    }
  };

  /** 状态标签 */
  const statusBadge = (c: Connector) => {
    if (c.status === 'connected') return <span style={{ color: '#22c55e', fontSize: 10, fontWeight: 600 }}>已连接</span>;
    if (c.status === 'disconnected') return <span style={{ color: '#ef4444', fontSize: 10 }}>断开</span>;
    return <span style={{ color: '#9aa4c2', fontSize: 10 }}>未配置</span>;
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
        <span>
          🔌 连接器
          {connectors.filter(c => c.enabled).length > 0 && (
            <span style={{ color: '#22c55e', marginLeft: 4 }}>
              ({connectors.filter(c => c.enabled).length})
            </span>
          )}
        </span>
        <span style={{ fontSize: 9 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '0 10px 8px', maxHeight: 260, overflowY: 'auto' }}>
          {connectors.length === 0 ? (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '6px 0', textAlign: 'center' }}>
              暂无连接器，点击下方按钮添加
            </div>
          ) : (
            connectors.map(c => (
              <div
                key={c.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 8px', borderRadius: 8, marginBottom: 4,
                  fontSize: 11, background: c.enabled ? 'rgba(34,197,94,0.06)' : 'var(--bg-deep)',
                  border: `1px solid ${c.enabled ? 'rgba(34,197,94,0.2)' : 'transparent'}`,
                }}
              >
                {/* 图标 */}
                <span style={{ fontSize: 16, flexShrink: 0 }}>{c.icon}</span>

                {/* 名称 + 状态 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    fontWeight: c.enabled ? 600 : 400,
                  }}>
                    {c.label}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                    {statusBadge(c)}
                  </div>
                </div>

                {/* 操作按钮 */}
                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                  {/* 配置按钮 */}
                  <button
                    onClick={() => setConfigConnector(c)}
                    style={{
                      border: 'none', background: 'rgba(99,102,241,0.1)', cursor: 'pointer',
                      fontSize: 10, color: '#6366f1', padding: '2px 6px',
                      borderRadius: 4, lineHeight: 1, fontWeight: 500,
                    }}
                    title="配置"
                  >⚙</button>

                  {/* 快速测试 */}
                  {c.type === 'custom' && (
                    <button
                      onClick={() => handleTest(c)}
                      style={{
                        border: 'none', background: 'rgba(34,197,94,0.1)', cursor: 'pointer',
                        fontSize: 10, color: '#22c55e', padding: '2px 6px',
                        borderRadius: 4, lineHeight: 1,
                      }}
                      title="测试连接"
                    >🔍</button>
                  )}

                  {/* 删除 */}
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

      {/* 配置模态框 */}
      {configConnector && (
        <ConnectorConfigModal
          connector={configConnector}
          onClose={() => setConfigConnector(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
