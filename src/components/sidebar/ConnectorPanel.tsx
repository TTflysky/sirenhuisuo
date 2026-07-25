import { useCallback, useEffect, useMemo, useState } from 'react';
import { DeleteOutlined, FolderOpenOutlined, LinkOutlined, PlusOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { App, Button } from 'antd';
import {
  checkConnector,
  type Connector,
  loadConnectors,
  saveConnectors,
  updateConnector,
  upsertConnector,
} from '../../data/connectors';
import ConnectorConfigModal from './ConnectorConfigModal';
import { BUS_CHANNELS, onBus } from '../../ipcBus';

function connectorIcon(connector: Connector) {
  if (connector.kind === 'obsidian') return <FolderOpenOutlined />;
  if (connector.kind === 'knowledge-url') return <LinkOutlined />;
  return <span>{connector.icon}</span>;
}

function statusText(connector: Connector) {
  if (connector.status === 'connected') return '已连接';
  if (connector.status === 'disconnected') return '需检查';
  return '未配置';
}

export function KnowledgeConnectorManager({ compact = false, onChange }: { compact?: boolean; onChange?: (connectors: Connector[]) => void }) {
  const { message, modal } = App.useApp();
  const [connectors, setConnectors] = useState<Connector[]>(() => loadConnectors());
  const [configConnector, setConfigConnector] = useState<Connector | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const ordered = useMemo(() => [...connectors].sort((a, b) => Number(b.kind !== 'legacy') - Number(a.kind !== 'legacy')), [connectors]);
  const refresh = useCallback(() => {
    const next = [...loadConnectors()];
    setConnectors(next);
    onChange?.(next);
  }, [onChange]);

  useEffect(() => onBus(BUS_CHANNELS.CONNECTORS_CHANGED, refresh), [refresh]);

  const configure = async (connector: Connector) => {
    if (!window.electronAPI?.openTool) { setConfigConnector(connector); return; }
    const result = await window.electronAPI.openTool({ type: 'connector-config', refId: connector.id, payload: connector });
    if (!result.ok) setConfigConnector(connector);
  };

  const addWebKnowledge = () => void configure({
    id: `knowledge-${Date.now()}`,
    label: '网页知识库',
    icon: '🔗',
    type: 'custom',
    kind: 'knowledge-url',
    mcpServerName: 'knowledge-url',
    status: 'unknown',
    enabled: true,
  });

  const addObsidian = async () => {
    const result = await window.electronAPI?.knowledgePickObsidian?.();
    if (!result || result.canceled) return;
    if (!result.ok || !result.path) { message.error(result.error ?? 'Vault 连接失败'); return; }
    const connector: Connector = {
      id: `obsidian-${Date.now()}`,
      label: result.path.split(/[\\/]/).filter(Boolean).pop() || 'Obsidian',
      icon: '◇',
      type: 'custom',
      kind: 'obsidian',
      mcpServerName: 'obsidian-vault',
      status: 'connected',
      enabled: true,
      localPath: result.path,
      lastChecked: Date.now(),
    };
    upsertConnector(connector);
    refresh();
    message.success(`Obsidian 已连接，发现 ${result.noteCount ?? 0} 篇笔记`);
  };

  const test = async (connector: Connector) => {
    setTesting(connector.id);
    const result = await checkConnector(connector);
    updateConnector(connector.id, { status: result.status, error: result.error, lastChecked: Date.now(), discoveredActions: result.actions, runtimeStatus: result.runtimeStatus });
    refresh();
    setTesting(null);
    if (result.status === 'connected') message.success(`${connector.label} 连接正常`);
    else message.warning(result.error ?? '连接失败');
  };

  const remove = (connector: Connector) => modal.confirm({
    title: `移除 ${connector.label}？`,
    okText: '移除',
    okButtonProps: { danger: true },
    cancelText: '取消',
    onOk: () => {
      saveConnectors(loadConnectors().filter((item) => item.id !== connector.id));
      refresh();
    },
  });

  return (
    <div className={`knowledge-manager ${compact ? 'knowledge-manager--compact' : ''}`}>
      <div className="knowledge-manager-actions">
        <Button size="small" icon={<LinkOutlined />} onClick={addWebKnowledge}>网页知识库</Button>
        <Button size="small" icon={<FolderOpenOutlined />} onClick={() => void addObsidian()}>Obsidian</Button>
      </div>
      <div className="knowledge-connector-list">
        {ordered.length === 0 && <div className="knowledge-empty">暂无知识库连接</div>}
        {ordered.map((connector) => (
          <div className={`knowledge-connector-row ${connector.enabled ? 'enabled' : ''}`} key={connector.id}>
            <div className="knowledge-connector-icon">{connectorIcon(connector)}</div>
            <div className="knowledge-connector-main">
              <strong>{connector.label}</strong>
              <small className={`status-${connector.status}`}>{statusText(connector)}{connector.kind === 'legacy' ? ' · 旧连接器' : ''}</small>
            </div>
            <div className="knowledge-connector-tools">
              <button title="检查连接" onClick={() => void test(connector)} disabled={testing === connector.id}><ReloadOutlined spin={testing === connector.id} /></button>
              <button title="配置" onClick={() => void configure(connector)}><SettingOutlined /></button>
              <button title="移除" onClick={() => remove(connector)}><DeleteOutlined /></button>
            </div>
          </div>
        ))}
      </div>
      {!compact && <Button type="dashed" block icon={<PlusOutlined />} onClick={addWebKnowledge}>添加知识库</Button>}
      {configConnector && <ConnectorConfigModal connector={configConnector} onClose={() => setConfigConnector(null)} onSaved={refresh} />}
    </div>
  );
}

export default function ConnectorPanel() {
  const [expanded, setExpanded] = useState(false);
  const [connected, setConnected] = useState(() => loadConnectors().filter((connector) => connector.enabled && connector.status === 'connected').length);
  return (
    <div className="connector-panel">
      <button className="connector-toggle" onClick={() => setExpanded((value) => !value)}>
        <span><LinkOutlined /> 知识库{connected > 0 && <b>{connected}</b>}</span>
        <span>{expanded ? '−' : '+'}</span>
      </button>
      {expanded && <KnowledgeConnectorManager compact onChange={(items) => setConnected(items.filter((connector) => connector.enabled && connector.status === 'connected').length)} />}
    </div>
  );
}
