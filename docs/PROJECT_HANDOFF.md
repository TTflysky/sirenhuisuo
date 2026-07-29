# 项目交接手册

> 最后整理：2026-07-29
> 当前源码版本：`v0.50.3`
> 主分支：`main`
> 仓库：[TTflysky/sirenhuisuo](https://github.com/TTflysky/sirenhuisuo)

## v0.41-v0.49 统一执行协议

`src/engine/teamExecutionProtocol.mjs` 是助理、员工私聊、团队窗口和主进程 Worker 共用的任务范围协议。它保存团队和任务边界、成员独立模型快照、助理首发言、步骤依赖、员工状态、当前工具、事件序号、失败恢复、交付物和审查责任。

版本职责：v0.41 首发言和责任计划；v0.42 Worker 事件投影；v0.43 可观测摘要和计时；v0.44 失败分类与原上下文恢复；v0.45 按 `teamId/runId/sequence` 跨窗口同步；v0.46 Skill/Connector 是否使用及调用证据；v0.47 真实磁盘交付物索引；v0.48 审查退回责任步骤；v0.49 全量发布门禁。

新增回归：`npm.cmd run verify:team-execution-protocol`。最终发布门禁：`npm.cmd run verify:v049-release-gate`。小版本不生成客户端安装包，只有最终大版本统一构建、验证并发布。

## v0.40.0 收口门禁

本版本修复批准组建团队后子窗口偶发显示“团队不存在”的竞态：团队元数据和首条消息一起持久化，聊天窗口启动时会等待并恢复团队快照。执行状态现在由工具调用、执行控制器和原生 Worker 统一投影到员工头像；执行提示展示实时计时，进行中使用流光动画。助理正式启动团队任务前会先复述需求、拆解顺序并点名成员，执行过程中的二进制和长编码只保留在任务账本，不直接污染聊天气泡。

`v0.39.0` 的发布门禁和历史说明继续保留在下方，当前发布版本为 `v0.40.0`。

当前版本使用统一门禁 `npm.cmd run verify:v039-release-gate`。门禁会校验版本和锁文件一致性、关键内核文件存在性，并实际运行构建、Lint、任务合同、执行控制器、任务运行器、团队 @ 路由、任务交接、状态机、执行协议、Skill 证据、动态委派和恢复胶囊回归。小版本不打包、不发布 GitHub，只有最终大版本验收通过后才进入发布流程。

本文件是接手本项目的唯一工作入口。先执行 `npm.cmd run sync:project`，再进入命令输出的最新源码目录阅读本文件、`README.md`、`CHANGELOG.md` 和相关模块；跨电脑接力的固定流程见 `docs/CROSS_DEVICE_WORKFLOW.md`。`开发资料全记录.md` 是早期历史档案，不能用来判断当前实现。

## 1. 产品目标与不可破坏的规则

太极 AI 办公会所是一个 Windows 桌面多智能体办公应用。用户可创建员工、配置多个 OpenAI 兼容模型、组成团队，让助理负责理解、拆解、调度、交接和验收。

以下规则是产品核心，改动前必须保留：

1. 一个团队必须支持多个员工使用不同模型；员工未开启独立配置时继承全局模型，开启后只使用自己的模型。
2. 驴狗蛋助手是默认调度者：普通团队工作请求由助理先接收和拆解；用户明确 `@员工` 时，助理不能抢答或代替该员工完成任务。
3. 团队任务按计划顺序执行；模型超时或上一步没有返回结果时，后续步骤必须等待，不能跳过。审查不通过时只退回责任人对应步骤。
4. 员工不能只口头承诺“已完成”。需要文件的任务必须通过工具写入真实工作区；界面需展示可观察的任务状态、工具调用和最终交付物。
5. 助理、员工单聊、团队聊天的附件能力必须保持一致：选择文件、粘贴、拖拽、真实落盘、错误提示和工具可读取性不能只修其中一个入口。
6. 交付物只登记真实文件，并分为最终交付、工作文件、参考资料；绝不能把聊天摘要、工具日志、附件占位或重复记录冒充产物。
7. 每次功能交付必须升级版本、构建 Windows 安装包并计算 SHA-256；补丁版本只做本地安装验收，功能大版本验收通过后才提交、推送 `main` 并创建 GitHub Release。
8. 面向用户的最终回答必须先说清楚成功、失败或进行中；原始工具名、命令、参数、退出码和日志只放在折叠执行过程中，不能在消息正文重复展示。
9. 工具审批和命令沙盒必须同时覆盖助手、员工私聊和团队聊天。审批被拒绝时必须返回“未执行”的真实结果，不能把取消、权限不足或沙盒拦截描述成完成。
10. 所有执行入口必须先通过 `taskDecisionKernel` 还原真实目标、首选路线和完成标准，再由 `taskFidelity` 固定不可丢失条件，最后通过统一 `ExecutionController` 观察结果、分类失败、决定重试或换路线并重新验收；不得重新引入按回复文案、关键词猜测或“工具返回内容就算成功”的分支。
11. 所有动态连接器 Action 必须经过 `ConnectorProtocol`；输入、权限、dry-run、真实调用、输出验证、脱敏和幂等不可在单个连接器中自行绕过，UI 只认客户端协议证据。
12. 文件与审查必须产生 `ToolExecutionEvidence`；审查退回必须扩展正式 TaskPlan/Runner 并绑定责任步骤，不能重新退化为解析聊天文案或只改界面步骤。
13. 分层记忆的 JSON 状态是唯一事实源，Markdown 只是可重建投影；真实验收经验可自动沉淀，模型推断必须先审批，任何后台复盘都不得改写内置或手动安装的 Skill。

## 2. 当前已交付的能力

- 多员工、团队、分类头像库、自定义头像、DiceBear Pixel Art 在线选择与本地保存、身份牌、头像框、颜色和在线/工作/掉线状态。
- 全局模型、助理模型、员工独立模型的分离；团队任务每一步按员工自己的有效模型执行。
- 助理默认调度、明确 @ 员工直达、顺序任务运行器、暂停/继续/关闭、审查退回和任务列表。
- 团队与私聊模型失败重试、超时诊断、Token 消耗、聊天时间戳、可折叠执行过程和聊天跳转轨道。
- 本机 Skill 扫描、搜索、读取和手动选择；模型按任务需要自行判断是否检索 Skill。
- IMA 官方 Skill 1.1.8 完整内置；根规则与明确引用的知识库、笔记子规则统一读取，旧关联失效时自动回退并持久化内置 Skill ID。
- 明确要求今日、最新、实时或联网资料时，客户端保证先执行真实搜索；普通任务仍由模型按需决定。搜索通过 Electron 代理访问 DuckDuckGo/Bing，支持重试、切换和具体错误诊断。
- 资料型请求在搜索后由客户端并行读取前 5 个可访问来源正文，再使用无工具的专用整理阶段；模型整理失败最多重试 5 次，仍失败则由客户端根据搜索摘要和链接直接交付，不能把成功搜索误报为查询失败，也不能要求用户自行阅读或回传链接。
- 连接器的验证、测试、诊断请求由客户端先做真实状态检查；纯验证请求直接返回客户端证据，不再调用模型二次改写。
- 连接器是外部能力的统一入口，MCP 只是其中一种协议。IMA 当前是“官方 Skill 规则 + Electron 原生适配器”，主进程直接调用固定官方端点并核对 HTTP 与业务码，不经过 PowerShell，也不是 MCP Server。
- mac 风格的浅色/深色界面、内置幼圆、原生 Electron 聊天子窗口和可调整面板宽度。
- 助理、单聊、团队三类聊天统一支持附件文件选择、粘贴、拖拽。
- 图片可作为视觉输入，文本/代码可直接读取；Excel、Word、PowerPoint、PDF、OpenDocument、RTF、EPUB 通过 `officeparser` 提取文本；其他二进制也会真实保存，并向模型返回可操作路径和明确说明。
- 产出物按聊天 scope 隔离，显示路径、类型、大小、时间，可直接打开真实磁盘文件。
- 项目编排：助理可生成待批准项目草案，按职责/专长/在线状态从全体员工匹配成员；批准后创建隔离项目团队并复用顺序任务运行器。
- 人格、用户画像、长期记忆和任务经验分层；组织、团队、员工、用户四层结构化记忆支持容量、脱敏、去重、精确替换、审批和审计，团队共享经验与员工个人经验会同时进入任务上下文。
- 任务终态异步复盘不阻塞前台交付；真实验收路线直接沉淀，模型建议进入审批，重复稳定流程进入隔离 Skill 草案，批准后才安装。
- 驴狗蛋助手、员工私聊和团队执行支持运行中“排队 / 引导”，员工工作状态在所有窗口通过 Store 广播同步。
- 驴狗蛋助手伴随窗是主窗口的 owned window，保持同一窗口层级但不跨应用永久置顶。

最新安装包和历史发布在 GitHub Releases。源码最新功能以 `main` 为准。

## 3. 关键架构

### 前端与状态

| 模块 | 责任 |
| --- | --- |
| `src/store.tsx` | 全局状态、团队消息路由、助理调度、任务运行的启动/暂停/继续/关闭。 |
| `src/data/hermesClient.ts` | OpenAI 兼容请求、模型配置解析、聊天/员工/团队/Token 本地持久化、Agent 循环。 |
| `src/engine/taskDecisionKernel.mjs` | 将每次用户消息编译为任务合同，结合语义模型决策和高置信度安全规则，决定聊天、回答或执行及首选路线。 |
| `src/engine/taskFidelity.mjs` | 从用户原话提取不可丢失的目标约束，在工具调用、证据返回和最终交付三个阶段检查目标一致性。 |
| `src/engine/taskLearningMemory.ts` | 保存、归并和检索任务成功/失败经验；只提供路线参考，当前真实证据优先。 |
| `src/engine/agentGuardrails.mjs` | 最新消息分类、实时搜索识别与查询清洗、文字控制、反馈挂起、工具语义去重和资源读取上限。 |
| `src/engine/teamDiscussion.ts` | 浏览器开发环境的兼容团队执行器；Electron 正式客户端改用主进程原生 Adapter。 |
| `src/engine/executionEvidence.mjs` | 文件交付与审查结论的版本化客户端证据协议。 |
| `src/engine/taskContext.mjs` | 任务上下文 v2、确定性压缩、模型摘要边界与上下文提示。 |
| `src/engine/taskHistory.mjs` | 跨会话历史检索、只读提示和任务事件回放。 |
| `src/engine/tools.ts` | `write_file`、`read_file`、`list_files`、`search_skills`、`read_skill`、`run_command` 和连接器工具。 |
| `src/components/chat/AssistantChat.tsx` | 驴狗蛋助手聊天与运行中引导。 |
| `src/components/chat/DmChatApp.tsx` | 员工单聊与失败重试。 |
| `src/components/chat/TeamChatApp.tsx` | 团队聊天、任务过程和成员 @。 |
| `src/components/outputs/ChatOutputsPanel.tsx` | 按 scope 和用途分类、折叠、预览真实交付文件。 |
| `src/utils/attachments.ts` | 三种聊天共用的附件分类、读取、落盘和工作区上下文。 |
| `src/hooks/useFileDrop.ts` | 三种聊天共用的文件拖拽交互。 |

### Electron 主进程与本机资源

| 模块 | 责任 |
| --- | --- |
| `electron/main.cjs` | 窗口管理、工作区安全边界、文件 IPC、命令执行、Office/PDF 解析及走 Electron 代理的搜索 IPC。 |
| `electron/knowledge.cjs` | 网页正文读取、DuckDuckGo/Bing 双源搜索、超时重试、结果解析和错误聚合。 |
| `electron/connectorAdapters.cjs` | 内置外部服务原生适配器；IMA 固定只读验证、阶段诊断、重试和脱敏结果。 |
| `electron/commandShell.cjs` | Windows PowerShell 命令包装并正确传播原生进程退出码。 |
| `electron/taskRuntimeStore.cjs` | 追加式任务事件账本、SHA-256 哈希链、旧快照迁移、损坏尾部隔离和任务投影重建。JSONL 是事实源，JSON 快照只是缓存；渲染写入不能覆盖 Worker 权威检查点。 |
| `electron/memoryManager.cjs` | 组织、团队、员工、用户四层记忆事实源：校验、原子写入、损坏隔离、容量、脱敏、去重、审批、审计和 Markdown 投影。 |
| `electron/learningReviewQueue.cjs` | 持久化异步任务复盘：重启恢复、真实经验沉淀、审查模型建议、记忆审批和 Skill 草案生成。 |
| `electron/taskWorker.cjs` | 主进程 Worker 控制平面：命令日志、租约、心跳、检查点、暂停/恢复/停止、跨会话过期恢复和命令幂等。 |
| `electron/executionAdapterProtocol.cjs` | Execution Adapter v1 协议：校验严格递增检查点，并把步骤开始/完成/失败与任务最终状态应用到主进程权威投影。 |
| `electron/nativeExecutionAdapter.cjs` | Electron 主进程团队执行循环：模型调用、工具编排、目标验收、审查退回、运行中插话和后台生命周期。 |
| `electron/nativeToolRuntime.cjs` | 主进程工具运行时：工作区文件、命令、联网、Skill、Connector、知识库与结构化证据，持久化前统一脱敏。 |
| `electron/ecosystemHealth.cjs` | 生态健康协议 v1：统一检查版本身份、任务账本、Worker、工具、Skill、工作区与 Git Worktree，并作为升级验收门禁。 |
| `electron/preload.cjs` | 受限的 `window.electronAPI` 桥接。新增 IPC 必须同步更新此文件和 `src/electron.d.ts`。 |
| `electron/skills.cjs` | 扫描用户与项目 Skill，负责健康检查、原子安装，以及隔离复盘草案的批准、安装和受限精确更新。 |
| `electron/autoUpdate.cjs` | 通过 GitHub Releases 检查并下载更新；后台检查失败只写诊断日志，不冒充模型网络故障。 |
| `electron/releaseDownload.cjs` | 回滚安装包断点续传、无数据超时、大小与 SHA-256 校验、临时文件原子落盘。 |
| `scripts/build-windows.ps1` | 恢复 Electron 缓存并固定用便携 Node 20 打包；临时目录位于项目缓存，完成后自动验收 ASAR 与发布文件。 |

## 4. 数据位置与隐私边界

以下内容是本机用户数据，**不要提交到 GitHub**：API Key、连接器凭据、员工和团队实际配置、聊天内容、长期记忆、任务运行记录、上传附件、工作区文件、安装包缓存。

- 渲染进程配置、聊天与兼容缓存：Chromium `localStorage`，键以 `hermes_office_` 开头。
- 任务运行事实源：`app.getPath('userData')/task-runtime/task-events.jsonl`；`task-runs.json` 是可从账本重建的投影缓存。两者都是本机用户数据，禁止提交 GitHub。
- 真实工作区：Electron `app.getPath('userData')/workspace`；每个聊天 scope 下有独立目录。
- 上传附件：`<scope>/uploads/<批次>/<原文件名>`。输入附件不会显示为最终产出物。
- Skill：用户目录 `.workbuddy/skills` 或项目本地 Skill 目录。
- 外部 API：公开适配器、Skill 规则和安全验收逻辑可以随安装包内置；用户 API Key、OAuth 和账号凭据只能保存在本机，绝不能进入 GitHub 或安装资源。
- Skill 安装：单文件、GitHub 目录和 ZIP 都先写入同根暂存目录，校验通过后原子替换；失败时恢复旧目录。
- 交付文件：由 `write_file` 或命令生成，写入对应 scope 工作区；`ChatOutputsPanel` 只登记真实文件。

同步配置文件 `config/local-test-profile.sanitized.json` 只包含员工、团队、模型结构和连接器非敏感信息，不包含聊天、记忆、任务运行记录或明文 API Key。启动应用后，在左侧点击“同步”即可导入；导入后到设置中为模型逐个回填本机 API Key。

若需要迁移用户实际配置到另一台电脑，应单独设计“导出/导入用户数据”功能，不能直接把本机 `localStorage` 或用户数据目录提交到仓库。

## 5. 附件处理链路（v0.5.7 已验证）

1. 三个聊天组件调用 `fileToAttachment()`，图片、文本和二进制分别分类。
2. `persistAttachments()` 先把附件写入当前 scope 的 `uploads/<批次>/`，同名文件不会覆盖。
3. 附件 chip 显示“已保存”或具体失败原因；二进制 base64 在成功落盘后不会写入聊天 localStorage。
4. 发送时，`attachmentWorkspaceContext()` 把真实相对路径提供给 Agent；图片同时作为多模态 `image_url` 输入。
5. Agent 调 `read_file` 时：普通 UTF-8 文本直接读取，Office/PDF 等由主进程 `officeparser` 提取文本，长内容可用 `offset`/`limit` 分段读取。
6. 不能直接解析的二进制返回失败原因和真实路径，由匹配 Skill 或 `run_command` 继续处理，禁止说“文件只是占位记录”。

已用真实结构的 XLSX 测试过 `officeparser`，可正确提取单元格内容。支持格式不等于能理解所有专业语义，模型仍需实际调用 `read_file`、Skill 或命令后再回答。

## 6. 当前风险与后续优先级

### P0：验收现有行为

1. 在助理、单聊、团队各拖入一次图片、`.xlsx`、`.pdf` 和任意二进制文件，确认 chip 显示已保存、模型不再称其为占位文件。
2. 让员工使用 `read_file` 读取 Excel，确认能看到工作表内容；用长文档验证 `offset` 分段读取。
3. 让团队执行一个含规划、实现、审查的实际任务，确认 @ 指定员工时助理不抢答，步骤按顺序推进，失败不跳过。
4. 确认深色模式、发送按钮、连接器控件和产出物面板在实际安装包中可读可用。

### P1：产品改进

- 将“后台调度和实际工具执行”进一步做成更紧凑、可展开的聊天内状态流，避免铺满屏幕。
- 完善用户数据导出/导入，支持迁移员工、团队、设置和必要工作区文件，而不是依赖手工复制。
- 验证 GitHub Release 的安装器、`.blockmap` 和 `latest.yml` 都已上传，并用已安装旧版验证热更新提示与下载。
- 给关键逻辑补自动化测试：模型继承/独立配置、任务退回、附件落盘、Office 读取、产出物过滤、跨窗口同步。
- 在显卡驱动稳定的 Windows 机器补跑设置记忆页、办公室 999 工位和团队窗口的真实 Electron 压力回归。

### P2：工程债务

- `README.md` 已说明主 bundle 大于 500 KB；可按模块拆分懒加载。
- `npm run lint` 当前有历史警告；新增代码不得增加警告，条件允许时逐步清理。
- 旧版 `开发资料全记录.md` 仅保留历史背景，内容已过时；所有新结论写入本文件和 CHANGELOG。
- 安装包未签名，Windows SmartScreen 可能提示风险。

## 7. 开发、测试与发布

开发过程中可以单独运行对应回归。补丁版本先本地构建和安装验收；功能大版本验收通过后再使用发布入口：

```powershell
npm.cmd run publish:release
```

该命令要求当前位于干净的 `main` 分支，版本与文档已经提交，并且用户已经明确验收当前安装包。它会自动运行核心回归、稳定 Windows 打包、推送 `main`、创建或更新同版本 Release，上传三个更新资产，并核对远端提交、大小和 SHA-256。不要在用户验收前运行，也不要使用临时发布脚本或裸 `gh release` 命令。

发布检查清单：

1. `package.json`、`package-lock.json`、README、CHANGELOG 使用同一版本号。
2. `npm.cmd run build` 必须通过；`npm.cmd run lint` 的新增警告必须为零；`git diff --check` 必须通过。
3. 构建安装包并记录绝对路径、文件大小和 SHA-256。
4. 补丁版本只保留本地改动和安装包，不运行发布命令；功能大版本再 `git add`、`git commit`、推送源码并保持工作区干净。
5. 功能大版本提交前先让用户安装本地构建包验收。
6. 用户确认大版本通过后运行 `npm.cmd run publish:release`，以远端提交、Release URL、安装包路径和 SHA-256 为发布凭据。

本机若残留失效的全局 Git 代理，可对同步或推送命令临时追加 `-c http.proxy= -c https.proxy=` 直连 GitHub。不要把 GitHub Token、代理凭据或 API Key 写进代码、文档和提交记录。

## 8. 建议的接手顺序

1. `git pull` 后先运行 `npm.cmd install`、`npm.cmd run build`。
2. 阅读本文件的“不可破坏规则”和“附件处理链路”。
3. 从用户当前反馈中选一个可验收的问题，先复现，再沿对应模块修改；不要顺手重构无关部分。
4. 涉及聊天/附件/模型/任务时，必须同时检查助理、单聊、团队三条路径。
5. 完成后按第 7 节的版本、安装包、GitHub Release 流程交付。
