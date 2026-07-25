import { useMemo, useRef, useState } from 'react';
import {
  CheckOutlined,
  ExportOutlined,
  LoadingOutlined,
  PictureOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { Modal } from 'antd';
import {
  AVATAR_PRESET_GROUPS,
  AVATAR_PRESETS,
  getPreset,
  renderPresetAvatar,
  type AvatarPresetGroupId,
} from '../../data/avatarPresets';

interface Props {
  avatar: string;
  avatarKind: 'preset' | 'custom';
  onChange: (avatar: string, avatarKind: 'preset' | 'custom') => void;
}

interface OnlinePixelAvatar {
  id: string;
  label: string;
  url: string;
}

const MAX_CUSTOM_AVATAR_BYTES = 500 * 1024;
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

export default function EmployeeAvatarPicker({ avatar, avatarKind, onChange }: Props) {
  const currentPreset = avatarKind === 'preset' ? getPreset(avatar) : undefined;
  const isOnlinePixelAvatar = avatarKind === 'custom' && avatar.startsWith('data:image/svg+xml');
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState<AvatarPresetGroupId>(isOnlinePixelAvatar ? 'pixel' : currentPreset?.group === 'pixel' ? 'pixel' : currentPreset?.group ?? 'office');
  const [onlineBatch, setOnlineBatch] = useState(1);
  const [savingOnlineId, setSavingOnlineId] = useState('');
  const [onlineError, setOnlineError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const visiblePresets = useMemo(
    () => groupId === 'pixel' ? [] : AVATAR_PRESETS.filter((preset) => preset.group === groupId),
    [groupId],
  );
  const onlinePixelAvatars = useMemo(() => createOnlinePixelAvatars(onlineBatch), [onlineBatch]);

  const groupCount = (id: AvatarPresetGroupId) => (
    id === 'pixel' ? ONLINE_PIXEL_COUNT : AVATAR_PRESETS.filter((preset) => preset.group === id).length
  );

  const openLibrary = () => {
    setGroupId(isOnlinePixelAvatar ? 'pixel' : currentPreset?.group === 'pixel' ? 'pixel' : currentPreset?.group ?? 'office');
    setOnlineError('');
    setOpen(true);
  };

  const selectPreset = (key: string) => {
    onChange(key, 'preset');
    setOpen(false);
  };

  const handleFile = (file?: File) => {
    if (!file) return;
    if (file.size > MAX_CUSTOM_AVATAR_BYTES) {
      window.alert('图片过大，请压缩到 500KB 以内');
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
      if (blob.size > MAX_CUSTOM_AVATAR_BYTES) throw new Error('头像文件超过 500KB');
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
            {AVATAR_PRESET_GROUPS.map((group) => (
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
          <span>{AVATAR_PRESET_GROUPS.find((group) => group.id === groupId)?.description}</span>
          {groupId === 'pixel' && <span>CC0 1.0</span>}
        </div>

        {onlineError && <div className="avatar-library-error" role="alert">{onlineError}</div>}

        <div className={`avatar-library-grid${groupId === 'pixel' ? ' online' : ''}`}>
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
        </div>
      </Modal>
    </>
  );
}
