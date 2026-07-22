import { useState, useRef, useEffect } from 'react';
import { loadSettings, saveSettings, getProvider } from '../../data/hermesClient';

// 为每个服务商提供常用的模型选项
const PROVIDER_MODELS: Record<string, string[]> = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  qwen: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'],
  zhipu: ['glm-4-flash', 'glm-4-plus', 'glm-4-long'],
  kimi: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  doubao: ['doubao-1.5-pro', 'doubao-1.5-lite', 'doubao-1.5-pro-256k'],
  hunyuan: ['hunyuan-pro', 'hunyuan-standard', 'hunyuan-lite'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'o3-mini', 'gpt-4.1-mini', 'gpt-4.1-nano'],
  custom: [''],
};

/** 获取当前可用的模型选择列表 */
function getModelOptions(): { label: string; value: string }[] {
  const s = loadSettings();
  const provider = s.provider ?? 'custom';
  const models = PROVIDER_MODELS[provider] ?? [];
  return models.map((m) => ({
    label: m || '输入模型名…',
    value: m,
  }));
}

export default function ModelSelector() {
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const settings = loadSettings();
  const currentModel = settings.model || getProvider(settings.provider).defaultModel || '未设置';
  const currentProvider = getProvider(settings.provider);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const switchModel = (model: string) => {
    if (!model) return;
    const s = loadSettings();
    s.model = model;
    saveSettings(s);
    setOpen(false);
  };

  const handleCustomSubmit = () => {
    const m = customInput.trim();
    if (m) switchModel(m);
  };

  const options = getModelOptions();

  return (
    <div className="model-selector" ref={menuRef}>
      <button
        className="model-selector-btn"
        onClick={() => setOpen(!open)}
        title={`当前模型：${currentModel}（${currentProvider.label}）`}
      >
        <span className="model-selector-icon">🧠</span>
        <span className="model-selector-name">{currentModel}</span>
        <span className="model-selector-arrow">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="model-selector-dropdown">
          <div className="model-selector-header">
            {currentProvider.label} · 切换模型
          </div>

          {options.length > 0 && (
            <div className="model-selector-list">
              {options.map((opt) => (
                <button
                  key={opt.value}
                  className={`model-selector-option ${currentModel === opt.value ? 'active' : ''}`}
                  onClick={() => opt.value && switchModel(opt.value)}
                >
                  {opt.value === currentModel && <span className="model-selector-check">✓ </span>}
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          <div className="model-selector-custom">
            <input
              ref={inputRef}
              className="form-input"
              placeholder="输入自定义模型名回车…"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCustomSubmit(); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
