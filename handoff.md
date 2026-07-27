# 太极项目当前交接

> 更新时间：2026-07-27
> 当前版本：`v0.9.2`
> 主分支：`main`
> 仓库：[TTflysky/sirenhuisuo](https://github.com/TTflysky/sirenhuisuo)
> Release：[v0.9.2](https://github.com/TTflysky/sirenhuisuo/releases/tag/v0.9.2)

`v0.9.2` 在八项稳定闭环和 Skill 原子修复基础上补齐回滚安装包的断点续传、慢速网络容错与原子校验，不改变既有任务、模型和用户数据结构。

## 办公室端直接开始

在任意已有源码中运行：

```powershell
npm.cmd run sync:project
```

进入新下载的 `sirenhuisuo-v0.9.2-<commit>` 目录后依次执行：

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run lint
npm.cmd run verify:foundation
npm.cmd run verify:agent-kernel
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
- `src/engine/securityBoundary.ts`
- `src/data/skills.ts`
- `electron/main.cjs`
- `electron/preload.cjs`
- `electron/skills.cjs`
- `electron/autoUpdate.cjs`
- `electron/releaseDownload.cjs`
- `src/brand.ts`
- `scripts/verify-foundation.mjs`
- `scripts/verify-foundation-e2e.mjs`
- `scripts/verify-skill-atomic.cjs`
- `scripts/verify-update-download.cjs`
- `scripts/sync-project.ps1`

## 验证证据

- `npm.cmd run build`：通过。
- `npm.cmd run lint`：通过；只有已有非阻断警告。
- `npm.cmd run verify:foundation`：通过；隔离目录内容为 `first-content / second-content`，附件为 `attachment-content`，敏感参数已隐藏，旧会话任务转为暂停待恢复，诊断领域为 5 项。
- `npm.cmd run verify:agent-kernel`：通过；118 次重复 Skill 读取只执行 1 次。
- `npm.cmd run verify:skill-atomic`：通过；无效包不触碰旧 Skill，成功替换不残留旧文件，哈希损坏被拦截。
- `npm.cmd run verify:update-download`：通过；模拟断线后 Range 续传、服务器忽略断点、等长损坏缓存和 SHA-256 拦截。
- `npm.cmd run verify:docx`：通过；生成的 Word 可重新解析正文。
- 安装版 `npm.cmd run verify:foundation-ui`：通过；真实 Electron IPC 和诊断中心五项完整显示。
- 安装版 `npm.cmd run verify:assistant-background`：通过；助理隐藏后执行计时继续。
- 安装版 `npm.cmd run verify:tool-window`：通过；连接器窗口 `620 × 820`，底部操作区完整可见。
- 安装版 `npm.cmd run verify:steering-e2e`：通过；插话优先回答、暂停状态保留、旧请求数量不再增长。
- `node --check electron/main.cjs electron/preload.cjs electron/autoUpdate.cjs`：通过。

## 安装与发布资产

- 安装包：`E:\私人办公会所项目\release\taiji-office-setup-0.9.2.exe`
- Blockmap：`E:\私人办公会所项目\release\taiji-office-setup-0.9.2.exe.blockmap`
- 更新清单：`E:\私人办公会所项目\release\latest.yml`
- 安装包大小：`173801148` 字节。
- 安装包 SHA-256：`C46B41941082533A86A5858BF08180B595ADEAC29DC453C204C061CE2A4E4A0D`。
- `app.asar` SHA-256：`4CE036A05C1336742B0B93AC365961F188BB6FB199B9F4F468CA526246180C1D`。
- 包内版本：`0.9.2`。
- 安装目录只保留 `太极 AI 办公会所.exe` 和对应卸载程序，没有旧产品可执行文件残留。

## 已知边界

1. 自动更新备份与回滚代码、顺序和类型已经验证，真实跨版本自动更新链正在用隔离安装目录演练。
2. 源码开发版 Electron 在本机 Codex 终端会因图形子进程环境崩溃；正式安装版在同机真实 Electron 回归全部通过。这不是客户端进程占用，也不是太极业务代码错误。
3. 安装包没有代码签名证书，Windows SmartScreen 仍可能提示风险。
4. 主前端 bundle 仍超过 500 KB，后续可做按模块懒加载，但不要与任务内核改动混在同一版本。

## 踩过的坑

- 源码快照不是 Git 工作树，不能用本目录的 `git status/push` 判断远端；发布继续使用工作区根目录的 `publish-v061.ps1` 和 Git Credential Manager OAuth。
- 不要修改内部 `name`、`appId` 或 `hermes_office_*` 键，否则品牌改名会造成用户数据看似丢失。
- 回滚不能先恢复配置再下载旧安装包；下载失败会让当前版本提前加载旧配置。
- 直接运行 `electron-builder` 会尝试写系统缓存并遇到权限拒绝；必须使用 `npm.cmd run dist:win`，脚本会把缓存定向到 `L:\AI办公室\eb-cache`。
- NSIS 构建中间会短暂出现 0 字节 `.7z`，必须等正式 `.exe`、`.blockmap` 和新 `latest.yml` 全部存在后再判断完成。
- 不提交 API Key、密码、验证码、聊天数据、本机配置、用户 Skill 或测试用户目录。

## 下一步

1. 在用户真实配置上验收五个场景：新建员工后助手立即找到、团队任务异常退出后恢复、损坏 Skill 修复、连接器真实连接证据、一次自动更新与回滚。
2. 完成一次隔离目录的真实跨版本自动更新与回滚演练并记录证据。
3. 给升级日志增加用户可导出的通俗诊断报告。
4. 按用户新反馈继续优化，但同层问题必须同步检查助手、员工私聊和团队三条路径。

每次完成后仍按：预检、构建、回归、打包、覆盖安装、哈希校验、更新本文件、发布 GitHub `main` 与同版本 Release 的顺序交付。
