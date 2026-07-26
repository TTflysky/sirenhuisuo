import { useEffect, useState } from 'react';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import {
  APPROVAL_MODE_OPTIONS,
  getExecutionPolicy,
  saveExecutionPolicy,
  type ApprovalMode,
  type ExecutionPolicy,
} from '../../data/hermesClient';
import { onBus } from '../../ipcBus';

function isExecutionPolicy(value: unknown): value is ExecutionPolicy {
  if (!value || typeof value !== 'object') return false;
  const policy = value as Partial<ExecutionPolicy>;
  return typeof policy.sandboxEnabled === 'boolean'
    && (policy.approvalMode === 'ask' || policy.approvalMode === 'delegate' || policy.approvalMode === 'full');
}

/** Shared approval selector used by assistant, direct-message, and team chats. */
export default function ExecutionPolicyControl() {
  const [policy, setPolicy] = useState<ExecutionPolicy>(() => getExecutionPolicy());
  const selected = APPROVAL_MODE_OPTIONS.find((option) => option.value === policy.approvalMode) ?? APPROVAL_MODE_OPTIONS[1];

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'hermes_office_settings') setPolicy(getExecutionPolicy());
    };
    const unsubscribe = onBus('execution-policy:changed', (value) => {
      if (isExecutionPolicy(value)) setPolicy(value);
    });
    const onPolicyChange = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (isExecutionPolicy(detail)) setPolicy(detail);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('execution-policy:changed', onPolicyChange);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('execution-policy:changed', onPolicyChange);
    };
  }, []);

  const update = (approvalMode: ApprovalMode) => {
    const next = saveExecutionPolicy({ approvalMode });
    setPolicy(getExecutionPolicy(next));
  };

  return (
    <label
      className="execution-policy-control"
      title={`${selected.description} 当前命令${policy.sandboxEnabled ? '只在沙盒工作区内运行。' : '可访问沙盒外的本机路径。'}`}
    >
      <SafetyCertificateOutlined aria-hidden="true" />
      <select value={policy.approvalMode} onChange={(event) => update(event.target.value as ApprovalMode)} aria-label="工具审批方式">
        {APPROVAL_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <span className={`execution-sandbox-state${policy.sandboxEnabled ? '' : ' is-open'}`}>{policy.sandboxEnabled ? '沙盒' : '直连'}</span>
    </label>
  );
}
