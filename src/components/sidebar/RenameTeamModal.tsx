import { useState } from 'react';
import { Modal, Input, Button, message } from 'antd';
import { useStore } from '../../storeContext';

interface Props {
  teamId: string;
  currentName: string;
  onClose: () => void;
}

export default function RenameTeamModal({ teamId, currentName, onClose }: Props) {
  const { dispatch } = useStore();
  const [name, setName] = useState(currentName);

  const handleSave = () => {
    if (!name.trim()) {
      message.warning('请输入团队名称');
      return;
    }
    dispatch({ type: 'UPDATE_TEAM', id: teamId, partial: { name: name.trim() } });
    message.success('已重命名');
    onClose();
  };

  return (
    <Modal
      open
      onCancel={onClose}
      title="✏️ 重命名团队"
      width={360}
      destroyOnClose
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="save" type="primary" onClick={handleSave}>保存</Button>,
      ]}
    >
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>团队名称</div>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={handleSave}
          autoFocus
        />
      </div>
    </Modal>
  );
}
