import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { getConversationModel, getModelCapabilities, loadSettings, saveSettings, getProvider, resolveChatSettings } from '../../data/hermesClient';
import type { ModelEntry } from '../../data/hermesClient';
import type { ChatMessage, ModelConfig } from '../../types';

interface Props {
  /** 'assistant' | 'dm' (员工私聊) | 'team' (团队) */
  scene?: 'assistant' | 'dm' | 'team';
  /** DM 场景下传入员工 ID，以正确读取员工独立模型 */
  employeeId?: string;
  /** 当前窗口实际会使用的模型配置。 */
  modelConfig?: ModelConfig;
  /** 用于显示最近一次请求的真实上下文用量。 */
  messages?: ChatMessage[];
}

function formatTokens(value: number): string {
  return value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K` : String(value);
}

function estimateMessageTokens(messages: ChatMessage[]): number {
  const text = messages.slice(-20).map((message) => message.content).join('\n');
  let tokens = 240; // System prompt, role metadata and message framing.
  for (const char of text) tokens += /[一-鿿]/u.test(char) ? 0.67 : 0.25;
  return Math.max(1, Math.round(tokens));
}

export default function ModelSelector({ scene = 'assistant', employeeId: _employeeId, modelConfig, messages = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  // 读取当前实际使用的模型
  const settings = loadSettings();
  const selectedModel = settings.chatModelOverrides?.[scene] ? getConversationModel(scene) : undefined;
  const resolved = resolveChatSettings(modelConfig);  // 解析当前窗口实际配置

  // 确定当前模型显示名
  let currentModel: string;
  let currentProviderLabel: string;
  let usingLibrary: boolean = false;

  if (selectedModel?.model) {
    currentModel = selectedModel.model;
    currentProviderLabel = getProvider(selectedModel.provider).label;
    usingLibrary = Boolean(selectedModel.refModelId);
  } else if (scene === 'assistant' && settings.modelLibrary && settings.modelLibrary.length > 0 && settings.assistantModelId) {
    // 助理场景：仅在明确选择 assistantModelId 时使用模型库
    const entry = settings.modelLibrary.find(e => e.id === settings.assistantModelId);
    if (entry) {
      currentModel = entry.model || entry.label;
      currentProviderLabel = entry.label;
      usingLibrary = true;
    } else {
      currentModel = settings.model || getProvider().defaultModel || '未设置';
      currentProviderLabel = getProvider().label;
    }
  } else if (settings.modelLibrary && settings.modelLibrary.length > 0 && settings.activeModelId) {
    const entry = settings.modelLibrary.find(e => e.id === settings.activeModelId);
    if (entry) {
      currentModel = entry.model || entry.label;
      currentProviderLabel = entry.label;
      usingLibrary = true;
    } else {
      currentModel = settings.model || getProvider().defaultModel || '未设置';
      currentProviderLabel = getProvider().label;
    }
  } else {
    currentModel = settings.model || resolved.model || getProvider().defaultModel || '未设置';
    currentProviderLabel = getProvider().label;
  }

  if (scene === 'dm' && modelConfig?.model && !selectedModel?.refModelId) {
    currentModel = modelConfig.model;
    currentProviderLabel = getProvider(modelConfig.provider).label;
  }

  const effectiveModel = selectedModel?.model ? selectedModel : (modelConfig ?? getConversationModel(scene));
  const currentEntry = libraryEntryForContext(settings.modelLibrary ?? [], currentModel, effectiveModel);
  const configuredLimit = effectiveModel.contextWindowTokens ?? currentEntry?.contextWindowTokens;
  const latestUsage = [...messages].reverse().find((message) => message.contextUsage)?.contextUsage;
  const usedTokens = latestUsage?.promptTokens ?? estimateMessageTokens(messages);
  const usageSource = latestUsage?.source ?? 'estimate';
  const contextTitle = configuredLimit
    ? `最近一次模型输入：${usedTokens.toLocaleString()} / ${configuredLimit.toLocaleString()} tokens（${usageSource === 'api' ? '服务端真实值' : '本地估算'}）`
    : `最近一次模型输入：${usedTokens.toLocaleString()} tokens（${usageSource === 'api' ? '服务端真实值' : '本地估算'}）；模型上限未设置`;
  const percentage = configuredLimit ? Math.min(100, Math.round((usedTokens / configuredLimit) * 100)) : undefined;

  const updateMenuPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 16);
    const gap = 6;
    const estimatedHeight = Math.min(520, window.innerHeight - 24);
    const top = rect.top >= estimatedHeight + gap
      ? rect.top - estimatedHeight - gap
      : Math.min(rect.bottom + gap, window.innerHeight - estimatedHeight - 12);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    setMenuStyle({ top, left, width, maxHeight: Math.max(180, window.innerHeight - top - 12) });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const handler = () => updateMenuPosition();
    const outside = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    document.addEventListener('mousedown', outside);
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  // 自动聚焦输入框
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const switchToLibraryModel = (entry: ModelEntry) => {
    const s = loadSettings();
    s.chatModelOverrides = { ...s.chatModelOverrides, [scene]: entry.id };
    saveSettings(s);
    setOpen(false);
  };

  const switchManualModel = (model: string) => {
    if (!model) return;
    const s = loadSettings();
    if (s.chatModelOverrides) {
      const next = { ...s.chatModelOverrides };
      delete next[scene];
      s.chatModelOverrides = next;
    }
    if (scene === 'assistant') {
      s.assistantModelId = undefined;
      s.assistantModelConfig = {
        provider: s.provider,
        apiHost: s.apiHost,
        apiKey: s.apiKey,
        model,
      };
    } else {
      s.activeModelId = undefined;
      s.model = model;
    }
    saveSettings(s);
    setOpen(false);
  };

  const handleCustomSubmit = () => {
    const m = customInput.trim();
    if (m) switchManualModel(m);
  };

  const libraryModels = settings.modelLibrary ?? [];
  // 将 modelLibrary 按 provider 分组
  const groupedLibrary = libraryModels.reduce((acc, e) => {
    const g = e.label;
    if (!acc[g]) acc[g] = [];
    acc[g].push(e);
    return acc;
  }, {} as Record<string, ModelEntry[]>);

  return (
    <div className="model-selector">
      <button
        ref={triggerRef}
        className="model-selector-btn"
        onClick={() => setOpen(!open)}
        title={`当前模型：${currentModel}（${currentProviderLabel}）\n${contextTitle}`}
      >
        <span className="model-selector-icon">🧠</span>
        <span className="model-selector-name">{currentModel}</span>
        {usingLibrary && <span className="model-selector-badge">库</span>}
        <span className={`model-context-chip${percentage != null && percentage >= 80 ? ' is-warning' : ''}`} title={contextTitle}>
          {configuredLimit ? `${formatTokens(usedTokens)}/${formatTokens(configuredLimit)}` : `${formatTokens(usedTokens)}/?`}
        </span>
        <span className="model-selector-arrow">{open ? '▲' : '▼'}</span>
      </button>

      {open && createPortal(
        <div ref={menuRef} className="model-selector-dropdown" style={menuStyle}>
          <div className="model-selector-header">
            {currentProviderLabel} · 切换模型
            <span style={{ fontSize: 9, fontWeight: 400, marginLeft: 'auto' }}>
              {libraryModels.length > 0 ? `${libraryModels.length} 个已配置` : ''}
            </span>
          </div>
          <div className="model-context-summary">
            <div className="model-context-summary-head"><span>本次上下文</span><strong>{configuredLimit ? `${usedTokens.toLocaleString()} / ${configuredLimit.toLocaleString()} tokens` : `${usedTokens.toLocaleString()} tokens / 未获知上限`}</strong></div>
            {configuredLimit && <div className="model-context-track" aria-label={`上下文使用 ${percentage ?? 0}%`}><span style={{ width: `${percentage ?? 0}%` }} /></div>}
            <small>{usageSource === 'api' ? '已用量来自服务端本次请求。' : '已用量按当前聊天内容估算；服务端没有返回 prompt_tokens。'} {configuredLimit ? `已使用 ${percentage}%` : '请在“设置 → 模型”填写该模型的官方上下文上限。'}</small>
          </div>

          {/* 模型库中的模型（优先展示） */}
          {Object.keys(groupedLibrary).length > 0 && (
            <div className="model-selector-section">
              <div className="model-selector-section-title">📦 模型库</div>
              {Object.entries(groupedLibrary).map(([groupLabel, entries]) => (
                <div key={groupLabel}>
                  <div className="model-selector-group-label">{groupLabel}</div>
                  {entries.map((entry) => (
                    <button
                      key={entry.id}
                      className={`model-selector-option ${currentModel === (entry.model || entry.label) ? 'active' : ''}`}
                      onClick={() => switchToLibraryModel(entry)}
                    >
                      <span className="model-lib-icon">📦</span>
                      <span className="model-lib-name">{entry.model || entry.label}</span>
                      {getModelCapabilities(entry).includes('image') && <span className="model-context-chip">Image</span>}
                      {entry.apiHost && <span className="model-lib-host" title={entry.apiHost}>{new URL(entry.apiHost).hostname}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* 手动模式（兼容旧版） */}
          <div className="model-selector-section">
            <div className="model-selector-section-title">
              ✏️ 手动输入
              {libraryModels.length > 0 && <span className="model-selector-section-hint">（覆盖模型库选择）</span>}
            </div>
            <div className="model-selector-custom">
              <input
                ref={inputRef}
                className="form-input"
                placeholder="输入模型名回车…"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCustomSubmit(); }}
              />
            </div>
          </div>
        </div>, document.body
      )}
    </div>
  );
}

function libraryEntryForContext(library: ModelEntry[], model: string, config: ModelConfig): ModelEntry | undefined {
  return library.find((entry) => entry.model === model && entry.apiHost === config.apiHost)
    ?? library.find((entry) => entry.model === model)
    ?? library.find((entry) => entry.id === config.refModelId);
}
