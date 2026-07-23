import { useState } from 'react';
import { Modal, Select, Switch, Input, Button, App } from 'antd';
import type { Employee, OpcRoleId, ModelConfig } from '../../types';
import { ROLE_SCARF } from '../../types';
import { useStore } from '../../store';
import { PROVIDER_PRESETS, getProvider, loadSettings } from '../../data/hermesClient';
import type { ModelEntry } from '../../data/hermesClient';
import AgentAvatar from '../office/AgentAvatar';

interface Props {
  employee: Employee;
  onClose: () => void;
}

export default function EditEmployeeModal({ employee, onClose }: Props) {
  const { dispatch } = useStore();
  const { message } = App.useApp();

  const [name, setName] = useState(employee.name);
  const [title, setTitle] = useState(employee.title);
  const [role, setRole] = useState<OpcRoleId>(employee.role);
  const [prompt, setPrompt] = useState(employee.prompt ?? '');
  const [soul, setSoul] = useState(employee.soul ?? '');
  const [isOnline, setIsOnline] = useState(employee.isOnline);

  // 模型配置
  const mc = employee.modelConfig;
  const [useCustomModel, setUseCustomModel] = useState(!!mc);

  // 模式选择：'manual' = 手动填写全部，'ref' = 引用模型库已有模型
  const [modelMode, setModelMode] = useState<'manual' | 'ref'>(
    mc && !mc.refModelId ? 'manual' : 'ref'
  );
  const [refModelId, setRefModelId] = useState(mc?.refModelId ?? '');

  const [provider, setProvider] = useState(mc?.provider ?? 'deepseek');
  const [apiHost, setApiHost] = useState(mc?.apiHost ?? '');
  const [apiKey, setApiKey] = useState(mc?.apiKey ?? '');
  const [modelName, setModelName] = useState(mc?.model ?? '');

  // 模型库列表
  const modelLibrary: ModelEntry[] = loadSettings().modelLibrary ?? [];

  // 引用的模型显示名
  const refEntry = modelLibrary.find(m => m.id === refModelId);

  const onProviderChange = (key: string) => {
    setProvider(key);
    if (key === 'custom') return;
    const preset = getProvider(key);
    if (!apiHost || apiHost === getProvider(provider).baseUrl) {
      setApiHost(preset.baseUrl);
    }
    if (!modelName || modelName === getProvider(provider).defaultModel) {
      setModelName(preset.defaultModel);
    }
  };

  const handleModelModeChange = (mode: 'manual' | 'ref') => {
    setModelMode(mode);
    if (mode === 'ref' && modelLibrary.length > 0 && !refModelId) {
      setRefModelId(modelLibrary[0].id);
    }
    if (mode === 'manual' && refModelId) {
      setRefModelId('');
    }
  };

  const handleRefModelChange = (id: string) => {
    setRefModelId(id);
    // 自动填充引用的模型配置到输入框（方便视觉确认）
    const entry = modelLibrary.find(m => m.id === id);
    if (entry) {
      setProvider(entry.provider ?? 'deepseek');
      setApiHost(entry.apiHost ?? '');
      setApiKey(entry.apiKey ?? '');
      setModelName(entry.model ?? '');
    }
  };

  const handleSave = () => {
    if (!name.trim()) {
      message.warning('请输入名字');
      return;
    }

    let modelConfig: ModelConfig | undefined;
    if (useCustomModel) {
      if (modelMode === 'ref' && refModelId) {
        // 引用模式：只存 refModelId，不存具体配置
        modelConfig = { refModelId };
      } else {
        modelConfig = {
          provider: provider || undefined,
          apiHost: apiHost.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
          model: modelName.trim() || undefined,
        };
        // 如果所有配置都为空，等同于使用全局
        if (!modelConfig.provider && !modelConfig.apiHost && !modelConfig.apiKey && !modelConfig.model) {
          modelConfig = undefined;
        }
      }
    }

    dispatch({
      type: 'UPDATE_EMPLOYEE',
      id: employee.id,
      partial: {
        name: name.trim(),
        title: title.trim(),
        role,
        prompt: prompt.trim() || undefined,
        soul: soul.trim() || undefined,
        isOnline,
        modelConfig,
      },
    });
    onClose();
  };

  return (
    <Modal
      open
      onCancel={onClose}
      title={`✏️ 编辑员工 — ${employee.name}`}
      width={540}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="save" type="primary" onClick={handleSave}>保存修改</Button>,
      ]}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <AgentAvatar employee={employee} size={48} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{employee.name}</div>
          <div style={{ fontSize: 12, color: employee.statusColor }}>{employee.title}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>姓名</div>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div style={{ flex: 1, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>身份牌</div>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：技术总监" />
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>角色</div>
        <Select
          value={role}
          onChange={(v) => setRole(v as OpcRoleId)}
          style={{ width: '100%' }}
          options={[
            { value: 'pm', label: 'PM 协调者' },
            { value: 'planner', label: 'Planner 规划者' },
            { value: 'coder', label: 'Coder 编码者' },
            { value: 'checker', label: 'Checker 审查者' },
            { value: 'custom', label: '自定义' },
          ]}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>在线状态</div>
        <Switch
          checked={isOnline}
          onChange={(c) => setIsOnline(c)}
          checkedChildren="在线 🟢"
          unCheckedChildren="离线"
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>个性提示词（人设/说话风格）</div>
        <Input.TextArea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例如：你是一个严谨的测试工程师，说话简洁，喜欢用数据和事实回复。"
          rows={2}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
          核心人格 · soul.md
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2 }}>
            AI 的深度人格设定，定义世界观、价值观、行事风格。比「个性提示词」更底层、更完整。
          </div>
        </div>
        <Input.TextArea
          value={soul}
          onChange={(e) => setSoul(e.target.value)}
          placeholder={`示例（按需修改）：\n# ${employee.name} 的核\n\n我是一个经验丰富的软件工程师，拥有 10 年全栈开发经验。\n- 信仰：代码可读性 > 炫技，测试覆盖 > 口头承诺\n- 沟通：直接、坦诚，喜欢先理解问题再给方案\n- 决策偏好：倾向于渐进式重构而非重写\n- 写作风格：中文为主，关键术语用英文`}
          rows={6}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>角色标识色</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 20, height: 20, borderRadius: 4, background: ROLE_SCARF[role] }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ROLE_SCARF[role]}</span>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', margin: '18px 0' }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>独立模型配置</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            开启后该员工使用独立模型，不跟随全局设置
          </div>
        </div>
        <Switch checked={useCustomModel} onChange={(c) => setUseCustomModel(c)} />
      </div>

      {useCustomModel && (
        <>
          {/* 模式选择：引用已有模型 vs 手动配置 */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>配置方式</div>
            <Select
              value={modelMode}
              onChange={handleModelModeChange}
              style={{ width: '100%' }}
              options={[
                { value: 'ref', label: '📦 引用模型库中已配置的模型' },
                { value: 'manual', label: '✏️ 手动填写模型配置' },
              ]}
            />
          </div>

          {modelMode === 'ref' ? (
            <>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>选择模型</div>
                {modelLibrary.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>
                    模型库为空，请先在 ⚙️ 设置中添加模型
                  </div>
                ) : (
                  <Select
                    value={refModelId}
                    onChange={handleRefModelChange}
                    style={{ width: '100%' }}
                    options={modelLibrary.map(m => ({
                      value: m.id,
                      label: `${m.label} ${m.tested === 'ok' ? '✓' : m.tested === 'fail' ? '✗' : ''} · ${m.model ?? ''}`,
                    }))}
                  />
                )}
              </div>

              {refEntry && (
                <div style={{
                  padding: '10px 12px', background: 'var(--bg-deep)', borderRadius: 8,
                  fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6,
                }}>
                  引用: <strong>{refEntry.label}</strong><br />
                  服务商: {refEntry.provider ? getProvider(refEntry.provider).label : '默认'}<br />
                  模型: {refEntry.model ?? '默认'}<br />
                  API: {(refEntry.apiKey ?? '').slice(0, 8)}...
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>服务商</div>
                <Select
                  value={provider}
                  onChange={onProviderChange}
                  style={{ width: '100%' }}
                  options={PROVIDER_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>API 地址（base_url）</div>
                <Input
                  value={apiHost}
                  onChange={(e) => setApiHost(e.target.value)}
                  placeholder="如 https://api.deepseek.com"
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>API Key</div>
                <Input.Password
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="该员工专用的 API Key（留空则用全局）"
                />
              </div>

              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>模型名</div>
                <Input
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder="如 deepseek-chat / gpt-4o-mini"
                />
              </div>

              {provider !== 'custom' && modelName && (
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
                  模型：<code>{getProvider(provider).label} / {modelName}</code>
                </div>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
