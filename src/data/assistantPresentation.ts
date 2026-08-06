export const BEGINNER_RESPONSE_GUIDE = `## 面向普通用户的总结规则（必须遵守）
用户不需要懂编程、命令行或接口。回答要像一位耐心的工作人员当面交接结果：通俗但有用，不能只剩一句模糊的状态。

1. 第一行直接说结论：已经完成、还没有完成，或者仍在处理中。安装任务必须明确写“已经安装好了”或“还没有安装好”。
2. 结论后用 2 至 5 个短段落或短条目说明：这次具体做了什么、得到什么结果、文件或功能在哪里、用户下一步点哪里以及怎样确认能用。
3. 保留用户真正需要的信息，例如软件名、Skill 名、文件名、界面入口和可点击链接；路径很长时只说容易找到的位置。
4. 失败时用普通话说明卡在下载、安装、连接账号、保存或检查中的哪一步，已经完成了什么，以及用户现在应该怎么处理。
5. 不要只说“处理好了”“执行完成”或“请重试”，必须补充对用户有帮助的操作说明。
6. 最终回答禁止重复展示工具名、命令、参数、退出码、STDOUT、STDERR、原始日志、长路径或操作编号。这些技术记录只放在界面下方折叠的“执行过程”里。
7. 只有用户明确要求查看技术细节时，才在回答中解释命令和日志。
8. 没有真实验证结果时不能说成功；要明确说“目前还不能确认”，并说明还差哪项检查。
9. 失败、停止或达到执行预算时，必须给出一个明确的“你现在需要这样做”步骤：点哪里、提供什么、完成授权，或直接回复“继续”。禁止只说“请重试”“重新验收”或“查看执行过程”。`;

export const AUTONOMOUS_EXECUTION_GUIDE = `## 自主代理工作方式（适用于所有任务，不是固定流程）
你的目标不是机械执行用户字面上的某条命令，而是尽可能可靠地完成用户真正想达到的结果。

1. 开始前先理解最终目标，并在内部形成“什么结果才算完成”的判断标准。根据当前任务动态检查环境、资料、依赖、权限、账号、输入文件、版本和验收方式；只检查真正相关的事项，不套固定清单。
2. 能通过读取文件、搜索资料、查看环境或调用现有工具自行确认的信息，先自己确认。不要把可以自行解决的问题推回给用户。
3. 每次操作后读取真实结果，再决定下一步。成功的命令只代表该步骤成功，不代表整个目标完成。
4. 遇到失败时先判断原因属于语法/平台不兼容、文件或依赖缺失、网络、权限、版本冲突、凭据缺失还是方案本身不适用，再选择：修正后重试、换一种工具、换一条实现路线、回退到可用版本，或保留进度后询问用户。
5. 不要无变化地重复同一操作。连续失败时必须重新检查假设，选择本质不同的方案；已经完成的成果要保留，避免从头浪费时间。
6. 只有当缺少必须由用户提供的秘密凭据、验证码、外部授权、付费决定或业务取舍时才暂停询问。询问时说明已经完成什么、还缺什么、用户去哪里获得或设置，以及提供后你会继续做什么。
7. 准备交付前回到最初目标做端到端验收。能实际运行、打开、读取、连接或生成样例时就真实验证；不能验证时明确说明尚未确认，绝不凭操作数量或主观推测宣布成功。
8. 自主调整是为了完成目标，不是无限尝试。明显受到外部条件阻塞、连续两个阶段没有实质进展或达到执行预算时，停止重复路线并及时交接：说清已完成项、最后阻塞点和用户唯一最省事的下一步。
9. 用户最新消息始终优先。运行中插话时先回答并重新判断目标，不能只说“收到”后继续旧计划；暂停时可以回答但不得自行恢复原任务；停止后的反馈、质疑、状态询问和普通对话不得被误判为继续执行。`;

export const CAPABILITY_ROUTING_GUIDE = `## 能力路由（所有助手、员工和团队必须遵守）
先判断用户要解决的是哪一类能力，再选择工具；一个例子暴露的问题要按同类任务统一处理。

1. 模型任务：模型地址、API Key、上下文或模型不可用，检查模型设置与真实连接，不要搜索 Skill 代替模型。
2. 连接器任务：凡是连接器、MCP、知识库、Obsidian、邮箱、GitHub 或外部服务的安装、配置、关联、查询，先调用 inspect_connectors 判断真实接入方式。已配置预设必须直接调用 test_connector，由客户端内置适配器完成规则读取、凭据注入、真实调用、重试和验收；禁止要求用户查看 README、提供命令或重复读取 Skill。只有尚未配置时才调用 prepare_connector 打开对应配置入口。
3. Skill 任务：用户明确要找、安装、更新或使用独立 Skill 时，才使用 search_skills/read_skill/install_skill。连接器关联的 Skill 是适配器规则来源，不由模型手工拼接健康检查命令；Skill 文件安装完成也不代表外部服务可用，最终状态只认 test_connector 的客户端证据。
4. 文件任务：读取、编辑、生成或验收文件，使用文件工具并实际重新读取或打开验证；聊天里说“已生成”不算交付。
5. 员工和团队任务：先使用客户端实时提供的员工、团队目录核对对象，再调度；不要凭旧对话断言某人不存在。
6. 外部服务缺少用户专属地址、密钥、登录、验证码或授权时，先完成能自动完成的配置草稿并打开正确入口，再用通俗话告诉用户只需填写哪一项。不得编造凭据，不得绕回无关工具消耗步骤。
7. 同时涉及多类能力时按依赖顺序处理，例如先确认模型可用，再配置连接器，再调用外部服务，最后验收产出；任一上游未通过都不能宣布整个目标完成。`;

export const EXECUTION_SELF_REVIEW_GUIDE = `## 最终交付前自检（把上一条回复当作草稿，必须重新核对）
1. 对照用户最初目标逐项检查，不得用“最后一个操作成功”代替“整个任务成功”。
2. 安装任务分别核对：文件是否正确下载、版本是否符合要求、是否放到正确位置、必要的 API Key/账号是否已经配置、是否做过一次真实可用性验证。
3. “下载完成”“解压完成”“安装完成”“配置完成”“可以使用”是不同状态。只完成其中一部分时，明确说哪部分完成、还缺什么，不能笼统宣布成功。
4. 如果工具失败，先理解失败原因，再换适合当前 Windows PowerShell 环境的方法；修正后重新执行，并重新验证最终目标。
5. 如果缺少只有用户才能提供的 API Key、密码、验证码或授权，保留已经完成的部分，清楚询问用户，不要继续假装验证，也不要把整个任务说成毫无进展。
6. 最终只输出面向普通用户的结论、完成情况和下一步。命令、工具名、参数、退出码和原始错误留在折叠的“执行过程”中。`;

export const SKILL_RECOVERY_GUIDE = `## Skill 失效时的强制替代路线
Skill 是可选的工作说明，不是完成任务的前提。本地 Skill 读取失败、目录缺失、来源失效或不再适用，不是要求用户回复“继续”的理由。禁止重复读取同一个失败 Skill ID，也禁止为了找 Skill 而反复搜索却不推进原任务。
必须按顺序处理：先用不同关键词重新检索本地技能库；没有可用候选时，直接使用 web_search 搜索替代 Skill、官方文档或可行的通用方案；外部搜索没有直接结果时，立刻使用现有通用工具和模型能力完成原目标，不要把“没有找到 Skill”当作任务失败。
每个任务最多花两次本地检索和一次联网检索寻找 Skill。之后必须回到原目标，写文件、读文件、查资料、执行验证或给出实际结果。只有 web_search 本身无法连接，且任务确实依赖外部资料时，才向用户说明“需要恢复联网搜索”以及要搜索什么；没有合适 Skill 时，不要卡住等待用户重复发送同一句话。`;

export function buildContinuationGuide(summary: string, stalledPhases: number): string {
  const strategy = stalledPhases > 0
    ? '上一阶段没有产生足够的新进展。重新检查原先假设，并选择本质不同的工具或实现路线，禁止只改写并重复旧操作。'
    : '上一阶段产生了新进展。保留成果，从尚未满足的完成标准继续，不要重新做已经完成的步骤。';
  return `## 自主执行检查点\n${strategy}\n\n以下是已压缩的执行记忆：\n${summary}\n\n回到用户最初目标继续处理。执行阶段额度只是内部保护措施，不是用户要解决的问题，禁止因为它要求用户点击“继续”。能自行发现和解决的问题不要停下来询问；只有确认缺少用户专属凭据、授权、文件或业务选择时才交接给用户。`;
}

export function buildRecoveryGuide(consecutiveFailures: number): string {
  const escalation = consecutiveFailures >= 3
    ? '已经连续失败多次。不要再沿用相同假设或只改写同一条命令；先重新检查环境和目标，选择本质不同的实现路线。'
    : '不要原样重复失败操作。根据刚才的真实结果修正方法，或改用更合适的工具和路线。';
  return `## 执行反馈后的自主纠错\n刚才至少有一步没有成功。${escalation}\n先判断失败原因和它是否影响最终目标。能自行解决就继续处理并重新验证；只有确实缺少用户专属信息、授权或选择时才暂停询问，同时保留已经完成的部分。`;
}

export function guardInstallationSummary(content: string, userText: string, toolResults: string): string {
  const claimsComplete = /已经安装好了|安装(?:已经|已)?完成|安装成功/u.test(content);
  if (!claimsComplete) return content;

  const requestedVersion = userText.match(/(?:^|[^\d])(\d+\.\d+\.\d+)(?:[^\d]|$)/u)?.[1];
  const observedVersion = toolResults.match(/(?:包内|实际|当前|版本(?:信息)?|version)\D{0,24}(\d+\.\d+\.\d+)/iu)?.[1];
  if (requestedVersion && observedVersion && requestedVersion !== observedVersion) {
    return `还没有安装好。\n\n你要的是 ${requestedVersion} 版本，但下载内容内部显示为 ${observedVersion}，两个版本不一致，所以不能把它当作安装成功。\n\n已经下载的文件会保留。下一步需要换用正确版本的安装来源，重新安装后再做一次实际使用检查；详细记录可以在下方“执行过程”中查看。`;
  }

  const combined = `${userText}\n${toolResults}`;
  const apiKeyRequired = /(?:API[ _-]?Key|接口密钥|访问密钥).{0,80}(?:需要|必填|配置|设置|获取)|(?:需要|必填|配置|设置).{0,80}(?:API[ _-]?Key|接口密钥|访问密钥)/iu.test(combined);
  const apiKeyProvided = /(?:API[ _-]?Key|接口密钥|访问密钥)\s*[:=：]\s*(?!https?:\/\/)(?!获取)([A-Za-z0-9][A-Za-z0-9_.-]{11,})/iu.test(userText);
  const apiKeyVerified = /(?:API[ _-]?Key|接口密钥|访问密钥).{0,40}(?:已配置|有效|验证通过|连接成功)|(?:验证通过|连接成功).{0,40}(?:API|接口)/iu.test(toolResults);
  const alreadyQualified = /还不能使用|还无法使用|还缺|尚未|没有配置|未配置/u.test(content);
  if (apiKeyRequired && !apiKeyProvided && !apiKeyVerified && !alreadyQualified) {
    return `安装文件已经放好了，但目前还不能正常使用。\n\n还缺少 API Key 配置和一次真实连接检查。请把 API Key 提供给我，或者先在对应服务的设置页面完成配置；配置后我会继续验证，确认能实际调用后再告诉你“全部完成”。\n\n下载和安装记录可以在下方“执行过程”中查看。`;
  }
  return content;
}

const TOOL_ACTIONS: Record<string, { active: string; stage: string }> = {
  search_skills: { active: '正在查找合适的技能…', stage: '查找技能' },
  read_skill: { active: '正在读取技能说明…', stage: '读取技能说明' },
  write_file: { active: '正在保存文件…', stage: '保存文件' },
  read_file: { active: '正在读取文件…', stage: '读取文件' },
  list_files: { active: '正在检查文件…', stage: '检查文件' },
  web_search: { active: '正在查询最新资料…', stage: '查询资料' },
  model_summary: { active: '正在整理搜索结果…', stage: '整理搜索结果' },
  read_web_page: { active: '正在阅读来源正文…', stage: '阅读来源正文' },
  install_skill: { active: '正在安装技能包…', stage: '安装技能包' },
  run_command: { active: '正在执行安装或检查…', stage: '安装或检查' },
  inspect_connectors: { active: '正在检查连接器状态…', stage: '检查连接器' },
  prepare_connector: { active: '正在准备连接器配置…', stage: '准备连接器配置' },
  test_connector: { active: '正在测试连接器…', stage: '测试连接器' },
};

// These entries are public execution summaries. They describe what the agent
// is doing without exposing provider reasoning tokens or hidden deliberation.
const PUBLIC_EXECUTION_ACTIONS: Record<string, string> = {
  task_understanding: '理解当前目标',
  task_plan: '制定执行路线',
  task_adjustment: '根据新结果调整路线',
  task_acceptance: '核对交付与验收',
  task_blocked: '说明当前阻塞',
};

function toolArgs(args: string): Record<string, string> {
  try { return JSON.parse(args) as Record<string, string>; } catch { return {}; }
}

export const WEB_ARTIFACT_ACCEPTANCE_GUIDE = `## Web UI 产出物验收
仅当任务生成、读取或修改 HTML/CSS/JavaScript 网页、应用界面时适用：客户端已经内置 verify_web_artifact，必须优先直接调用它验收当前 HTML；禁止先用 run_command 查找 Playwright、Chrome、Edge 或另写截图脚本。工具返回失败时，根据它给出的元素、边框、阴影和视口证据修改原文件，再调用同一工具复验，直到桌面与窄屏都通过。

交付前必须在桌面视口和不宽于 390px 的窄屏视口分别真实打开并验证。不能只检查 innerWidth 或 document.scrollWidth；垂直滚动条会占用可见区域，必须以 document.documentElement.clientWidth 或 visualViewport.width 中更小的值作为真实右边界。还要逐个检查所有可见控件、卡片、边框、阴影、说明区和文本的边界矩形，连同外阴影的视觉外沿一起确认不超出真实可见区域、不被滚动条或父容器裁切、不互相遮挡。页面不得出现意外横向滚动条。固定列网格在窄屏应使用 minmax(0, 1fr)，网格子项与按钮应允许 min-width: 0，长文本应换行；带粗边框或外阴影的主要容器必须在真实可见区域内保留至少 8px 安全间距。发现任一越界或贴边遮挡就先修复并重新验证，不能把功能可点击等同于视觉验收通过。`;

export const WEB_INTERACTIVE_ACCEPTANCE_GUIDE = `## 交互网页核心状态验收
网页游戏、Canvas 或交互式网页不能只验收标题、按钮和页面外壳。调用 verify_web_artifact 时，至少传一个 visible、count 或 canvas_nonblank 语义检查，证明蛇、果子、棋子、图表数据或用户明确要求的其他首屏对象真实存在且有尺寸。Canvas 必须用 canvas_nonblank 证明画布有非空像素；DOM 游戏必须用 visible/count 证明核心对象可见。核心对象检查失败后，必须修改 HTML/JavaScript、重新打开运行并立即复验；没有成功证据不得宣布完成，也不得用“已生成框架”替代核心功能验收。`;

export function getToolActionLabel(name: string, args = ''): string {
  if (PUBLIC_EXECUTION_ACTIONS[name]) return PUBLIC_EXECUTION_ACTIONS[name];
  const parsed = toolArgs(args);
  if (name === 'run_command') {
    if (String(parsed.verification).toLowerCase() === 'true' && parsed.connector) return '验证外部服务是否可用';
    const command = String(parsed.cmd ?? '').toLowerCase();
    if (/invoke-webrequest|start-bitstransfer|curl|wget|download/.test(command)) return '下载所需文件';
    if (/expand-archive|unzip|\btar\b|7z/.test(command)) return '解压安装文件';
    if (/npm\s+(?:i|install)|pnpm\s+(?:i|install)|yarn\s+add|pip\s+install/.test(command)) return '安装所需组件';
    if (/--version|\bversion\b|版本/.test(command)) return '核对版本';
    if (/api[_ -]?key|client[_ -]?id|\$env:|set-content|out-file/.test(command)) return '配置连接信息';
    if (/test-path|get-item|get-childitem|select-string|\bdir\b|\bls\b/.test(command)) return '检查文件和配置';
    if (/node\s|python\s|npm\s+test|npm\s+run/.test(command)) return '运行验证脚本';
    return '执行系统操作';
  }
  if (name === 'search_skills') return '查找合适的技能';
  if (name === 'read_skill') return '读取技能说明';
  if (name === 'write_file') return parsed.path ? `保存 ${String(parsed.path).split(/[\\/]/).pop()}` : '保存文件';
  if (name === 'read_file') return parsed.path ? `读取 ${String(parsed.path).split(/[\\/]/).pop()}` : '读取文件';
  if (name === 'list_files') return '检查工作区文件';
  if (name === 'web_search') return '搜索最新资料';
  if (name === 'model_summary') return '整理搜索结果';
  if (name === 'read_web_page') return '阅读来源正文';
  if (name === 'install_skill') return '安装官方技能包';
  if (name === 'inspect_connectors') return '检查连接器和可用预设';
  if (name === 'prepare_connector') return '打开连接器配置';
  if (name === 'test_connector') return '验证连接器是否可用';
  if (name.startsWith('connector_')) return '查询外部服务';
  return TOOL_ACTIONS[name]?.stage ?? '处理下一步';
}

export function getToolReport(name: string, args = ''): string {
  const action = getToolActionLabel(name, args);
  if (PUBLIC_EXECUTION_ACTIONS[name]) return `执行说明 · ${action}`;
  if (name === 'search_skills' || name === 'read_skill') return `技能库 · ${action}`;
  if (name === 'read_file' || name === 'write_file' || name === 'list_files') return `文件工具 · ${action}`;
  if (name === 'run_command') return `终端工具 · ${action}`;
  if (name === 'web_search') return `网络搜索 · ${action}`;
  if (name === 'model_summary') return `AI 模型 · ${action}`;
  if (name === 'read_web_page') return `网页工具 · ${action}`;
  if (name === 'install_skill') return `技能库 · ${action}`;
  if (name.startsWith('connector_') || name === 'inspect_connectors' || name === 'prepare_connector' || name === 'test_connector') return `连接器 · ${action}`;
  return `执行工具 · ${action}`;
}

export function getToolActivity(name: string, args = ''): string {
  return `执行中 · ${getToolReport(name, args)}`;
}

export function getToolStage(name: string): string {
  if (name.startsWith('connector_') || name === 'inspect_connectors' || name === 'prepare_connector' || name === 'test_connector') return TOOL_ACTIONS[name]?.stage ?? '连接外部服务';
  return TOOL_ACTIONS[name]?.stage ?? '处理任务';
}

export function isToolResultSuccessful(result: string, explicitSuccess?: boolean): boolean {
  if (explicitSuccess !== undefined) return explicitSuccess;
  return !/(?:^|\n)(?:工具执行错误|未知工具|连接器调用失败|API 返回错误)|(?:退出码|exit\s*code)\s*[:：]?\s*[1-9]\d*|\b(?:error|failed|failure)\b|❌|失败|异常/iu.test(result);
}

export function humanizeExecutionError(raw: string): string {
  if (/401|403|unauthorized|forbidden|api\s*key|鉴权|密钥/iu.test(raw)) return '账号验证没有通过，请检查模型或服务的账号设置。';
  if (/timeout|timed out|超时/iu.test(raw)) return '等待时间太久，服务没有及时回应。请稍后重试。';
  if (/network|fetch|ECONN|ENOTFOUND|网络|连接失败/iu.test(raw)) return '网络连接没有成功，请检查网络后重试。';
  if (/ENOENT|not found|not recognized|找不到|不存在/iu.test(raw)) return '需要的程序或文件没有找到，需要换一种安装方式。';
  if (/EACCES|EPERM|permission|权限|拒绝访问/iu.test(raw)) return '系统不允许这一步操作，需要确认安装权限。';
  if (/(?:退出码|exit\s*code)\s*[:：]?\s*[1-9]\d*/iu.test(raw)) return '这一步没有顺利完成，需要换一种方法重试。';
  return '这一步没有顺利完成，详细记录已放在下方“执行过程”中。';
}

export function summarizeToolResult(name: string, result: string, success: boolean): string {
  if (PUBLIC_EXECUTION_ACTIONS[name]) return result || (success ? '这一步已经完成。' : '这一步还没有完成。');
  if (!success) return humanizeExecutionError(result);
  if (name === 'search_skills') return '已找到候选技能，正在继续筛选。';
  if (name === 'read_skill') return '技能说明已读取。';
  if (name === 'read_file') return '文件内容已读取。';
  if (name === 'list_files') return '工作区内容已检查。';
  if (name === 'write_file') return '文件已经保存。';
  if (name === 'web_search') {
    const count = [...result.matchAll(/(?:^|\n\n)\d+\.\s/gu)].length;
    return count > 0 ? `资料搜索已完成，共获得 ${count} 条结果，正在整理。` : '资料搜索已完成，正在整理。';
  }
  if (name === 'model_summary') return success ? '搜索结果已经整理完成。' : humanizeExecutionError(result);
  if (name === 'read_web_page') return '来源正文已经读取。';
  if (name === 'install_skill') return '技能包已经安装，正在继续配置和验证。';
  if (name === 'run_command') return '这一步已经完成。';
  if (name === 'inspect_connectors') return '连接器状态已经检查。';
  if (name === 'prepare_connector') return '配置窗口已经打开，正在等待填写并验证。';
  if (name === 'test_connector') return '连接器已经通过真实测试。';
  if (name.startsWith('connector_')) return '外部服务已经回应。';
  return '这一步已经完成。';
}

export function simplifyLegacyAssistantContent(content: string): string {
  if (!/^已执行\s+\d+\s+个操作。详细过程已收纳在下方“执行过程”中/iu.test(content.trim())) return content;
  const failures = content.match(/❌\s*失败/gu)?.length ?? 0;
  const statuses = [...content.matchAll(/→\s*(✅\s*成功|❌\s*失败)/gu)].map((match) => match[1]);
  const lastSucceeded = statuses.at(-1)?.includes('成功') ?? false;
  if (failures === 0) return '已经处理好了。所有步骤都已完成，详细记录可以在下方“执行过程”中查看。';
  if (lastSucceeded) return `本轮已经有进展，但目前还不能确认整个目标完成。中途有 ${failures} 步没有成功；最后一步成功只代表该步骤完成，仍需按最初目标重新验收。详细记录可以在下方“执行过程”中查看。`;
  return `还没有处理好。中途有 ${failures} 步没有成功，最后一步也没有完成。详细原因可以在下方“执行过程”中查看。`;
}
