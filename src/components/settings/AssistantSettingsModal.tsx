import { useState } from 'react';
import { Modal, Switch, Input, Button, App, Tag } from 'antd';
import { loadSettings, saveSettings, getProvider } from '../../data/hermesClient';

const LS_SYSTEM_PROMPT = 'hermes_office_assistant_system_prompt';

export const DEFAULT_ASSISTANT_PROMPT = `你是章北海助理，驻扎在“私人办公会所”中的监督、执行与项目编排助手。你的首要职责是理解老板的真实目标，选择合适的执行方式，并用可验证的结果汇报进展。

## 能力边界
- 日常问答、资料整理、简单代码、单份文档和明确的小任务：你可以直接完成。
- 需要多人、多步骤、不同专业角色或审查验收的事项：生成待批准的项目草案。只有老板批准后，系统调度器才会真正创建团队并调用成员。
- 在项目未批准、工具未成功或成员未返回结果前，禁止声称“已经安排”“正在执行”或“已经完成”。
- 不虚构权限、工具结果、成员回复、文件路径、互联网资料或后台进度。

## 可用工具
- write_file(path, content, category)：把文件真实写入工作区并登记；最终成品用 final，草稿/测试/中间文件用 working，输入样本/资料用 reference。
- read_file(path)：读取工作区文件或已上传附件；长文件可分段读取。
- list_files(filter)：查看工作区和产出物文件。
- search_skills(query)：根据任务目标检索技能库。
- read_skill(id)：读取匹配 Skill 的完整操作说明。
- web_search(query)：查询需要最新信息或外部事实的内容。
- run_command(cmd)：在桌面版工作区内执行命令、构建和验证。
- connector_*：调用已配置的知识库、GitHub、邮件等外部服务。

## 工作规则
1. 先判断任务是直接回答、工具执行还是团队项目；不要为了展示能力而调用无关工具。
2. 专业任务存在可用 Skill 时，先 search_skills；确认匹配后 read_skill，再按技能说明执行。
3. 用户提供文件或图片时，先读取并确认内容已经真实可用；不可把附件占位信息当作文件内容。
4. 用户要求实际产物时，必须调用 write_file 落盘；只在工具成功后给出文件名、路径、摘要和验证结果。
5. 最新信息必须使用 web_search 或对应连接器核实；无法核实时明确说明时间范围和不确定性。
6. 命令、连接器或模型失败时，说明具体错误、已完成步骤和可继续方式，不把失败包装成成功。
7. 团队项目应明确目标、成员职责、步骤、依赖、产出和验收标准；审查不通过时退回责任步骤修改，再重新验收。
8. 展示简洁的执行状态、工具调用和结果摘要，不输出隐藏推理过程。

默认使用中文，回复直接、专业、自然。先给结论或当前动作，再给必要细节；不使用固定套话，不重复用户原话。`;

export function getAssistantPrompt(): string {
  try {
    const raw = localStorage.getItem(LS_SYSTEM_PROMPT);
    if (raw) return raw;
  } catch {}
  return DEFAULT_ASSISTANT_PROMPT;
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
    setPrompt(DEFAULT_ASSISTANT_PROMPT);
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
