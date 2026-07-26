import { useState } from 'react';
import { DownloadOutlined, FolderOpenOutlined, LinkOutlined } from '@ant-design/icons';
import { App, Button, Input, Modal, Select, Switch } from 'antd';
import type { Connector, ConnectorAuth } from '../../data/connectors';
import { checkConnector, connectorMissingFields, findConnectorPreset, upsertConnector } from '../../data/connectors';

interface Props { connector: Connector; onClose: () => void; onSaved: () => void; }

export default function ConnectorConfigModal({ connector, onClose, onSaved }: Props) {
  const { message } = App.useApp();
  const preset = findConnectorPreset(connector.mcpServerName || connector.label);
  const [label, setLabel] = useState(connector.label);
  const [baseUrl, setBaseUrl] = useState(connector.baseUrl ?? preset?.baseUrl ?? '');
  const [localPath, setLocalPath] = useState(connector.localPath ?? '');
  const [authType, setAuthType] = useState<ConnectorAuth['type']>(connector.auth?.type ?? preset?.authType ?? 'none');
  const [token, setToken] = useState(connector.auth?.token ?? '');
  const [headers, setHeaders] = useState(Object.entries(connector.headers ?? {}).map(([key, value]) => `${key}: ${value}`).join('\n'));
  const [credentials, setCredentials] = useState<Record<string, string>>(connector.credentials ?? {});
  const [documentationUrl, setDocumentationUrl] = useState(connector.documentationUrl ?? preset?.documentationUrl ?? '');
  const [skillSourceUrl, setSkillSourceUrl] = useState(connector.skillSourceUrl ?? preset?.skillSourceUrl ?? '');
  const [installedSkillId, setInstalledSkillId] = useState(connector.installedSkillId ?? '');
  const [installingSkill, setInstallingSkill] = useState(false);
  const [enabled, setEnabled] = useState(connector.enabled);
  const [saving, setSaving] = useState(false);

  const parseHeaders = () => Object.fromEntries(headers.split('\n').map((line) => line.split(/:\s*/, 2)).filter(([key, value]) => key && value));
  const buildConnector = (): Connector => ({
    ...connector,
    label: label.trim() || preset?.label || connector.label,
    baseUrl: baseUrl.trim() || undefined,
    localPath: localPath.trim() || undefined,
    headers: parseHeaders(),
    auth: authType === 'none' ? undefined : { type: authType, token: token.trim() || undefined },
    credentials: connector.kind === 'skill-bridge' ? credentials : connector.credentials,
    credentialFields: preset?.credentialFields ?? connector.credentialFields,
    documentationUrl: documentationUrl.trim() || undefined,
    skillSourceUrl: skillSourceUrl.trim() || undefined,
    skillName: preset?.skillName ?? connector.skillName,
    installedSkillId: installedSkillId || undefined,
    enabled,
  });

  const pickVault = async () => {
    const result = await window.electronAPI?.knowledgePickObsidian?.();
    if (!result || result.canceled) return;
    if (!result.ok || !result.path) { message.error(result.error ?? '无法打开该目录'); return; }
    setLocalPath(result.path);
    if (!label.trim() || label === 'Obsidian') setLabel(result.path.split(/[\\/]/).filter(Boolean).pop() || 'Obsidian');
    message.success(`已发现 ${result.noteCount ?? 0} 篇笔记`);
  };

  const handleSave = async () => {
    const draft = buildConnector();
    const missing = connectorMissingFields(draft);
    if (missing.length > 0) { message.warning(`还需要填写：${missing.join('、')}`); return; }
    setSaving(true);
    const result = await checkConnector(draft);
    upsertConnector({ ...draft, status: result.status, error: result.error, lastChecked: Date.now(), enabled: result.status === 'connected' ? true : draft.enabled });
    setSaving(false);
    onSaved();
    if (result.status === 'connected') { message.success(`${draft.label} 已配置并连接`); onClose(); }
    else message.warning(result.error ?? '配置已保存，连接测试未通过');
  };

  const installSkillPackage = async () => {
    if (!skillSourceUrl.trim()) { message.warning('请先填写官方 Skill 下载地址'); return; }
    let parsed: URL;
    try { parsed = new URL(skillSourceUrl.trim()); } catch { message.warning('Skill 下载地址无效'); return; }
    if (parsed.protocol !== 'https:') { message.warning('Skill 下载地址必须使用 HTTPS'); return; }
    if (!window.electronAPI?.skillsInstall) { message.error('当前环境不支持安装 Skill'); return; }
    setInstallingSkill(true);
    const result = await window.electronAPI.skillsInstall({ sourceUrl: parsed.toString(), name: preset?.skillName ?? connector.skillName });
    setInstallingSkill(false);
    if (!result.ok || !result.skill) { message.error(result.error ?? 'Skill 安装失败'); return; }
    setInstalledSkillId(result.skill.id);
    message.success(`${result.skill.name} 已安装，请继续填写凭据并保存`);
  };

  const isKnowledge = connector.kind === 'knowledge-url' || connector.kind === 'obsidian';
  const isSkillBridge = connector.kind === 'skill-bridge';
  return (
    <Modal title={connector.kind === 'obsidian' ? '配置 Obsidian' : connector.kind === 'knowledge-url' ? '配置网页知识库' : `配置 ${connector.label}`} open onCancel={onClose} footer={null} width={560} destroyOnClose>
      <div className="knowledge-config-form">
        <div className="knowledge-config-summary"><span>{connector.kind === 'obsidian' ? <FolderOpenOutlined /> : <LinkOutlined />}</span><div><strong>{preset?.label ?? connector.label}</strong><small>{preset?.desc ?? connector.type}</small></div></div>
        <label><span>名称</span><Input value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        {connector.kind === 'knowledge-url' && <label><span>知识库链接</span><Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://docs.example.com/knowledge" /></label>}
        {connector.kind === 'obsidian' && <label><span>Vault 目录</span><div className="knowledge-path-row"><Input value={localPath} readOnly placeholder="选择 Obsidian Vault" /><Button icon={<FolderOpenOutlined />} onClick={() => void pickVault()}>选择</Button></div></label>}
        {isSkillBridge && (
          <>
            <label><span>官方说明页</span><div className="knowledge-path-row"><Input value={documentationUrl} onChange={(event) => setDocumentationUrl(event.target.value)} placeholder="由助手阅读官方说明后填写" /><Button icon={<LinkOutlined />} disabled={!documentationUrl.trim()} onClick={() => void window.electronAPI?.openExternal(documentationUrl.trim())}>打开</Button></div></label>
            <label><span>官方 Skill 下载地址</span><div className="knowledge-path-row"><Input value={skillSourceUrl} onChange={(event) => { setSkillSourceUrl(event.target.value); setInstalledSkillId(''); }} placeholder="SKILL.md、GitHub 目录或 ZIP" /><Button icon={<DownloadOutlined />} loading={installingSkill} onClick={() => void installSkillPackage()}>{installedSkillId ? '重装' : '安装'}</Button></div></label>
            {installedSkillId && <div className="knowledge-skill-status">Skill 已安装并关联</div>}
            {(preset?.credentialFields ?? connector.credentialFields ?? []).map((field) => (
              <label key={field.key}><span>{field.label}{field.required ? ' *' : ''}</span>{field.secret
                ? <Input.Password value={credentials[field.key] ?? ''} onChange={(event) => setCredentials((current) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.placeholder} />
                : <Input value={credentials[field.key] ?? ''} onChange={(event) => setCredentials((current) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.placeholder} />}</label>
            ))}
          </>
        )}
        {!isKnowledge && !isSkillBridge && (
          <>
            <label><span>服务地址 / MCP endpoint</span><Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label>
            <label><span>认证方式</span><Select value={authType} onChange={setAuthType} options={[{ value: 'apikey', label: 'API Key' }, { value: 'bearer', label: 'Bearer Token' }, { value: 'none', label: '无认证' }]} /></label>
            {authType !== 'none' && <label><span>认证凭据</span><Input.Password value={token} onChange={(event) => setToken(event.target.value)} /></label>}
            <label><span>自定义 Headers</span><Input.TextArea value={headers} onChange={(event) => setHeaders(event.target.value)} rows={3} /></label>
          </>
        )}
        <div className="knowledge-enable-row"><span>启用</span><Switch checked={enabled} onChange={setEnabled} /></div>
        <div className="knowledge-config-actions"><Button onClick={onClose}>取消</Button><Button type="primary" loading={saving} onClick={() => void handleSave()}>一键配置</Button></div>
      </div>
    </Modal>
  );
}
