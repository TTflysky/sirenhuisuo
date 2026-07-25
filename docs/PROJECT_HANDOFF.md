# 项目交接手册

> 最后整理：2026-07-25
> 当前源码版本：`v0.7.12`
> 主分支：`main`
> 仓库：[TTflysky/sirenhuisuo](https://github.com/TTflysky/sirenhuisuo)

本文件是接手本项目的唯一工作入口。先执行 `npm.cmd run status:project -- -Fetch`，再读本文件、`README.md`、`CHANGELOG.md` 和相关模块；跨电脑接力的固定流程见 `docs/CROSS_DEVICE_WORKFLOW.md`。`开发资料全记录.md` 是早期历史档案，不能用来判断当前实现。

## 1. 产品目标与不可破坏的规则

私人办公会所是一个 Windows 桌面多智能体办公应用。用户可创建员工、配置多个 OpenAI 兼容模型、组成团队，让助理负责理解、拆解、调度、交接和验收。

以下规则是产品核心，改动前必须保留：

1. 一个团队必须支持多个员工使用不同模型；员工未开启独立配置时继承全局模型，开启后只使用自己的模型。
2. 章北海助理是默认调度者：普通团队工作请求由助理先接收和拆解；用户明确 `@员工` 时，助理不能抢答或代替该员工完成任务。
3. 团队任务按计划顺序执行；模型超时或上一步没有返回结果时，后续步骤必须等待，不能跳过。审查不通过时只退回责任人对应步骤。
4. 员工不能只口头承诺“已完成”。需要文件的任务必须通过工具写入真实工作区；界面需展示可观察的任务状态、工具调用和最终交付物。
5. 助理、员工单聊、团队聊天的附件能力必须保持一致：选择文件、粘贴、拖拽、真实落盘、错误提示和工具可读取性不能只修其中一个入口。
6. 交付物只登记真实文件，并分为最终交付、工作文件、参考资料；绝不能把聊天摘要、工具日志、附件占位或重复记录冒充产物。
7. 每次功能发布必须：升级版本、构建 Windows 安装包、计算 SHA-256、提交并推送 `main`、创建 GitHub Release 并上传安装包和 blockmap。

## 2. 当前已交付的能力

- 多员工、团队、头像、身份牌、头像框、颜色和在线/工作/掉线状态。
- 全局模型、助理模型、员工独立模型的分离；团队任务每一步按员工自己的有效模型执行。
- 助理默认调度、明确 @ 员工直达、顺序任务运行器、暂停/继续/关闭、审查退回和任务列表。
- 团队与私聊模型失败重试、超时诊断、Token 消耗、聊天时间戳、可折叠执行过程和聊天跳转轨道。
- 本机 Skill 扫描、搜索、读取和手动选择；模型按任务需要自行判断是否检索 Skill。
- mac 风格的浅色/深色界面、内置幼圆、原生 Electron 聊天子窗口和可调整面板宽度。
- 助理、单聊、团队三类聊天统一支持附件文件选择、粘贴、拖拽。
- 图片可作为视觉输入，文本/代码可直接读取；Excel、Word、PowerPoint、PDF、OpenDocument、RTF、EPUB 通过 `officeparser` 提取文本；其他二进制也会真实保存，并向模型返回可操作路径和明确说明。
- 产出物按聊天 scope 隔离，显示路径、类型、大小、时间，可直接打开真实磁盘文件。
- 项目编排：助理可生成待批准项目草案，按职责/专长/在线状态从全体员工匹配成员；批准后创建隔离项目团队并复用顺序任务运行器。
- 人格、用户画像和长期记忆分层；记忆具备准入筛选、分类、去重、冲突替换、重要性排序和容量淘汰。
- 章北海、员工私聊和团队执行支持运行中“排队 / 引导”，员工工作状态在所有窗口通过 Store 广播同步。
- 章北海伴随窗是主窗口的 owned window，保持同一窗口层级但不跨应用永久置顶。

最新安装包和历史发布在 GitHub Releases。源码最新功能以 `main` 为准。

## 3. 关键架构

### 前端与状态

| 模块 | 责任 |
| --- | --- |
| `src/store.tsx` | 全局状态、团队消息路由、助理调度、任务运行的启动/暂停/继续/关闭。 |
| `src/data/hermesClient.ts` | OpenAI 兼容请求、模型配置解析、聊天/员工/团队/Token 本地持久化、Agent 循环。 |
| `src/engine/teamDiscussion.ts` | 计划步骤执行、员工发言、工具回调、审查与交接。 |
| `src/engine/tools.ts` | `write_file`、`read_file`、`list_files`、`search_skills`、`read_skill`、`run_command` 和连接器工具。 |
| `src/components/chat/AssistantChat.tsx` | 章北海助理聊天与运行中引导。 |
| `src/components/chat/DmChatApp.tsx` | 员工单聊与失败重试。 |
| `src/components/chat/TeamChatApp.tsx` | 团队聊天、任务过程和成员 @。 |
| `src/components/outputs/ChatOutputsPanel.tsx` | 按 scope 和用途分类、折叠、预览真实交付文件。 |
| `src/utils/attachments.ts` | 三种聊天共用的附件分类、读取、落盘和工作区上下文。 |
| `src/hooks/useFileDrop.ts` | 三种聊天共用的文件拖拽交互。 |

### Electron 主进程与本机资源

| 模块 | 责任 |
| --- | --- |
| `electron/main.cjs` | 窗口管理、工作区安全边界、文件 IPC、命令执行、Office/PDF 解析。 |
| `electron/preload.cjs` | 受限的 `window.electronAPI` 桥接。新增 IPC 必须同步更新此文件和 `src/electron.d.ts`。 |
| `electron/skills.cjs` | 扫描 `%USERPROFILE%/.workbuddy/skills`、项目 `skills/` 和 `.workbuddy/skills`。 |
| `electron/autoUpdate.cjs` | 通过 GitHub Releases 检查并下载更新；后台检查失败只写诊断日志，不冒充模型网络故障。 |

## 4. 数据位置与隐私边界

以下内容是本机用户数据，**不要提交到 GitHub**：API Key、连接器凭据、员工和团队实际配置、聊天内容、长期记忆、任务运行记录、上传附件、工作区文件、安装包缓存。

- 渲染进程数据：Chromium `localStorage`，键以 `hermes_office_` 开头。
- 真实工作区：Electron `app.getPath('userData')/workspace`；每个聊天 scope 下有独立目录。
- 上传附件：`<scope>/uploads/<批次>/<原文件名>`。输入附件不会显示为最终产出物。
- Skill：用户目录 `.workbuddy/skills` 或项目本地 Skill 目录。
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

### P2：工程债务

- `README.md` 已说明主 bundle 大于 500 KB；可按模块拆分懒加载。
- `npm run lint` 当前有历史警告；新增代码不得增加警告，条件允许时逐步清理。
- 旧版 `开发资料全记录.md` 仅保留历史背景，内容已过时；所有新结论写入本文件和 CHANGELOG。
- 安装包未签名，Windows SmartScreen 可能提示风险。

## 7. 开发、测试与发布

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run lint

$env:ELECTRON_BUILDER_CACHE='E:\私人办公会所项目\.electron-builder-cache'
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
npm.cmd run dist:win
Get-FileHash -Algorithm SHA256 'release\hermes-office-pro-setup-<version>.exe'
```

发布检查清单：

1. `package.json`、`package-lock.json`、README、CHANGELOG 使用同一版本号。
2. `npm.cmd run build` 必须通过；`npm.cmd run lint` 的新增警告必须为零；`git diff --check` 必须通过。
3. 构建安装包并记录绝对路径、文件大小和 SHA-256。
4. `git add`、`git commit`、通过本机代理推送 `main`。
5. 创建 `v<version>` GitHub Release，上传 `hermes-office-pro-setup-<version>.exe`、同名 `.blockmap` 和 `latest.yml`。
6. 用 GitHub API 或 Release 页面确认：远端 `main`、README 版本、Release 标签和三个发布资产都存在。

本机网络若需要代理，Git/GitHub 使用：`http://127.0.0.1:65532`。不要把 GitHub Token、代理凭据或 API Key 写进代码、文档和提交记录。

## 8. 建议的接手顺序

1. `git pull` 后先运行 `npm.cmd install`、`npm.cmd run build`。
2. 阅读本文件的“不可破坏规则”和“附件处理链路”。
3. 从用户当前反馈中选一个可验收的问题，先复现，再沿对应模块修改；不要顺手重构无关部分。
4. 涉及聊天/附件/模型/任务时，必须同时检查助理、单聊、团队三条路径。
5. 完成后按第 7 节的版本、安装包、GitHub Release 流程交付。
