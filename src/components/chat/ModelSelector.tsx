import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { loadSettings, saveSettings, getProvider, resolveChatSettings } from '../../data/hermesClient';
import type { ModelEntry } from '../../data/hermesClient';

interface Props {
  /** 'assistant' | 'dm' (员工私聊) | 'team' (团队) */
  scene?: 'assistant' | 'dm' | 'team';
  /** DM 场景下传入员工 ID，以正确读取员工独立模型 */
  employeeId?: string;
}

export default function ModelSelector({ scene = 'assistant', employeeId: _employeeId }: Props) {
  const [open, setOpen] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  // 读取当前实际使用的模型
  const settings = loadSettings();
  const resolved = resolveChatSettings();  // 解析助理配置

  // 确定当前模型显示名
  let currentModel: string;
  let currentProviderLabel: string;
  let usingLibrary: boolean = false;

  if (scene === 'assistant' && settings.modelLibrary && settings.modelLibrary.length > 0 && settings.assistantModelId) {
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
    if (scene === 'assistant') {
      s.assistantModelId = entry.id;
    } else {
      s.activeModelId = entry.id;
    }
    saveSettings(s);
    setOpen(false);
  };

  const switchManualModel = (model: string) => {
    if (!model) return;
    const s = loadSettings();
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
        title={`当前模型：${currentModel}（${currentProviderLabel}）`}
      >
        <span className="model-selector-icon">🧠</span>
        <span className="model-selector-name">{currentModel}</span>
        {usingLibrary && <span className="model-selector-badge">库</span>}
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
