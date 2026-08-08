# v5.10.1 内核改造发布补记（2026-08-08）

## 本轮补记

- 当前内核改造已提交到 `52c7c7d`（`refactor: split task service helpers for boundaries`），并推送到 `origin/main`。
- 为通过模块边界门禁，`electron/taskService.cjs`、`electron/taskServiceContextQueries.cjs` 和 `electron/taskServiceEvidenceCommands.cjs` 的新增归一化/投影/证据记账逻辑已拆到独立辅助模块；最终 `npm.cmd run verify:v510`、`npm.cmd run lint`、`npm.cmd run verify:module-boundaries` 均通过。
- GitHub Release `v5.10.1` 已确认存在，并补齐/更新三个资产：`taiji-office-setup-5.10.1.exe`、`.blockmap`、`latest.yml`；发布地址：<https://github.com/TTflysky/sirenhuisuo/releases/tag/v5.10.1>。
- 这轮发布后，下一轮可以直接基于 `v5.10.1` 继续内核开发，不需要重复追查发布资产或边界门禁问题。

---

# 当前 v5.10.1 风格化主题聊天可读性修复交接（2026-08-08）

## 本轮完成

- 用户在深色/风格化配色下打开新的团队聊天窗口时，运行观察 Demo 壳仍强制使用固定浅色纸张和白色卡片，但文字继续继承当前深色主题的浅色前景，导致成员名称、恢复提示、消息正文和阶段内容几乎不可见。
- `src/styles/runtime-observer.css` 的运行观察颜色令牌已改为映射全局语义主题变量：正文、页面、表面、边框和弱文字分别读取 `--text`、`--bg`、`--surface`、`--border` 与 `--text-muted`；聊天壳同时显式继承正文颜色。
- 人类消息气泡补齐与其背景配套的前景色；删除遗留的孤立 `.runtime-demo-shell` 选择器，恢复运行观察基础样式的正常作用域。
- `src/styles/collaboration.css` 中使用运行观察私有变量的输入区样式已限定到 `.runtime-demo-shell`，普通聊天不再读取未定义的运行观察变量。
- `scripts/verify-visual-system.mjs` 新增主题契约回归，禁止运行观察壳重新写死浅色画布，并验证输入区作用域和消息前景配对。

## 验证证据

- `npm.cmd run verify:visual-system`：通过。
- `npm.cmd run verify:runtime-observer-ui`：通过。
- `npm.cmd run lint`：通过。
- `npm.cmd run build`：通过；沙箱内首次因 Vite 子进程 `spawn EPERM` 被阻止，在正常权限环境重跑后完整构建成功。
- 尝试通过 `scripts/run-electron-e2e.cjs scripts/verify-team-window-layout.mjs` 启动隔离真实窗口，但 Electron 43 在渲染器沙箱预加载阶段报 `binding.startupData` 为空，脚本未进入主题/布局断言；该失败属于现有 E2E 启动环境，不能作为本次界面验收证据。
- 本轮没有改版本号、提交、推送或发布 GitHub；需要在真实客户端切换原版深色、波普漫画和酸性暗黑主题复核后，再决定是否制作修复版本。

## 下一步

1. 在真实 Electron 客户端复核截图中的团队聊天，确认成员栏、恢复横幅、消息正文、阶段卡片和输入区均随主题保持可读。
2. 如准备发布，先确定补丁版本号，再执行完整发布门禁、更新 SBOM/来源证明并发布 GitHub Release。

---

# v5.10.0 交付物驱动动态团队内核交接（2026-08-08）

## v5.10.0 本轮完成

- 本阶段目标：把固定角色串行流程改造成“交付物 → 能力 → 负责人 → 证据 → 整合”的动态团队内核；非目标是不继续堆监控 UI，也不冒充长期自治验收。
- 任务决策交付物现在可携带稳定 ID、目标、验收、能力、依赖、输出路径和验证方式；项目简报升级到 version 2，并以交付物 DAG 代替固定开发阶段。
- 新增 `src/engine/deliverableTeamPlanner.ts`：无依赖交付物有限并行，根据能力选择责任成员，显式记录能力缺口，生成主代理整合节点和可用时的独立最终审查节点。
- 成员步骤拥有结构化任务合同：输入引用、输出类型/路径、完成条件、验证方式、模型轮次/工具调用/返工预算和升级条件。
- 合同已贯通 `electron/taskService.cjs`、`electron/taskServiceTeamExecution.cjs` 与 `src/engine/adaptivePlanGraph.mjs`，根任务、计划节点、责任子任务和重启恢复读取同一事实链。
- 项目创建和团队聊天会合并全部必需交付物的能力集合后选择成员；新版项目不再被旧 `compileCodingProject()` 固定 DAG 覆盖，旧数据仍走兼容路径。

## 验证证据

- `verify:v510-deliverable-kernel`：通过；两个独立交付物同时 ready，整合节点等待二者，三个责任子任务均保留合同，重启后恢复。
- 单元测试：56 个测试文件、190 项测试全部通过；新增交付物规划器与自适应图合同投影覆盖。
- `verify:adaptive-plan`、`verify:task-service`、`verify:completion-gate`、Lint 和生产构建均通过。
- 未执行也不宣称完成：连续 8 小时真实客户端驻留、第三方真实账户矩阵、所有失败场景下的自动换人。

## 下一阶段

1. 能力缺口触发同一项目提案 revision，补充或替换成员后只重分配受影响节点。
2. 把审查 REJECT 与任务合同返工预算联动，优先退回原责任成员，达到阈值后再换人或换路线。
3. 在真实客户端跑多交付物项目，核对 DAG、成员响应、产物索引、插话修订与完成门证据。

---

## v5.9.1 历史交接

## v5.9.1 本轮完成

- 团队聊天同步已验收的运行观察 Demo，统一观察、产物、技能和回放；删除团队群重复的新建聊天、发起讨论和发布任务入口。
- 暂停/停止即时反馈并与 Worker 权威状态对账；完成门禁按文件、代码、连接器和决策类交付核验必要证据，完成证据先落账再进入终态。
- 新需求不再隐式继承多个旧项目；只有明确引用项目才会恢复旧审批、任务和工作区。项目名称来自模型提炼的目标，而不是最后一句对话。
- 下一阶段继续沿“自主智能体团队”目标处理提案替代、动态成员响应和自适应计划，不为单个测试项目增加关键词工作流。

## 本阶段回顾与路线核对

- V5 的总目标不变：太极是由目标、证据、阻塞与用户插话驱动的自主智能体团队；任务图、审批和状态机只用于事实、恢复与安全边界，不能取代模型对具体项目的判断。
- 本阶段按 V5.8 陪跑结论先补齐可观测事实链，而不是为“拉团队”“拍摄脚本”或任何单个项目增加关键词特例。
- 本阶段非目标：不记录模型隐藏推理、提示词、密钥或附件正文；不新建第二套任务、产物或团队状态；不把自动回放冒充真实长期陪跑。

## v5.9 已完成：统一运行轨迹与监控台

- 新增 `electron/telemetryLedger.cjs`。遥测账本是主进程的追加式、可轮转事实投影，事件包含稳定 ID、时间、任务/项目/会话关联、执行者、模型、工具、状态、耗时、Token、错误分类、证据 ID 与脱敏公开摘要。
- 任务事件账本通过 `taskRuntimeStore` 适配器进入统一轨迹；Worker 和原生执行器的真实状态变更也写入同一轨迹。`operationDiagnostics` 保持原诊断账本，同时自动投影为遥测事件。
- 设置 -> 诊断中心新增“运行监控台”：默认面向普通用户展示当前任务、最后真实动作、错误/提醒、Token 和阶段事件；技术事件按时间线保留。它每 2.5 秒读取主进程账本，不依赖窗口广播堆积。
- 新增 `telemetry:query`、`telemetry:summary`、`telemetry:export` IPC。问题包会导出脱敏遥测、任务快照、任务账本事件、操作诊断、版本和完整性信息，不包含隐藏推理、密钥或附件正文。
- 新增 `scripts/verify-v59-runtime-telemetry.cjs`：验证任务/工具/诊断汇总、敏感字段与隐藏推理剔除、Token 汇总、重启读取，以及主进程/preload/界面接线。
- 已通过 `npm.cmd run verify:v59`：V5.9 遥测验证、V5.6-V5.8 既有核心验证、24 项自治回放、性能回归、12 窗口 Electron 驻留、Lint 与生产构建全部通过。

## 必须如实保留的限制

- 当前事件源已覆盖任务账本、Worker、原生执行器和操作诊断；团队提案、渲染器存储异常、所有模型请求和所有工具细节仍有部分旧路径尚未统一发出结构化事件。监控台能显示已进入主进程的真实活动，但不能宣称全链路覆盖已完成。
- 运行监控台解决的是“发生了什么、在哪中断、已有何种证据”，不会自动给出根因或自动修复。通用异常检测属于 v5.9.1。
- 连续 8 小时真实客户端驻留、真实第三方账户矩阵和长期真实用户任务指标仍未完成；自动回放与短驻留只能证明相应链路回归。

## 下一步：v5.9 陪跑与 v5.9.1

1. 在新版客户端打开“设置 -> 诊断中心 -> 运行监控台”，保持窗口打开后执行一个正常项目任务。
2. 观察是否依次出现任务合同、Worker、模型/工具、产物/验收、暂停或完成事件；任何异常直接使用“导出问题包”。
3. 以真实事件选择共性问题进入 v5.9.1：目标漂移、纠正误判、重复工具、能力缺失、已有产物却声明无结果、预算异常或存储容量异常。每条告警必须指向事件与责任阶段，不能按项目关键词判断。

# v5.8.1 历史交接（2026-08-07）

## 本阶段回顾与路线核对

- 本阶段继续 V5 的总目标：太极必须根据目标、证据、阻塞和用户插话动态决定下一步，状态机、任务图和审批只负责安全边界，不能替模型预设所有项目的固定顺序。
- 本阶段承接 V5.6 的统一记忆账本与项目边界、V5.7 的 Skill 候选生命周期，目标是补上可回放的自治评测和真实运行观察，不把模型的完成声明当成事实。
- 本阶段非目标：不为单个 Skill、网站、命令或用户措辞添加特例；不自动批准单次任务生成的 Skill；不把自动回放或短驻留冒充真实长期使用验收。

## v5.8 已完成

- 新增 `electron/autonomyEvaluation.cjs`：24 个稳定可回放场景、持久化评测会话、观察记录、审计事件、证据捕获、汇总和导出。
- 主进程、preload、诊断中心和章北海内置 v29 人格接入自治评测协议。
- 诊断中心新增“自治陪跑评测”入口，支持开始、刷新、完成和导出；样本不足时明确显示不足，不使用回放数据伪造真实陪跑分数。
- `verify:v58-autonomy-evaluation` 覆盖场景回放、重启读取、任务/记忆/Skill 证据捕获、IPC/UI/人格契约和 V5.8 总门禁接线。
- 新增 12 窗口 Electron 驻留测试，短驻留期间持续验证主界面、助理、员工私聊、团队、设置和工具窗口，真实任务检查点序列为 3。
- `createWindow` 已抽离自治评测 IPC 注册函数，文件从 657 行降至 614 行；未进行无关的大规模重构。
- 已通过：`verify:v58`、`verify:v2-core-gate`、`verify:v56`、`verify:v57`、`verify:phase2-soak:smoke`、`verify:phase3-performance`、`verify:v315-soak`、`lint`、`git diff --check`；54 个测试文件、184 个测试全部通过。
- 性能基线：320 名员工、12 个窗口、12000 个任务事件，堆增长 2.22 MB。
- 评测中保留 3 个预设失败样本作为错误证据，评测门禁通过不等于系统所有场景都成功。

## v5.8.1 本地修复：陪跑真实边界与自动验收

- 用户启动真实陪跑后发现旧版本把会话开始前的历史任务扫描进本轮，导致刚开始就出现混杂的完成率、失败率和场景结果。根因是 `capture()` 未按 `startedAt` 过滤，且采集只发生在手动刷新时。
- 真实陪跑现在只接受本轮开始后的任务、记忆与 Skill 证据；启动前误写入的旧观察会被清除，并留下“真实陪跑不采纳会话开始前的历史证据”审计记录。
- 主进程每 5 秒自动采集，无论诊断页面是否打开；重启后仍有进行中的会话会恢复采集。界面显示秒级时长、最近采集时间和运行指示。
- 新增“一键验收 24 项”。它在隔离的 `automated` 会话中覆盖 24 个标准场景，自动结果与真实 `live` 会话严格隔离；用户不需要为填表而创建任务。
- 已通过：`npm.cmd run verify:v58`、`npm.cmd run lint`、`npm.cmd run verify:package` 和 `git diff --check`。用户已于 2026-08-07 授权发布 `v5.8.1`；发布脚本将再次执行完整发布门禁、重建安装包并核验远端资产。真实陪跑的长期数据仍需在正常使用中持续积累，不以自动基准替代。
- 首次发布预检曾因遗漏版本绑定的 `docs/sbom-v5.8.1.json` 与 `docs/release-provenance-v5.8.1.json` 被发布治理门禁正确拦截；现已通过 `generate:sbom`、`generate:provenance` 与 `verify:release-governance` 补齐并验证。今后在版本号变更后、首次提交发布内容前必须先生成并提交这两份证明。
- 已于 2026-08-07 发布并远端校验 [GitHub Release v5.8.1](https://github.com/TTflysky/sirenhuisuo/releases/tag/v5.8.1)。发布目标提交为 `524432ecf331134fbcd27c7a2f860511e56c26f9`；安装包 `release/taiji-office-setup-5.8.1.exe` 的 SHA-256 为 `1EA1414F568CCA39DB7A1C31BCFD6422D3B3D7A886346EACF45AE9678B9C93F2`。Release 同时包含 blockmap 与 `latest.yml`，且由发布脚本完成远端校验。

## v5.8 发布状态

- 已生成并提交 `docs/sbom-v5.8.0.json` 与 `docs/release-provenance-v5.8.0.json`；核心实现提交为 `2c20643`，发布提交为 `793799f3239843319643541c0fcfdbf58d489029`。
- 已构建并校验 `taiji-office-setup-5.8.0.exe`、Blockmap 和 `latest.yml`；安装包为 197,595,650 字节，SHA-256 为 `92779099E56CA2DCCBC3B8EFE07D933EEBA464ED2C1288BED9C02AA2386DBEC4`。
- 已推送 `main` 并发布 GitHub Release `v5.8.0`；安装包、Blockmap 和 `latest.yml` 已由发布脚本远端核验。发布过程未覆盖用户数据目录。
- 后续在“设置 -> 诊断中心 -> 自治陪跑评测”启动真实客户端陪跑。

## 必须如实保留的限制

- 连续 8 小时真实客户端驻留、第三方账号矩阵和真实用户任务统计仍未完成，不能用自动回放或短驻留替代。
- 发布成功只证明源码、门禁和安装包链路完成，不代表长期自治能力已经达到最终目标。
- 下一版本必须从真实陪跑记录中选择一个已验证的共性短板；开始下一阶段前重新阅读本节、`docs/TAIJI_V5_AUTONOMOUS_AGENT_ROADMAP.md`、`docs/TAIJI_V5_6_TO_V5_8_LEARNING_KERNEL_ROADMAP.md` 和 `docs/TAIJI_V5_8_REVIEW.md`。

## 下一阶段交接：v5.9.0 统一运行轨迹与监控台

- 新任务样本显示：原始“制作每日拍摄脚本工作台并组建专业团队”没有立即进入任务运行；后续纠正被误判为独立新任务，任务合同丢失原目标，并在决策模型不可用时回退为仅由助理执行。
- 真实任务产生了 HTML 和团队方案文件，但因重复完整回读、工具参数/验收契约错误、团队调度能力未暴露和约 480000 Token 预算停止，最终只向用户显示笼统的未完成。
- 陪跑导出仅记录 4 条记忆检索，未捕获暂停任务、模型/工具调用、Token、渲染器记忆容量超限和团队状态 `QuotaExceededError`，证明当前评测层不能代替故障监控。
- 为什么优先做：当前事实分散在聊天、任务 JSON、项目事件、操作诊断、Electron 日志、浏览器存储和陪跑导出中。继续逐个修截图只能看见一层；先统一事实链，后续语义、团队、Token、存储和恢复问题才能依据真实证据定位。
- 下一阶段固定为 `v5.9.0`：先建立唯一的遥测事件协议和追加式事件账本，再接入用户操作、语义决策、任务合同、团队调度、模型、工具、Worker、审批、恢复、产物、验收、窗口/存储异常与资源指标；监控台只是这条轨迹在“设置 -> 诊断中心”的可读投影。
- 必须交付实时任务摘要、阶段时间线、错误与 Token/耗时、证据视图、重启回放和脱敏问题包导出；自治陪跑改为消费统一事件轨迹，暂停任务也必须被观察。
- 不得建立第二套任务状态或产物事实源，不记录模型隐藏推理与密钥，不为本次任务添加关键词特例。`v5.9.0` 只解决事实完整可还原；通用异常检测进入 `v5.9.1`，长期资源治理进入 `v5.9.2`。
- 开工顺序、事件字段、非目标和验收标准见 `docs/TAIJI_V5_8_1_LIVE_MONITORING_GAP.md`。下一位执行者开始前必须先读本节和 V5 总路线，先写协议与现有事件源映射，再动 UI。

# V5.7 历史开发交接（2026-08-07）

## V5.7 已完成：Skill 候选、编译、验证、灰度与回滚

### 本阶段目标
- 将复盘模型直接生成 Skill 草案改为跨任务候选聚合。
- 只有两个以上独立任务通过真实验收、工具路线相近且失败率低于阈值时，才允许编译草案。
- 补齐结构、权限、安全、依赖、Dry-run、正向/失败样例验证，以及人工审批、灰度停用和版本回滚。

### 本阶段非目标
- 不做 V5.8 的长期自治评测，不自动批准 Skill，不覆盖内置或手动安装 Skill。
- 不为某个 Skill、网站、命令或用户措辞添加关键词特例。
- 本轮不打包、不覆盖本地客户端、不发布 GitHub。

### 已完成
- 新增 `electron/skillLifecycle.cjs`，持久化 `SkillCandidate`、候选观察、审批后 rollout、真实调用和审计记录。
- `learningReviewQueue` 升级至 v4。复盘模型只输出结构化 `skill_candidates`，单次任务不再调用 `createSkillDraft()`。
- 候选硬门槛为：至少两个独立任务、至少两个真实验收、存在真实工具路线、路线相似度不低于 70%、失败率不高于 20%。
- 编译器生成规范 `SKILL.md`、`references/contract.md` 与 `agents/openai.yaml`，并按 `skill-creator` 原则保持 frontmatter 简洁、核心说明短小、详细契约按需加载。
- 验证流水线覆盖候选门槛、frontmatter、命名、渐进加载、敏感信息、权限、外联依赖、静态 Dry-run、正向样例和失败样例。
- `SkillLibraryView` 新增“学习与审批”视图，展示正文、Diff、来源任务/证据、权限、风险、验证报告和候选积累进度。
- 自动 Skill 使用完整目录和包清单安装。每次批准记录版本快照；更新只允许替换太极自动生成的 Skill。
- 助理、员工私聊和团队工具调用均写入 Skill Runtime。批准后前 5 次真实调用为灰度；失败 2 次或成功率过低会自动停用，成功率达标后转为 active。
- 新增自动 Skill 回滚入口；内置和手动安装 Skill 继续受保护。
- 章北海内置人格升级至 v28，并确保新用户默认人格直接包含 V5.7 协议。
- 助理聊天、总设置和人格设置入口已统一直接使用 `PERSONA_MIGRATION_APPENDIX_V28`；v20 至 v27 的导出只保留历史兼容，不再作为当前运行入口。
- 版本号已同步为 `5.7.0`；新增 `docs/TAIJI_V5_7_REVIEW.md`。

### V5.7 验收证据
- `npm.cmd run verify:v57`：通过，覆盖候选聚合、编译、验证、审批、灰度失败停用、灰度成功转正、完整替换、回滚、既有草案/运行时/Agent Kernel 和生产构建。
- `npm.cmd run test:run`：54 个测试文件、184 项测试通过。
- `npm.cmd run lint`：通过，无警告。
- `npm.cmd run verify:module-boundaries` 与 `npm.cmd run verify:function-boundaries`：通过。
- `npm.cmd run verify:v2-core-gate`：通过，覆盖生产构建、54 个测试文件/184 项测试、400 条语义基准、Agent 轨迹、任务恢复、原生执行、Skill 安装、图像路由、指定网页读取、记忆质量、模块/函数边界和性能回归。
- `git diff --check`：通过，无空白错误；仅输出 Windows CRLF 转换提示。

### 失败样本
- 首次测试错误依赖 Skill 包文件顺序，已改为集合完整性校验。
- 编译器安全说明中的“账号/授权”措辞触发了现有依赖扫描，导致自动 Skill 被误标为待配置；已改为不制造虚假依赖的用户专属凭据/人工确认表述。
- 总门禁首次被旧验证脚本中的人格 v26 断言阻塞；产品实际已是 v28。已同步三个旧断言，并把当前运行入口改为直接引用 v28，旧别名继续兼容历史配置。

### 下一步
- V5.8 只做真实自治评测与持续学习：20 至 30 个可回放长期场景、真实客户端长驻、多窗口和大量员工回归，以及完成率、误执行率、恢复率、记忆命中正确率、跨项目污染率、Skill 复用成功率和不必要工具调用数。
- 开始 V5.8 前必须重新阅读本交接顶部、`docs/TAIJI_V5_AUTONOMOUS_AGENT_ROADMAP.md`、`docs/TAIJI_V5_6_TO_V5_8_LEARNING_KERNEL_ROADMAP.md` 和 `docs/TAIJI_V5_7_REVIEW.md`。

# V5.6.0 历史交接（2026-08-07）

## V5.6 已完成：统一记忆账本与项目边界

### 本阶段目标
- 将主进程记忆账本升级为唯一可写事实源，消除浏览器 `localStorage` 与分层记忆并行参与模型上下文的双事实源。
- 新增 `project` 记忆范围，确保新聊天/新项目不会继承旧项目专属经验。
- 为每次记忆检索留下 `memoryId`、命中理由、分数和调用关联的证据记录。
- 保留旧用户画像、用户记忆、任务经验的无损兼容导入；旧数据导入后不再直接注入模型。

### 本阶段非目标
- 不做向量数据库，不提前实现自动 Skill 发布，不删除用户现有本地数据。
- 不为某个用户案例、网址、Skill 名称或项目标题添加关键词分支。

### 已完成
- 已回顾 `docs/TAIJI_V5_AUTONOMOUS_AGENT_ROADMAP.md` 与本交接，确认 V5 的“项目独立、事实有 ID、普通操作自主完成”边界不变。
- `electron/memoryManager.cjs` 已升级 schema v4：新增 `project` 记忆范围、`memoryId`、项目 ID、证据 ID、状态、替代链、检索引用账本和历史恢复。
- 助理、员工私聊、团队讨论、恢复控制和团队主持都通过主进程账本检索记忆，并传入项目、会话、任务和成员边界。助理/员工聊天任务会把检索记录绑定到任务引用。
- `chatCompletion`、任务决策和 Agent Loop 不再从旧版 `localStorage` 直接注入用户画像或任务经验；旧数据只做兼容迁移与只读核对。
- 用户洞察提炼改为创建待审核提案；自动批准只允许有真实验收证据的团队/员工程序经验，组织、用户和项目范围必须人工批准。
- 记忆中心支持项目范围、历史版本恢复、证据数量和最近检索记录；旧版记忆/任务经验已明确标记为不参与模型上下文的兼容备份。
- 内置章北海人格已升级至 v27；已使用 `skill-creator` 的结构化、渐进加载和前向验证原则设计后续 V5.7 Skill 生命周期。
- 已新增路线图：`docs/TAIJI_V5_6_TO_V5_8_LEARNING_KERNEL_ROADMAP.md`。
- 已新增版本复盘：`docs/TAIJI_V5_6_REVIEW.md`，当前综合产品成熟度为 74/100，工程结构/发布/审计为 84/100。

### V5.6 验收证据
- `npm.cmd run verify:v56` 已通过：项目范围隔离、引用审计、版本替代、回滚、旧任务经验隔离、自动批准边界、重启一致性、既有分层记忆/复盘回归与生产构建。
- `npm.cmd run test:run` 已通过：54 个测试文件、184 项测试。
- `npm.cmd run lint` 已通过，无保留警告。

### 未决问题与下一步
- V5.7 只做 `SkillCandidate`、Skill 编译、结构/安全/权限/dry-run/样例验证、人工审阅和灰度/回滚；不得从单次任务直接生成可用 Skill。
- V5.8 才做 20 至 30 个可回放长期任务和真实客户端长驻评测。

### 强制工作方式
- 每次开始新阶段必须先阅读本文件顶部与 `docs/TAIJI_V5_AUTONOMOUS_AGENT_ROADMAP.md`，并在这里写明目标、非目标和验证证据。
- 每个版本结束必须写复盘：完成项、未完成项、测试、失败样本、评分变化、下一版本唯一重点。

# V5.5.3 历史交接（2026-08-07）

## Explicit Skill source isolation and truthful failure state (2026-08-07)

### Goal and boundary
- Goal: repair the general command-to-task boundary behind an explicit `npx skills add owner/repo` request being parsed incorrectly, then silently resuming an older Skill installation.
- Boundary: preserve the user-provided source as a new task contract, route native installation without marketplace gating, and show the actual failure stage. Do not add a Skill-name-specific exception or change an existing release tag.

### Completed
- `skillInstallRouting` now recognizes strict GitHub repository grammar even when Chinese instructions immediately follow the repository token.
- `chatTaskContinuation` treats any newly explicit Skill source as a new task and keeps malformed current input local instead of falling back to an older source.
- `unifiedHost` gates only true external dependencies: SkillHub availability remains relevant to `search_skills`, while the native `install_skill` path is allowed to validate its own GitHub, ZIP, or marketplace source.
- The chat failure presentation reports the actual Skill-install capability stage rather than a misleading AI-model connection stage.
- Extracted the multimodal attachment message preparation from `agentLoopRuntime`; the runtime is 855 lines and its main factory function is exactly within the 760-line function boundary.
- Release verification now validates the committed SBOM/provenance rather than regenerating evidence after the clean-worktree check. This prevents the release gate from blocking itself with newly untracked proof files.

### Verification and release follow-up
- Passed: 54 Vitest files / 184 tests, `verify:agent-kernel`, `verify:v317`, `verify:v2-core-gate`, production build, and lint.
- Expected user test after installation: submit `npx skills add mattpocock/skills安装这套skill然后把名称发给我`. The task must target `https://github.com/mattpocock/skills`, must not reuse an earlier repository or workspace, and any true installer error must be reported as an installation issue rather than an AI-model connection problem.
- Local release commits are `9b709be` (Skill routing) and `a4f14ba` (release verification), rebased on the v5.5.2 history before release.
- Published and verified on 2026-08-07: `https://github.com/TTflysky/sirenhuisuo/releases/tag/v5.5.3`. Release tag and source commit are `f89c856731d94524e79f591f26e143c8c01d0873`.
- Verified release assets: `taiji-office-setup-5.5.3.exe`, its `.blockmap`, and `latest.yml`. Installer size is 197,580,128 bytes and SHA-256 is `585135CEBF8D473C970F2091EE8EF06DED5BCACAA7684EE091AF3C458934821B`.
- The initial network reset/timeout was recovered after the proxy route was restored. Future release recovery may use `-SkipTests -SkipBuild` only when the same committed source and already verified package are unchanged.

## Skill command boundary and truthful failure state (2026-08-07)

### Goal and boundary
- Goal: diagnose a new explicit Skill install request that failed after the v5.5.2 client was already confirmed installed, without mistaking it for an updater or model-connection failure.
- Boundary: repair general command parsing, task/project continuation isolation, external-capability gating, and user-facing error semantics. Do not add a special case for `mattpocock/skills`; do not publish an installer in this repair.

### Root cause
- The new request `npx skills add mattpocock/skills安装这套skill然后把名称发给我` put Chinese instructions immediately after `owner/repo`. `parseSkillCliInstall()` previously consumed all non-space characters, rejected the source, and `resolveSkillInstallContinuation()` then inherited the prior `vercel-labs/agent-skills` task.
- `unifiedHost` mapped every tool whose name contained `skill` to the external `skillhub` capability. It blocked native `install_skill` before the installer could validate its own GitHub/ZIP/SkillHub source, then the chat catch path left the default stage at “连接 AI 模型”.

### Completed
- CLI parsing now recognizes the exact GitHub repository grammar, including a repository immediately followed by Chinese prose.
- An explicit malformed install command keeps its own validation error and cannot silently inherit an older Skill source. A new concrete Skill source also cannot reuse an older assistant task/workspace, even if an upstream relation label is incorrectly `continuation`.
- The external capability matrix now gates only real external dependencies. `search_skills` remains gated by SkillHub availability; native `install_skill`, coding, file output, and other internal contract capabilities are not blocked by marketplace inventory.
- Failure presentation classifies the actual exception before rendering the final chat message. A capability block for `install_skill` now says “检查技能安装能力”, and the summary explains that the tool did not start; it no longer claims an AI model connection failure.

### Verification and follow-up
- Passed: focused Skill/continuation/presentation tests (23 assertions); full test suite (53 files, 182 tests); `verify:agent-kernel`; `verify:v317`; `verify:external-capability-matrix`; `verify:task-service`; and production `build`.
- `verify:v2-core-gate` reached the existing module-boundary check and stopped because `src/data/agentLoopRuntime.ts` is 911 lines while the repository limit is 900. This repair did not modify that file; do not claim the full core gate passed until the runtime split is handled as a separate scoped task.
- Next user verification after a client build: send the exact command above. Expected behavior is one native `install_skill` call against `https://github.com/mattpocock/skills`, no reuse of yesterday's repository, and no “连接 AI 模型” message. The real network/download result still determines whether installation completes.

## Operational migration: old updater backup-limit recovery (2026-08-07)

### Goal and boundary
- Goal: recover a client still physically running v5.0.0 after its built-in updater stopped before installer launch because the legacy pre-update single-file backup was limited to 24MB.
- Boundary: preserve the canonical `taiji-office` user-data root, including memory, task runtime, and project workspaces. Do not treat an updater download as a completed installation.

### Completed
- Confirmed the installed executable at `C:\Users\Administrator\AppData\Local\Programs\taiji-office\太极 AI 办公会所.exe` was v5.0.0, which exactly explains the visible legacy "configuration exceeds 24MB" error.
- Confirmed the old client had already downloaded and checksum-verified `taiji-office-setup-5.5.2.exe` into the updater pending directory.
- Created an independent pre-install snapshot at `E:\私人办公会所项目\local-backups\taiji-office-pre-v5.5.2-20260807-090945`. The snapshot contains every file present in the live user-data tree and additionally preserves files that were cleaned from an old workspace during copying.
- Installed v5.5.2 over the old program directory. The installer exited with code 0 and the installed executable reports v5.5.2.
- Verified the live user-data root after installation: 627 files, 306,692,544 bytes; `taiji-memory`, `task-runtime`, `workspace`, and Chromium local storage remain present.
- Started the installed client and verified its real main-process log: startup completed, windows were revealed, and the updater reported that v5.5.2 is already the latest available version. The v5.0.0 24MB backup path is no longer the executing client.

### Follow-up
- Future update investigations must first verify the physical executable version, not only the downloaded release or updater cache state.
- Keep the pre-v5.5.2 snapshot until the user has completed normal task and Skill checks on the upgraded client.


## V5.5.2 补丁发布：Skill 安装回读与公开执行记录（2026-08-07）

### 本轮目标与边界
- 目标：让明确来源的 Skill 安装在真实受管目录中一次完成并可验证，同时让聊天窗口呈现用户能审计的执行过程，避免只看见工具名称而不知道系统正在做什么。
- 非目标：不暴露模型原始思维链或 provider 私有 `reasoning_content`；不把本地构建成功冒充远端资产已经上传和核验。

### 已完成
- Skill 安装回读改为比较规范化文件系统路径，修复 Windows 8.3 短路径与长路径同一目录被错判为“已写入但扫描不到”的问题。GitHub 仓库、ZIP 与单文件安装路径均已覆盖。
- 聊天中的“执行思路与过程”按真实事件持久化：目标理解、执行计划、进行中的工具、观察结果、失败调整、用户插话和最终验收/阻塞。每一步都带状态，完成结果原地更新；长结果支持独立滚动、放大和复制。
- 明确 Skill 命令、绑定候选和“继续安装”保持同一原生安装合同，不重新调用规划模型，也不退回交互式第三方 CLI。

### 验证证据与下一步
- 已通过 Skill 安装 E2E、相关 15 项单元测试、生产构建、执行记录契约与真实 Electron 界面回归。界面验证确认 5 个步骤可见、字号为 15px、长结果可滚动、放大详情适配窗口且无横向溢出。
- 已发布正式 [v5.5.2 Release](https://github.com/TTflysky/sirenhuisuo/releases/tag/v5.5.2)，包含 Windows 安装器、Blockmap 和 `latest.yml`。标签提交为 `b817026b7bfc7f83710766f365eeced61cce72de`；安装器为 `197580487` 字节，SHA-256 为 `6BACA78CF0B47DEC31DD22A66EB6CEA682AAB72996412690709D26755D8891C2`；远端资产大小和摘要均已通过发布脚本核对。

## V5.5.1 补丁发布：Skill 安装确定性闭环（2026-08-06）

## V5.5.1 补丁发布：Skill 安装确定性闭环（2026-08-06）

### 本轮目标与边界
- 目标：定位并修复从项目早期持续存在的 Skill 安装失败，不为某个技能名称增加特例；明确命令、GitHub 仓库、SkillHub 来源和已绑定候选必须进入同一套原生安装闭环。
- 非目标：不运行交互式第三方 CLI，不把本地确定性回归冒充为已经覆盖安装客户端后的真实联网验收，也不在本轮改版本号或发布安装包。

### 根因
- 裸命令 `npx skills add owner/repo` 过去可能被任务决策当成“让模型解释命令”，没有被保护为必须执行的安装操作；用户随后说“继续安装”时，旧目标也可能丢失。
- `skills add` 是面向 Codex/Claude/Cursor 等 harness 的交互式安装器，后台无 TTY 时会停在目标选择，而且即使执行也不保证写入太极扫描的 `%USERPROFILE%\.workbuddy\skills`。
- 太极原生安装器此前支持 SkillHub ZIP、单个 `SKILL.md` 和 GitHub 具体目录，但不支持只给 `https://github.com/owner/repo` 的多 Skill 仓库；`vercel-labs/agent-skills` 正是这种仓库根地址。
- 明确来源和“安装它”过去仍会回到通用模型循环，模型可以反复读网页、搜索或改路线；普通任务预算允许最多约 48 万 token，因此确定性安装错误被放大成数分钟空转。

### 真实故障现场
- 客户端任务 `task-1786007789021-42915921` 把目标保存成了“继续安装。”，没有继承上一条 `npx skills add vercel-labs/agent-skills`；决策模型不可用时，旧规则把主路线错误降级为 `run_command`。
- 首次命令真实超时在 `Select skills to install` 交互菜单；第二次追加 `--yes` 后成功下载 9 个 Skill，但落在任务隔离工作区 `.agents/skills`，只产生该工作区的 `skills-lock.json`，不属于太极受管技能库。
- 后续运行时又执行了多次搜索、读取和目录检查；原生 `install_skill` 对 GitHub 仓库根地址返回 `HTTP 404`，改走 GitHub ZIP 又遇到连接重置，最终任务暂停并耗尽约 48 万 token。

### 已完成
- `skillInstallRouting` 能解析 `npx skills add owner/repo`，区分“执行命令”和“这是什么命令”，并把“继续安装”恢复到上一条真实安装目标。
- GitHub 仓库根地址由原生安装器读取仓库树，发现一个或多个 `SKILL.md`，按完整目录下载、限制文件数/大小、写包清单、原子替换并逐个回读验证；支持安装全部或指定 Skill。
- 明确安装目标不再调用规划模型：运行时直接执行一次 `install_skill`，写入真实技能目录并根据回读证据结束；已绑定候选后的“安装它”复用同一来源合同。
- `run_command` 明确阻止 `npx skills add` 和 `skillhub install` 进入交互式/错误目录路线，并给出统一原生安装器反馈。
- 将 Skill 安装准备与直接执行拆到 `src/data/agentLoopSkillInstall.ts`；核心循环保持 896 行，最长函数 759 行，模块和函数边界均通过。

### 验证证据与未决
- `verify:skill-install-e2e` 通过：覆盖 SkillHub ZIP、GitHub 多 Skill 仓库、完整包回读和 CLI 路线阻断。
- 新增 Agent Loop 回归：明确命令的规划模型调用次数为 0、原生安装调用次数为 1；“安装它”使用绑定来源，疑问句不会误触发安装。
- `verify:v2-core-gate` 全部通过：52 个测试文件、179 项测试、400 条任务语义样例、构建、Skill 专项、模块/函数边界与性能门禁均通过。
- 本版已将源码修复、客户端安装包和自动更新清单统一发布为 `v5.5.1`；`v5.5.0` 标签保持不变。Release：`https://github.com/TTflysky/sirenhuisuo/releases/tag/v5.5.1`；发布提交：`3f670cb64aeccaddf00427e8d64ebb0353a73ff0`；安装包：`release/taiji-office-setup-5.5.1.exe`；SHA-256：`EED17DB0625FE48CA696FF53320B458EDCB0414075FF4234037DC8DD3E3F7BBA`。客户端验收应直接发送 `npx skills add vercel-labs/agent-skills`，预期不再先解释命令，也不再进入模型循环；安装完成后核对技能页数量和完整包回读摘要。

## V5.5.0 发布门禁修复（2026-08-06）

### 本轮目标与边界
- 目标：修复停止任务在人工批准补偿后的状态竞态，并让原生执行器验证失败时立即退出，避免发布脚本表现为无期限卡住。
- 非目标：不绕过原生执行器门禁，不把确定性回归通过写成真实 Electron 窗口验收已经完成。

### 已完成与证据
- `electron/nativeExecutionControl.cjs`：批准后只进入补偿恢复路径，不再同时走普通 resume；补偿队列状态不会被旧的 stop 收尾覆盖。
- `electron/nativeExecutionAdapter.cjs`：旧执行回收时识别已排队的补偿，保留 `compensating_queue`，随后由队列真实执行补偿步骤。
- `scripts/verify-native-execution-adapter.cjs`：失败出口立即返回，避免测试 Worker 和定时器把发布门禁拖到外层超时。
- `npm.cmd run verify:native-execution`：通过；审批补偿、工具执行和最终状态均完成。
- `npm.cmd run verify:v2-core-gate`：通过；51 个测试文件、176 项测试、构建、模块边界和 V5.5 核心门禁均通过。

### 发布结果与下一步
- 已于 2026-08-06 发布 GitHub Release：`https://github.com/TTflysky/sirenhuisuo/releases/tag/v5.5.0`。
- `main` 和标签均指向 `25460e054df294abcb464f48bbfe6aa7e037f6f1`；Windows 安装包 `release/taiji-office-setup-5.5.0.exe` 已上传并完成远端大小与 SHA-256 校验。
- 安装包 SHA-256：`A2542D6BDFDCDA3744BF5432CB74AEDF908EAF958B39507F51D9C254B867FC8E`。
- 真实 Electron 窗口项目验收仍需在客户端启动后继续，不在发布动作中冒充通过。

## 项目与全局开发技能补充（2026-08-06）

### 本轮目标与边界
- 目标：为当前太极项目安装 `vercel-labs/agent-skills`，并安装到 Codex 全局技能目录，供后续项目开发按需调用。
- 非目标：不修改应用功能、不引入项目专用规则，也不替换现有 V5.5 发布前收尾工作。

### 已完成与证据
- `npx skills add vercel-labs/agent-skills` 已成功执行，项目级 `.agents/skills/` 新增 9 个技能：Vercel 部署、CLI、React 组合模式/最佳实践/原生开发/视图过渡、性能优化、Web 设计和写作规范。
- Codex 官方安装器已将同一套 9 个技能写入 `C:\Users\Administrator\.codex\skills`；已核对项目级和全局目录中的 9 份 `SKILL.md` 均存在。
- 安装器生成 `skills-lock.json`。全局 `vercel-react-view-transitions` 从上游获取到较新的内容版本，与项目副本存在真实内容差异；两份副本均完整，未对应用代码产生影响。

### 未决与下一步
- 后续实现相关工作时，先读取匹配技能的 `SKILL.md`；当前项目保留项目副本，其他项目可直接使用全局副本。本次不需要运行应用测试。

## V5.5.0 发布前收尾（2026-08-06）

### 本轮目标与边界
- 目标：完成 V5.5 真实项目验收所需的运行时拆分与发布门禁，不为单个验收项目增加特例。
- 非目标：在未覆盖安装并连接真实 Electron 窗口前，不宣称 V5.5 端到端项目验收已经通过。

### 已完成与证据
- 将原生执行提示构建和运行时脱敏拆至 `electron/nativeExecutionPrompting.cjs`；将团队根任务绑定、成员责任任务、事件和插话记录拆至 `electron/taskServiceTeamExecution.cjs`。
- `electron/taskService.cjs` 已从 685 行降至 482 行；团队执行模块设定 240 行边界，模块边界门禁已增加工厂存在性和防回流断言。
- 已通过：模块边界门禁、全量单元测试 51 个文件/176 项、Lint、构建、V5.3 团队责任绑定门禁与 V5 自主智能体门禁。
- 新安装的 `.agents/skills` 仅作为本机开发辅助能力保留，不属于客户端运行时或本次发布资产；为避免未经单独许可审查的第三方内容进入安装包，已由 `.gitignore` 排除。

### 未决与下一步
- `verify:v55-project` 必须连接已启动且开启调试端口的覆盖安装客户端；当前直接连接 `127.0.0.1:9336` 得到拒绝连接，未形成通过或失败的产品结论。
- 下一步：提交源码和发布证据、执行正式发布、覆盖本地客户端；用户启动新的 V5.5.0 客户端后复跑真实项目验收，并保留 `test-results/v5.5-project/project-report.json`。

## V5.5 阶段回顾与发布前边界（2026-08-06）

本阶段开始前已回顾 V5 总路线：V5.1 统一模型输出协议，V5.2 固化项目/任务/工作区和证据归属，V5.3 固化团队根任务与成员责任任务，V5.4 完成上下文隔离、附件回放和重启恢复；V5.5 只负责用真实项目验证从组队、执行、交付到验收的完整链路。

### V5.5 已完成

- 新增 `scripts/verify-v55-project.cjs` 和 `npm.cmd run verify:v55-project`，覆盖产品、架构、UI、前端、QA 多角色阶段依赖、真实文件写入、桌面/375px 页面验证、审查、任务树和项目/会话范围查询。
- 修复 `scripts/run-electron-e2e.cjs` 的 Chromium 参数顺序，并增加本地 E2E 的 `--no-sandbox`；V5.5 Mock 模型改为读取系统上下文的明确“当前步骤”，避免从完整任务文本猜到后续 Review。
- V5.4 的 `teamId`、`projectId`、`conversationId` 隔离、附件回放字段和重启后的责任任务/执行绑定恢复已保留。

### V5.5 当前验收状态

- 确定性回归、构建和发布资料正在按 `5.5.0` 统一；真实 Electron 项目验收曾启动但 180 秒内未结束，暂不标记通过。
- 为定位卡点，验收脚本已加入 Mock 模型启动、渲染器连接、任务创建、任务读取和执行启动日志。用户手动启动覆盖后的客户端后，将继续复跑并读取 `test-results/v5.5-project/project-report.json`。
- 当前不把客户端启动超时归因于模型、TaskService 或 Runner 中的任何一个，必须通过手动启动后的实时日志和任务观察状态确认具体边界。

### V5.5 下一步

- 用户手动启动覆盖后的 v5.5.0 客户端。
- 连接真实窗口，复跑 `verify:v55-project`，观察 `taskExecutionStart` 返回、阶段状态、Mock 模型请求和最终报告。
- 若再次超时，保留现场，按最后一个阶段日志定位并修复；若通过，再补写完整验收报告和最终版本状态。

## V5.3 阶段回顾与完成记录（2026-08-06）

本阶段继续遵循 V5 主路线：目标驱动、证据驱动、可恢复的自主智能体团队。V5.1 负责统一模型输出协议，V5.2 负责项目、任务、工作区和证据归属；V5.3 只解决真实团队执行链，不把“已通知成员”或模型文字声明当作完成。

### 本阶段完成

- `TaskService` 升级为版本 5，新增团队根任务绑定、固定成员责任任务绑定、团队执行事件和用户插话记录。
- 原生 Adapter 进入团队任务队列前，强制为根任务和每个固定成员步骤建立持久责任关系；责任任务是观察记录，不会被再次启动成重复工作。
- 每个固定成员步骤保存 `responsibilityTaskId` 和执行绑定信息，成员开始、完成、失败、暂停、等待用户和停止状态都会同步到责任任务。
- 工具调用、工具失败、结构化产物和验证证据同时写入团队根任务与对应成员责任任务；成员不再只有群消息，没有任务记录。
- 用户插话会记录原状态、受影响步骤、路由结果和是否抢占当前执行，便于恢复和回放时判断具体调整了什么。
- 团队绑定使用按根任务串行锁和幂等键，重复启动不会重复创建成员责任任务；成员快照写入前去除模型配置和凭证字段。

### V5.3 验证证据

- `npm.cmd run verify:v53-team-binding`：通过，覆盖根任务绑定、固定成员责任任务、重复绑定幂等、成员工具/产物证据和用户插话记录。
- `npm.cmd run verify:v52-project-context`：通过，V5.2 项目上下文门禁保持通过。
- `npm.cmd run test:run -- --reporter=dot`：通过，51 个测试文件、176 个测试通过。
- `npm.cmd run build`：通过。
- `npm.cmd run lint`：通过。

### 当前边界

- V5.3 已让团队责任和证据进入同一账本，但尚未完成客户端重启后的完整恢复回放、附件证据导出和跨聊天上下文隔离；这些进入 V5.4。
- V5.5 才使用真实项目端到端验证从组队、执行、插话、恢复、交付到最终验收的完整链路；在此之前不宣称 V5 完整可用。

### 下一阶段进入条件

- V5.4 方向固定为：恢复快照可重建、任务上下文按会话/项目隔离、附件随聊天记录和任务证据一并导出；不得用固定项目关键词增加专用通道。


正式陪跑报告：`docs/TAIJI_V5_LIVE_RUN_REPORT.md`。本文件与报告共同维护“自主智能体团队”最高目标；发布 V5 不代表两个 P0 运行时缺口已经修复。

## 本次 V5 安装与真实陪跑

- V5 发布源码提交：`74a5cba build: refresh v5 release evidence`，`package.json` 为 `5.0.0`，构建树已恢复干净；主分支随后补充了发布交接文档提交 `81054f2`。
- 已构建并覆盖本机旧客户端：`E:\AI办公会所\hermes-office-pro\太极 AI 办公会所.exe`，文件版本和产品版本均为 `5.0.0`。用户数据目录 `%APPDATA%\taiji-office` 保留。
- 构建验证：`npm.cmd run build`、`npm.cmd run lint`、`npm.cmd run test:run -- --reporter=dot`（48 个测试文件、167 个测试通过）、`npm.cmd run verify:v5` 均通过；发布前完整 `verify:v2-core-gate` 也已通过。
- 本机陪跑使用禁用 GPU 的客户端调试端口 `9336`，已确认 User-Agent 为 `taiji-office/5.0.0`。

### 陪跑项目一：科学计算器

请求：制作可运行的科学计算器，波普漫画风、黑白点状主体。

观察结果：新对话被创建，模型回复了完成说明，但客户端没有产生对应 `projectId`、`taskId`、结构化产物登记或可定位文件；按工作区和全盘检索也找不到它声称写入的 HTML。这个结果不能判定为完成，已保存于 `test-results/scientific-calculator-live/2026-08-05T22-32-40-831Z-draft.json`。

### 陪跑项目二：离线风险看板团队

请求：自主选择成员、创建隔离工作区和阶段计划，制作支持新增、筛选、优先级、JSON/Markdown 导出的离线风险看板，并完成运行验证。

观察结果：客户端创建了独立工作区元数据，例如 `%APPDATA%\taiji-office\workspace\tasks\assistant\default\run-1785970197006-gztag\.taiji-workspace.json`，但模型随后把 `<｜｜DSML｜｜tool_calls>` 原始文本直接显示在聊天中，没有转成 `list_files` 工具调用；没有生成团队提案、项目文档、产物或可执行任务记录。客户端随后回到可发送状态，属于“模型声称/输出工具格式但未执行”的失败现场。

陪跑脚本：`scripts/live-v5-team-project.mjs`、`scripts/monitor-v5-live-team.mjs`。这些脚本只用于记录真实运行证据，不向任务内核添加项目专用关键词。

## 真实陪跑结论

V5 的静态门禁和工作区隔离代码已存在，但真实客户端仍有两个 P0 缺口：

1. 普通助理入口在“直接写文件”路径上可能绕过结构化项目/任务登记，造成口头完成、无文件和无证据。
2. 当前 `deepseek-v4-flash` 返回的 DSML 工具调用没有被统一适配层解析，原始标签会进入聊天文本，导致任务停在“选择动作/单次回复”而不是执行工具。

下一轮应优先修复统一模型输出适配和普通助理入口的 TaskService/ProjectContext 接入，再重复这两个陪跑项目；在这两个现场通过前，不应把 V5 宣称为真实自主智能体团队完成版。不要用提示词或项目专用分支掩盖这两个内核问题。

## 当前交接动作

- `v5.0.0` GitHub Release 已发布：<https://github.com/TTflysky/sirenhuisuo/releases/tag/v5.0.0>。
- 发布提交：`74a5cbab6ae6f63ffee61f4e828c8e383d1b8a2e`；Windows 安装器已上传并完成远端大小/SHA-256 核对，当前本地安装器 SHA-256 为 `8C26D873173F98D1F2812BF89272B1EAFEE044C7CCFE17834569C3D85137328D`。
- 安装过程中仓库 `package.json` 曾被外部运行过程改回旧 `2.3.0` 内容，已核对并恢复为 `5.0.0`，未把该异常带入提交。
- 下次开始前先读本节、`AGENTS.md` 和 `docs/TAIJI_V5_AUTONOMOUS_AGENT_ROADMAP.md`，再从“统一工具调用解析 -> 任务/项目登记 -> 真实文件证据”顺序修复。

### 升级备份不再受 24MB 限制（本次同步修复）

- 旧版本在 `electron/autoUpdate.cjs` 中把全部 `hermes_office_*` 本地数据写成一个加密备份，并在原始 JSON 超过 24MB 时直接拒绝升级；因此可能出现“安装包已下载，但更新事务尚未创建备份就失败”的现象。
- 当前实现由 `electron/upgradeBackup.cjs` 统一负责备份序列化：先 gzip 压缩，再按最多 4MB 分片，随后每片使用 Electron `safeStorage` 加密写入；更新日志保存格式、片数、原始大小、压缩大小和 SHA-256 摘要。
- 恢复时按分片序号重组、校验 SHA-256 后解压 JSON；仍兼容旧版本的单文件加密备份。任一分片写入失败会清理本次已写入的分片，不留下半套备份。
- 发布门禁固定执行 `npm.cmd run verify:upgrade-backup`，并检查 `electron/upgradeBackup.cjs` 已纳入发布治理文件清单。以后不得重新引入单文件大小硬拒绝；若调整分片大小或格式，必须同时更新单元测试、恢复兼容和交接记录。

## V5.1 统一模型输出网关（本阶段已完成，尚未改版本号）

### 本阶段目标与边界

- 目标：修复模型输出了工具协议、客户端却把控制标记当普通聊天文字的问题；前端聊天流和 Electron 原生执行器必须经过同一套规范化逻辑。
- 非目标：本阶段不修改员工分工、团队调度、任务看板或某个模型的专用提示词；协议差异由通用网关处理。

### 已完成

- 新增 `src/engine/modelOutputGateway.mjs` 及类型声明：统一接收原生 `tool_calls`、渲染出的 DeepSeek DSML 标记和流式文本，输出规范化工具调用、清理后的公开文本和诊断结果。
- `src/engine/chatStream.mjs` 使用流式过滤器，控制标记不会进入用户可见文本；标记被拆在多个数据块时也会暂存并在收尾阶段清理。
- `src/data/hermesClient.ts` 和 `electron/nativeModelGateway.cjs` 接入同一网关；畸形工具协议会被阻止并进入有限重试路径，不再伪装成普通回答。
- `electron/nativeStepExecutor.cjs` 记录 `model_output_normalized` 诊断事件，保留协议来源、解析状态、错误和调用数量。

### 验证证据

- `npm.cmd run verify:model-output-gateway`：6 个测试通过，覆盖原生调用、DSML 标记、begin/sep/end 变体、畸形阻断、流式拆包和原生执行器接入。
- `npm.cmd run test:run -- --reporter=dot`：50 个测试文件、173 个测试通过。
- `npm.cmd run build`：通过。

### 进入 V5.2 前仍需验证

- 需要把所有普通助理的读、搜、写、运行、验证动作强制绑定到同一个 TaskService/ProjectContext 任务入口；V5.1 只保证模型输出能被正确解析，尚未解决普通助理绕过任务登记的问题。

## V5.2 项目上下文与证据归属（本阶段已完成，版本号待 V5.5 统一提升）

### 本阶段开始前回顾

- 总路线仍是“目标、证据、阻塞和用户插话驱动的自主智能体团队”，不是给单个项目增加固定流程。
- V5.1 已解决模型工具协议被当成聊天文本的问题；本阶段只处理项目、任务、工作区、产物和证据的统一归属。
- 非目标：本阶段不宣称已经完成真实团队协作、重启恢复或失败换路；这些分别留给 V5.3、V5.4 和 V5.5 验收。

### 已完成

- 普通助理和员工私聊创建 TaskService 任务前，会先建立或恢复同一 `projectId` 的项目目录和项目文档。
- 项目清单改为读取后合并：已有成员、预期产出和历史字段不会被后续执行回合的空值覆盖。
- TaskService 任务持久化 `projectId`；续作会从原任务继承 `projectId`、工作区、原目标和父任务关系。
- 每个聊天任务在 `projects/<projectId>/tasks/<taskId>.md` 留下任务记录；任务状态、阶段、下一步和已登记产物会更新回该记录。
- 产物登记和任务结束事件写入同一项目的 `events.jsonl`，与 TaskService 的工具尝试和验证记录保持项目归属一致。
- TaskService 上下文查询现在返回 `projectId` 和任务工作区，便于恢复时重新绑定正确项目。

### 验证证据

- `npm.cmd run verify:v52-project-context`：通过，覆盖静态契约和 V5.2 专项测试。
- V5.2 专项测试：3 个测试文件、13 个测试通过。
- 全量单元测试：51 个测试文件、176 个测试通过。
- `npm.cmd run build`：通过。

### 未完成与下一阶段

- 团队成员仍需要真实子任务、回应、超时和换人证据；进入 V5.3。
- 项目重启后的文档读取、任务恢复和新旧聊天隔离需要进入 V5.4。
- 科学计算器和离线风险看板的真实项目回放尚未重新验收；V5.5 前不得宣布 V5 完整可用。

# 当前 V5 交接（2026-08-05）

## 本轮目标

把应用升级入口从首页标题栏迁移到“设置 -> 诊断中心”，不改变已有 Electron 更新事务、加密备份、安装、升级后验证和回滚能力。同时建立可被后续会话读取的项目上下文，避免上下文折叠后忘记自主智能体团队这一最高目标。

## 已完成

- `src/App.tsx` 删除首页升级按钮、更新状态监听和升级操作，首页只保留版本号与设置入口。
- `src/components/settings/DiagnosticsTab.tsx` 增加应用更新面板：检查更新、下载进度、重启安装、失败重试、目标版本和真实提示。
- `electron/autoUpdate.cjs` 将更新状态广播给所有 Electron 窗口，并保存最近状态；设置窗口晚打开也能恢复启动阶段的更新进度。
- `electron/preload.cjs` 和 `src/electron.d.ts` 增加 `getUpdateStatus` IPC 合同。
- 更新门禁和聊天控制面测试已改为断言：首页无升级控件，诊断中心有升级控件。
- 根目录新增 `AGENTS.md`，规定每次开始先读取本交接和 V5 路线图，并锁定自主智能体而非固定工作流的产品边界。

## 验证证据

- `npm.cmd run build`：通过。
- `npm.cmd run lint`：通过。
- `npm.cmd run test:run -- --reporter=dot`：48 个测试文件、166 个测试通过。
- `node scripts/verify-update-control.mjs`：通过，确认升级控制只在诊断中心，状态可恢复并广播到所有窗口。

## 未完成与下一步

- 本轮只完成升级入口迁移，V5 的 GoalFrame、项目文档/工作区隔离、提案版本化、成员真实响应、动态目标图和阶段汇报仍需按 `docs/TAIJI_V5_AUTONOMOUS_AGENT_ROADMAP.md` 继续实现。
- 需要在 Electron 实机设置窗口验证：检查更新 -> 下载 -> 重启安装全链路，以及主窗口、设置窗口同时存在时状态不丢失。
- 后续每轮先回顾 `AGENTS.md`、本节和路线图，再开始改动；完成后继续更新本节，不把临时项目修复当作 V5 内核完成。

# 太极项目当前交接

## 当前版本：v4.0.0（2026-08-05；源码与门禁已完成，尚未创建 GitHub Release）

## v4.0.0 收口交接

- `src/engine/v4ReleaseReadiness.mjs` 与 `scripts/verify-v4-release-readiness.mjs` 固化 v4 发布清单：统一主持唯一入口、五类执行入口、迁移、健康、回滚和发布证据必须齐全。
- `electron/upgradeGovernance.cjs` 和 `electron/updateTransaction.cjs` 已把八个迁移域接入升级事务，安装后健康检查失败或回滚证据缺失时不会提交升级。
- `docs/sbom-v4.0.0.json`、`docs/release-provenance-v4.0.0.json` 已生成；`package.json`、`package-lock.json` 均为 `4.0.0`。
- 已通过 `verify:v316`、`verify:v317`、`verify:v318`、`verify:v4-release`、构建和 Lint。当前未配置代码签名，正式发布前需明确是否接受 SmartScreen warning。
- v4 源码尚未创建 GitHub Release，也没有上传安装包；这不是未完成代码，而是发布动作尚未执行。

### 每轮路线回顾

1. v3.16：事实账本、冲突证据、路线成功率和记忆时间衰减。
2. v3.17：统一主持唯一入口、能力矩阵和事实冲突处理入口。
3. v3.18：升级事务、八域迁移矩阵、健康检查和回滚治理。
4. v4.0：把以上能力收成发布清单和可审计证据，保持单一主持层，不新增平行调度器。

## v3.17.0 统一主持交接

- 新增 `src/engine/unifiedHost.mjs`：所有聊天、员工、团队、Worker 和后台任务共享同一主持请求合同；入口、目标、请求 ID 和能力预检随任务账本持久化。
- TaskService 新建任务保存 `hostEntrypoint`、`requiredCapabilities` 和 `capabilityMatrix`；有真实能力清单时才执行强制前置检查，旧任务不因历史缺字段而整体停摆。
- 原生 Worker 工具调用与 `src/engine/taskServiceBridge.ts` 均在 `autonomousExecutionGate` 后调用统一主持动作校验。
- `task-service:resolve-fact-conflict` 已贯通 TaskService、IPC、preload 和 `src/electron.d.ts`，冲突处理会写入服务事件，可被任务回放读取。
- 验证：`npm.cmd run verify:v317`、`npm.cmd run build`、`npm.cmd run lint` 通过。
- 下一步是 `v3.18` 的更新事务完整性与迁移/回滚治理；不要恢复旧 Autopilot 执行入口，也不要把能力判断散落到窗口组件。

## v3.16.0 事实与经验闭环（本轮）

- `src/engine/factLedger.mjs` 建立事实版本链：按 `factKey` 记录版本、来源、观察次数和证据 ID；不同陈述会生成冲突记录，不再静默覆盖旧事实。
- 冲突支持 `accept_latest`、`keep_previous`、`accept_both`、`dismiss` 四种处理；已验证证据冲突会让自主决策进入“等待用户确认”，未验证冲突先要求补证据。
- `SituationModel` 和任务详情接入事实账本摘要；任务回放可看到事实版本、未决冲突、旧值和新值。
- 执行控制器路线记录新增 `successRate`、`failureRate`、最近成功/失败时间，公开判断的“已尝试路线”显示 `成功率 + 成功/尝试次数`。
- Electron 分层记忆 schema 从 v2 迁移到 v3，新增按记忆类型配置的指数半衰期、`decayScore`、访问元数据；上下文排序会降低过时记忆的权重，迁移写入审计事件。
- 新增 `scripts/verify-v316-fact-route-decay.mjs` 与 `npm.cmd run verify:v316`，覆盖事实冲突、统一自主控制阻断、路线统计、记忆迁移和衰减。

### 本轮验证

- `npm.cmd run verify:v316`：通过。
- `npm.cmd run build`：通过。
- `npm.cmd run lint`：通过。
- `node scripts/verify-execution-controller.mjs`、`verify-layered-memory.cjs`、`verify-autonomous-control.mjs`：通过。
- 这次只更新源码和验证门禁，尚未上传 GitHub Release；下一步是 `v3.17` 统一主持唯一入口与第三方矩阵。

### 已完成

- v3.15.4 已补齐团队大厅与 Demo 的视觉一致性：Pop 网点、4px/3px 层级、硬阴影、卡片密度和空状态；Acid 深色网格与可读对比度同步。
- v3.15.3 补齐交互网页核心内容验收：可见性、数量和 Canvas 非空检查会阻止只有框架的产物完成；验收失败反馈会保留原目标并进入修复执行。
- 团队大厅恢复“新建团队”入口，标题区和空状态均可创建；Electron 独立窗口失败时回退到页内弹窗，回归门禁已覆盖入口可达性。
- v3.15.2 已发布：生产 Pop 主题与审核通过的 Demo 对齐，README 已加入最新 UI 快照并提供可更新安装包。

- 发布基线：`v3.14.1` 风格化 UI 已发布，三种风格、25 套配色、音效和快照可从 GitHub Release 更新。
- 长任务驻留：`src/engine/taskResidencyCheckpoint.mjs` 校验目标、计划、已完成步骤、证据、下一步、上下文和 Worker 序号；重启一致时自动恢复，冲突时暂停等待核对。
- 上下文一致性：Turn Lifecycle 的摘要、压缩次数、未决问题和用户插话进入驻留哈希；新任务默认建立 `recoveryContext`，旧任务领取时兼容补齐。
- 通用网页语义验收：`verify_web_artifact` 的 `semanticChecks` 支持分组、顺序、相邻、网格和交互契约；不包含计算器专用逻辑。
- 窗口层级：锁定助手或员工/团队聊天后使用系统级置顶，主窗口聚焦和窗口重建不再挤到后面；解锁恢复普通层级。
- 窗口控件：助手、员工私聊和团队聊天的标题栏按钮已与主界面统一为 `34 x 34px` 正方形，锁定/最小化/最大化/关闭不会再被标题栏拉成长方形。
- Demo 对齐：生产 Pop 主题现在与 `design-demos/pop-comic-ui/index.html` 和 `styles.css` 使用同一套可验收基准：全幅根布局、62px 标题栏、4px 主分界、3px 次级控件、34px 正方形按钮、16px/12px 圆角、网点背景、阴影和按钮层级。办公室、员工牌、聊天、团队、设置、诊断和弹层均已覆盖。
- 可读性与音效：酸性暗黑的记忆/诊断标签已提高对比度；互动音效面板按 Demo 结构支持 FC、Mac、街机、开关、80% 默认音量、滑杆和试听。
- 内核耐久验证：持续任务跨两个客户端会话恢复，连续检查点 `1 -> 5`，上下文压缩 `2` 次，用户插话 `2` 条均保留。

### 验证

- `npm.cmd run verify:v315`：通过。
- `npm.cmd run build`：通过。
- `npm.cmd run lint`：通过。
- `npm.cmd run verify:visual-system`：通过，覆盖 Demo 根布局、34px 控件、4px/3px 层级、3 套风格、25 套配色、音效面板和跨窗口视觉同步。
- 多窗口图形耐久测试 `verify:phase2-soak:smoke` 在本机图形驱动环境失败于 Electron 渲染进程 `launch-failed / exitCode 49`，不是任务内核断言；无界面内核耐久门禁已通过。

### 下一步计划

1. 需要对外发布时，先决定是否配置代码签名，再创建 `v4.0.0` GitHub Release；按当前约定不上传安装包，除非另行要求。
2. 发布前重新运行 `npm.cmd run verify:v4-release`，并把 Release URL、签名状态和资产清单写回本文件。
3. 后续问题按新的 v4 任务/缺陷记录处理，不回退到旧 Autopilot 或另起平行调度器。

### 踩过的坑

- 驻留检查点不能放在心跳分支刷新，否则心跳会伪造真实进展；现在只在领取、真实步骤检查点、暂停和继续时刷新。
- 仅检查网页能运行、无溢出和控件数量会漏掉数字键/导航等语义错位；必须由任务合同提供 `semanticChecks`。
- 本机 Electron 图形驱动会终止渲染进程；图形专项与无界面内核专项分开，不能因环境故障修改业务恢复判断。

## v3.14.1 风格化生产界面（2026-08-04）

- 当前源码版本为 `3.14.1`。已将定稿 Demo 迁移到生产客户端，提供原版商务、波普漫画和酸性暗黑三种风格、共 25 套配色。
- 主窗口、员工私聊、团队、设置和弹层使用同一视觉状态并跨窗口同步；新安装默认波普漫画，各风格独立记忆上次配色。
- 波普采用 4px 主边框、3px 次级边框；酸性暗黑隐藏员工工牌顶部挂带；原版商务保持原有轻量层级。
- 新增 FC、Mac、街机互动音效，默认开启、80% 音量，支持关闭、调节和试听。
- Vitest `159/159`、视觉专项、生产构建、Lint 与仓库卫生门禁通过。
- 报告与快照：`docs/TAIJI_VISUAL_SYSTEM_V3.14.1.md`、`docs/snapshots/v3.14.1-visual-system/`。发布完成后进入 `v3.15`，不重复返工 UI。

## 已登记：v3.15 通用语义验收缺口（2026-08-04）

- 用户验收发现科学计算器数字键排列错误。现有门禁虽然能通过运行、响应式边界和控件数量检查，但没有判断元素分组、顺序、邻接关系、网格坐标和交互流程是否符合目标。
- 根因样本：功能键与数字键共用五列自动网格，跨列等号触发自动换行，数字行整体右移。该样本用于证明验收能力缺失，不能据此添加计算器专用逻辑。
- 下一大版本必须增加任务合同驱动的 `semanticChecks`/布局契约，并扩展到导航顺序、表格列、表单字段和任务步骤。语义证据失败时不得完成，只重开责任实现与审查步骤。
- 本项已写入 `docs/TAIJI_V3_TO_V4_ROADMAP.md`，与 `v3.15` 长任务、跨重启和上下文恢复一起实施、测试和验收。

## v3.14.0 统一执行前自主授权（2026-08-04）

- 每轮开工前必须先阅读 `docs/TAIJI_V3_TO_V4_ROADMAP.md`，按已完成证据和未完成项继续，不能由临时问题改变主路线。
- 新增 `src/engine/autonomousExecutionGate.mjs`；工具动作必须绑定当前目标、计划版本、责任步骤、责任员工、工具名和已接受提案。
- 助理、员工私聊、团队成员、团队交接读取和原生后台执行器已接入同一门禁；原生执行真正调用工具前会先写入任务账本并校验。
- 过期计划、未满足依赖、错误责任员工、错误工具和未授权直调会被拒绝；没有新增关键词式业务分支。
- 已通过 Vitest `156/156`、原生执行专项、仓库卫生、模块边界、函数边界和生产构建。
- 阶段报告：`docs/TAIJI_STAGE_V3.14_PROGRESS.md`。下一步严格进入 `v3.15` 长任务、跨重启和上下文恢复验收。
- 尚未完成：正式 8 小时驻留、事实冲突/时间衰减、唯一主持入口、真实第三方矩阵、跨版本回滚与代码签名。

## v3.13.0 已发布：自主决策权与四类记忆（2026-08-04）

- 当前源码与本机安装版本均为 `3.13.0`；GitHub Release `v3.13.0` 已发布。
- 新增统一自主行动提案校验：助理、员工私聊和团队工具调用必须绑定当前目标、计划版本、责任步骤、工具和公开理由；过期计划、无效步骤和未满足依赖在执行前拒绝。
- TaskService 恢复、Agent Loop 收尾和团队自主决策已拆为独立模块；主 TaskService 约 477 行，最长函数约 180 行，模块与函数边界门禁通过。
- 聊天任务只有责任步骤完成、`verify_completion` 决策通过且完成门禁通过才关闭；证据不足保持等待，失败写回责任步骤。
- 分层记忆 schema 升级到 v2，增加情景、语义、程序和用户偏好四类。任务复盘只有“完成且有真实验证证据”才能自动形成程序记忆。
- 旧版任务经验缺少验收证据时迁移为情景记忆，不删除历史，也不冒充已验证流程。
- 内置章北海人格升级到 v26，所有活跃入口使用 `PERSONA_MIGRATION_APPENDIX_V26`。
- 完整门禁已通过：Vitest `152/152`、语义基准 `400/400`、阶段 A/B/3、完整 v2 核心门禁、生产构建、Lint、模块边界和函数边界。
- 安装器 `release/taiji-office-setup-3.13.0.exe` 为 `195896339` 字节，SHA-256 `D7690E007BABE8D4A685880BCFCE4B380AEEA68865E8C1303B85DA13287AE515`；Blockmap 为 `206822` 字节，SHA-256 `05662FE0E187322C529822C07197C3A3CFC7CBD97E27D6550B0375D584AC74BA`；`latest.yml` 为 `356` 字节，SHA-256 `3D1C081767DB288597C56814A499F2BA018B43D20F4159209A1AE209B2A0AEF5`。
- 已覆盖安装，产品版本 `3.13.0.0`、包内版本 `3.13.0`。覆盖前用户数据与备份均为 314 个文件、`222077920` 字节；备份为 `local-backups/preinstall-3.13.0-20260804-173527`。
- 安装包内模块已真实迁移 184 条记忆到 schema v2：情景 40、语义 82、程序 46、偏好 16；重启后 5 个客户端进程全部响应。
- 历史净化后的发布标签提交为 `d4f0387e13f2273eea9a86a2bd71aa3e57104c44`；标签和三项 Release 资产的大小与 SHA-256 已通过核验。Release：`https://github.com/TTflysky/sirenhuisuo/releases/tag/v3.13.0`。
- 2026-08-04 已从全部 Git 历史和标签中清除旧 `release/` 构建资产。安装器、Blockmap 与 `latest.yml` 只发布到 GitHub Releases；旧文档里的历史提交短哈希不再作为版本定位依据。
- 阶段报告：`docs/TAIJI_STAGE_V3.13_PROGRESS.md`；差距矩阵：`docs/TAIJI_STAGE_V3.13_GAP_MATRIX.md`。
- 尚未完成并不得冒充：正式 8 小时驻留、真实第三方账号矩阵、代码签名、`createWindow` 继续拆分和 v4.0 唯一自主主持入口。

## v3.12.0 已发布：窗口边界、DeepSeek 兼容与仓库治理（2026-08-04）

- 当前源码与本机安装版本均为 `3.12.0`；GitHub Release `v3.12.0` 已发布，历史净化后的标签对应提交 `e5a00f3468035209af7dd57c84c05a771d199ce3`。
- 新增 `windowRegistry.cjs`、`windowIpc.cjs` 与 `taskServiceIpc.cjs`，窗口登记、窗口 IPC 和 24 个 TaskService IPC 命令已从 `main.cjs` 抽出；`createWindow` 最长函数从约 786 行降至 593 行。
- 修复 DeepSeek 思考模式工具续轮 400：普通 Agent Loop、流式响应和原生团队/Coding 执行都会保留模型返回的 `reasoning_content`，并在提交工具结果后的下一轮原样带回；空字符串字段也不会被错误删除。
- TaskService 已拆出查询、上下文、证据、审批和生命周期模块；主文件 581 行，最长 `createTaskService` 285 行。
- 新增前端与原生消息兼容模块和回归测试。当前 Vitest `139/139`、生产构建、Lint、400 条语义基准和完整 `verify:v2-core-gate` 通过。
- 旧门禁已同步为检查 `taskServiceIpc.cjs` 中的生命周期注册和 `main.cjs` 的统一装配，不允许为了测试把命令重新塞回主进程大函数。
- 内置章北海人格已升级到 v25；README、阶段报告和 GitHub 整改报告加入真实办公室与项目验收快照。
- 仓库补齐 MIT License、忽略规则、包元数据和强化后的 GitHub Actions 发布门禁。历史安装包使 Git pack 约为 `319.36 MiB`，历史重写延期到项目收尾统一执行。
- 安装器 `release/taiji-office-setup-3.12.0.exe` 为 `195887469` 字节，SHA-256 `40AA6B9F7182C4C9EA004B4EC5E2C1674116ACD1228AEF8DA75E9A083F658275`；Blockmap 和 `latest.yml` 均已生成并核验。
- 已覆盖安装到 `%LOCALAPPDATA%\Programs\taiji-office`，产品版本 `3.12.0.0`、包内版本 `3.12.0`，启动存活正常。覆盖前后用户数据均为 320 个文件、`477263942` 字节；备份位于 `local-backups/preinstall-3.12.0-20260804-160237`。
- GitHub 远端已核对 `main`、标签、安装器、Blockmap 和 `latest.yml` 的大小与 SHA-256；Release 地址为 `https://github.com/TTflysky/sirenhuisuo/releases/tag/v3.12.0`。
- 仓库 Description、Homepage 和 Topics 已同步；公开首页现在能够直接说明产品定位并进入最新下载。
- 下一步继续拆步骤失败/审查返工/自适应恢复、Agent Loop 工具周期和窗口构造协调。

## v3.11.0 核心职责拆分与结构防回流（2026-08-04）

- 当前源码版本为 `3.11.0`，承接 v3.7 自适应计划，连续完成 v3.8-v3.11 四轮核心模块拆分；未回退已有动态计划、执行证据、团队恢复或 UI 能力。
- `nativeExecutionAdapter` 已拆出控制面和步骤执行器；`hermesClient` 已拆出 Agent Loop；`store.tsx` 已拆出办公室命令、任务控制、团队消息和团队讨论运行时。
- v3.11 新增 `agentLoopPolicy.ts`、`teamWorkerLease.ts`、`teamRunFinalization.ts`，分别负责固定来源与失败策略、Worker 租约/心跳/检查点、按交付类型最终验收。
- 新增 `verify:function-boundaries`，与 `verify:module-boundaries` 同时进入 v2 核心门禁。当前最长函数仍是 `main.cjs:createWindow` 786 行、`taskService:createTaskService` 676 行、Agent Loop 850 行和团队 Runtime 560 行，已被锁定为下一轮拆分债务，不能继续增长。
- 内置章北海人格为 v24。所有入口使用 `PERSONA_MIGRATION_APPENDIX_V24`，旧自定义人格只追加缺失协议，不覆盖用户原文。
- 标准测试 `125/125`、生产构建、模块边界和函数边界已通过。Windows 安装包为 `release/taiji-office-setup-3.11.0.exe`，大小 `195887039` 字节，SHA-256 `05C7DFF7A4C2C23708F629B8FEF07863F6A88C34726B3E597538F1C8A51483C2`。
- 已覆盖安装到 `%LOCALAPPDATA%\Programs\taiji-office`，实际产品版本 `3.11.0.0`，桌面快捷方式已更新；用户数据文件覆盖前后均为 314 个。精简备份位于 `local-backups/preinstall-3.11.0-20260804-113614`，包含 263 个配置、记忆、任务和工作区文件。
- 安装版真实项目任务 `installed-v311-1785816224289` 完成，计划修订 3 次；第一次 375px 验收失败后保留 `brief`，切换到 `installed-risk-board-verification-v1`，补入响应式专家，构建和审查各执行 2 次，6 次模型调用后进入 `completed`。
- 差异矩阵：`docs/TAIJI_STAGE_V3.8_TO_V3.11_GAP_MATRIX.md`；自评：`docs/SELF_EVALUATION_v3.11.0.md`；真实项目：`docs/REAL_PROJECT_ACCEPTANCE_v3.11.0.md`。

## v3.6.1 真实项目闭环与窄屏验收（2026-08-04）

- 本轮使用真实任务“制作可使用的科学计算器，波普漫画风、黑白点状主体”验收自主智能体链路，不增加计算器关键词或专用执行分支。
- 第一轮实际产物可运行，但太极因命令参数别名、重复大文件上下文、缺失工作区事实和账本收尾阻塞而误报失败；18 轮约消耗 `554,097` Token。
- 通用修复覆盖 `cmd/command` 路线键、成功写入历史压缩、TaskService 工作区与执行状态、实时 artifact/工具证据、250ms 心跳合并和大账本延迟检查点。第二轮缩短到 6 个工具动作、约 `154,952` Token，任务正确进入 `completed`，功能交互全部通过。
- 用户截图继续暴露窄屏视觉验收盲区：Electron `innerWidth=375`，但垂直滚动条占位后 `clientWidth=360`；主卡片和 5px 外阴影进入右侧安全区。旧脚本因此误报通过。现统一按 `min(documentElement.clientWidth, visualViewport.width)` 判断真实边界，并检查边框、阴影、父级裁切和至少 8px 安全间距。
- 网页完成门禁现在要求同一验收调用同时覆盖桌面与窄屏；只有单视口的成功结果不能完成。桌面与窄屏均通过后，执行控制器立即按原目标交付，不再继续读文件或另找浏览器。
- 最终安装版第三轮续作以 11 个工具动作、约 `165,524` Token 完成，任务 `task-1785778780340-8d6f6079` 状态为 `completed`。真实验收确认 33 个控件，桌面与 375px 无运行错误、横向滚动、元素裁切或边框/外阴影安全区问题。
- 当前源码版本为 `3.6.1`。Vitest `112/112`、Lint、TypeScript/Vite 构建和 `verify:agent-kernel` 已通过；完整发布门禁仍须在提交前重跑并记录最终结果。
- 本机覆盖验收包 `release/taiji-office-setup-3.6.1.exe` 为 `195877927` 字节，SHA-256 `9F831EA55272E94B4ADBBF6AE5F78812CCCB1FCDDE60F6E510F5F306C1A2E28A`；Blockmap SHA-256 为 `2871231CDE356EC6A59AC3350A75867AD5939F5722E1D32C2AA96C3F9A9FBEE7`，`latest.yml` SHA-256 为 `550DBFDD106729096582CB37051EF0B38C9972EDCB72E0391592C2BD8750BA4D`。已覆盖安装到 `%LOCALAPPDATA%\Programs\taiji-office`，并从安装后的 `app.asar` 核对版本 `3.6.1` 及收尾代码标记；覆盖前备份为 `L:\AI办公室\taiji-backups\preinstall-3.6.1-20260804-013718`。
- 真实复测时曾被 01:22 启动的旧 `v3.6.1` 进程截获。以后同版本覆盖必须先退出旧 Electron 进程，再核对安装后 `app.asar` 的时间与代码标记，不能只看版本角标。
- 功能提交 `c7b8cef` 与标签已推送，[GitHub Release v3.6.1](https://github.com/TTflysky/sirenhuisuo/releases/tag/v3.6.1) 已由 Actions `30842774363` 发布。官方安装包为 `195875991` 字节，SHA-256 `5ADFECC43B44392BCB27854D46B547A3BF699EA8CF5DD5D11BFFA56D7DF1425F`；Blockmap 为 `207260` 字节、SHA-256 `56EF9E46B6783ABE94C23949ADCB5F4C507A32AFE81B1979F8405430E0B28B5F`；`latest.yml` 为 `353` 字节、SHA-256 `29FF5DB40778B310E0BC79379910BD379BC670832A21C9771356B50E8ACF476B`。
- 详细证据见 `docs/REAL_PROJECT_ACCEPTANCE_v3.6.1.md`。下一阶段仍按 `docs/TAIJI_AUTONOMOUS_AGENT_ARCHITECTURE.md` 推进，不允许退回固定工作流或关键词补丁。

## 产品方向锁定：自主智能体优先（2026-08-03）

- 后续核心升级必须先阅读 [`docs/TAIJI_AUTONOMOUS_AGENT_ARCHITECTURE.md`](docs/TAIJI_AUTONOMOUS_AGENT_ARCHITECTURE.md)。该文档是 `v3.6.0` 到 `v4.0.0` 的最高产品与架构约束。
- 太极的目标不是“智能体驱动的固定工作流”，而是目标驱动、能够观察、行动、验证、反思、重规划和主持团队的自主智能体平台。工作流只能作为可修改的执行载体。
- 当前工作区、账本、权限、工具、证据、审查和恢复能力继续保留；固定 Coding DAG、关键词调度和步骤预算必须逐步降级，不能继续承担大脑职责。
- 所有后续改动都要用报告中的防跑偏清单与十个真实场景验收。提示词加长、单点关键词补丁或增加固定分支不能算自主内核升级。

## v3.6.0 自主控制内核影子模式（2026-08-03）

- 当前源码版本为 `3.6.0`。本版新增 `src/engine/autonomousControl.mjs`，正式定义 `GoalState`、`SituationModel`、`DecisionRecord` 和 `AutonomousControlSnapshot`。
- 控制协议为 `observe -> interpret -> propose -> validate -> act -> verify -> reflect`。本版 `mode=shadow`：现有执行器继续执行，新内核只记录它建议的下一步，不能把本版描述为已经完成执行权迁移。
- `createTaskRun()` 与渲染端 `updateTaskRun()` 会立即校准控制快照；`taskRuntimeStore.write()`、`updateTask()`、恢复点还原和旧账本初始化使用同一入口，覆盖助理、员工、团队和后台恢复。
- `goalId/projectId/conversationId` 跨重启稳定。用户纠正与约束从结构化任务上下文进入同一目标并按事件 ID 去重；`queue_separately` 的独立目标不会合并进当前项目。
- `SituationModel` 只把 `verified=true` 的证据和已通过验收写为事实，未验证结果进入假设。工作区、成员、步骤、证据和恢复数据迁移前后必须原样保留。
- 相同失败路线达到两次且没有成功时，公开决策建议 `switch_route`。这只是影子建议；`v3.7.0` 才会建设可修订计划图、失败归因和实际换路控制。
- 团队任务详情与项目详情已显示公开“自主判断”：下一步、原因、阻塞、事实、已尝试路线和预期证据。禁止在此字段或其他日志保存隐藏思维链。
- 回归入口：`npm.cmd run verify:autonomous-control`。已通过全量 `96/96` 单测、`verify:task-runtime-store`、完整 `verify:v2-core-gate`、模块边界、Lint 与生产构建。
- 下一步用真实任务同时观察旧执行路线与影子判断，记录偏差样本；通过后进入 `v3.7.0` 动态计划与自主恢复，不能提前让影子建议直接执行危险动作。
- `v3.6.0` 安装包已生成并通过包内校验：`release/taiji-office-setup-3.6.0.exe`，大小 `195873370` 字节，SHA-256 `3EDA068868A5F8FE67B1CAAEE327D9F99F8E3CF8F838B704FE8B93F2AF2DFB53`。已覆盖安装到 `%LOCALAPPDATA%\Programs\taiji-office`，并从已安装 `app.asar` 读取确认版本为 `3.6.0`；覆盖前数据备份位于 `L:\AI办公室\taiji-backups\preinstall-3.6.0-20260803-2316`。

## v3.5.8 Windows 黑屏恢复（2026-08-02）

- 当前源码版本为 `3.5.8`。本轮承接 `v3.5.7` 的工作区事实校正，并修复本机安装版 Electron 进程存活但窗口纯黑的问题。
- 实机诊断已经证明 `dist/index.html`、React 根节点、办公室员工数据和助理聊天内容均已完整加载；普通硬件合成画面纯黑，使用 `app.disableHardwareAcceleration()` 后 CDP 截图可正常看到界面，因此故障位于 Windows GPU 合成层，不是业务数据或前端页面损坏。
- `electron/renderingPolicy.cjs` 统一管理渲染策略、窗口加载诊断和显示时机。Windows 默认软件渲染；设置 `TAIJI_FORCE_HARDWARE_ACCELERATION=1` 才会显式恢复硬件加速用于排障。
- 主窗口、助理、员工私聊、团队聊天、设置和独立工具窗口都在内容加载后再显示，并统一记录 `did-fail-load`、`render-process-gone`、`unresponsive` 和严重控制台错误。十秒未收到正常显示事件时会触发兜底，不再只有后台进程而没有可见窗口。
- 新增 `test/unit/renderingPolicy.test.mjs`，覆盖 Windows 默认策略、显式硬件覆盖、只显示一次和错误日志。全量门禁、Windows 打包、覆盖安装和真实安装版 CDP 页面检查已经完成。
- `v3.5.8` 实机新建手机生图 APP 项目时发现员工迁移数据中的宽泛 `ui_ux` 标签会提前覆盖 UI 岗位。能力图现要求协调、架构、UI、前端、后端和 QA 在存在专业员工时由稳定姓名/职位身份覆盖；项目经理和相邻工程师可保留辅助标签，但不能阻止真正的 UI 设计师入队。
- 实机团队名单修正为六人后又发现 Coding DAG 自己按宽泛标签重选负责人，导致系统架构师抢占 Product brief、UX/UI design 和 Delivery。`codingProject.mjs` 现复用能力图统一负责人选择器；实际六人污染标签回归固定八步归属为实验追踪员、系统架构师、UI 设计师、前端开发者、后端架构师、审查者、审查者、实验追踪员。
- 第二次实机重建确认负责人正确，但 Product brief 在成功 `submit_review(PASS)` 后仍持续请求模型，并通过四次动态委派把八步扩成十二步。现对固定 Coding DAG 隐藏并拒绝动态委派，结构化结论在正式审查步骤成为明确终止信号；普通非 Coding DAG 任务仍保留动态委派能力。
- 第三次实机重建中八步和负责人稳定，Product、Architecture、UX/UI 正常完成，且已真实产出 `DESIGN.md`、`index.html`、`styles.css`、`app.js` 和成功 `node --check` 证据；随后发现前端普通步骤仍能误用 `submit_review`。现审查工具只对 `kind=review` 的正式审查步骤注册，普通步骤必须按自身交付类型收口。
- 同一实机流程发现新聊天会同时显示旧会话和当前会话的待批准卡。`ProjectApprovalCard`、当前项目解析和驳回草案恢复现统一按 `conversationId` 隔离；无会话字段的历史项目只属于 `conversation-legacy-assistant`，不能污染新聊天。
- 文件步骤只要已经有真实落盘文件和成功运行命令，就按证据完成；到达 24 次工具预算时也会停止重复调用并收口。长文件步骤只有在已有真实进展时才获得有限收尾轮次，模型请求与恢复逻辑已抽到 `electron/nativeModelGateway.cjs`，Adapter 仍低于 2150 行门禁。
- 动态复审统一为 `decision` 类型，正式 `review` 步骤提交 `PASS/REJECT` 后立即结束。主进程第一次账本同步前不会自动恢复项目，避免用未完成同步的旧状态启动任务。
- 真实项目 `run-1785617297693-za7fs` 位于 `%APPDATA%/taiji-office/workspace/tasks/team/team-project-1785617222061-3sb5q/run-run-1785617297693-za7fs`。已完成产品、架构、UX/UI、前后端、验证、首次审查和第一次修订，真实产出 18 项；系统自主改用本机 Chrome 完成 390px 视口、Mock 生图、刷新持久化和横向溢出验证，并正确退回图生图、设置持久化和证据不完整问题。
- 该项目最终复审因上游模型连续返回 `HTTP 502: Upstream service temporarily unavailable` 暂停，不能写成已验收。服务恢复后在仓库运行 `node scripts/resume-native-run-authoritative.mjs run-1785617297693-za7fs`；现场和产出物仍在，Delivery 尚未执行。
- `v3.5.8` 安装包已覆盖本机旧版，覆盖前用户数据备份位于 `L:\AI办公室\taiji-backups\preinstall-3.5.8-20260802-0632`。发布资产、GitHub 提交和 Release 需以本交接后续记录为准。

## v3.5.7 工作区能力事实校正（2026-08-02）

- 当前源码版本为 `3.5.7`。项目正在 Stage F 真实项目验收阶段；Stage E 工程链已完成，但真实旧版升级、故障回滚和代码签名仍保留为实机未验收项。
- 章北海现在从父子任务链读取真实工作区。工作区存在且仍有未完成步骤时，错误的“没有写入/运行入口”回复会被确定性事实校正，不再依赖模型是否听从提示词。
- 原生 Worker、备用团队执行器和主持层使用同一条能力事实：未产出文件不等于没有入口，必须实际调用工具；失败时展示真实工具错误、责任步骤和恢复方式。
- 回归覆盖错误回复拦截、正确回复保留、无工作区不虚构、子任务继承父项目工作区、原生执行和会话隔离。

## v3.5.6 软件项目恢复与真实交付（2026-08-02）

- 当前源码版本为 `3.5.6`。本版针对任务回放中“UX 阶段暂停后无法进入原型实现、助手误报没有工作区入口、最终只有文字没有代码文件”的完整链路修复。
- 自然语言“继续”“立即进入原型实现阶段”会在确有可恢复项目时回到同一项目根；否定句和无任务时的普通对话不会被误判。
- 原生子任务恢复顺序已改为先更新持久化状态、再入内存队列，消除 `awaiting_user` 状态领取执行租约失败的竞态。
- 软件项目必须交付真实项目文件、磁盘回读结果、运行或测试证据和最终路径清单。工作区存在且仍有实现步骤时，助理不得再声称没有写入/运行入口。
- 重点验证：`verify:context-router`、`verify:native-execution`、`verify:task-service`、`verify:coding-project-v2`、`verify:task-decision-pipeline`、`verify:child-task-dispatch`、Lint 与生产构建。

## v3.3.0 团队主持与阶段交接（2026-08-01）

- 当前源码版本为 `3.3.0`。本版统一解决团队聊天流水杂乱、阶段结果不可读、用户插话缺少主持、授权含义不清和同项目补充要求产生平行任务的问题。
- `electron/nativeCollaborationProtocol.cjs` 是原生执行路径的阶段总结与授权合同边界；`src/engine/teamStageHandoff.ts`、`teamSupervisor.ts` 和 `teamControl.ts` 是渲染层协议与控制边界。界面不得重新从自由文本猜阶段或授权含义。
- 阶段总结固定包含问题、理由、完成项、证据、剩余项、下一负责人、下一动作和耗时，底层操作默认折叠。审查退回只重开责任步骤，并明确责任人和复审动作。
- 未点名员工时章北海作为常驻主助理优先响应；澄清阶段可继续沟通但不得启动员工工具。用户插话按询问、纠正、补充约束、暂停、继续或新目标判断，同项目继续继承根任务、工作区、附件和证据。
- 授权批准/拒绝通过 IPC 回写原卡；拒绝动作会持久记录，禁止原样重复申请。聊天导出保存阶段总结、授权决定、附件和折叠执行过程。
- 内置人格为 v22；总设置和独立助理设置均使用 v22 迁移附录。自评见 `docs/SELF_EVALUATION_v3.3.0.md`，差异矩阵见 `docs/TAIJI_STAGE_D_V3.3_GAP_MATRIX.md`。
- 标准测试 `68/68`、语义基准 `400/400`、完整 v2 核心门禁、阶段三治理、Lint、TypeScript、生产构建与包内验收通过。安装包为 `release/taiji-office-setup-3.3.0.exe`，大小 `195851435` 字节，SHA-256 `8C963B1051A5151A433DE81BEF41973E89A51B9E8D62CBF82EFB83037A7CB601`；Blockmap SHA-256 为 `B5C0D5A38E1821D05812E81E4A2841B8A6919E2D185E58BD84BA9C6EB0A1FCD5`，`latest.yml` SHA-256 为 `A7C0873ED006F6F1BBA8ACD7535733362853742052B1BD59C918873A9DDBCA30`。
- 真实多人项目、正式 8 小时驻留和跨版本故障回滚仍需后续实机验收，不得由本轮自动门禁冒充。

## v3.2.1 上下文连续性补丁交接（2026-08-01）

- 当前源码版本为 `3.2.1`。这是 `v3.2.0` 阶段 C 后的本地补丁，不提交、不推送 Git，也不覆盖本机安装。
- `conversationReferences.mjs` 只在真实资源动作中解析 Skill、文件和网页；普通上下文表达不再触发“存在多个对象”的澄清。
- `conversationDispatchContext.mjs` 从最近对话恢复原始目标和最近团队方案；团队审批可使用完整能力重新匹配成员，并能原子恢复刚被驳回的草案。
- 助理正式上下文为最近 40 条实质对话，任务决策输入保留最近 24 条、内核结构化窗口保留 20 条；员工私聊同步扩大到 40 条。
- 三类聊天导出均携带附件元数据和路径；员工私聊用户消息已补齐附件实体保存。图片不嵌入 Base64，文本只附有限预览。
- 标准测试 `65/65`、400 条语义基准 `400/400`、V2 核心门禁、生产构建与 Lint 均通过。
- 安装包 `release/taiji-office-setup-3.2.1.exe` 为 `195847308` 字节，SHA-256 `2C871138D5D92017D5193683029035890C7A63D40D0A71CE4DEC2C0C6E4CE507`；Blockmap 为 `205534` 字节，SHA-256 `BE173BF0EFB7F654F3CBDCF4610D6E8311350C37CA6CB723ABA7A7635BF01E74`；`latest.yml` 为 `353` 字节，SHA-256 `90D033D14B89A310DC42DE388F04A3BD6FAF0FCD47A43F310C490577398901D6`。

## v3.2.0 阶段 C 交接（2026-08-01）

- 当前源码版本为 `3.2.0`。本阶段只构建本地客户端，不提交、不推送 Git，也不覆盖本机安装；后续大版本统一发布。
- 项目看板增加负责人、证据、耗时、等待条件、下一步和责任返工范围；恢复和子任务保持在同一项目卡片。
- 本地状态持久化、员工运行状态投影、原生任务公开投影已从三个核心大模块抽离，主渲染包从约 5.14 MB 降到约 0.81 MB，下降 84.1%，原有 5 条无效动态导入警告清零。
- 320 员工、12000 事件、40 项目/3200 步骤压力门禁通过；真实桌面 12 窗口短驻留堆增长 0.15 MB。正式 8 小时驻留未执行。
- 内置章北海人格为 v21，所有入口统一使用完整阶段 A/B/C 迁移附录。
- `verify:v2-core-gate`、`verify:phase3`、`verify:phase-c`、Lint 和包内验收均通过。安装包 `release/taiji-office-setup-3.2.0.exe` 为 `195846389` 字节，SHA-256 `32266E279020CB74F6284D7A8F37853C56D3B3CFA95EDB88A06E17F0BE0A4BE0`；Blockmap 为 `206117` 字节，SHA-256 `8129C43B6631521D913917BDDEE2A9A7946048F1E2216A4E363E94D03DEE5E5B`；`latest.yml` 为 `353` 字节，SHA-256 `EF155F850513B6259E10AC6BF0DD482AE8FB1EDB43822E7BC1C83B0ED368F9CF`。
- 自评与差异矩阵：`docs/SELF_EVALUATION_v3.2.0.md`、`docs/TAIJI_STAGE_C_V3.2_GAP_MATRIX.md`。下一阶段 D 做真实旧版升级、迁移、故障注入、回滚和签名评估。

## v3.1.0 阶段 B 交接（2026-08-01）

- 当前源码版本为 `3.1.0`，主分支为 `main`。阶段 B 安装包 `release/taiji-office-setup-3.1.0.exe` 已生成并通过包内验收，尚未安装或发布。
- 诊断中心现在覆盖聊天模型、图片生成、指定网页、SkillHub、知识库、邮件、GitHub、HTTP 和 MCP 九类能力，并区分八种真实状态。保存配置、发现工具和安装 Skill 均不能把能力标记为可用。
- Skill 证据协议升级到五段：发现、读取规则、真实调用、产出、验收。助手、员工私聊和团队任务共用同一协议；安装成功不再等于调用成功。
- 内置章北海人格为 v20，旧自定义人格增量追加阶段 A/B 协议。标准测试 `57/57`，阶段 A/B、v2 核心和阶段三发布治理门禁通过。
- 尚未验收：用户真实第三方账号矩阵、邮件/GitHub 写操作、正式 8 小时驻留、代码签名、真实跨版本回滚和远端 Release。详细限制见 `docs/SELF_EVALUATION_v3.1.0.md`，差异见 `docs/TAIJI_STAGE_B_V3.1_GAP_MATRIX.md`。

## v2.9.5 可用性修复交接（2026-08-01）

- 当前源码版本为 `2.9.5`，主分支为 `main`。这是在 `v2.9.4` 发布治理基础上的补丁发布，不回滚或重写前三阶段架构。
- HTTP 5xx 和 `Service temporarily unavailable` 已被统一归类为可恢复的 `server` 故障；最终提示是稍后继续执行，不再把上游暂时不可用说成模型配置错误。
- 诊断优化只可使用聊天模型，头像生图只可使用图片模型；设置页和运行时都执行该能力约束。
- 模型故障提示已抽离到 `src/engine/modelFailurePresentation.mjs`，类型声明位于同目录 `.d.mts`；不要将展示字符串重新塞回 `hermesClient.ts`。
- 本版自我评价：工程能力 87/100，真实生产可用性 76/100。详细报告为 `docs/SELF_EVALUATION_v2.9.5.md`；后续分期为 `docs/TAIJI_OPTIMIZATION_PLAN_V3.0_TO_V3.4.md`。
- 已完成：Lint、38 项测试、统一运行时、图片路由、确定性 Phase 2/3 门禁和 Windows 打包。尚未完成：本机覆盖（审批服务限流拦截）、正式 8 小时驻留、真实第三方账号矩阵、跨版本故障注入回滚、在线依赖审计。

## v2.9.4 第三阶段交接（2026-08-01）

- 当前源码版本已提升为 `2.9.4`，主分支仍为 `main`。第一阶段 `v2.7.4` 与第二阶段 `v2.8.4` 的代码和发布记录保持不变。
- 已完成模型/图片兼容矩阵（`src/engine/modelCompatibility.mjs`）、Skill Runtime（`electron/skillRuntime.cjs`）、safeStorage 凭据保险库（`electron/credentialVault.cjs`）、更新事务（`electron/updateTransaction.cjs`）和发布治理脚本（SBOM、provenance、敏感信息扫描）。
- 模型设置测试现在会保存兼容矩阵状态；图片模型按真实 `data[].b64_json/url` 验收。连接器 localStorage 只保存 `credentialRef`，真实调用前由 `hydrateConnectorCredentials()` 临时读取。
- `npm.cmd run verify:phase3` 已通过：模型矩阵、Skill Runtime、凭据保险库、更新事务、SBOM、来源证明和治理检查均通过；`npm.cmd run build`、`npm.cmd run lint` 通过，标准测试为 38 条。
- Windows 安装包已由 `npm.cmd run dist:win` 生成并通过 `npm.cmd run verify:package`：`release/taiji-office-setup-2.9.4.exe` 为 `195826975` 字节，SHA-256 `F1AFA846C979B1D90F4ED97BD9DDC977C1CF425A50BC60159599E81A7C2A41DE`；Blockmap 为 `206051` 字节，SHA-256 `9555F64DA5BAAC9CEC5D9F2707EE1D3BAF1D58052E1F4A78EC722DD829F40E8C`；`latest.yml` 为 `353` 字节，SHA-256 `FB18975C1FDF973C10F49450B1D7E82C36CAA7D485CDE9A19EE2C5BFA49FEEB5`。远端 GitHub Release 待发布脚本完成后核对。
- `npm.cmd run verify:phase3` 与 `npm.cmd run verify:v2-core-gate` 已通过；真实 Electron E2E 在本机仍被图形驱动进程终止（GPU exit `-1073741515`），不能把它写成通过。
- 尚未声称完成：正式 8 小时驻留、真实第三方账号连接器矩阵、从已发布旧版到 `2.9.4` 的真实故障注入回滚；GitHub Release 资产将在发布脚本完成后以远端 SHA-256 为准。
- 人格升级为 v18；评分更新在 `docs/自我评分.md`，阶段计划结果在 `docs/TAIJI_UPGRADE_PLAN_V2.7_TO_V3.0.md`，发布证明在 `docs/sbom-v2.9.4.json` 与 `docs/release-provenance-v2.9.4.json`。


## v2.8.4 第二阶段：长期执行与 Coding Runtime（2026-07-31，正式版本）

- 当前源码版本为 `2.8.4`，一次性收口升级计划中的 v2.8.0-v2.8.4。不要重新实现第一阶段资源合同、语义基准或状态边界。
- `src/engine/executionController.mjs` 已升级为 v2：失败分类、路线差异、结果指纹、无进展停止、模型/工具/时间/重试/Token 独立预算、检查点、证据和未决问题均为可恢复状态；v1 快照自动迁移。
- `src/engine/chatStream.mjs` 负责 SSE 正文和流式工具参数拼接。助手与员工私聊实时显示，团队事件在 UI 侧以 200ms 合并，不能退回每个心跳全量刷新。
- `electron/codingRuntime.cjs` 提供原子补丁、修改前恢复点、递归影响分析、测试选择、增量命令会话和带风险/回滚点的交付报告。`verify:coding-runtime-repositories` 已在三个独立 Git 仓库验证修改到交付闭环。
- `src/engine/codingProject.mjs` 按能力和负载选人，并为每个阶段保存工件合同。执行中补人、替换负责人和定向返工必须修改同一项目状态，不能从聊天文字重新猜团队。
- GPT Image 2 输出规格由 `imageSpecifications.mjs` 和 `ImageGenerationOptions.tsx` 统一管理，已接入助手、员工和团队：五种画幅、标准/2K/2.7K/4K、四档质量，界面显示解析后的实际像素。
- Electron 已锁定 `43.2.0`。`verify:phase2-electron-e2e` 已真实通过办公室、设置、助手、员工私聊、团队、新建聊天和暂停/继续；12 窗口冒烟驻留中节点/文档数稳定，堆内存增长 `0.15 MB`。
- 统一门禁 `verify:phase2` 已通过 35 条 Vitest、Lint、ExecutionController、Coding Runtime、三仓库、项目 DAG、真实 Electron E2E、12 窗口驻留冒烟和 Build。正式 8 小时门禁 `verify:phase2-soak:8h` 尚未执行，不得写成已通过。
- 人格版本为 v17。下一阶段从 v2.9.0 开始：模型/图片兼容矩阵、Skill Runtime、连接器/MCP 凭据安全、真实更新回滚和发布治理。
- 发布资产：`taiji-office-setup-2.8.4.exe` 为 `195822199` 字节，SHA-256 `5FC2E8E0922FF27E2108D1DD61710FA20959753FE7ED0E6E2EEBC97785B5BE3A`；Blockmap 为 `206372` 字节，SHA-256 `29DCD73E098A468E37660CE65FE0581BBFCBDAD2A0B23CC9856FC8393C9C58A6`；`latest.yml` 为 `353` 字节，SHA-256 `B5757498C34257334C080971BF1FB2DD6042E9BC475B1B4E62A59E2AA30442C8`。

## v2.7.4 第一阶段：工程内核标准化（2026-07-31，正式版本）

- 当前源码版本为 `2.7.4`。本阶段一次性收口升级计划中的 v2.7.0-v2.7.4，不把中间小版本分别发布。
- 标准测试入口为 `test:run` 与 `test:coverage`。目前 6 个测试文件、31 条标准测试全部通过；核心纯逻辑覆盖率为语句 90.44%、分支 75.73%、函数 89.69%、行 93.96%。`verify:phase1` 同时执行标准测试、架构边界和 200 条语义基准。
- `src/store/appStateReducer.ts` 只负责纯状态转换，`src/store/appStatePersistence.ts` 负责保存副作用；`store.tsx` 通过两者组合。`src/theme.css` 只导入 `core/collaboration/appearance/settings/workspace` 五个样式模块，顺序保持原样。
- `src/engine/resourceContract.mjs` 是网页、文件、附件、Skill、连接器、员工和任务的通用对象身份与证据合同；`explicitResourceContract.mjs` 仅保留兼容适配。模型可以决定如何处理，但不能改掉用户指定对象。
- `electron/resourceAcquisition.cjs` 按失败分类选择获取器，`browserPageReader.cjs` 使用隐藏、隔离、禁用 Node 的浏览器窗口读取动态正文。指定 URL 不得回退为主题搜索；404 不继续，其他失败保留每次尝试证据。
- `KNOWN-URL-001` 已真实联网验收：微信 URL 直连得到验证拦截，浏览器会话约 8 秒取得 1219 字正文，`unrelatedSearches=0`。验收脚本为 `verify:known-url-live`。
- 200 条语义轨迹准确率为 95%（190/200）。本轮同时修复“你刚才的回答……”被误当普通问题，以及“这个结果我不满意”可能继承旧任务执行权的问题。
- 内置人格为 v16，自定义人格按章节追加新协议，不覆盖用户原文。下一阶段从 v2.8.0 ExecutionController v2 开始；真实长驻 Electron、Coding Runtime v2、专业协作 v2 和跨版本回滚仍未完成。
- Windows 安装包为 `release/taiji-office-setup-2.7.4.exe`，大小 `175437030` 字节，SHA-256 为 `770A5A95C18B2F6ADD5A6DBBD7604730E006DED138473D946338E8C0FB6BA24F`；Blockmap 大小 `181343` 字节，SHA-256 为 `6E7DBDBAE0570E3D4DF771AA345F5424B683D8B477C4D38563458546331C243D`；`latest.yml` SHA-256 为 `0EFEA2F59001D66031F56E37261EA0D36433EA5946C6675076CB92CF1128CE1A`。
- 本机已覆盖安装并启动。安装目录 ASAR 为 `taiji-office 2.7.4`，Windows 产品版本为 `2.7.4.0`，启动后 5 个 Electron 进程正常驻留；用户数据目录覆盖前 264 个文件、停止时 263 个、启动后 265 个，差异来自运行时锁与会话文件，业务目录未清理。

## v2.6.2 阶段三：明确资源忠实与更新入口恢复（2026-07-31，正式版本）

- 当前源码版本为 `2.6.2`，基于已推送的 `v2.6.1`。安装包为 `release/taiji-office-setup-2.6.2.exe`，大小 `175439262` 字节，SHA-256 为 `DF421190A3F3A728F0D32724E0EB7BED8DEEDB572A81C236E8018994C8C777C0`。
- `src/engine/explicitResourceContract.mjs` 是明确网页对象的统一身份与证据边界。用户要求处理指定网页正文时，`taskDecisionKernel` 强制优先 `read_web_page`；章北海聊天循环和原生团队执行器都会拒绝 `web_search`、其他地址和无原地址成功读取证据的完成声明。
- 对话中的“这个链接”通过已有引用解析器把真实 `sourceUrl` 注入同一合同。上文失败不会覆盖本轮明确对象，已保存的 URL 不得再次向用户索要。
- `electron/knowledge.cjs` 会拒绝空正文、验证码、访问异常和拦截页，避免把反爬提示当成文章证据；读取器标识已从旧 Hermes 名称改为 Taiji。
- 自动更新入口现在始终可见。`idle/not-available/error` 可点击检查，`checking/available/downloading` 防重复点击，`downloaded` 触发备份后安装；主进程错误可见，45 秒无结果会变成可重试错误。
- 人格版本为 v15。专项回归为 `verify:explicit-resource-contract` 与 `verify:update-control`，均进入 `verify:v2-core-gate`。微信公众号示例 `https://mp.weixin.qq.com/s/6d_2gn2jK3lVTJaeookHkA` 已作为精确地址回归样例。
- `verify:v2-core-gate`、Build、Lint 与安装包 20 项必需文件检查均通过。本机安装目录已覆盖为 `2.6.2`，关键合同文件存在；覆盖前后用户数据文件均为 259 个，配置、员工、会话、任务和记忆未清理。
- 已知未解决问题 `KNOWN-URL-001`：微信公众号指定链接仍可能无法取得正文，执行器随后扩散到搜索、终端和文件检查。v2.6.2 只阻止替代网页和无证据完成声明，没有解决受限网页的可靠获取；本轮不再修改，统一纳入 `docs/TAIJI_UPGRADE_PLAN_V2.7_TO_V3.0.md` 的 v2.7.3 资源获取改造。

## v2.6.1 阶段三：图片编辑、记忆质量与性能基线（2026-07-31，本地开发版）

- 当前源码版本为 `2.6.1`，基于已发布并完成本机安装迁移验收的 `v2.6.0`。本版本只做本地源码和回归收口，尚未打包、安装或发布 GitHub Release。
- 图片模型链路已修正：`src/engine/imageRequest.mjs` 选择本轮真实图片、解码 data URL 并构造 multipart；`generateImage()` 有源图走 `/images/edits`，无源图走 `/images/generations`。助理、员工单聊、团队聊天都必须传入本轮附件，不能仅把图片显示在气泡里。
- 用户记忆质量已从 `hermesClient` 抽离到 `userMemoryQuality.mjs` 与 `userMemory.ts`。重复、替换、冲突、重要度容量、过期复核和可见修改原因由统一引擎处理；待复核记忆不注入模型上下文。
- `nativeExecutionPolicy.cjs` 从原生执行主循环抽出端点、交付类型、补偿审批、证据与父子任务交接判断；`eventFanout.mjs` 负责跨组件广播订阅并清理空频道。`verify:module-boundaries` 阻止这些职责回流到超大模块。
- 新增回归：`verify:image-model-routing`、`verify:user-memory-quality`、`verify:native-execution-policy`、`verify:module-boundaries`、`verify:phase3-performance`。性能基线覆盖 268 名专家、320 员工、12000 条任务事件与 12 窗口广播；以上均进入 `verify:v2-core-gate`。
- 内置章北海人格版本升至 v14。人格迁移已改为逐章节补齐，保留用户自定义内容，同时确保附件事实、图片编辑和记忆质量协议进入旧客户端。
- v2.6.1 自我评分更新为 `78/100`：团队任务、Coding Runtime、诊断、记忆质量和可验证交付是主要优势；标准测试体系、真实 Electron 长驻性能、外部兼容矩阵、Store/Theme 拆分和跨版本回滚演练是主要短板。详细证据与 88 分门槛见 `docs/自我评分.md`。
- 阶段三尚未完成：下一批继续拆分 `store.tsx` 与 `theme.css`，补真实 Electron 多窗口/长驻内存回归，并完成跨版本自动更新下载、迁移检查和回滚演练。不要把本地性能脚本冒充真实 Electron 长驻验收。

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

# v3.12.0 发布交接（2026-08-04）

- 源码与本机安装版均为 `v3.12.0`；GitHub Release 以顶部最新记录和远端资产核验为准。
- 已修复 DeepSeek thinking 模式续轮缺失 `reasoning_content` 的 `400 invalid_request`，覆盖普通聊天、员工、团队和 Coding Runtime。
- Electron 新增 `windowRegistry.cjs` 与 `windowIpc.cjs`；窗口 IPC 已移出 `createWindow`，并覆盖新开、复用、广播、锁定和销毁测试。
- TaskService 新增 `taskServiceIpc.cjs`、`taskServiceQueries.cjs`、`taskServiceContextQueries.cjs`、`taskServiceEvidenceCommands.cjs`、`taskServiceApprovalCommands.cjs` 与 `taskServiceLifecycleCommands.cjs`。
- `taskService.cjs` 当前 581 行，最长 `createTaskService` 285 行；模块和函数边界门禁已锁定，不得把职责搬回主文件。
- 编码任务统一进入 Git 工作树准备态并要求检查点、验证证据；权限、鉴权和计费错误进入等待用户，普通授权批准后重新排队。
- 完整核心门禁通过：Vitest `139/139`、语义基准 `400/400`、构建、Lint、原生执行、恢复、Skill、网页、图片、Coding、诊断和性能全部通过。
- 内置章北海人格为 v25；安装器、Blockmap、`latest.yml`、SBOM 和来源证明均已生成并通过门禁。
- 本机安装版产品版本和包内版本均为 `3.12.0`；320 个用户数据文件与覆盖前备份一致，启动存活正常。
- 下一批：拆步骤失败/审查返工/自适应恢复命令，拆 Agent Loop 工具周期与收尾，继续拆窗口构造协调。
- 详细进度见 `docs/TAIJI_STAGE_V3.12_PROGRESS.md`。
# v3.4.0 Stage E 发布交接（2026-08-01）

- 版本：`3.4.0`，完成发布、迁移、安全演练基础能力。
- 新增 `scripts/verify-stage-e.cjs`：升级迁移失败注入后回滚、凭据轮换/过期/最小权限审计。
- 新增 `scripts/verify-release-consistency.mjs`：版本、lockfile、README、CHANGELOG、handoff、SBOM、provenance 与核心模块一致性门禁。
- `electron/updateTransaction.cjs` 新增 `simulateFailure()` 与阶段失败注入；`electron/credentialVault.cjs` 新增 `expiresAt`、`scopes`、`rotate()`、`audit()`。
- 文档：`docs/TAIJI_STAGE_E_V3.4_GAP_MATRIX.md`、`docs/SELF_EVALUATION_v3.4.0.md`。
- 尚未冒充完成：真实旧版升级、断网/磁盘不足/强制退出回滚、Windows 代码签名和第三方账号矩阵仍需实机验证。
# v3.5.0 Stage F 发布交接（2026-08-01）

- 新增 `src/engine/projectDelivery.mjs`：项目成员职责、阶段依赖、审查退回、风险、变更和验收包。
- 新增 `scripts/verify-project-delivery.mjs`，覆盖阶段批准、变更记录和未决风险导出。
- 文档：`docs/TAIJI_STAGE_F_V3.5_GAP_MATRIX.md`、`docs/SELF_EVALUATION_v3.5.0.md`。
- 仍需真实项目验收：连续三个软件项目、多人协作依赖调度、Windows 签名与跨版本回滚。
# v3.5.1 修复交接

- 助手窗口订阅跨窗口后台活动，显示任务仍在后台运行的提示。
- 待处理请求绑定会话并缩短过期窗口，避免新聊天继承旧任务。
- 聊天消息支持基础 Markdown 标题、粗体、行内代码和段落渲染。
# v3.5.2 回放导出交接

- 项目面板新增“导出全部回放 MD”，合并当前团队会话内全部任务。
- 文件包含任务状态、阶段负责人、Worker、验收证据、交接、时间线和原始结构化回放。
# v3.5.3 实时过程面板交接

- 顶部实时过程支持展开/收起；收起后仅保留当前负责人和状态，后台任务继续执行。
# v3.5.4 任务确认交接

- 最新“是否继续/是否批准”消息显示为高亮确认卡并关联等待或排队任务。
- 点击确认卡会写入继续动作；普通插话继续使用现有 steering 队列重新评估同一任务。
# V5.0.0 当前交接（2026-08-05）

## 本轮结论

V5 的目标是把太极继续收拢为“目标驱动的自主智能体协作团队”，不是针对某个项目添加关键词特例，也不是把模型锁进固定工作流。本轮已完成核心边界的代码化，并将版本与长期上下文更新为 `5.0.0`。

## 已完成

- 每个新聊天会创建独立 `conversationId`、`conversationProjectId`、项目工作区和长期项目文档；项目目录包含 `project.md`、`project.json`、`conversations/`、`tasks/`、`artifacts/{final,working,reference,logs}/`、`evidence/` 和串行写入的 `events.jsonl`。
- 项目提案拥有 `proposalId` 和递增 `proposalRevision`。成员纠正会把旧提案标记为 `superseded`，生成新提案；审批必须匹配当前 revision，失效卡不可继续批准。
- 新团队建立后会在群聊中为每位成员发布职责、初步计划、依赖和风险；成员计划状态会随真实步骤变为 `working`、`submitted` 或 `blocked`。
- 团队助理 presence 由真实模型请求驱动：`queued`、`thinking`、`answering`、`error`、`idle`，群成员栏显示动态点和当前说明。
- 每个工作/审查阶段继续写入阶段总结；任务进入完成、暂停、停止或失败状态时发布一次项目级汇报，并同步到项目事件账本。
- 新增 `scripts/verify-v5-autonomous-agent.mjs` 和 `npm.cmd run verify:v5`，覆盖上述十项内核契约。

## 验证证据

- `npm.cmd run build`：通过。
- `npm.cmd run lint`：通过。
- `npm.cmd run test:run -- --reporter=dot`：48 个测试文件、166 个测试通过。
- `npm.cmd run verify:v5`：10 项 V5 内核门禁全部通过。
- Electron 多窗口实机图形 E2E 仍受本机图形驱动 `launch-failed / exitCode 49` 影响；这是已有环境故障，不能用业务代码绕过，需在图形环境正常的机器上做最终窗口验收。

## 发布状态

- `package.json` 与 `package-lock.json` 已同步为 `5.0.0`。
- 本轮不上传安装包；待源码和长期上下文提交后创建不带安装包的 GitHub Release。

## 后续边界

- 不恢复首页升级入口；更新仍只在“设置 -> 诊断中心”。
- 后续若继续深化，应优先把产物登记、成员回应超时/重试和跨重启项目文档读取接入同一事件账本，不能另起平行调度器。
# v5.10.1 发布完成（2026-08-08）

## 本轮结果

- 已将“新对话窗口在风格化主题下文字看不见”的问题修复并发布到 GitHub。
- 发布标签：`v5.10.1`
- GitHub Release：<https://github.com/TTflysky/sirenhuisuo/releases/tag/v5.10.1>
- 发布提交：`da396115c282eecaaf46ca2bd0da9b99e1d30b00`
- 安装包：`release/taiji-office-setup-5.10.1.exe`
- 安装包 SHA-256：`17630FB9046F589449D3933305E51D8A9FD9A0A546C65706FADC2B72F2CBF1DD`

## 已完成验证

- `npm.cmd run verify:visual-system`
- `npm.cmd run verify:runtime-observer-ui`
- `npm.cmd run verify:release-governance`
- `npm.cmd run lint`
- `npm.cmd run build`

## 关键改动

- `src/styles/runtime-observer.css`
- `src/styles/collaboration.css`
- `scripts/verify-visual-system.mjs`

## 备注

- 已完成 `git push`，远端 main 已更新。
- 这次发布重点是让团队聊天/新对话窗在深色主题下继续继承语义色，而不是回退到固定浅色纸面。
# v5.10.0 最小回归验证记录（2026-08-08）

## 本次简单任务

- 选用最小回归任务：`npm.cmd run verify:v510-deliverable-kernel`
- 目的：只验证 v5.10.0 的核心内核方向是否仍然成立，不扩大到全量发布门禁

## 结果

- 通过
- `rootTaskId`: `task-1786166571776-24621d3e`
- ready 节点：`client`、`api`
- 责任子任务：`task-1786166571795-5ba69eba`、`task-1786166571820-1d09302f`、`task-1786166571845-e7cba76f`
- 持久化合同版本：`1`

## 判断

- 这次最小任务说明 v5.10.0 的内核方向仍然有效：交付物可并行 ready、整合节点会等依赖、责任子任务和任务合同能持久化并在重启后恢复。
# 当前简短结论（2026-08-08）

## 已验证结论

- v5.10.0 的内核方向已经通过，最小回归 `verify:v510-deliverable-kernel` 也通过。
- v5.10.1 的主题可读性修复已经发布，说明这次修复方向有效。
- 目前没有必要重复观察 workbuddy 的工作过程；下一轮可以直接沿着已验证方向继续开发。

## 下一步最值得改的 3 个内核点

1. 继续扩展“交付物 → 能力 → 负责人 → 证据 → 整合”的合同链路，让更多真实任务都能走同一套内核，不再靠固定流程分支。
2. 加强任务服务与自适应计划的重启恢复、状态投影和证据持久化，确保任务在中断、恢复、重读后仍保持同一事实源。
3. 把最小回归门禁标准化成稳定的内核验证集合，优先保住并行 ready、依赖整合、责任子任务绑定、恢复一致性这四项核心能力。
# v5.10.1 本地内核合同与证据链强化（2026-08-08）

## 本阶段目标与非目标

- 目标：完成已确定的三项内核改造——扩展交付物合同链路、加强恢复/状态投影/证据持久化、标准化最小内核回归门禁。
- 非目标：不新增固定项目流程，不为单个任务增加关键词特例，不改版本号，不发布 GitHub。

## 已完成

1. 普通 TaskService 步骤现在也会自动获得完整任务合同；合同包含输入证据引用、输出类型与路径、完成条件、验证方式、返工预算和升级条件。
2. 产物与验证证据会按稳定 ID 同步投影到任务步骤、自适应计划图节点和恢复上下文；恢复查询新增独立的步骤合同/证据投影，同时保持既有 `completedSteps` API 形状不变。
3. 自适应计划图回投任务步骤时会保留原合同、验收条件、输出路径和证据 ID，避免计划修订或重启后丢失事实。
4. 原生团队执行登记产物时会携带对应步骤 ID，根任务和责任子任务都能形成相同的证据链。
5. 新增稳定命令 `npm.cmd run verify:kernel-minimal`；现有 v5.10 最小门禁同时覆盖团队任务和普通单步骤任务的合同、证据投影与重启恢复。
6. 新增 `test/unit/taskServiceContractEvidence.test.mjs`，锁定普通步骤自动合同和证据三向持久化。

## 验证证据

- `npm.cmd run verify:kernel-minimal`：通过。
- 聚焦 Vitest：4 个测试文件、15 项测试全部通过。
- `npm.cmd run lint`：通过。
- `git diff --check`：通过，仅有仓库现有的 LF/CRLF 转换提示。

## 已知边界与下一步

- 本轮按用户要求执行了最小门禁和聚焦测试，没有重跑完整 `verify:v510`、生产构建或发布门禁。
- 当前改动尚未提交、尚未发布；如果准备制作新版本，应先跑完整 `verify:v510` 和生产构建，再决定版本号。
