import { useMemo, useRef, useState } from 'react';
import {
  CheckOutlined,
  ExportOutlined,
  LoadingOutlined,
  PictureOutlined,
  ReloadOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { Button, Input, Modal, Select } from 'antd';
import {
  AVATAR_PRESET_GROUPS,
  AVATAR_PRESETS,
  getPreset,
  renderPresetAvatar,
  type AvatarPresetGroupId,
} from '../../data/avatarPresets';
import { generateEmployeeAvatarImage, getModelCapabilities, loadSettings, saveSettings, type AppSettings } from '../../data/hermesClient';

interface Props {
  avatar: string;
  avatarKind: 'preset' | 'custom';
  onChange: (avatar: string, avatarKind: 'preset' | 'custom') => void;
  employeeName?: string;
  employeeTitle?: string;
}

type PickerGroupId = AvatarPresetGroupId | 'ai';

const AVATAR_LIBRARY_GROUPS: Array<{ id: PickerGroupId; label: string; description: string }> = [
  ...AVATAR_PRESET_GROUPS,
  { id: 'ai', label: 'AI 生成', description: '调用模型库中指定的生图模型，生成并保存为本地员工头像' },
];

interface OnlinePixelAvatar {
  id: string;
  label: string;
  url: string;
}

const MAX_CUSTOM_AVATAR_BYTES = 10 * 1024 * 1024;
const ONLINE_PIXEL_COUNT = 24;
const DICEBEAR_STYLE_URL = 'https://www.dicebear.com/styles/pixel-art/';
const DICEBEAR_API_URL = 'https://api.dicebear.com/9.x/pixel-art/svg';

function createOnlinePixelAvatars(batch: number): OnlinePixelAvatar[] {
  return Array.from({ length: ONLINE_PIXEL_COUNT }, (_, index) => {
    const number = index + 1;
    const seed = `Hermes-Office-${batch}-${number}`;
    return {
      id: seed,
      label: `像素员工 ${String(number).padStart(2, '0')}`,
      url: `${DICEBEAR_API_URL}?seed=${encodeURIComponent(seed)}&size=160`,
    };
  });
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('头像文件读取失败'));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

const AVATAR_STYLES = [
  '现代 3D 黏土风格，柔和棚拍光，干净纯色背景，专业且亲切',
  '精致像素艺术风格，清晰轮廓，有限色板，适合作为办公软件头像',
  '扁平矢量插画风格，几何造型，清晰面部特征，专业团队形象',
  '日系动画头像风格，克制配色，清晰五官，办公室职业形象',
  '未来科技员工肖像，材质细腻，明亮背景，可信赖的专业气质',
];

function randomAvatarPrompt(name = '', title = ''): string {
  const style = AVATAR_STYLES[Math.floor(Math.random() * AVATAR_STYLES.length)];
  const identity = [name.trim(), title.trim()].filter(Boolean).join('，');
  return `正方形单人头像，${identity || 'AI 办公室员工'}，${style}。主体居中，头肩构图，背景简洁，无文字，无水印，无徽标。`;
}

export default function EmployeeAvatarPicker({ avatar, avatarKind, onChange, employeeName = '', employeeTitle = '' }: Props) {
  const currentPreset = avatarKind === 'preset' ? getPreset(avatar) : undefined;
  const isOnlinePixelAvatar = avatarKind === 'custom' && avatar.startsWith('data:image/svg+xml');
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState<PickerGroupId>(isOnlinePixelAvatar ? 'pixel' : currentPreset?.group === 'pixel' ? 'pixel' : currentPreset?.group ?? 'office');
  const [onlineBatch, setOnlineBatch] = useState(1);
  const [savingOnlineId, setSavingOnlineId] = useState('');
  const [onlineError, setOnlineError] = useState('');
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [aiPrompt, setAiPrompt] = useState(() => randomAvatarPrompt(employeeName, employeeTitle));
  const [generating, setGenerating] = useState(false);
  const [generatedAvatar, setGeneratedAvatar] = useState('');
  const [generatedModel, setGeneratedModel] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const visiblePresets = useMemo(
    () => groupId === 'pixel' || groupId === 'ai' ? [] : AVATAR_PRESETS.filter((preset) => preset.group === groupId),
    [groupId],
  );
  const onlinePixelAvatars = useMemo(() => createOnlinePixelAvatars(onlineBatch), [onlineBatch]);

  const groupCount = (id: PickerGroupId) => id === 'pixel'
    ? ONLINE_PIXEL_COUNT
    : id === 'ai'
      ? ((settings.modelLibrary ?? []).filter((model) => getModelCapabilities(model).includes('image')).length)
      : AVATAR_PRESETS.filter((preset) => preset.group === id).length;

  const openLibrary = () => {
    setGroupId(isOnlinePixelAvatar ? 'pixel' : currentPreset?.group === 'pixel' ? 'pixel' : currentPreset?.group ?? 'office');
    setOnlineError('');
    setSettings(loadSettings());
    setOpen(true);
  };

  const selectImageModel = (id: string) => {
    const next = loadSettings();
    next.imageModelId = id || undefined;
    saveSettings(next);
    setSettings(next);
  };

  const generateAvatar = async () => {
    const model = (settings.modelLibrary ?? []).find((entry) => entry.id === settings.imageModelId);
    if (!model) {
      setOnlineError('请先在模型库添加生图模型，并在这里选择它');
      return;
    }
    setGenerating(true);
    setGeneratedAvatar('');
    setGeneratedModel('');
    setOnlineError('');
    try {
      const result = await generateEmployeeAvatarImage(aiPrompt, model);
      if (result.dataUrl.length > MAX_CUSTOM_AVATAR_BYTES * 1.4) throw new Error('生成头像超过 10MB，请降低生图尺寸');
      setGeneratedAvatar(result.dataUrl);
      setGeneratedModel(result.model);
    } catch (error) {
      setOnlineError(error instanceof Error ? error.message : '头像生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const selectPreset = (key: string) => {
    onChange(key, 'preset');
    setOpen(false);
  };

  const handleFile = (file?: File) => {
    if (!file) return;
    if (file.size > MAX_CUSTOM_AVATAR_BYTES) {
      window.alert('头像文件不能超过 10MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onChange(reader.result as string, 'custom');
      setOpen(false);
    };
    reader.readAsDataURL(file);
  };

  const selectOnlineAvatar = async (item: OnlinePixelAvatar) => {
    setSavingOnlineId(item.id);
    setOnlineError('');
    try {
      const response = await fetch(item.url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`头像服务返回 ${response.status}`);
      const blob = await response.blob();
      if (blob.size > MAX_CUSTOM_AVATAR_BYTES) throw new Error('头像文件不能超过 10MB');
      const dataUrl = await readBlobAsDataUrl(blob);
      onChange(dataUrl, 'custom');
      setOpen(false);
    } catch (error) {
      setOnlineError(error instanceof Error ? error.message : '头像下载失败，请检查网络后重试');
    } finally {
      setSavingOnlineId('');
    }
  };

  const openDiceBear = async () => {
    const result = await window.electronAPI?.openExternal?.(DICEBEAR_STYLE_URL);
    if (!window.electronAPI) window.open(DICEBEAR_STYLE_URL, '_blank', 'noopener,noreferrer');
    if (result && !result.ok) setOnlineError(result.error || '无法打开头像来源页面');
  };

  return (
    <>
      <button type="button" className="employee-avatar-picker-trigger" onClick={openLibrary}>
        <span className="employee-avatar-picker-preview">
          {avatarKind === 'custom' ? (
            <img src={avatar} alt="自定义员工头像" />
          ) : (
            renderPresetAvatar(avatar, 64)
          )}
        </span>
        <span className="employee-avatar-picker-copy">
          <strong>{avatarKind === 'custom' ? isOnlinePixelAvatar ? '在线像素头像' : '自定义头像' : currentPreset?.label}</strong>
          <small>打开头像库</small>
        </span>
        <PictureOutlined aria-hidden />
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        hidden
        onChange={(event) => {
          handleFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={760}
        title={<span className="avatar-library-title"><PictureOutlined /> 员工头像库</span>}
        rootClassName="employee-avatar-library-modal"
        destroyOnClose={false}
      >
        <div className="avatar-library-toolbar">
          <div className="avatar-library-tabs" role="tablist" aria-label="头像分类">
            {AVATAR_LIBRARY_GROUPS.map((group) => (
              <button
                key={group.id}
                type="button"
                role="tab"
                aria-selected={groupId === group.id}
                className={groupId === group.id ? 'selected' : ''}
                onClick={() => {
                  setGroupId(group.id);
                  setOnlineError('');
                }}
              >
                {group.label}
                <span>{groupCount(group.id)}</span>
              </button>
            ))}
          </div>
          <div className="avatar-library-actions">
            {groupId === 'pixel' && (
              <>
                <button type="button" className="avatar-library-upload" onClick={() => setOnlineBatch(Date.now())} title="重新生成 24 个头像">
                  <ReloadOutlined /> 换一批
                </button>
                <button type="button" className="avatar-library-icon-button" onClick={() => void openDiceBear()} title="查看 DiceBear Pixel Art 来源" aria-label="查看在线像素头像来源">
                  <ExportOutlined />
                </button>
              </>
            )}
            <button type="button" className="avatar-library-upload" onClick={() => fileRef.current?.click()}>
              <UploadOutlined /> 上传头像
            </button>
          </div>
        </div>

        <div className="avatar-library-group-note">
          <span>{AVATAR_LIBRARY_GROUPS.find((group) => group.id === groupId)?.description}</span>
          {groupId === 'pixel' && <span>CC0 1.0</span>}
        </div>

        {onlineError && <div className="avatar-library-error" role="alert">{onlineError}</div>}

        {groupId === 'ai' ? (
          <section className="avatar-ai-generator">
            <div className="avatar-ai-fields">
              <label><span>生图模型</span><Select value={settings.imageModelId} placeholder="选择模型库中的生图模型" onChange={selectImageModel} options={(settings.modelLibrary ?? []).filter((model) => getModelCapabilities(model).includes('image')).map((model) => ({ value: model.id, label: `${model.label} · ${model.model ?? '未填写模型名'}` }))} /></label>
              <label><span>头像描述</span><Input.TextArea value={aiPrompt} rows={4} onChange={(event) => setAiPrompt(event.target.value)} maxLength={1200} showCount /></label>
              <div className="avatar-ai-actions">
                <Button icon={<ReloadOutlined />} onClick={() => { setAiPrompt(randomAvatarPrompt(employeeName, employeeTitle)); setGeneratedAvatar(''); }}>换个创意</Button>
                <Button type="primary" icon={<ThunderboltOutlined />} loading={generating} disabled={!settings.imageModelId || !aiPrompt.trim()} onClick={() => void generateAvatar()}>随机生成头像</Button>
              </div>
            </div>
            <div className={`avatar-ai-preview${generatedAvatar ? ' has-image' : ''}`}>
              {generatedAvatar ? <img src={generatedAvatar} alt="AI 生成员工头像预览" /> : <div><RobotOutlined /><strong>{generating ? '正在生成头像' : '生成结果会显示在这里'}</strong><span>{generating ? '生图通常需要几十秒，请保持窗口开启' : '不会自动覆盖当前头像'}</span></div>}
              {generatedAvatar && <><small>{generatedModel}</small><Button type="primary" icon={<CheckOutlined />} onClick={() => { onChange(generatedAvatar, 'custom'); setOpen(false); }}>使用这个头像</Button></>}
            </div>
          </section>
        ) : <div className={`avatar-library-grid${groupId === 'pixel' ? ' online' : ''}`}>
          {groupId === 'pixel' ? onlinePixelAvatars.map((item) => {
            const saving = savingOnlineId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className="avatar-library-item online"
                onClick={() => void selectOnlineAvatar(item)}
                title={`保存并使用${item.label}`}
                disabled={Boolean(savingOnlineId)}
              >
                <span className="avatar-library-image online"><img src={item.url} alt={item.label} loading="lazy" /></span>
                <span className="avatar-library-name">{saving ? '正在保存' : item.label}</span>
                {saving && <span className="avatar-library-saving"><LoadingOutlined spin /></span>}
              </button>
            );
          }) : visiblePresets.map((preset) => {
            const selected = avatarKind === 'preset' && avatar === preset.key;
            return (
              <button
                key={preset.key}
                type="button"
                className={`avatar-library-item${selected ? ' selected' : ''}`}
                onClick={() => selectPreset(preset.key)}
                title={`使用${preset.label}`}
              >
                <span className="avatar-library-image">{renderPresetAvatar(preset.key, 88)}</span>
                <span className="avatar-library-name">{preset.label}</span>
                {selected && <span className="avatar-library-check"><CheckOutlined /></span>}
              </button>
            );
          })}
        </div>}
      </Modal>
    </>
  );
}
