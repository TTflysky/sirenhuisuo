import { useState, useEffect } from 'react';
import { Modal, Input, Select, Button, Switch, App } from 'antd';
import type { Connector, ConnectorAuth } from '../../data/connectors';
import { CONNECTOR_PRESETS, updateConnector, checkConnector } from '../../data/connectors';

interface Props {
  connector: Connector;
  onClose: () => void;
  onSaved: () => void;
}

export default function ConnectorConfigModal({ connector, onClose, onSaved }: Props) {
  const { message } = App.useApp();
  const preset = CONNECTOR_PRESETS.find(p => p.mcpServerName === connector.mcpServerName);

  const [baseUrl, setBaseUrl] = useState(connector.baseUrl ?? preset?.baseUrl ?? '');
  const [authType, setAuthType] = useState<ConnectorAuth['type']>(connector.auth?.type ?? preset?.authType ?? 'none');
  const [token, setToken] = useState(connector.auth?.token ?? '');
  const [enabled, setEnabled] = useState(connector.enabled);
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    const c: Connector = {
      ...connector,
      baseUrl: baseUrl.trim() || undefined,
      auth: authType === 'none' ? undefined
        : { type: authType, token: token.trim() || undefined },
      enabled: true,
    };
    const result = await checkConnector(c);
    if (result.status === 'connected') {
      message.success('连接成功！');
    } else {
      message.warning(`连接失败: ${result.error ?? '未知原因'}`);
    }
    setTesting(false);
  };

  const handleSave = () => {
    const updates: Partial<Connector> = {
      baseUrl: baseUrl.trim() || undefined,
      enabled,
    };
    if (authType === 'none') {
      updates.auth = undefined;
    } else {
      updates.auth = {
        type: authType,
        token: token.trim() || undefined,
      };
    }
    updateConnector(connector.id, updates);
    message.success('连接器配置已保存');
    onSaved();
    onClose();
  };

  return (
    <Modal
      title={`配置连接器 - ${connector.label}`}
      open
      onCancel={onClose}
      footer={null}
      width={520}
      destroyOnClose
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
        {/* 连接器信息 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--bg-deep)' }}>
          <span style={{ fontSize: 24 }}>{connector.icon}</span>
          <div>
            <div style={{ fontWeight: 600 }}>{connector.label}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{preset?.desc ?? connector.type}</div>
          </div>
        </div>

        {/* 启用开关 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 500 }}>启用连接器</span>
          <Switch checked={enabled} onChange={setEnabled} />
        </div>

        {/* 基础配置 */}
        {connector.type === 'custom' && (
          <>
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>服务地址 (Base URL)</div>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={preset?.baseUrl ? `默认: ${preset.baseUrl}` : 'https://api.example.com'}
              />
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>认证方式</div>
              <Select
                value={authType}
                onChange={(v) => setAuthType(v)}
                style={{ width: '100%' }}
                options={[
                  { value: 'apikey', label: 'API Key（自定义 header）' },
                  { value: 'bearer', label: 'Bearer Token' },
                  { value: 'none', label: '无认证' },
                ]}
              />
            </div>

            {authType !== 'none' && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                  {authType === 'bearer' ? 'Bearer Token' : 'API Key'}
                </div>
                <Input.Password
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={authType === 'bearer' ? 'sk-xxx...' : 'your-api-key'}
                />
              </div>
            )}
          </>
        )}

        {/* MCP 类型提示 */}
        {connector.type === 'mcp' && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 12,
            background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
            color: 'var(--text-secondary)',
          }}>
            💡 MCP 类型连接器需先在 WorkBuddy 中配置对应 MCP 服务，启用后助手可通过工具调用其能力。
            当前状态：<strong>{connector.status === 'connected' ? '已连接' : connector.status === 'disconnected' ? '已断开' : '未知'}</strong>
          </div>
        )}

        {/* 操作按钮 */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8 }}>
          {connector.type === 'custom' && (
            <Button onClick={handleTest} loading={testing} disabled={!baseUrl}>
              🔍 测试连接
            </Button>
          )}
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={handleSave}>保存配置</Button>
        </div>
      </div>
    </Modal>
  );
}
