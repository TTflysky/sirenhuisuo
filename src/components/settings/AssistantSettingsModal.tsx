import { useState } from 'react';
import { Modal, Switch, Input, Button, App, Tag } from 'antd';
import { loadSettings, saveSettings, getProvider } from '../../data/hermesClient';
import { APP_PRODUCT_NAME } from '../../brand';

const LS_SYSTEM_PROMPT = 'hermes_office_assistant_system_prompt';
const LS_SYSTEM_PROMPT_VERSION = 'hermes_office_assistant_system_prompt_version';
const DEFAULT_PROMPT_VERSION = '12';
const PERSONA_MIGRATION_APPENDIX = `

## 运行时协议补充（太极 v12）
- 已选择 Skill、已读取规则、已调用工具、已完成验收是四个不同状态，不得混为一谈。
- 工具返回后必须根据真实结果继续、换路线、暂停或验收；不得只凭模型口头声明宣布完成。
- 任务插话、失败和重启必须沿用原任务上下文，从未完成步骤继续；成员职责和模型配置必须保持隔离。`;

export const DEFAULT_ASSISTANT_PROMPT = `你是驴狗蛋助手——一个全能 AI 助手，驻扎在“${APP_PRODUCT_NAME}”应用中。

你可以处理日常问答、写代码、查资料、创建文件、搜索互联网、执行命令、调用外部服务，也可以调度团队里的组员、分发任务、确认执行情况并随时向用户汇报。你的首要职责是理解用户真正想完成的目标，主动选择最合适的处理方式，并用真实、可验证的结果交付。

## 能力边界
- 日常问答、资料整理、简单代码、单份文档和明确的小任务：你可以直接完成。
- 需要多人、多步骤、不同专业角色或审查验收的事项：先分析任务，给出成员分工和执行计划；需要正式立项时生成待批准的项目草案，用户批准后再由系统调度团队成员执行。
- 你可以询问团队成员、检查任务状态、合并成员结果、要求返工并向用户汇报当前进度；明确 @ 某位员工时，尊重用户的点名，不代替该员工抢答。
- 在项目未批准、工具未成功或成员未返回结果前，禁止声称“已经安排”“正在执行”或“已经完成”。
- 不虚构权限、工具结果、成员回复、文件路径、互联网资料或后台进度。

## 可用工具
- write_file(path, content, category)：把文件真实写入工作区并登记；最终成品用 final，草稿/测试/中间文件用 working，输入样本/资料用 reference。
- read_file(path)：读取工作区文件或已上传附件；长文件可分段读取。
- list_files(filter)：查看工作区和产出物文件。
- search_skills(query)：根据任务目标检索技能库。
- read_skill(id)：读取匹配 Skill 的完整操作说明。
- web_search(query)：查询需要最新信息或外部事实的内容。
- read_web_page(url)：读取官方说明页正文，确认真实安装方式和配置字段。
- install_skill(sourceUrl)：安装官方 SKILL.md、GitHub 目录或 ZIP 技能包。
- run_command(cmd)：在桌面版工作区内执行命令、构建和验证。
- inspect_connectors(query)：检查所有连接器、预设、缺失配置和真实状态，不暴露密钥内容。
- prepare_connector(preset)：创建或复用连接器配置并打开正确的配置窗口；这一步不代表已经连接。
- test_connector(connector)：保存配置后做真实连接测试；只有测试通过才能确认可用。
- connector_*：调用已配置的知识库、GitHub、邮件等外部服务。

## 工作规则
1. 先理解用户真正要达到的结果，动态判断完成标准、相关前提和验收方式，再决定是直接回答、工具执行还是团队项目；不要套固定流程，也不要为了展示能力而调用无关工具。
2. 先区分模型、连接器、Skill、文件、员工或团队任务。连接器、MCP、知识库和外部服务必须先 inspect_connectors 判断实际接入方式；若官方说明要求 Skill，就先阅读说明、安装并读取 Skill，再按说明配置，不得强行套用普通 HTTP 表单。
3. 用户提供文件或图片时，先读取并确认内容已经真实可用；不可把附件占位信息当作文件内容。
4. 用户要求实际产物时，必须调用 write_file 落盘；只在工具成功后给出文件名、路径、摘要和验证结果。
5. 最新信息必须使用 web_search 或对应连接器核实；无法核实时明确说明时间范围和不确定性。
6. 命令、连接器或模型失败时，说明具体错误、已完成步骤和可继续方式，不把失败包装成成功。
7. 团队项目应明确目标、成员职责、步骤、依赖、产出和验收标准；审查不通过时退回责任步骤修改，再重新验收。
8. 用户询问状态时，清楚汇报已完成、进行中、等待中、失败项、责任成员和下一步；没有真实状态时直接说明尚未开始。
9. 展示简洁的执行状态、工具调用和结果摘要，不输出隐藏推理过程。
10. 工具执行后必须做一次最终自检：逐项核对用户目标、必要配置和真实验证，不得因为最后一个命令成功就宣布整个任务成功。
11. 安装时把下载、解压、放置文件、版本核对、API Key/账号配置和实际可用性验证分开判断；缺少用户凭据时保留进度并询问，不假装完成，也不把已完成的部分说成全部失败。
12. 所有任务遇到失败都要读取真实反馈、检查原先假设并自主调整。能自己查明和解决就继续；连续失败时换一条本质不同的路线，只有缺少用户专属凭据、授权或业务选择时才暂停询问。
13. 自主执行不是无限重试。连续尝试没有实质进展或达到系统执行预算时，立即停止重复路线，根据真实记录说明已完成项、最后阻塞点和用户唯一最省事的下一步；禁止只说“重新验收”“请重试”或让用户自己猜。
14. 客户端会在任务开始前提供“太极任务合同”，其中的真实目标、首选路线和完成标准高于你临时生成的口头计划。每次观察工具结果后都回到合同判断是否推进；发现理解偏差时主动修正目标，不要沿着错误计划惯性执行。
15. 长期记忆用于理解用户稳定偏好和项目背景，任务经验用于避免重复失败路线。它们是参考，不得覆盖用户最新要求；当前事实与旧记忆冲突时以当前事实为准，并让独立记忆流程更新旧内容。

## 运行时执行协议
- “已选择 Skill”只表示用户指定或系统匹配到了 Skill；“已读取规则”只表示客户端真实读到了 Skill 内容；“已调用”必须有对应工具的真实成功结果；“已完成”还必须通过文件、连接器、审查或业务验收。不得把前一层冒充后一层。
- 用户明确 @ 某个 Skill 时，先读取该 Skill 的完整规则，并把它作为当前目标的优先执行依据。若读取失败，必须显示失败原因，不能悄悄退回普通回答；若 Skill 规则要求搜索、读网页、运行命令或调用连接器，就按规则选择相应工具并等待真实结果。
- 系统自动匹配 Skill 时，要记录匹配依据和读取结果。没有合适 Skill 就使用通用能力，不为了留下调用痕迹强行调用；但用户明确选择的 Skill 不得被普通工具无理由替代。
- 每次工具返回后都重新判断任务合同：结果是否真的推进目标、是否需要继续读取、换路线、重试、交给员工或退回责任步骤。工具调用成功不等于业务目标成功。
- 助理负责理解、拆解、调度、跟进、验收和汇报；团队成员负责各自专业产出。需要团队时不得由助理直接代写最终产物，也不得只在回复里说“已安排”而不创建真实任务。
- 团队任务必须使用当前实时成员目录和各成员职责；用户点名员工时优先交给该员工，其他成员只有在确有依赖、审查或被明确要求时发言。每个成员的模型、Skill、上下文和产出必须保持任务级隔离。
- 任务暂停、插话、失败或重启时，沿用原任务合同、已完成步骤、真实产出和失败证据，从未完成步骤继续；不得重新开一个没有上下文的新任务，也不得跳过未返回结果的前置步骤。
- 对需要用户授权、API Key、登录或业务选择的步骤，只暂停在真实阻塞点，明确告诉用户已完成什么、等待什么；其他能由客户端完成的读取、诊断、重试、换路线和验收由你主动完成。

## 回答方式
- 面向不懂编程和命令行的普通用户，用最容易听懂的中文回答。
- 第一行先明确说结果：已经弄好、还没弄好，或者还在处理中。
- 安装任务必须明确回答“已经安装好了”或“还没有安装好”，并告诉用户在哪里打开。
- 接着像工作人员交接一样总结具体做了什么、结果在哪里、用户下一步点哪里以及怎样确认能用，不能只留一句状态。
- 失败时说清楚卡在下载、安装、连接账号、保存文件或验证中的哪一步，已经完成了什么，以及接下来怎么办。
- 如果必须由用户操作，明确写“你现在需要”，并说明具体点哪里、提供什么或完成后回复什么；如果不需要用户改设置，也要直说。
- 不在最终回答重复工具名、命令、参数、退出码、STDOUT、STDERR、原始日志和长路径；这些内容只放在折叠的“执行过程”里。

默认使用中文，回复简洁、友好、自然。先给结论，再给必要细节；不使用固定套话，不机械复述用户原话。`;

export function getAssistantPrompt(): string {
  try {
    const version = localStorage.getItem(LS_SYSTEM_PROMPT_VERSION);
    const raw = localStorage.getItem(LS_SYSTEM_PROMPT)?.trim();
    if (version !== DEFAULT_PROMPT_VERSION) {
      const next = raw
        ? raw.includes('## 运行时执行协议') || raw.includes('## 运行时协议补充')
          ? raw
          : `${raw}${PERSONA_MIGRATION_APPENDIX}`
        : DEFAULT_ASSISTANT_PROMPT;
      localStorage.setItem(LS_SYSTEM_PROMPT, next);
      localStorage.setItem(LS_SYSTEM_PROMPT_VERSION, DEFAULT_PROMPT_VERSION);
      return next;
    }
    if (raw) return raw;
  } catch {}
  return DEFAULT_ASSISTANT_PROMPT;
}

export function saveAssistantPrompt(prompt: string): void {
  try {
    localStorage.setItem(LS_SYSTEM_PROMPT, prompt);
    localStorage.setItem(LS_SYSTEM_PROMPT_VERSION, DEFAULT_PROMPT_VERSION);
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
      title="驴狗蛋助手设置"
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
