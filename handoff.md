# 太极项目当前交接

## v2.6.0 阶段三：执行观测、诊断账本与任务防误删（2026-07-31，正式版本）

- 应用内部身份已正式迁移为 `taiji-office` / `com.taiji.office`。`electron/appIdentityMigration.cjs` 在任何 `userData` 消费者初始化前，将 `%APPDATA%/hermes-office-pro` 的业务数据无损复制到 `%APPDATA%/taiji-office`；不覆盖新文件、不复制缓存/锁/旧更新器 ID，成功后写版本标记。旧目录暂留作恢复备份。
- 当前源码版本为 `2.6.0`。`electron/executionObservability.cjs` 将执行状态投影为队列、运行、等待子任务、补偿、暂停和终态，并聚合重试、工具结果、失败类别、证据完整度与耗时。
- `electron/operationDiagnostics.cjs` 是可持久化、可筛选、可导出的 JSONL 错误账本。它对 API Key、Token、密码、Authorization 和常见密钥字面量脱敏；记录 `taskId/teamId/scope/operation/failureClass/recoverable/context`，保留最近 5000 条。
- 所有渲染窗口的未处理错误、主进程未处理异常、任务账本失败、任务恢复前置检查、原生执行器的工具/步骤失败与核心 IPC 失败都进入同一错误账本。设置 → 诊断中心显示摘要并可导出 JSON 给开发排查。
- 已修复当前“继续执行”相关根因：旧渲染端快照不能再通过省略条目删除活跃父任务。只有用户显式请求且任务已终态时才允许移除；`verify:task-runtime-store` 覆盖旧快照、显式删除和活跃任务保护。
- 专项回归：`npm.cmd run verify:execution-observability`、`npm.cmd run verify:operation-diagnostics`、`npm.cmd run verify:app-identity-migration`、`npm.cmd run verify:task-runtime-store`、`npm.cmd run verify:native-execution`、Build 与 Lint 均已通过。下一步继续阶段三的模块拆分、性能压测、真实更新与回滚演练。
- 本机已卸载旧安装身份并安装到 `%LOCALAPPDATA%/Programs/taiji-office`，真实启动迁移 225 个业务文件、0 个失败；任务账本、记忆和工作区规模与迁移前一致。安装包 `release/taiji-office-setup-2.6.0.exe` 为 175428775 字节，SHA-256 为 `49A59EDD0FE78D6DDC296654014FF915F4B11102075E329CE047C0DA5916502D`。

## v2.5.2 办公室工位卡片（2026-07-31，开发中）

- 员工工位卡片的配置入口已从左上角移至右下角，并改用三点更多图标，避免遮挡身份文字。入口仍打开同一套员工设置。

## v2.5.1 阶段二：Coding Runtime 与项目 DAG（2026-07-31，开发中）

- 当前源码版本为 `2.5.1`。本版开始落实“专业协作与 Coding Runtime”：独立受控工作区/可选 Git Worktree、仓库索引、符号与依赖定位、Diff/检查点、可追溯命令会话，以及 ProjectBrief 到责任 DAG 的编译。
- `src/engine/codingProject.mjs` 是统一编译器；`electron/codingRuntime.cjs` 是实际运行时。不要退回用提示词或聊天文字代替项目图、工作区、补丁和验证证据。
- 团队项目在 `ProjectBrief` 存在且目标属于软件实现时会调用同一个编译器。DAG 存在职责缺口时进入等待补人，不随机派给现有成员。审查退回必须指定 `responsibleStepId`，仅重开该步骤。
- `npm.cmd run verify:coding-runtime` 覆盖工作树隔离、仓库索引、符号/依赖查找、检查点、原生 Coding 工具、ProjectBrief DAG 和定向返工；已纳入 `verify:v2-core-gate`。
- 本轮已打包客户端 `release/taiji-office-setup-2.5.1.exe`，尚未创建 GitHub Release。下一小版本继续：把 Coding Runtime 的增量命令会话接入原生执行器，产出统一 Diff/测试/回滚交付面板，并将中途补人事件显示到项目阶段。

## v2.5.0 阶段二：专家人格归位与团队入口收口（2026-07-31，开发中）

- 当前源码版本为 `2.5.0`，基线 `v2.4.0` 已推送至 GitHub `main`，提交 `b3e9ffd`；本节改动尚未提交、打包或发布。
- 专家目录的创建规则已修正：`prompt` 只保存角色与职责摘要，完整专业指令放到 `soul`。`fetchInitial()` 会对已存在的目录专家执行幂等迁移：识别旧版“专业工作规则”混写格式并拆分；用户自行修改的 `prompt` 不会被覆盖，空 `soul` 会补全官方规则。
- 办公室双面员工工牌增加左上角设置入口，打开同一份员工设置页。设置、员工私聊和团队执行将读取同一组 `prompt`/`soul` 数据。
- 左侧边栏移除团队列表、折叠状态和重复的新建入口；团队大厅是查看、打开、重命名、归档和删除团队的唯一管理入口。
- 专项回归：`npm.cmd run verify:v250-personas-and-office`，并加入 `verify:v2-core-gate`。下一步继续阶段二的任务上下文和跨入口语义一致性，不打包客户端，直到用户要求验收。

## v2.4.0 阶段一：任务轮次隔离与全界面 GPT Image 2（2026-07-31，未发布）

- 当前源码版本为 `2.4.0`，尚未打包或发布。此工作树基于已发布的 `v2.3.1`。
- 新增 `turnRelation`：`new_task`、`continuation`、`correction`、`control`、`question`。任务决策在进入执行前先判断本轮与当前任务的关系；独立新目标进入新的队列，暂停/继续/停止和进度询问不再误触发新的任务规划。
- `gpt-image-2` 作为平台通用图片模型接入：设置页一键创建配置，助理、员工单聊、团队聊天均可在模型选择器切换；生成结果保存为消息图片附件并可下载。
- 图片切换保存到 `chatModelOverrides`，只影响 assistant/dm/team 当前场景，不覆盖 `assistantModelId`、`activeModelId` 或员工专属模型，避免后台任务错误地向图片模型发送聊天请求。
- OpenAI 实际图片请求尚未在本机验证，因为当前没有可用于实测的 OpenAI API Key。已通过 `verify:image-model-routing`、`verify:task-turn-isolation`、构建、Lint 和 v2 核心门禁。
- 后续优先继续阶段一的语义可靠性差距：让任务合同、观察结果与恢复判断在所有聊天入口完全一致；不打包、不发布，直到用户要求阶段版本验收。

## v2.3.1 软件项目组队精度与完整分类导航（2026-07-31）

- 当前源码版本为 `2.3.1`。软件、应用、客户端、平台、系统、网站和小程序的新建需求会生成不可被模型删减的职责基线：协调、软件架构、UI/UX、客户端/前端、后端、工程实现和质量验收。
- 组队选择不再按目录顺序用泛化工程师兜底。核心职责使用员工姓名、职位和显式能力进行专门度排序；长提示词里偶然提到 UI 或测试不会让架构师冒充设计师或 QA。
- “人员不对、重新看需求、重新选人、客户端开发”等纠错直接重匹配当前会话中的同一待批项目，并继承结构化原始目标。用户给出的“个人创作者发布平台客户端”四轮对话已固化为 `verify:v231-dispatch-and-brand`，断言不出现 Drupal、WordPress 或幼师。
- 办公室分类导航已增加左右图标、鼠标纵向滚轮转横向、当前标签自动显现和焦点反馈。在真实 272 人目录的 `1280×720`、`760×720` 页面中，12 个分类可完整浏览，页面没有横向溢出。
- Markdown 聊天导出页脚已统一为“由太极助手导出”。系统评分和 Coding Runtime 路线已写入 `docs/自我评分.md`，综合评分为 `67/100`。
- 已通过专项回归、`verify:dispatch-intelligence`、`verify:team-membership`、`verify:expert-orchestration`、Build 和 Lint。完整 `verify:v2-core-gate`、Windows 安装包及 GitHub Release 状态见本节后续发布记录。
- 已于 2026-07-31 发布 [GitHub Release v2.3.1](https://github.com/TTflysky/sirenhuisuo/releases/tag/v2.3.1)，发布提交为 `2e1913fc96bfca21e71873be5e9fe45037740b80`。
- Windows 安装包 `taiji-office-setup-2.3.1.exe` 为 `175406335` 字节，SHA-256 为 `07C273E525981F250414125745BF75C973B761D4405F9237D07BAA41CAA09CE7`；配套 blockmap 为 `181422` 字节，`latest.yml` 为 `353` 字节。
- 发布前完整 `verify:v2-core-gate`、发布脚本全部专项验证、`dist:win` 和 `verify:package` 均通过。GitHub 已核对远端 `main`、Release 标签、安装包、blockmap、`latest.yml` 与本地 SHA-256 一致。

## v2.3.0 员工导航、主题工牌与专用模型（2026-07-30）

- 当前源码已升级为 `2.3.0`。办公室新增 11 类动态导航与实时人数，分类来源是实际员工资料和专业目录，不维护第二份静态员工名单。
- 工位已替换为主题自适应双面工牌。正面展示头像框、姓名、职位、能力摘要、能力标签和状态；背面展示完整能力说明与独立私聊按钮。分类切换以员工 ID 隔离翻面状态，隐藏面不会进入键盘焦点。
- 272 名及更多员工仍使用办公室独立纵向滚动；工牌固定高度并使用 `content-visibility` 跳过离屏渲染，减少大员工目录的绘制开销。分类导航本身可横向滚动。
- 新增员工头像库的 `AI 生成` 页签。必须从现有模型库显式指定生图模型，支持 OpenAI 兼容 `/images/generations` 的 Base64 和 URL 返回；结果先预览，点击“使用这个头像”后才保存为本地头像。
- 诊断中心新增专用模型与“一键诊断并优化”。模型读取结构化报告并作判断，客户端确定性白名单只允许修复来源明确的用户 Skill 和恢复“沙盒开启、命令/连接器替我审核”；模型、API Key、连接器、外部软件、工作区和运行时故障不会被伪装为已修复。
- 新增 `npm.cmd run verify:v230-experience`，已加入 `verify:v2-core-gate` 和正式发布脚本。真实 Vite 页面已在 `1440×960` 与 `1024×720` 检查办公室、分类导航、工牌、设置诊断页和 AI 头像页，无横向溢出或内容遮挡。
- 正式发布已完成：发布脚本重新通过 `verify:v2-core-gate`、构建、Lint 和包内校验，并核对 GitHub 标签、提交与三个远端资产。Release：[v2.3.0](https://github.com/TTflysky/sirenhuisuo/releases/tag/v2.3.0)；发布源码提交：`ac6a3c389d5e6238561c72166a0945eec5ce7d6c`。安装包 `taiji-office-setup-2.3.0.exe` 为 `175403350` 字节，`.blockmap` 为 `181355` 字节，`latest.yml` 为 `353` 字节；安装包 SHA-256 为 `F929BA87A3B7A64D0CC8CE78376D93EFAD6539B5BA0804C00AF1F83B39CDFD31`。
- 发布门禁曾发现办公室预设容量被误改为 24，现已拆分为“逻辑预留 999 个工位”和“默认只渲染 24 个可见空位”。员工超过 999 人仍继续分配，真实员工全部可滚动查看，但少量员工时不会绘制 999 张空工牌拖慢界面。
- Electron 异常码 `-1073741515` 已确认是 Windows `0xC0000135`（进程启动时找不到 DLL），不是显卡算力不足。VC++、DirectX 和 Electron 自带 `libEGL/libGLES` 均存在，当前安装版 `v2.2.2` 主/子进程正常运行；现有事件日志只记录 `RADAR_PRE_LEAK_64` 内存压力，没有应用崩溃记录。因此不向正式版强制注入关闭硬件加速，后续只对开发测试子进程捕获加载路径和具体缺失模块。

## v2.2.2 团队方案连续性与顺序执行（2026-07-30）

- 发布完成：源码版本 `2.2.2` 已提交为 `ea64c9594dae8a790c05e4547d5447443fb9ed42`，并已快进到远端 `main` 与标签 `v2.2.2`。发布分支仍为 `codex/v2.2.2-orchestration`，后续开发应从远端 `main` 同步。
- 已修复的 P0 组队问题：项目草案新增 `conversationId`、`rosterRevision`、`clarifying` 状态和方向确认记录。成员替换、添加、移除直接修改结构化名单；“可以”“就这个团队，拉群吧”优先批准当前会话的待批草案，绝不创建第二份草案或重新从专家池猜人。
- 已修复的 P0 执行问题：审批只建立团队并提出方向/风格问题，不立即开工。收到确认后点击团队窗口的“确认方向并开始执行”才创建任务计划。计划按需求/架构、设计/数据、实现、审查的依赖关卡推进；未满足依赖的员工显示“等待前置步骤”，不再伪装为全员并行。
- 已修复的性能问题：原生执行事件改为按 `taskId` 增量读取主进程任务投影。首次启动与恢复仍全量校准，实际产出才同步产出物；高频通知不会在每个窗口扫描所有任务和全部产出物。
- 已通过：`npm.cmd run build`、`npm.cmd run lint`、`npm.cmd run verify:team-membership`、`verify:dispatch-intelligence`、`verify:orchestration-control`、`verify:project-board`、`verify:team-execution-protocol`、`verify:native-execution`、`verify:task-runner`、`verify:chat-session-isolation`、`verify:execution-controller`、`verify:execution-evidence`。
- 发布校验已完成：`verify:v2-core-gate` 和 `verify:package` 均已通过。GitHub Release：[v2.2.2](https://github.com/TTflysky/sirenhuisuo/releases/tag/v2.2.2) 已上传 `taiji-office-setup-2.2.2.exe`（`175395904` 字节）、同名 `.blockmap`（`181461` 字节）和 `latest.yml`（`353` 字节）。安装包 SHA-256：`6FDC81FB950D744207C3687B2EBF5FCF1A5E4D54A2B2C4AC77A3858464D8F944`。真实 Electron UI 截图仍因本机图形驱动环境退出而未跑通，不能伪称通过。

## v2.2.1 专家团编排与办公室员工化（2026-07-30）

- `v2.2.1` 补充：全部 268 位内置专家在首次启动时自动迁移为真实办公室员工，稳定分配职责名称、部门、头像框和工位；旧的 999 个固定空工位已改为按实际员工数量生成。

- 当前源码与本地安装包版本为 `2.2.1`，Windows 安装包为 `release/taiji-office-setup-2.2.1.exe`；发布时必须同时上传该安装包、`.blockmap` 和 `latest.yml`，不能只推送源码提交。
- 已内置 `jnMetaCode/agency-agents-zh` 的 268 位 MIT 许可中文专家，包含来源、许可证、职责摘要和完整规则；`v2.2.1` 已改为首次启动即将缺失专家补齐为可执行办公室员工，旧的“仅在项目中物化”方案已废弃。
- 团队人数没有硬上限。项目运行期间添加专家会刷新原生执行器成员快照和内存名单，并增加 `memberRosterVersion`，使后续动态委派能够使用新专家。
- 项目草案增加持久的 `ProjectBrief`，在批准卡中展示目标、专业阶段、交付和验收；批准后该简报进入任务上下文。
- 已通过 lint、build、专家编排回归、原生执行、团队成员、项目看板、任务内核和 Windows 打包检查。
- 完整设计、已完成/未完成边界、后续顺序和验证记录见 `docs/V2.2.0_AGENCY_EXPERT_ORCHESTRATION.md`。下一次继续前必须先读该文档，避免把“专家已显示为员工、目录和项目简报已完成”误判为“多专家分别产出方案与 ProjectBrief DAG 已全部实现”。

## v2.1.0 当前状态（2026-07-29）

- 当前源码版本：`v2.1.0`。本轮按 Hermes 提交 `41a07f5` 的真实运行链路完成四层对齐：模型决策与公开轨迹、执行循环与分类恢复、工具/Skill 真实调用、记忆与团队协作闭环。
- 新增 `src/engine/turnLifecycle.mjs`，助手、员工私聊和原生团队 Worker 统一记录目标、公开决定、工具调用/结果、真实证据、上下文压缩、用户插话、预算、退出原因和恢复条件；不保存隐藏思维链。
- TaskService 升级到协议 v2，持久化 `conversationId`、`turnRuntime`、`turnFinalization`、`turnLifecycle` 和 `lifecycleRecovery`。旧序号或同序号冲突快照不能覆盖新事实，心跳不会冒充真实进展。
- 主进程对生命周期和恢复胶囊再次脱敏。工具调用通过 `callId` 原子配对，中断恢复后由同一真实证据闭合，避免重复副作用或永久显示“进行中”。
- 子任务继承父任务已验证产物、引用、生命周期退出状态和恢复胶囊，不继承未验证的口头完成声明。暂停、等待用户、检查点、停止和失败都有独立结局与继续条件。
- 详细源码映射：`docs/HERMES_RUNTIME_ALIGNMENT_V2.1.md`。专项回归：`npm.cmd run verify:turn-lifecycle`。
- 已通过：`verify:v2-core-gate`、`verify:v1-core-gate`、`verify:v1-fault-injection`、`verify:turn-lifecycle`、`verify:task-service`、`verify:native-execution`、`build`、`lint` 和 `verify:package`。
- Windows 安装包：`release/taiji-office-setup-2.1.0.exe`，大小 `174349843` 字节，最终发布资产 SHA-256：`90EF3F096CFFF8F0CDFB3787ABD11ED1088B3F459E4293F0AA3DC15AEC678F44`。`latest.yml` 与安装包版本、大小一致，包内 6 款字体、内置 Skill 和 16 项必需运行文件均已验证。
- 本机真实 Electron UI 自动化未完成：Electron 33 的 GPU 子进程仍以系统错误 `-1073741515` 在渲染前退出，即使使用独立用户目录和 `--disable-gpu` 也相同。核心、组件合同、构建和包内验证均通过；`verify:foundation-ui` 与 `verify:chat-controls-ui` 留给图形运行环境正常的电脑补跑，不能记录为已通过。
- GitHub 发布状态：已发布并由发布脚本核对远端 `main`、`v2.1.0` tag、安装包大小和 digest。Release：`https://github.com/TTflysky/sirenhuisuo/releases/tag/v2.1.0`；功能提交：`d392e5dd0e01a8bdd57ec785cedd8f7bd27bb2be`。

### 当前问题与下一步

- 办公室电脑先补跑 `npm.cmd run verify:foundation-ui` 和 `npm.cmd run verify:chat-controls-ui`；本机 GPU 环境失败不能通过修改业务代码或跳过断言伪装解决。
- 后续发布脚本不应在记录 SHA-256 后再次无条件重打包；Electron Builder 会写入新的发布时间，二次构建会改变哈希。交接文档必须记录最后一次实际上传并经远端校验的资产值。
- 助手和员工聊天进一步迁移到完全由主进程托管的长期后台队列属于后续增量，不在本版伪报完成；当前原生团队 Worker 已由主进程托管。

### 已踩过的坑

- 不能把心跳当作真实进展，否则卡死进程会长期显示“正在工作”。
- 不能只在渲染端脱敏；TaskService 是持久化边界，必须二次清洗。
- 生命周期序号相同也不能允许内容冲突覆盖；相同序号只应视为幂等重发。
- 工具开始和结果必须以同一 `callId` 闭合；恢复时另建记录会导致重复执行或错误验收。
- `waiting_user`、`paused` 和预算检查点不是普通失败，更不能包装成完成。
- GitHub 发布成功必须同时满足远端 `main`、tag、Release 资产大小和 SHA-256 一致；网络失败时只能记录阻塞，不能声称已发布。

---

## 本地续作状态（2026-07-29）

- 当前本地开发版本：`v2.0.1`。本轮完成 SkillHub/GitHub/ZIP/SKILL.md 统一安装闭环、助理/员工/团队三类独立聊天历史、任务与子任务会话归属、父子任务正确恢复顺序、真实进展与进程心跳分离，以及模型/工具无响应时的自动停滞保护。
- `v2.0.1` 的执行界面会明确显示当前模型或工具动作、最后真实进展和进程心跳。心跳不再刷新“真实进展”；工具结果不确定时会安全暂停，避免重复副作用，并给出通俗的继续条件。
- 新增 `npm.cmd run verify:chat-session-isolation`；`verify:native-execution` 已覆盖永不返回的模型、永不返回的工具、停滞暂停和父子继续顺序。上述检查已加入 `verify:v2-core-gate` 和发布门禁。
- 新增 `npm.cmd run verify:chat-controls-ui`，已在真实 Electron 窗口点击验证助理、员工私聊、团队的新建聊天，以及停滞任务的“继续执行”反馈；员工窄窗口工具栏已改为稳定图标和自适应换行，不再逐字竖排。
- `v2.0.1` Windows 安装包已完成本地构建和包内校验：`174342459` 字节，SHA-256 为 `5D04FE6D45579097EDAD263497B0FB72E37FB47787BD95B4907DD29891142D33`；6 款字体、内置 Skill、任务状态和会话控件均在 `app.asar` 中。
- 当前本地开发版本：`v2.0.0`。已完成统一 Turn Runtime、能力图调度、MoA 私有顾问、分类恢复、类型化交付验收、精确工具参数保留和团队决策合同透传；旧 UI、员工、团队、聊天、记忆与本地存储键保持兼容。
- v2 发布门禁：`npm.cmd run verify:v2-core-gate` 与 `npm.cmd run verify:v1-core-gate` 均通过。新增轨迹覆盖精确查询词、偏题换路线、纯问答不造文件、文件/连接验收、缺授权等待、上下文溢出、运行中插话、UI 团队选择、顾问越权和预算交接。
- 当前本地开发版本：`v1.0.2`。助理、员工私聊和团队聊天已统一使用可读执行详情，宽版查看、全局字号、长结果滚动和原样显示已完成；五款被误排除的内置中文字体已经恢复为可选项并加入安装包门禁。
- `v1.0.2` 视觉回归：深色、浅色、1000×850 和 600×760 均无横向溢出或遮挡；本机 Electron 33 的 GPU 进程仍以系统错误 `-1073741515` 在渲染前退出，因此保留 `npm.cmd run verify:execution-detail-ui` 供图形环境正常的电脑执行，本机使用真实 React 组件与主题 CSS 的 Vite 浏览器回归完成像素检查。
- `v1.0.1` 调度链路：空闲状态的新消息先由模型编译一次结构化任务合同；团队任务进入待审批方案，普通任务复用同一份决定进入执行循环。模型不直接改团队，员工必须来自实时目录且满足能力覆盖；无模型或分类失败时走确定性降级。
- `v1.0.1` 现场回归：`改造操作系统前端界面` 固定覆盖 UI/UX、前端实现和验收，幼师与无关在线员工不得入选；`为什么不叫 UI UX 前端设计师` 直接更新最近待审批方案；`办公室有多少人` 只读本地目录，不调用 Skill 或网页。
- `v0.63-v0.72` 已将助理单聊、员工单聊和团队执行接入统一 `TaskService`，并补齐真实子任务创建、原生队列、父子依赖等待、验证结果回灌、失败回写、生命周期级联和进程恢复续跑。
- `v0.73` 补齐补偿执行：已经完成且明确声明副作用与补偿步骤的工作，在停止、关闭或运行失败时按逆序执行补偿；补偿本身必须产生真实工具成功证据，且完整结果被写入账本、恢复胶囊、执行事件与 Runner 历史。
- `v0.74` 补齐补偿交接：补偿目标缺失、负责人不可用和跨子任务补偿暂不可执行时，都会落入账本、恢复胶囊和明确的用户交接；任务指标可区分已完成、受阻和失败的补偿。
- `v0.75` 补齐已排队子任务的补偿顺序：停止父任务时，排队中的子任务会先完成自身声明的补偿，父任务随后才处理自身补偿，避免共享资源以错误顺序被撤销。
- `v0.76` 补齐已排队父任务的补偿：父任务在队列中而子任务执行时被停止，父任务会进入专用补偿队列，在子任务停止/补偿结算后再执行，避免遗漏回滚或并发工具调用。
- `v0.77` 新增账本任务树审计投影：根任务可一次读取所有后代、层级、状态、阻塞、步骤、已验证产出和补偿结果；恢复、诊断与后续界面可共享这一事实来源。
- `v0.78` 新增恢复计划：从任务树统一判断根任务能否继续、必须先解决的授权/配置/补偿阻塞项，以及由深到浅的补偿处理顺序；不再由界面猜测恢复路径。
- `v0.79` 将恢复计划接入 Worker 的继续入口：恢复条件不满足时拒绝在状态变更前，返回完整恢复计划，避免任务被错误重新入队。
- `v0.80` 将高风险补偿接入人工审批账本：停止任务后，删除、发送、发布、部署、支付等补偿先等待批准；批准只恢复专用补偿队列，拒绝保留阻塞交接。
- `v0.81` 完成高风险补偿审批端到端回归：验证停止不会预先调用工具、批准后只执行补偿、并经由统一 Worker 恢复门禁进入专用队列；同时修正补偿批准后的状态机衔接。
- `v0.82` 将任务树审计和恢复计划接入团队任务详情：展开任务即可读取账本真实层级、补偿、阻塞与继续条件，不再依赖聊天气泡推断执行状态。
- `v0.83` 建立 v1 核心发布门禁：一条命令实际串行执行 Lint、构建、任务服务、恢复、计划、子任务、原生端到端、内核与生态健康检查，首个失败会明确中止。
- `v0.84` 清理三处发布 Lint 噪声：文件名与工作区路径仍会过滤控制字符，但改用 Unicode 属性类实现；核心门禁重新通过。
- `v0.85` 将 Skill 上下文读取与真实证据从输入组件迁入执行内核模块，助理/员工/团队保持统一调用；废弃目录不再参与 Lint。
- `v0.86` 清理人格与 Store 的组件边界，发布 Lint 已无警告；新增 `verify:v1-fault-injection`，覆盖超时、授权拒绝、Worker 重启、子任务、补偿、工具和 Skill 证据。
- `v1.0` 将内置人格和全部可见入口统一为章北海助理，默认人格升级至 v13，旧的自定义人格不被覆盖，只会追加一次 v1 任务账本与恢复协议；`v1.0.2` 保持幼圆为默认字体，并恢复另外五款必须随客户端交付的可选中文字体。
- 新增/扩展回归：`npm.cmd run verify:task-service`、`npm.cmd run verify:child-task-dispatch`、`node scripts/verify-native-execution-adapter.cjs`。原生端到端场景覆盖模型委派、手动委派、子任务交接、暂停/停止级联、无活动执行器的恢复续跑、子任务失败同步和停止后的真实补偿工具执行。
- 本轮核心文件：`electron/nativeExecutionAdapter.cjs`、`electron/taskService.cjs`、`scripts/verify-native-execution-adapter.cjs`、`scripts/verify-task-service.cjs`、`docs/TASK_SERVICE_V0.67.md` 至 `docs/TASK_SERVICE_V0.73.md`。
- 发布前命令：`npm.cmd run verify:v1-core-gate`、`npm.cmd run dist:win`、`npm.cmd run verify:package`。发布后以 GitHub Release 的安装包和 digest 为准。

> 更新时间：2026-07-29
> 当前版本：`v2.0.0`
> 主分支：`main`
> 仓库：[TTflysky/sirenhuisuo](https://github.com/TTflysky/sirenhuisuo)
> Release：`v2.0.0` 为统一智能体运行时与自主执行内核大版本

## v0.40.0 收口状态
- 本版本修复批准组建团队后聊天子窗口偶发显示“团队不存在”的跨窗口初始化竞态，并持久化新团队首条消息。
- 成员工作状态现在同时由工具调用、执行控制器和原生 Worker 运行步骤投影；执行提示显示实时计时，进行中气泡有流光动画。
- 执行气泡仅显示清洗后的摘要，Base64/data URL 等长编码保留在任务账本和回放中，不再污染聊天界面。

## v0.39.0 收口状态

- `v0.39.0` 已统一完成并发布；`v0.40.0` 为本轮团队窗口与执行状态修复版本。
- 已加入统一版本门禁 `npm.cmd run verify:v039-release-gate`，会实际执行构建、Lint 与核心内核回归。
- 本轮只更新核心代码、回归脚本和说明，不打包 Windows 客户端，不发布 GitHub Release；后续大版本验收通过后再执行发布流程。

`v0.29.0` 在现有架构上补齐双重记忆和学习闭环：团队共享经验与员工个人经验同时参与执行，真实验收路线自动沉淀，模型推断进入审批，重复流程只生成隔离 Skill 草案；没有替换现有任务内核、人格、员工、团队或聊天数据。

## 办公室端直接开始

在任意已有源码中运行：

```powershell
npm.cmd run sync:project
```

进入同步命令输出的最新源码目录后依次执行：

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run lint
npm.cmd run verify:foundation
npm.cmd run verify:agent-kernel
npm.cmd run verify:execution-controller
npm.cmd run verify:steering-e2e
npm.cmd run verify:connector-adapters
npm.cmd run verify:layered-memory
npm.cmd run verify:learning-review
npm.cmd run verify:context-tool-pairs
npm.cmd run verify:skill-drafts
npm.cmd run verify:native-execution
npm.cmd run verify:package
```

开始修改前阅读本文件、`docs/PROJECT_HANDOFF.md`、`docs/CROSS_DEVICE_WORKFLOW.md` 和 `CHANGELOG.md` 的最新版本。

## 八项实现状态

### 1. 工作区隔离：已完成

- 助手、员工私聊和团队任务每次请求创建独立工作区。
- 员工自动重试、团队暂停与恢复继续使用原任务目录。
- 团队链路已贯通 `startTaskRun -> initializeTaskWorkspace -> runAgentLoop -> executeTool`。
- 新增受限 `fs:copyIntoWorkspace` IPC，把聊天暂存附件复制进本次任务工作区。
- 两个任务中的同名文件不会互相覆盖。

### 2. 统一诊断中心：已完成

- 设置首页改为诊断中心，一次真实检查 AI 模型、连接器与知识库、Skill、工具注册、任务内核与恢复、工作区和安全审批。
- 每项显示“可用 / 需确认 / 缺配置”、通俗原因、下一步和设置入口。
- 主进程生态健康报告同时检查版本身份、账本、Worker、工具、安装 Skill、物理工作区和 Git Worktree，并区分核心阻塞与可选提醒。

### 3. 上下文与预算管理：已完成首个可恢复版本

- `TaskRecoveryContext` 持久化摘要、已完成证据、未决问题、运行中插话、工具次数和上下文用量。
- 每次客户端进程有独立会话编号；新开窗口不会误判中断。
- 客户端退出或重启后，旧 `running/queued` 团队任务会转为暂停的“待恢复”任务。
- 原工作区、已完成步骤、证据和未决问题保留，恢复时从未完成步骤继续。
- `TaskRecoveryContext.controller` 保存统一执行状态机快照，包括失败分类、路线哈希、观察、证据和验收状态，不保存原始工具参数或凭据。

### 3A. 统一执行控制器：已完成首版

- `src/engine/executionController.mjs` 是助理、员工私聊和团队任务的统一裁决源。
- 工具调用前检查路线许可，结果返回后分类成功或失败；瞬时错误可重试，确定性错误直接换路线。
- 模型请求失败每 10 秒重试，最多 5 次；团队上一步没有结果时停止后续步骤。
- 最终文本必须经过证据门槛和独立复核；没有真实证据时拒绝模型口头完成声明。
- 用户运行中插话会进入 `applyExecutionSteering` 重新判断，团队点击继续会重新验证旧阻塞条件。

### 4. Skill 健康与恢复：已完成原子修复闭环

- 健康状态为 `ready / setup / limited / broken`。
- 扫描环境变量、外部软件、账号授权和 `SKILL.md` 引用文件。
- 损坏 Skill 自动隔离，不参与自动匹配。
- 安装前展示要求；来源明确的用户 Skill 支持重新安装修复。
- 安装记录保存来源和正文 SHA-256。
- 单文件、GitHub 目录和 ZIP 均在同根暂存目录完成验证后原子替换；失败会保留或恢复旧版本。
- 本机最近扫描 95 个 Skill：65 个可直接使用、30 个使用前需配置、没有误判为损坏的 Skill。

### 5. 任务验收与审查：已完成

- 证据区分文件、运行、连接、审查、人工和进度。
- 模型口头说“完成”不能完成任务。
- 写文件必须真实成功；代码、安装和部署必须有运行证据；连接器必须有最小真实连接证据；审查步骤必须明确通过。
- 缺证据时进入待恢复，并显示缺少哪项；审查不通过只退回责任员工和对应步骤。

### 6. 安全边界：已完成

- 工具参数进入聊天前隐藏 API Key、Token、密码和验证码。
- 拒绝在命令中直接写入疑似明文密钥。
- 命令和连接器使用独立审批档位。
- 删除、付费、密码、验证码和对外发送即使在“完全访问权限”下也要单独确认。
- 设置页明确展示沙盒、命令审批、连接器审批和敏感信息保护。

### 7. 升级与回滚：已完成首个版本

- 禁止退出时未经备份自动安装更新。
- 更新前用 Electron `safeStorage` 加密备份本地配置，记录员工、团队、模型和任务数量。
- 新版本启动后自动验证数据数量和工作区，并写入升级日志。
- 回滚严格按“下载并校验旧安装包 -> 读取旧配置备份 -> 恢复配置 -> 启动旧安装包”执行；下载失败不会先改当前配置。
- GitHub Release 提供 digest 时校验 SHA-256。
- 回滚安装包使用 `.part` 临时文件和 HTTP Range 断点续传；连续 5 分钟没有数据才重试，慢速但持续传输不会被 120 秒整包超时误杀。
- 正式客户端通过 Electron `net.fetch` 下载，继承 Chromium/系统代理；纯下载模块允许注入网络实现，便于本地断线测试。
- `scripts/build-windows.ps1` 在 Electron 运行时缺失时优先恢复 `%LOCALAPPDATA%\electron\Cache\electron-v<version>-win32-x64.zip`，缓存不存在才联网下载。
- 服务器忽略 Range 时从头覆盖；等长损坏缓存、超出 Release 大小和 SHA-256 不匹配都会被丢弃，只有校验完成后才原子改名为可执行安装包。

### 8. 太极应用身份迁移：v2.6.0 完成

- 产品、窗口、托盘、快捷方式、安装包、默认提示词和内部应用身份统一为“太极”。
- 安装包名改为 `taiji-office-setup-<version>.exe`。
- 内部包名为 `taiji-office`，Windows `appId` 为 `com.taiji.office`，新安装目录和用户数据目录均使用 `taiji-office`。
- 首次启动在 Electron 初始化前把旧目录中的员工、团队、聊天、模型、任务、记忆、工作区和 Chromium 本地存储无损复制到新目录；已有新文件不覆盖，失败会在下次启动续迁。
- 所有 `hermes_office_*` 本地存储键暂时保持为历史数据兼容层，不再代表产品或安装身份；后续只能通过带版本迁移和回滚测试逐步替换。
- 旧用户数据目录迁移验证前不删除，可作为人工恢复备份；旧安装程序可在新客户端验证后移除。
- “Hermes Agent Skills”等第三方来源名称保留，不冒充太极自有品牌。

## 本轮关键文件

- `src/utils/attachments.ts`
- `src/diagnostics/systemDiagnostics.ts`
- `src/components/settings/DiagnosticsTab.tsx`
- `src/data/taskRuns.ts`
- `src/engine/executionController.mjs`
- `src/engine/executionController.d.mts`
- `src/engine/executionEvidence.mjs`
- `src/engine/executionEvidence.d.mts`
- `src/engine/taskContext.mjs`
- `src/engine/taskContext.d.mts`
- `src/engine/taskHistory.mjs`
- `src/engine/taskHistory.d.mts`
- `src/data/hermesClient.ts`
- `src/engine/teamDiscussion.ts`
- `src/engine/securityBoundary.ts`
- `src/data/skills.ts`
- `src/data/connectors.ts`
- `electron/main.cjs`
- `electron/preload.cjs`
- `electron/skills.cjs`
- `electron/autoUpdate.cjs`
- `electron/releaseDownload.cjs`
- `electron/knowledge.cjs`
- `src/brand.ts`
- `scripts/verify-foundation.mjs`
- `scripts/verify-execution-controller.mjs`
- `scripts/verify-execution-evidence.mjs`
- `scripts/verify-task-context.mjs`
- `scripts/verify-task-history.mjs`
- `scripts/verify-foundation-e2e.mjs`
- `scripts/verify-skill-atomic.cjs`
- `scripts/verify-update-download.cjs`
- `scripts/verify-web-search.cjs`
- `scripts/diagnose-web-search-live.cjs`
- `scripts/sync-project.ps1`

## 验证证据

- `npm.cmd run build`：通过。
- `npm.cmd run lint`：通过；只有已有非阻断警告。
- `npm.cmd run verify:foundation`：通过；隔离目录内容为 `first-content / second-content`，附件为 `attachment-content`，敏感参数已隐藏，旧会话任务转为暂停待恢复，诊断领域为 7 项。
- `npm.cmd run verify:agent-kernel`：通过；118 次重复 Skill 读取只执行 1 次。
- `npm.cmd run verify:execution-controller`：通过；覆盖瞬时错误重试后换路线、参数错误、认证边界、替代路线恢复、无证据禁止完成、独立复核、快照恢复、插话转向和模型 5 次重试。
- `npm.cmd run verify:connector-adapters`：通过；覆盖 IMA 原生成功、业务失败、畸形响应、三次网络重试、凭据不泄漏和 Windows 命令退出码传播。
- `npm.cmd run verify:connector-protocol`：通过；覆盖六阶段协议、错误分类、脱敏和副作用幂等复用。
- `npm.cmd run verify:execution-evidence`：通过；覆盖真实磁盘文件证据、仅渲染登记降级和结构化审查退回。
- `npm.cmd run verify:task-runner`：通过；覆盖审查退回责任步骤、动态追加修订/复审节点并最终完成。
- `npm.cmd run verify:task-context`：通过；上下文 v1 自动迁移到 v2，最近 120 条事件、确定性压缩、模型摘要边界、交付路径和历史关联均通过。
- `npm.cmd run verify:context-router`：通过；覆盖运行中抢占重排、预算换路线和恢复胶囊压缩。
- `npm.cmd run verify:task-history`：通过；中文历史检索命中正确团队任务，运行中任务不参与旧经验注入，只读提示与上下文/Runner 回放顺序通过。
- `npm.cmd run verify:task-delegation`：通过；覆盖自动选择责任员工、动态子任务持久化和局部修订/复审。
- `npm.cmd run verify:task-runtime-store`：通过；覆盖旧快照迁移、并发首次读取、事件序号与哈希链、创建/更新/移除、重复写入去重、账本重建和损坏尾部隔离恢复。
- `npm.cmd run verify:skill-atomic`：通过；无效包不触碰旧 Skill，成功替换不残留旧文件，哈希损坏被拦截，并真实验证根 Skill 可读取知识库与笔记子规则。
- `npm.cmd run verify:update-download`：通过；模拟断线后 Range 续传、服务器忽略断点、等长损坏缓存和 SHA-256 拦截。
- `npm.cmd run verify:web-search`：通过；覆盖 Bing XML 解析、主源超时后备用源成功和双源具体错误聚合。
- `npm.cmd run verify:web-search` 新增目标一致性覆盖：安徽百科不能冒充全椒县天气；结构化天气数据必须包含地点、日期、温度、湿度等真实字段。
- `npm.cmd run verify:agent-kernel`：通过模型目标漂移、搜索词条件丢失、指定生图工具却写 SVG、用户新增约束合并和最终目标验收回归。
- 全椒县天气实网验证：`wttr.in 实时天气` 返回全椒县、安徽、坐标 `32.098, 118.258`、日期 `2026-07-28` 及完整气象字段；偏题网页未参与结果。
- `npm.cmd run verify:task-worker`：通过；覆盖命令幂等、租约、心跳、暂停/恢复、跨会话过期回收、停止、关闭和损坏命令尾部隔离。
- `npm.cmd run verify:task-worker` 新增 Adapter 覆盖：步骤开始/完成检查点、重复序号拒绝，以及旧渲染快照不能覆盖主进程权威检查点。
- `npm.cmd run verify:native-execution`：通过；无界面订阅时完成工作与审查步骤，重复写入只执行一次，暂停可中断模型，凭据未进入任务投影。
- `npm.cmd run verify:worktree`：通过；覆盖同仓库双任务隔离、补丁与未跟踪文件恢复、丢失目录重建和脏工作树拒绝清理。
- `npm.cmd run verify:ecosystem-health`：通过；七项健康检查全部可用，并验证核心账本故障会阻止发布、Git 可选能力故障只给出提醒。
- 打包客户端普通隔离启动连续存活 12 秒；已修复 Electron 33 Windows 下巡检计时器 `unref()` 导致的 `0x80000003` 原生异常。
- `npm.cmd run verify:foundation-ui`：通过；真实 Electron IPC 覆盖工作区、Worker 控制、诊断中心七项、记忆页、敏感信息脱敏和旧任务恢复。
- `npm.cmd run verify:office-scroll`：通过；真实渲染 999 个工位，办公区形成纵向滚动并响应鼠标滚轮。
- `npm.cmd run verify:team-window-layout`：通过；团队窗口从默认完整尺寸缩到 560px 后，头像不压缩、不裁切且无横向溢出。
- `npm.cmd run diagnose:web-search`：通过；Electron 实网使用 DuckDuckGo，首轮空结果自动重试后约 3.1 秒返回 8 条中文 AI 资讯。
- `npm.cmd run verify:docx`：通过；生成的 Word 可重新解析正文。
- 安装版 `npm.cmd run verify:foundation-ui`：通过；真实 Electron IPC 和诊断中心五项完整显示。
- 安装版 `npm.cmd run verify:assistant-background`：通过；助理隐藏后执行计时继续。
- 安装版 `npm.cmd run verify:tool-window`：通过；连接器窗口 `620 × 820`，底部操作区完整可见。
- 安装版 `npm.cmd run verify:steering-e2e`：通过；插话优先回答、暂停状态保留、旧请求数量不再增长。
- `node --check electron/main.cjs electron/preload.cjs electron/autoUpdate.cjs`：通过。

## 安装与发布资产

- 安装包：`release\taiji-office-setup-0.29.0.exe`
- Blockmap：`release\taiji-office-setup-0.29.0.exe.blockmap`
- 更新清单：`release\latest.yml`
- 包内版本和三项资产将在 `publish:release` 内自动核对为 `0.29.0`，任一不一致都会停止上传。
- 最终文件大小和 SHA-256 以 `npm.cmd run publish:release` 的成功输出及 GitHub Release digest 为准；发布脚本会逐项比对本地与远端，不再把易过期的单次构建摘要固化在交接文档中。
- 解包版受控启动 8 秒保持运行，未出现启动即崩溃。
- 安装目录只保留 `太极 AI 办公会所.exe` 和对应卸载程序，没有旧产品可执行文件残留。

## 已知边界

1. 自动更新备份与回滚代码、顺序和类型已经验证，真实跨版本自动更新链正在用隔离安装目录演练。
2. 源码开发版 Electron 运行时已从本机缓存恢复，并补齐 `path.txt` 定位文件；无窗口的 Electron 实网诊断可正常运行。带界面的端到端测试仍应先启动对应测试服务。
3. 安装包没有代码签名证书，Windows SmartScreen 仍可能提示风险。
4. 主前端 bundle 仍超过 500 KB，后续可做按模块懒加载，但不要与任务内核改动混在同一版本。
5. 本机 Electron GPU 子进程以 `-1073741515` 退出；`--in-process-gpu` 可初始加载，但 CDP 或高压力渲染仍会终止。因此 `verify:memory-ui`、`verify:office-scroll` 和 `verify:team-window-layout` 需在显卡环境正常的机器补跑，普通浏览器的 1280x720 与 720x720 设置页布局已验证无横向溢出。

## 踩过的坑

- 源码快照不是 Git 工作树，不能用快照目录的 `git status/push` 判断远端；开发工作树统一运行 `npm.cmd run publish:release`，授权统一读取 Git Credential Manager OAuth。
- `name` 和 `appId` 已由 v2.6.0 正式迁移为太极；不要删除 `appIdentityMigration.cjs` 或直接清理旧数据目录。`hermes_office_*` 历史键仍需兼容读取，后续改键必须增加独立版本迁移、数量核验和回滚测试。
- 回滚不能先恢复配置再下载旧安装包；下载失败会让当前版本提前加载旧配置。
- 系统 Node 24 与当前 ASAR 版本组合可能生成索引错位的不可启动包；必须使用 `npm.cmd run dist:win`。脚本固定复用项目缓存中的官方便携 Node 20.18.3，把临时目录定向到构建缓存，并在结束时自动验收 ASAR。
- NSIS 构建中间会短暂出现 0 字节 `.7z`，必须等正式 `.exe`、`.blockmap` 和新 `latest.yml` 全部存在后再判断完成。
- 不提交 API Key、密码、验证码、聊天数据、本机配置、用户 Skill 或测试用户目录。

## 下一步

1. 从 GitHub Release 下载并覆盖安装 `v0.29.0`，验收设置中的四层记忆、建议审批、复盘重试和技能库“复盘草案”。
2. 用真实团队任务验证：共享团队经验只进入同团队，员工经验只进入对应员工，客户端重启后复盘状态保持不倒退。
3. 验收发现的问题按同层级入口统一修复，不再恢复逐个截图、逐个小版本的发布节奏。

补丁版本完成后升级版本并更新本文件，运行 `npm.cmd run dist:win` 和 `npm.cmd run verify:package`，只做本地安装验收；功能大版本在验收通过后提交到干净的 `main`，再运行 `npm.cmd run publish:release` 完成预检、回归、打包、推送、Release 上传和远端哈希校验。
