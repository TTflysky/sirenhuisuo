import { useState } from 'react';
import { Modal, Switch, Input, Button, App, Tag } from 'antd';
import { loadSettings, saveSettings, getProvider } from '../../data/hermesClient';

const LS_SYSTEM_PROMPT = 'hermes_office_assistant_system_prompt';

const DEFAULT_PROMPT = `你是 Hermes 助手——一个全能 AI 助手，驻扎在私人办公会所应用中。
你可以做任何事情：回答日常问题、写代码、查资料、创建文件、搜索互联网、执行命令（桌面版）、调用外部服务（连接器）。

你的工具：
- write_file(文件名, 内容) —— 把文件真正写入工作区（代码/文档都落盘，可运行）
- read_file(文件名) —— 读取工作区文件
- list_files(过滤词) —— 列出工作区目录
- web_search(查询) —— 搜索互联网
- run_command(命令) —— 在工作区内执行终端命令（仅 Electron 桌面版可用）
- connector_* —— 已配置的外部服务连接器（如 IMA 知识库搜索、GitHub 仓库查询等）

当用户需要产出实际文件时，直接调 write_file，然后把文件路径和摘要告诉用户。
当用户问需要最新信息的事，调 web_search。
当用户提到知识库、GitHub、邮件等外部服务时，优先使用对应的连接器工具。
回复简洁、专业、友好，用中文。`;

export function getAssistantPrompt(): string {
  try {
    const raw = localStorage.getItem(LS_SYSTEM_PROMPT);
    if (raw) return raw;
  } catch {}
  return DEFAULT_PROMPT;
}

export function saveAssistantPrompt(prompt: string): void {
  try {
    localStorage.setItem(LS_SYSTEM_PROMPT, prompt);
  } catch {}
}

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export default function AssistantSettingsModal({ onClose, onSaved }: Props) {
  const { message } = App.useApp();
  const settings = loadSettings();
  const curPrompt = getAssistantPrompt();
  const [prompt, setPrompt] = useState(curPrompt);
  const [showCoT, setShowCoT] = useState(settings.showThoughtChain !== false);

  // 当前模型信息
  let modelLabel = '未设置';
  if (settings.modelLibrary && settings.modelLibrary.length > 0) {
    const aid = settings.assistantModelId || settings.activeModelId;
    const entry = settings.modelLibrary.find(e => e.id === aid);
    if (entry) modelLabel = `${entry.label} / ${entry.model || '(自动)'}`;
  } else if (settings.model) {
    modelLabel = `${getProvider().label} / ${settings.model}`;
  }

  const modelLibCount = settings.modelLibrary?.length ?? 0;

  const handleSave = () => {
    saveAssistantPrompt(prompt);
    const s = loadSettings();
    s.showThoughtChain = showCoT;
    saveSettings(s);
    message.success('助理设置已保存');
    onSaved();
    onClose();
  };

  const handleReset = () => {
    setPrompt(DEFAULT_PROMPT);
  };

  return (
    <Modal
      title="🤖 助理设置"
      open
      onCancel={onClose}
      width={580}
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="reset" onClick={handleReset} danger>恢复默认</Button>,
        <Button key="save" type="primary" onClick={handleSave}>保存</Button>,
      ]}
      destroyOnClose
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>

        {/* 模型信息 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 8, background: 'var(--bg-deep)' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>🧠 当前模型</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              {modelLabel}
              {modelLibCount > 0 && <Tag color="purple" style={{ marginLeft: 6, fontSize: 10 }}>模型库 · {modelLibCount}</Tag>}
            </div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            在 ⚙️ 全局设置中管理
          </span>
        </div>

        {/* 思维链开关 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>🧠 显示思维链</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              开启后，助手调用工具时会展示详细的推理步骤
            </div>
          </div>
          <Switch
            checked={showCoT}
            onChange={setShowCoT}
            checkedChildren="开"
            unCheckedChildren="关"
          />
        </div>

        {/* 系统提示词 */}
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>📝 系统提示词</div>
          <Input.TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={12}
            style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, resize: 'vertical' }}
            placeholder="输入自定义系统提示词..."
          />
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            💡 自定义助手的行为、角色定位和工具使用策略。恢复默认可还原到初始提示词。
          </div>
        </div>

      </div>
    </Modal>
  );
}
