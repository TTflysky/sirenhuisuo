import { useMemo, useRef, useState } from 'react';
import { CheckOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons';
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

const MAX_CUSTOM_AVATAR_BYTES = 500 * 1024;

export default function EmployeeAvatarPicker({ avatar, avatarKind, onChange }: Props) {
  const currentPreset = avatarKind === 'preset' ? getPreset(avatar) : undefined;
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState<AvatarPresetGroupId>(currentPreset?.group ?? 'office');
  const fileRef = useRef<HTMLInputElement>(null);

  const visiblePresets = useMemo(
    () => AVATAR_PRESETS.filter((preset) => preset.group === groupId),
    [groupId],
  );

  const openLibrary = () => {
    setGroupId(currentPreset?.group ?? 'office');
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
          <strong>{avatarKind === 'custom' ? '自定义头像' : currentPreset?.label}</strong>
          <small>打开头像库</small>
        </span>
        <PictureOutlined aria-hidden />
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
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
        width={720}
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
                onClick={() => setGroupId(group.id)}
              >
                {group.label}
                <span>{AVATAR_PRESETS.filter((preset) => preset.group === group.id).length}</span>
              </button>
            ))}
          </div>
          <button type="button" className="avatar-library-upload" onClick={() => fileRef.current?.click()}>
            <UploadOutlined /> 上传头像
          </button>
        </div>

        <div className="avatar-library-group-note">
          {AVATAR_PRESET_GROUPS.find((group) => group.id === groupId)?.description}
        </div>

        <div className="avatar-library-grid">
          {visiblePresets.map((preset) => {
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
