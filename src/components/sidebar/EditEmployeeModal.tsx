import { useState } from 'react';
import type { Employee, OpcRoleId, ModelConfig } from '../../types';
import { ROLE_SCARF } from '../../types';
import { useStore } from '../../store';
import { PROVIDER_PRESETS, getProvider } from '../../data/hermesClient';
import AgentAvatar from '../office/AgentAvatar';

interface Props {
  employee: Employee;
  onClose: () => void;
}

export default function EditEmployeeModal({ employee, onClose }: Props) {
  const { dispatch } = useStore();

  const [name, setName] = useState(employee.name);
  const [title, setTitle] = useState(employee.title);
  const [role, setRole] = useState<OpcRoleId>(employee.role);
  const [prompt, setPrompt] = useState(employee.prompt ?? '');
  const [soul, setSoul] = useState(employee.soul ?? '');
  const [isOnline, setIsOnline] = useState(employee.isOnline);

  // 模型配置
  const mc = employee.modelConfig;
  const [useCustomModel, setUseCustomModel] = useState(!!mc);
  const [provider, setProvider] = useState(mc?.provider ?? 'deepseek');
  const [apiHost, setApiHost] = useState(mc?.apiHost ?? '');
  const [apiKey, setApiKey] = useState(mc?.apiKey ?? '');
  const [modelName, setModelName] = useState(mc?.model ?? '');

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

  const handleSave = () => {
    if (!name.trim()) return alert('请输入名字');

    let modelConfig: ModelConfig | undefined;
    if (useCustomModel) {
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
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box" style={{ width: 520 }}>
        <h2>✏️ 编辑员工 — {employee.name}</h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <AgentAvatar employee={employee} size={48} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{employee.name}</div>
            <div style={{ fontSize: 12, color: employee.statusColor }}>{employee.title}</div>
          </div>
        </div>

        {/* 基本信息 */}
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">姓名</label>
            <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">身份牌</label>
            <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：技术总监" />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">角色</label>
          <select className="form-select" value={role} onChange={(e) => setRole(e.target.value as OpcRoleId)}>
            <option value="pm">PM 协调者</option>
            <option value="planner">Planner 规划者</option>
            <option value="coder">Coder 编码者</option>
            <option value="checker">Checker 审查者</option>
            <option value="custom">自定义</option>
          </select>
        </div>

        {/* 在线状态 */}
        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label className="form-label" style={{ margin: 0 }}>在线状态</label>
          <button
            type="button"
            className={`toggle-switch ${isOnline ? 'on' : ''}`}
            onClick={() => setIsOnline(!isOnline)}
          >
            <span className="toggle-knob" />
          </button>
          <span style={{ fontSize: 11, color: isOnline ? 'var(--online)' : 'var(--offline)' }}>
            {isOnline ? '在线 🟢' : '离线'}
          </span>
        </div>

        <div className="form-group">
          <label className="form-label">个性提示词（人设/说话风格）</label>
          <textarea
            className="form-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：你是一个严谨的测试工程师，说话简洁，喜欢用数据和事实回复。"
            rows={2}
          />
        </div>

        {/* ──── 核心人格 soul.md ──── */}
        <div className="form-group">
          <label className="form-label">
            核心人格 · soul.md
            <span className="form-hint" style={{ display: 'block', marginTop: 2 }}>
              AI 的深度人格设定，定义世界观、价值观、行事风格。比「个性提示词」更底层、更完整。
            </span>
          </label>
          <textarea
            className="form-textarea"
            value={soul}
            onChange={(e) => setSoul(e.target.value)}
            placeholder={`示例（按需修改）：\n# ${employee.name} 的核\n\n我是一个经验丰富的软件工程师，拥有 10 年全栈开发经验。\n- 信仰：代码可读性 > 炫技，测试覆盖 > 口头承诺\n- 沟通：直接、坦诚，喜欢先理解问题再给方案\n- 决策偏好：倾向于渐进式重构而非重写\n- 写作风格：中文为主，关键术语用英文`}
            rows={6}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
        </div>

        <div className="form-group">
          <label className="form-label">角色标识色</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 20, height: 20, borderRadius: 4, background: ROLE_SCARF[role] }} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ROLE_SCARF[role]}</span>
          </div>
        </div>

        {/* ──── 分隔线：独立模型配置 ──── */}
        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '16px 0' }} />

        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label className="form-label" style={{ margin: 0, flex: 1 }}>
            独立模型配置
            <span className="form-hint" style={{ display: 'block', marginTop: 2 }}>
              开启后该员工使用独立模型，不跟随全局设置
            </span>
          </label>
          <button
            type="button"
            className={`toggle-switch ${useCustomModel ? 'on' : ''}`}
            onClick={() => setUseCustomModel(!useCustomModel)}
          >
            <span className="toggle-knob" />
          </button>
        </div>

        {useCustomModel && (
          <>
            {/* 服务商选择 */}
            <div className="form-group">
              <label className="form-label">服务商</label>
              <div className="provider-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {PROVIDER_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={`provider-option ${provider === p.key ? 'selected' : ''}`}
                    onClick={() => onProviderChange(p.key)}
                    title={p.desc}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">API 地址（base_url）</label>
              <input
                className="form-input"
                value={apiHost}
                onChange={(e) => setApiHost(e.target.value)}
                placeholder="如 https://api.deepseek.com"
              />
            </div>

            <div className="form-group">
              <label className="form-label">API Key</label>
              <input
                className="form-input"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="该员工专用的 API Key（留空则用全局）"
              />
            </div>

            <div className="form-group">
              <label className="form-label">模型名</label>
              <input
                className="form-input"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="如 deepseek-chat / gpt-4o-mini"
              />
            </div>

            {provider !== 'custom' && modelName && (
              <div className="api-preview">
                <span className="api-preview-label">模型：</span>
                <code className="api-preview-url">
                  {getProvider(provider).label} / {modelName}
                </code>
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSave}>保存修改</button>
        </div>
      </div>
    </div>
  );
}
