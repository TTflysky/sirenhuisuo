# 太极项目当前交接

> 更新时间：2026-07-28
> 当前版本：`v0.20.0`
> 主分支：`main`
> 仓库：[TTflysky/sirenhuisuo](https://github.com/TTflysky/sirenhuisuo)
> Release：`v0.20.0` 已完成构建并正式发布

`v0.20.0` 在 Worker 控制平面之上新增 Execution Adapter v1 检查点协议。团队执行器把步骤开始、完成、失败、审查结论和最终状态按严格递增序号写回主进程，旧渲染快照不能覆盖新检查点；任务面板显示最新检查点摘要。模型与工具调用仍由渲染进程 Adapter v1 承接，后续主进程原生 Adapter 可复用同一控制协议。

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

- 设置首页改为诊断中心，一次真实检查 AI 模型、连接器与知识库、Skill、工作区和安全审批。
- 每项显示“可用 / 需确认 / 缺配置”、通俗原因、下一步和设置入口。
- 安装版 Electron 已实测五项全部渲染，工作区创建、写入和读回通过。

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
- `npm.cmd run verify:foundation`：通过；隔离目录内容为 `first-content / second-content`，附件为 `attachment-content`，敏感参数已隐藏，旧会话任务转为暂停待恢复，诊断领域为 5 项。
- `npm.cmd run verify:agent-kernel`：通过；118 次重复 Skill 读取只执行 1 次。
- `npm.cmd run verify:execution-controller`：通过；覆盖瞬时错误重试后换路线、参数错误、认证边界、替代路线恢复、无证据禁止完成、独立复核、快照恢复、插话转向和模型 5 次重试。
- `npm.cmd run verify:connector-adapters`：通过；覆盖 IMA 原生成功、业务失败、畸形响应、三次网络重试、凭据不泄漏和 Windows 命令退出码传播。
- `npm.cmd run verify:connector-protocol`：通过；覆盖六阶段协议、错误分类、脱敏和副作用幂等复用。
- `npm.cmd run verify:execution-evidence`：通过；覆盖真实磁盘文件证据、仅渲染登记降级和结构化审查退回。
- `npm.cmd run verify:task-runner`：通过；覆盖审查退回责任步骤、动态追加修订/复审节点并最终完成。
- `npm.cmd run verify:task-context`：通过；上下文 v1 自动迁移到 v2，最近 120 条事件、确定性压缩、模型摘要边界、交付路径和历史关联均通过。
- `npm.cmd run verify:task-history`：通过；中文历史检索命中正确团队任务，运行中任务不参与旧经验注入，只读提示与上下文/Runner 回放顺序通过。
- `npm.cmd run verify:task-runtime-store`：通过；覆盖旧快照迁移、并发首次读取、事件序号与哈希链、创建/更新/移除、重复写入去重、账本重建和损坏尾部隔离恢复。
- `npm.cmd run verify:skill-atomic`：通过；无效包不触碰旧 Skill，成功替换不残留旧文件，哈希损坏被拦截，并真实验证根 Skill 可读取知识库与笔记子规则。
- `npm.cmd run verify:update-download`：通过；模拟断线后 Range 续传、服务器忽略断点、等长损坏缓存和 SHA-256 拦截。
- `npm.cmd run verify:web-search`：通过；覆盖 Bing XML 解析、主源超时后备用源成功和双源具体错误聚合。
- `npm.cmd run verify:web-search` 新增目标一致性覆盖：安徽百科不能冒充全椒县天气；结构化天气数据必须包含地点、日期、温度、湿度等真实字段。
- `npm.cmd run verify:agent-kernel`：通过模型目标漂移、搜索词条件丢失、指定生图工具却写 SVG、用户新增约束合并和最终目标验收回归。
- 全椒县天气实网验证：`wttr.in 实时天气` 返回全椒县、安徽、坐标 `32.098, 118.258`、日期 `2026-07-28` 及完整气象字段；偏题网页未参与结果。
- `npm.cmd run verify:task-worker`：通过；覆盖命令幂等、租约、心跳、暂停/恢复、跨会话过期回收、停止、关闭和损坏命令尾部隔离。
- `npm.cmd run verify:task-worker` 新增 Adapter 覆盖：步骤开始/完成检查点、重复序号拒绝，以及旧渲染快照不能覆盖主进程权威检查点。
- `npm.cmd run verify:package`：通过；包内版本为 `0.20.0`，任务账本、Worker、Execution Adapter 协议和 UI 检查点标识可读取，安装器、blockmap 和 `latest.yml` 版本一致。
- 打包客户端普通隔离启动连续存活 12 秒；已修复 Electron 33 Windows 下巡检计时器 `unref()` 导致的 `0x80000003` 原生异常。
- `npm.cmd run verify:foundation-ui`：通过；真实 Electron IPC 覆盖工作区、Worker 控制、诊断中心、记忆页、敏感信息脱敏和旧任务恢复。
- `npm.cmd run diagnose:web-search`：通过；Electron 实网使用 DuckDuckGo，首轮空结果自动重试后约 3.1 秒返回 8 条中文 AI 资讯。
- `npm.cmd run verify:docx`：通过；生成的 Word 可重新解析正文。
- 安装版 `npm.cmd run verify:foundation-ui`：通过；真实 Electron IPC 和诊断中心五项完整显示。
- 安装版 `npm.cmd run verify:assistant-background`：通过；助理隐藏后执行计时继续。
- 安装版 `npm.cmd run verify:tool-window`：通过；连接器窗口 `620 × 820`，底部操作区完整可见。
- 安装版 `npm.cmd run verify:steering-e2e`：通过；插话优先回答、暂停状态保留、旧请求数量不再增长。
- `node --check electron/main.cjs electron/preload.cjs electron/autoUpdate.cjs`：通过。

## 安装与发布资产

- 安装包：`release\taiji-office-setup-0.20.0.exe`
- Blockmap：`release\taiji-office-setup-0.20.0.exe.blockmap`
- 更新清单：`release\latest.yml`
- 包内版本：`0.20.0`。
- 安装包大小：`173873605` 字节；SHA-256：`C9486A91E6F229EFE1D29A290E4235F7C5B9C5BB5888FD1A55DBA10218C49F40`。
- 最终文件大小和 SHA-256 以 `npm.cmd run publish:release` 的成功输出及 GitHub Release digest 为准；发布脚本会逐项比对本地与远端，不再把易过期的单次构建摘要固化在交接文档中。
- 解包版受控启动 8 秒保持运行，未出现启动即崩溃。
- 安装目录只保留 `太极 AI 办公会所.exe` 和对应卸载程序，没有旧产品可执行文件残留。

## 已知边界

1. 自动更新备份与回滚代码、顺序和类型已经验证，真实跨版本自动更新链正在用隔离安装目录演练。
2. 源码开发版 Electron 运行时已从本机缓存恢复，并补齐 `path.txt` 定位文件；无窗口的 Electron 实网诊断可正常运行。带界面的端到端测试仍应先启动对应测试服务。
3. 安装包没有代码签名证书，Windows SmartScreen 仍可能提示风险。
4. 主前端 bundle 仍超过 500 KB，后续可做按模块懒加载，但不要与任务内核改动混在同一版本。

## 踩过的坑

- 源码快照不是 Git 工作树，不能用快照目录的 `git status/push` 判断远端；开发工作树统一运行 `npm.cmd run publish:release`，授权统一读取 Git Credential Manager OAuth。
- 不要修改内部 `name`、`appId` 或 `hermes_office_*` 键，否则品牌改名会造成用户数据看似丢失。
- 回滚不能先恢复配置再下载旧安装包；下载失败会让当前版本提前加载旧配置。
- 系统 Node 24 与当前 ASAR 版本组合可能生成索引错位的不可启动包；必须使用 `npm.cmd run dist:win`。脚本固定复用项目缓存中的官方便携 Node 20.18.3，把临时目录定向到构建缓存，并在结束时自动验收 ASAR。
- NSIS 构建中间会短暂出现 0 字节 `.7z`，必须等正式 `.exe`、`.blockmap` 和新 `latest.yml` 全部存在后再判断完成。
- 不提交 API Key、密码、验证码、聊天数据、本机配置、用户 Skill 或测试用户目录。

## 下一步

1. 用户安装 `v0.20.0` 后新建团队任务，确认任务详情持续显示递增的 Adapter 检查点及步骤摘要。
2. 暂停、恢复并重启一个执行中任务，确认检查点、已完成步骤和账本状态不会被旧窗口快照回退。
3. 下一版本在 Adapter v1 协议不变的前提下，将模型与工具执行逐步迁入主进程，窗口最终只负责命令与投影。
4. 主进程原生 Adapter 稳定后再实现动态组队和并发执行，避免多个执行者共享不可靠状态。
5. 完成一次隔离目录的真实跨版本自动更新与回滚演练并记录证据。
6. 按用户新反馈继续优化，但同层问题必须同步检查助手、员工私聊和团队三条路径。

每次完成后先升级版本并更新本文件，提交到干净的 `main`，然后运行 `npm.cmd run publish:release` 一次完成预检、回归、打包、推送、Release 上传和远端哈希校验。
