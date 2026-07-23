import { useState } from 'react';
import { Modal, Input, Select, Button, Switch, App } from 'antd';
import type { Connector, ConnectorAuth } from '../../data/connectors';
import { CONNECTOR_PRESETS, updateConnector, checkConnector } from '../../data/connectors';

interface Props { connector: Connector; onClose: () => void; onSaved: () => void; }

export default function ConnectorConfigModal({ connector, onClose, onSaved }: Props) {
  const { message } = App.useApp();
  const preset = CONNECTOR_PRESETS.find(p => p.mcpServerName === connector.mcpServerName);
  const [baseUrl, setBaseUrl] = useState(connector.baseUrl ?? preset?.baseUrl ?? '');
  const [authType, setAuthType] = useState<ConnectorAuth['type']>(connector.auth?.type ?? preset?.authType ?? 'none');
  const [token, setToken] = useState(connector.auth?.token ?? '');
  const [headers, setHeaders] = useState(Object.entries(connector.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n'));
  const [enabled, setEnabled] = useState(connector.enabled);
  const [testing, setTesting] = useState(false);
  const parseHeaders = () => Object.fromEntries(headers.split('\n').map(line => line.split(/:\s*/, 2)).filter(([key, value]) => key && value));
  const buildConnector = (): Connector => ({ ...connector, baseUrl: baseUrl.trim() || undefined, headers: parseHeaders(), auth: authType === 'none' ? undefined : { type: authType, token: token.trim() || undefined }, enabled });
  const handleTest = async () => { setTesting(true); const result = await checkConnector(buildConnector()); if (result.status === 'connected') message.success('连接成功！'); else message.warning(`${result.runtimeStatus === 'unavailable' ? '运行时不可用' : '连接失败'}: ${result.error ?? '未知原因'}`); setTesting(false); };
  const handleSave = () => { const c = buildConnector(); updateConnector(connector.id, { baseUrl: c.baseUrl, headers: c.headers, auth: c.auth, enabled }); message.success('连接器配置已保存'); onSaved(); onClose(); };
  return <Modal title={`配置连接器 - ${connector.label}`} open onCancel={onClose} footer={null} width={520} destroyOnClose>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-deep)' }}><span style={{ fontSize: 24 }}>{connector.icon}</span><div><div style={{ fontWeight: 600 }}>{connector.label}</div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{preset?.desc ?? connector.type}</div></div></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontWeight: 500 }}>启用连接器</span><Switch checked={enabled} onChange={setEnabled} /></div>
      <div><div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>服务地址 / MCP endpoint</div><Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.example.com 或项目内 MCP endpoint" /></div>
      <div><div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>认证方式</div><Select value={authType} onChange={setAuthType} style={{ width: '100%' }} options={[{ value: 'apikey', label: 'API Key（自定义 header）' }, { value: 'bearer', label: 'Bearer Token' }, { value: 'none', label: '无认证' }]} /></div>
      {authType !== 'none' && <div><div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>认证凭据</div><Input.Password value={token} onChange={e => setToken(e.target.value)} placeholder="认证 token" /></div>}
      <div><div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>自定义 Headers（每行 Name: Value）</div><Input.TextArea value={headers} onChange={e => setHeaders(e.target.value)} rows={3} /></div>
      {connector.type === 'mcp' && <div style={{ padding: '10px 14px', borderRadius: 8, fontSize: 12, background: 'rgba(99,102,241,0.08)', color: 'var(--text-secondary)' }}>MCP 能力仅来自项目内配置的 endpoint/runtime；当前状态：<strong>{connector.runtimeStatus === 'available' ? '可用' : connector.runtimeStatus === 'unavailable' ? '未发现 runtime' : '未检查'}</strong>，工具数：{connector.discoveredActions?.length ?? 0}。</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8 }}><Button onClick={handleTest} loading={testing}>🔍 测试连接</Button><Button onClick={onClose}>取消</Button><Button type="primary" onClick={handleSave}>保存配置</Button></div>
    </div>
  </Modal>;
}
