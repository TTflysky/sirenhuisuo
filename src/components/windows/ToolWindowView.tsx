import { useEffect, useMemo, useState } from 'react';
import { AppstoreOutlined, CloseOutlined, MinusOutlined, BorderOutlined } from '@ant-design/icons';
import { useStore } from '../../store';
import type { Connector } from '../../data/connectors';
import AddEmployeeModal from '../sidebar/AddEmployeeModal';
import CreateTeamModal from '../sidebar/CreateTeamModal';
import EditEmployeeModal from '../sidebar/EditEmployeeModal';
import RenameTeamModal from '../sidebar/RenameTeamModal';
import ConnectorConfigModal from '../sidebar/ConnectorConfigModal';
import AssistantSettingsModal from '../settings/AssistantSettingsModal';
import { BUS_CHANNELS, sendBus } from '../../ipcBus';
import { APP_VERSION } from '../../appVersion';

interface Props { hash: string; }

const TITLES: Record<string, string> = {
  'add-employee': '添加员工',
  'edit-employee': '编辑员工',
  'create-team': '新建团队',
  'rename-team': '重命名团队',
  'connector-config': '配置连接器',
  'assistant-settings': '助手设置',
};

export default function ToolWindowView({ hash }: Props) {
  const { state } = useStore();
  const params = useMemo(() => new URLSearchParams(hash.replace(/^#tool\??/, '')), [hash]);
  const type = params.get('type') ?? '';
  const refId = params.get('id') ?? '';
  const session = params.get('session') ?? '';
  const [payload, setPayload] = useState<unknown>(undefined);
  const close = () => window.electronAPI?.close();

  useEffect(() => {
    let active = true;
    window.electronAPI?.getToolPayload(session).then((value) => active && setPayload(value));
    return () => { active = false; };
  }, [session]);

  const employee = state.employees.find((item) => item.id === refId);
  const team = state.teams.find((item) => item.id === refId);
  const content = (() => {
    if (type === 'add-employee') return <AddEmployeeModal standalone onClose={close} />;
    if (type === 'create-team') return <CreateTeamModal onClose={close} />;
    if (type === 'edit-employee') return employee ? <EditEmployeeModal employee={employee} onClose={close} /> : <WindowError text="没有找到这名员工，可能已经被删除。" />;
    if (type === 'rename-team') return team ? <RenameTeamModal teamId={team.id} currentName={team.name} onClose={close} /> : <WindowError text="没有找到这个团队，可能已经被删除。" />;
    if (type === 'connector-config') {
      if (payload === undefined) return <div className="tool-window-loading">正在读取连接器配置…</div>;
      if (!payload) return <WindowError text="没有读取到连接器配置，请关闭后重新打开。" />;
      return <ConnectorConfigModal standalone connector={payload as Connector} onClose={close} onSaved={() => sendBus(BUS_CHANNELS.CONNECTORS_CHANGED, { updatedAt: Date.now() })} />;
    }
    if (type === 'assistant-settings') return <AssistantSettingsModal onClose={close} onSaved={() => sendBus(BUS_CHANNELS.ASSISTANT_SETTINGS_CHANGED, { updatedAt: Date.now() })} />;
    return <WindowError text="无法识别这个窗口。" />;
  })();

  return (
    <div className="tool-window-view">
      <header className="tool-window-titlebar">
        <span className="tool-window-title"><AppstoreOutlined /><strong>{TITLES[type] ?? '工具窗口'}</strong><span className="window-version-badge" title={`当前版本 v${APP_VERSION}`}>v{APP_VERSION}</span></span>
        <span className="tool-window-controls">
          <button onClick={() => window.electronAPI?.minimize()} title="最小化"><MinusOutlined /></button>
          <button onClick={() => window.electronAPI?.toggleMax()} title="最大化或还原"><BorderOutlined /></button>
          <button className="tool-window-close" onClick={close} title="关闭"><CloseOutlined /></button>
        </span>
      </header>
      <main className="tool-window-body">{content}</main>
    </div>
  );
}

function WindowError({ text }: { text: string }) {
  return <div className="tool-window-error"><strong>暂时无法打开</strong><span>{text}</span></div>;
}
