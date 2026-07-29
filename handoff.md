# 太极项目当前交接

## 本地续作状态（2026-07-29）

- 当前本地开发版本：`v1.0.0`。v1 核心门禁和故障注入均已通过，下一步为 Windows 打包、安装包验收与 GitHub 发布。
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
- `v1.0` 将内置人格和全部可见入口统一为章北海助理，默认人格升级至 v13，旧的自定义人格不被覆盖，只会追加一次 v1 任务账本与恢复协议；界面统一使用幼圆，构建不再包含五套未选用字体。
- 新增/扩展回归：`npm.cmd run verify:task-service`、`npm.cmd run verify:child-task-dispatch`、`node scripts/verify-native-execution-adapter.cjs`。原生端到端场景覆盖模型委派、手动委派、子任务交接、暂停/停止级联、无活动执行器的恢复续跑、子任务失败同步和停止后的真实补偿工具执行。
- 本轮核心文件：`electron/nativeExecutionAdapter.cjs`、`electron/taskService.cjs`、`scripts/verify-native-execution-adapter.cjs`、`scripts/verify-task-service.cjs`、`docs/TASK_SERVICE_V0.67.md` 至 `docs/TASK_SERVICE_V0.73.md`。
- 发布前命令：`npm.cmd run verify:v1-core-gate`、`npm.cmd run dist:win`、`npm.cmd run verify:package`。发布后以 GitHub Release 的安装包和 digest 为准。

> 更新时间：2026-07-29
> 当前版本：`v1.0.0`
> 主分支：`main`
> 仓库：[TTflysky/sirenhuisuo](https://github.com/TTflysky/sirenhuisuo)
> Release：`v0.29.0` 为本轮分层记忆、异步复盘与学习闭环大版本

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

### 8. 太极品牌迁移：已完成

- 版本升级为 `0.9.0`，产品、窗口、托盘、快捷方式、安装包和默认提示词统一为“太极”。
- 安装包名改为 `taiji-office-setup-<version>.exe`。
- 内部包名仍为 `hermes-office-pro`，`appId` 仍为 `com.hermes.office`。
- 所有 `hermes_office_*` 本地存储键保持不变，并新增品牌迁移标记。
- 旧员工、团队、聊天、模型、任务和数据目录不迁移、不清空。
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
- 不要修改内部 `name`、`appId` 或 `hermes_office_*` 键，否则品牌改名会造成用户数据看似丢失。
- 回滚不能先恢复配置再下载旧安装包；下载失败会让当前版本提前加载旧配置。
- 系统 Node 24 与当前 ASAR 版本组合可能生成索引错位的不可启动包；必须使用 `npm.cmd run dist:win`。脚本固定复用项目缓存中的官方便携 Node 20.18.3，把临时目录定向到构建缓存，并在结束时自动验收 ASAR。
- NSIS 构建中间会短暂出现 0 字节 `.7z`，必须等正式 `.exe`、`.blockmap` 和新 `latest.yml` 全部存在后再判断完成。
- 不提交 API Key、密码、验证码、聊天数据、本机配置、用户 Skill 或测试用户目录。

## 下一步

1. 从 GitHub Release 下载并覆盖安装 `v0.29.0`，验收设置中的四层记忆、建议审批、复盘重试和技能库“复盘草案”。
2. 用真实团队任务验证：共享团队经验只进入同团队，员工经验只进入对应员工，客户端重启后复盘状态保持不倒退。
3. 验收发现的问题按同层级入口统一修复，不再恢复逐个截图、逐个小版本的发布节奏。

补丁版本完成后升级版本并更新本文件，运行 `npm.cmd run dist:win` 和 `npm.cmd run verify:package`，只做本地安装验收；功能大版本在验收通过后提交到干净的 `main`，再运行 `npm.cmd run publish:release` 完成预检、回归、打包、推送、Release 上传和远端哈希校验。
