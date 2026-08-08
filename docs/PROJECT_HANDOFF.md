# 项目交接手册

> 最后整理：2026-08-08
> 当前源码版本：`v5.9.1`；团队观察窗、任务控制、完成门禁和项目边界修复已通过本地验证，待 GitHub Release 远端资产校验
> 主分支：`main`
> 仓库：[TTflysky/sirenhuisuo](https://github.com/TTflysky/sirenhuisuo)

## v5.9.1 当前交接（2026-08-08）

- 团队观察窗统一为观察、产物、技能和回放四个视图；重复的团队群新建聊天、讨论和发布任务入口已从渲染树移除。
- 暂停/停止采用本地即时反馈和 Worker 权威状态对账；原生执行完成门禁按交付类型核验必需证据，并消除完成通知与终态写入竞争。
- 新项目不得通过模糊消息自动继承旧审批、任务或工作区；多个候选项目必须明确名称。团队名由模型理解后的真实目标生成。
- 本轮已通过项目命名、团队成员、会话隔离、运行观察窗、原生执行、任务 Worker、Lint 和生产构建验证。

## v5.9.0 历史交接（2026-08-07）

- 新增主进程追加式遥测账本：任务账本、Worker、原生执行器和操作诊断统一投影为可查询的脱敏事件，不创建第二套任务、产物或团队状态。
- 设置 -> 诊断中心新增“运行监控台”，每 2.5 秒展示当前任务、最新真实动作、错误/提醒与 Token；支持导出包含遥测、任务快照、任务账本事件和诊断的脱敏问题包。
- 不记录或展示模型隐藏推理、提示词、密钥、令牌和附件正文。自动根因建议尚未实现，属于后续 `v5.9.1`。
- 已通过 `npm.cmd run verify:v59`、生产构建与安装包校验；详细边界见 `handoff.md` 和 `docs/TAIJI_V5_9_REVIEW.md`。

## v5.8.1 历史交接（2026-08-07）

- 修复真实陪跑把启动前历史记录误写进当前会话的问题；旧记录不会再影响本轮完成率、恢复率或场景覆盖。
- 实时会话由主进程每 5 秒采集任务、记忆与 Skill 账本，客户端显示秒级时长、最近采集时间和运行状态。
- 新增隔离的“一键验收 24 项”，自动覆盖全部标准场景；自动基准和真实陪跑始终分开统计，用户不需要创建专门测试任务。
- 本轮 `v5.8.1` 已在本地通过自动基准、构建、Lint、包完整性与发布治理校验；`docs/sbom-v5.8.1.json`、`docs/release-provenance-v5.8.1.json` 已随版本生成。已于 2026-08-07 发布 [GitHub Release v5.8.1](https://github.com/TTflysky/sirenhuisuo/releases/tag/v5.8.1)，目标提交 `524432ecf331134fbcd27c7a2f860511e56c26f9`，安装包 SHA-256 为 `1EA1414F568CCA39DB7A1C31BCFD6422D3B3D7A886346EACF45AE9678B9C93F2`；发布脚本已核验远端安装包、blockmap 和 `latest.yml`。

## v5.8.0 发布交接（2026-08-07）

- 本版承接 V5.6 的记忆与项目边界、V5.7 的 Skill 生命周期，新增 24 个可回放自治评测场景和持久化真实观察记录。
- 诊断中心新增“自治陪跑评测”，主进程、preload 与章北海 v29 人格均已接入；评测结果区分自动回放、短驻留和真实长期陪跑。
- 已通过 `verify:v58`、V2 核心门禁、V5.6/V5.7 门禁、性能回归、V3.15 驻留回归、Lint 和 12 窗口短驻留；54 个测试文件、184 个测试通过，320 名员工/12 窗口/12000 任务事件堆增长 2.22 MB。
- V5.8 已发布 GitHub Release：发布提交为 `793799f3239843319643541c0fcfdbf58d489029`，安装包 SHA-256 为 `92779099E56CA2DCCBC3B8EFE07D933EEBA464ED2C1288BED9C02AA2386DBEC4`；在“设置 -> 诊断中心 -> 自治陪跑评测”开始真实陪跑。
- 连续 8 小时驻留、第三方账号矩阵和真实用户任务统计尚未完成，不得将自动评测分数写成长期自治验收结论。

## v5.5.3 历史交接（2026-08-07）

- 本轮针对“新明确来源却串入昨天安装任务”的内核故障收口，不为 `mattpocock/skills` 或任意具体 Skill 添加关键词特例。
- `npx skills add owner/repo` 现按严格仓库语法解析，允许仓库地址后直接紧跟中文说明；当前显式来源或当前格式错误命令都不会继承旧安装来源、旧任务或旧工作区。
- `unifiedHost` 现在只把 `search_skills` 视为需要 SkillHub 外部能力的工具。原生 `install_skill`、文件与 Coding 等内部能力不再因市场连接状态被误拦。
- 技能安装工具未启动时，聊天窗口显示真实的“检查技能安装能力”阶段；不再以“连接 AI 模型”掩盖工具门禁或输入错误。
- 发布脚本将日常证据生成与正式发布验证分离：发布只校验已提交的 SBOM/来源证明，避免它在清洁工作区门禁之后自己制造未提交文件。
- 发布证据：54 个测试文件、184 项测试、`verify:v317`、`verify:agent-kernel`、`verify:v2-core-gate`、生产构建和 Lint 已通过。GitHub Release `v5.5.3` 已于 2026-08-07 发布并完成远端资产校验，标签提交为 `f89c856731d94524e79f591f26e143c8c01d0873`；安装包 SHA-256 为 `585135CEBF8D473C970F2091EE8EF06DED5BCACAA7684EE091AF3C458934821B`。

## v5.5.2 当前交接（2026-08-07）

- 本轮修复明确来源的 Skill 安装收尾，并补上聊天窗口的公开执行记录。用户现在能看到“理解目标 -> 制定计划 -> 正在执行 -> 观察结果/调整 -> 最终验收或阻塞”的实际进度，而不是只看到工具名称。
- 这不是模型内部思维链：不会暴露或持久化 provider 的 `reasoning_content`。展示内容只来自任务合同、工具参数、真实工具结果、重试/插话事件和完成门禁，因而可审计、可回放且不误导为私有推理。
- Skill 安装读回修复 Windows `ADMINI~1` 与 `Administrator` 等同一路径被字符串比较误判的问题；GitHub 仓库、ZIP 和单文件安装均使用规范化路径验证。
- 已通过：`node scripts/verify-skill-install-e2e.cjs`、相关 Vitest、`npm.cmd run build`、`node scripts/verify-execution-detail-contract.mjs`、真实 Electron `verify-execution-detail-ui.mjs`。本轮按正式 `v5.5.2` Release 发布安装器、Blockmap 和自动更新清单，办公室客户端可直接同步。
- 已发布 [GitHub Release v5.5.2](https://github.com/TTflysky/sirenhuisuo/releases/tag/v5.5.2)：标签提交为 `b817026b7bfc7f83710766f365eeced61cce72de`；安装器 `taiji-office-setup-5.5.2.exe` 为 `197580487` 字节，SHA-256 为 `6BACA78CF0B47DEC31DD22A66EB6CEA682AAB72996412690709D26755D8891C2`。远端安装器、Blockmap 和 `latest.yml` 的大小与摘要均已核对。

## v5.5.1 当前交接（2026-08-06）

- 本版是 `v5.5.0` 的补丁发布，保留原标签不变；重点修复 Skill 安装链路，使明确的 `npx skills add owner/repo`、绑定候选后的“安装它”和“继续安装”都进入一次原生安装闭环。
- 原生安装器支持 GitHub 多 Skill 仓库根地址，按完整目录安装、限制包大小、原子替换并回读验证；后台不再执行交互式 Skill CLI，也不把技能写入错误的隔离目录。
- 验证证据：52 个测试文件、179 项测试、400 条任务语义样例、构建、Skill 安装 E2E、模块边界、函数边界和性能门禁均通过。
- 已发布 GitHub Release `v5.5.1`：发布提交为 `3f670cb64aeccaddf00427e8d64ebb0353a73ff0`，Windows 安装包为 `release/taiji-office-setup-5.5.1.exe`，SHA-256 为 `EED17DB0625FE48CA696FF53320B458EDCB0414075FF4234037DC8DD3E3F7BBA`；原 `v5.5.0` 标签未修改。
- 客户端验收：更新到 `v5.5.1` 后发送 `npx skills add vercel-labs/agent-skills`，核对不再先解释命令、技能数量和完整包回读摘要。

## v5.5.0 当前交接（2026-08-06）

- 本阶段回顾：V5.1 统一模型输出，V5.2 建立项目/任务/工作区证据归属，V5.3 建立团队根任务与成员责任任务，V5.4 补齐重启恢复、会话/项目隔离和附件回放；V5.5 负责真实项目端到端链路。
- V5.5 已实现真实项目验收脚本 `scripts/verify-v55-project.cjs` 和 `npm.cmd run verify:v55-project`，覆盖多角色阶段依赖、真实文件写入、桌面与 375px 验证、QA 审查、责任任务树和项目范围查询。
- 已修复 `scripts/run-electron-e2e.cjs` 的 Chromium 参数顺序，并补充本地 E2E 的 `--no-sandbox` 启动参数；V5.5 Mock 模型现在读取系统上下文中的明确当前步骤。
- 本轮曾在受限环境和本机临时目录上启动完整 Electron 验收；受测进程未在 180 秒内结束，当前只记录为“待手动启动客户端后定位”，不是通过，也不是失败原因已确认。
- 本次发布非目标：不添加项目关键词特例，不用提示词替代运行时，不把模型文字声明当作真实文件、工具或审查证据。
- 下一步：用户手动启动覆盖后的 `v5.5.0` 客户端后，连接真实窗口复跑 `verify:v55-project`，读取项目报告；若仍卡住，按新增阶段日志定位 `taskExecutionStart`、Runner 或模型请求的具体边界。

## v5.0.0 发布与真实陪跑交接（2026-08-06）

- V5 源码、构建和 `verify:v5` 已完成，Windows 安装包已上传到 [GitHub Release v5.0.0](https://github.com/TTflysky/sirenhuisuo/releases/tag/v5.0.0)；发布提交为 `74a5cbab6ae6f63ffee61f4e828c8e383d1b8a2e`。
- 真实陪跑没有通过最终自主团队验收：科学计算器出现“口头完成、无文件/证据”，风险看板出现 DeepSeek DSML 工具调用未解析。完整证据、根因和修复门禁见 [TAIJI_V5_LIVE_RUN_REPORT.md](./TAIJI_V5_LIVE_RUN_REPORT.md)。
- 下一轮必须先修复统一模型输出网关，再把普通助理入口强制接入 `TaskService`/`ProjectContext`，随后重跑两项通用陪跑；不得添加项目关键词特例，也不得把静态门禁通过写成真实完成。

## v3.16.0 事实、路线与记忆闭环（2026-08-05）

- `src/engine/factLedger.mjs` 以 `factKey` 建立事实版本链，保留新旧陈述、观察记录、来源和证据 ID；冲突不会被新值静默覆盖。
- `SituationModel` 持久化 `factLedger` 与 `openFactConflicts`。两个已验证陈述冲突时自主决策进入 `await_user`；只有未验证冲突时先要求补证据。任务详情展示账本摘要和冲突内容。
- `resolveFactConflict()` 支持接受最新、保留旧版、两者并存和驳回四种处理；冲突处理结果可随任务账本回放。
- `executionController` 路线记录新增成功率、失败率和最近成功/失败时间，公开决策摘要显示成功率与成功/尝试次数，不再只展示“调用过几次”。
- `electron/memoryManager.cjs` schema 升级到 v3，记忆按类型使用指数半衰期并输出 `decayScore`；旧 v1/v2 状态自动迁移并写入审计，`context()` 排序降低过时记忆权重。
- `scripts/verify-v316-fact-route-decay.mjs` 与 `npm.cmd run verify:v316` 已加入事实冲突、统一自主控制、路线统计、迁移和时间衰减回归。
- 当前源码构建与 Lint 已通过。该行是 v3.16 阶段交接记录；后续 v3.17、v3.18 和 v4.0 已在本手册上方收口。

## v3.17.0 统一主持与能力矩阵（2026-08-05）

- `src/engine/unifiedHost.mjs` 统一 assistant、employee、team、worker、background 五类入口，持久化请求 ID、入口身份、目标和能力预检状态。
- TaskService 新任务写入 `hostEntrypoint`、`requiredCapabilities` 和能力矩阵快照；无矩阵的旧任务不会被误阻断，但会保持未同步的可见状态。
- 有真实配置和探测记录的能力才强制阻断：工具动作若需要不可用的网页、技能、GitHub、知识库或图像能力，会在调用前等待配置或用户处理。
- 原生 Worker 与聊天任务桥都复用统一主持动作校验；旧 Autopilot 没有独立执行权。
- `task-service:resolve-fact-conflict` 已加入主进程、IPC、preload 和类型声明，处理结果进入任务事件账本。
- 门禁：`npm.cmd run verify:v317`、`npm.cmd run build`、`npm.cmd run lint` 已通过。
- 下一阶段严格进入 `v3.18` 更新事务、迁移矩阵、健康检查和回滚证据，不新增平行调度器。

## v3.18.0 升级事务与回滚治理（2026-08-05）

- `electron/upgradeGovernance.cjs` 定义员工、团队、会话、任务、记忆、模型、连接器和工作区八个迁移域，并为每个域保留状态、检查结果与证据。
- `electron/updateTransaction.cjs` 在准备、健康检查和提交阶段接入迁移域门禁；关键域未通过时不能提交升级。
- `electron/autoUpdate.cjs` 安装后验证绑定目标版本、数据保留、工作区可写、Worker 和统一主持可用性；回滚记录保留失败阶段、备份摘要、旧包校验和恢复结果。
- `scripts/verify-v318-upgrade-governance.cjs`、`verify:update-transaction` 和 `verify:ecosystem-health` 已通过。

## v4.0.0 自主智能体发布收口（2026-08-05）

- `src/engine/v4ReleaseReadiness.mjs` 将统一主持、五类入口、迁移矩阵、回滚证据、安装后健康和发布材料收成单一清单；`scripts/verify-v4-release-readiness.mjs` 验证清单完整性。
- 已生成 `docs/sbom-v4.0.0.json` 和 `docs/release-provenance-v4.0.0.json`，版本与 lockfile 均为 `4.0.0`。
- 发布门禁 `npm.cmd run verify:v4-release`、全量构建和 Lint 已通过。当前未配置代码签名证书，因此保留 Windows SmartScreen warning；开启“发布必须签名”策略会正确阻断。
- v4 源码实现完成，但尚未创建 GitHub Release；不要把“源码门禁通过”误写成“已发布安装包”。

## v3.15.0 长任务驻留与通用语义验收（2026-08-05）

- `src/engine/taskResidencyCheckpoint.mjs` 将目标、计划、完成步骤、验证证据、下一步骤、上下文摘要和 Worker 检查点序号写入可校验驻留检查点。跨客户端重启时全部一致才自动排回队列；冲突任务安全暂停并明确等待核对原因。
- Turn Lifecycle 的上下文压缩、摘要、未决问题和用户插话已纳入驻留摘要哈希；用户主动继续可基于当前真实状态重建恢复基线，已完成步骤不会被重复打开。
- TaskService 新任务默认建立 `recoveryContext`，Worker 领取旧任务时兼容补齐，避免恢复时只有状态没有可读原因。
- `verify_web_artifact` 支持任务合同驱动的 `semanticChecks`：`group`、`order`、`adjacent`、`grid`、`interaction` 五类通用契约。语义检查与越界/裁切/运行错误同等阻断完成，不包含计算器专用分支。
- `verify-web-semantic-contract.cjs` 真实 Electron 回归已证明错误网格被拒绝，修正后分组、顺序、相邻、网格和交互全部通过；`verify-v315-soak-kernel.mjs` 覆盖两次上下文压缩、两次用户插话、跨会话恢复和连续 5 个检查点。
- 门禁：`npm.cmd run verify:v315`、Build、Lint 通过。多窗口图形耐久脚本仍保留；本机若出现 Electron `launch-failed / exitCode 49`，属于图形驱动运行环境，不能冒充内核失败。
- 下一步严格进入 `v3.16`：事实版本、冲突证据、路线成功率与时间衰减。该行是 v3.15 阶段交接记录；当前 v4.0 源码门禁已完成。

## v3.14.1 风格化生产界面（2026-08-04）

- 已将定稿 Demo 迁移到生产客户端：原版商务 11 套、波普漫画 10 套、酸性暗黑 4 套，共 3 种风格与 25 套配色。
- 新安装默认波普漫画，各风格独立保存上次配色；主窗口、员工私聊、团队、设置和弹层通过广播同步。
- 波普主边框为 4px、次级控件为 3px；酸性暗黑隐藏员工工牌顶部挂带；原版商务保持 1px 边框。
- FC、Mac、街机音效默认开启且音量为 80%，支持关闭、调节与试听。报告与快照见 `TAIJI_VISUAL_SYSTEM_V3.14.1.md`。
- Vitest `159/159`、视觉专项、生产构建、Lint 与仓库卫生门禁已通过。
- 本版本只收口 UI 产品化，不改变主线。发布后严格进入 `v3.15` 长任务、跨重启、上下文一致性与通用语义验收。

## 待纳入 v3.15：通用产出物语义验收（2026-08-04）

- 昨晚真实科学计算器项目虽然通过运行、桌面/窄屏边界和控件数量检查，但用户验收发现数字键排列位置错误。根因是功能键与数字键共用自动五列网格，跨列的等号触发自动换行，导致 `1 2 3` 等数字整体右移。
- 这不是计算器单点问题，而是现有门禁只验证技术可运行性和几何边界，没有验证产出物是否在“分组、顺序、邻接、坐标和交互流程”上符合目标。
- `v3.15` 必须增加任务合同驱动的通用 `semanticChecks`/布局契约和浏览器证据，覆盖计算器、导航、表格、表单与步骤编排。语义失败不得完成任务，只重开责任步骤。
- 禁止硬编码计算器、数字键或当前 HTML 的坐标；必须由任务目标和产出类型生成可审查的语义约束。该项与长任务、跨重启及上下文一致性一起验收。

## v3.14.0 统一执行前自主授权

- 固定开工入口为 `TAIJI_V3_TO_V4_ROADMAP.md`，以后每轮先回顾完成证据、剩余差距与本轮边界。
- `autonomousExecutionGate` 已覆盖助理、员工私聊、团队、团队交接读取和原生后台执行，统一校验目标、计划、责任步骤、责任员工、工具与提案。
- 原生 `toolRuntime.execute`、动态委派和 Git Worktree 动作均在真实执行前经过任务账本与授权门禁。
- Vitest `156/156`、原生执行专项、生产构建与三项结构门禁通过。
- 详细报告：`TAIJI_STAGE_V3.14_PROGRESS.md`。下一阶段为 `v3.15` 长任务和跨重启验收，v4.0 尚未完成。

## v3.13.0 自主决策权与四类记忆

- 每个阶段开工前必须回顾路线、证据和差距矩阵；本轮已重新核对 `v3.6 -> v4.0` 自主智能体路线后实施。
- 新增 `src/engine/autonomousDecisionAuthority.mjs`：模型或运行时行动必须绑定当前 `goalId`、计划版本、责任步骤、工具和公开理由；过期目标、过期计划、废弃步骤、依赖未完成与未授权高风险动作在执行前被拒绝。
- 助理、员工私聊和团队员工共用决策权校验。TaskService 持久化联动测试已证明当前团队决策会被接受，计划修订后的旧提案会被拒绝。
- `electron/taskServiceRecoveryCommands.cjs`、`src/data/agentLoopFinalization.ts` 和 `src/store/teamAutonomousDecision.ts` 分别持有任务恢复、Agent Loop 收尾和团队工具决策职责。
- `taskService.cjs` 当前约 477 行，最长 `createTaskService` 约 180 行；Agent Loop 主函数约 730 行。模块与函数增长门禁通过。
- 分层记忆 schema 升级到 v2，增加 `memoryKind`：`episodic`、`semantic`、`procedural`、`preference`。记忆中心支持类型筛选和新增类型选择，可读投影同时展示类型与业务分类。
- 自动程序记忆必须同时满足任务完成和真实验证证据；无证据的完成声明不写入。旧版任务经验缺少可核对验收时迁移为情景记忆，保留历史但不冒充稳定流程。
- 内置章北海人格升级到 v26；所有活跃聊天与设置入口使用 `PERSONA_MIGRATION_APPENDIX_V26`。
- 已通过 `152/152` Vitest、`400/400` 语义基准、阶段 A/B/3、完整 v2 核心门禁、四类记忆迁移、任务复盘、自主决策、团队决策、TaskService 持久化、聊天完成门禁、模块边界、函数边界、构建与 Lint。
- Windows 安装包 `release/taiji-office-setup-3.13.0.exe` 为 `195896339` 字节，SHA-256 `D7690E007BABE8D4A685880BCFCE4B380AEEA68865E8C1303B85DA13287AE515`；Blockmap 为 `206822` 字节，SHA-256 `05662FE0E187322C529822C07197C3A3CFC7CBD97E27D6550B0375D584AC74BA`；`latest.yml` 为 `356` 字节，SHA-256 `3D1C081767DB288597C56814A499F2BA018B43D20F4159209A1AE209B2A0AEF5`。
- 已覆盖安装到 `%LOCALAPPDATA%\Programs\taiji-office`，产品版本 `3.13.0.0`、`app.asar` 包内版本 `3.13.0`。覆盖前用户数据与备份均为 314 个文件、`222077920` 字节；备份位于 `local-backups/preinstall-3.13.0-20260804-173527`。
- 已安装包内模块真实迁移 184 条记忆到 schema v2：情景 40、语义 82、程序 46、用户偏好 16；迁移后重启 8 秒，5 个客户端进程全部响应。
- GitHub Release `v3.13.0` 已发布，历史净化后的标签对应提交 `d4f0387e13f2273eea9a86a2bd71aa3e57104c44`；远端标签、安装器、Blockmap 和 `latest.yml` 的大小与 SHA-256 已通过发布脚本核验。
- Release 地址：`https://github.com/TTflysky/sirenhuisuo/releases/tag/v3.13.0`。
- 2026-08-04 已清除 Git 历史中的旧 `release/` 安装资产；此日期之前文档里记录的旧提交短哈希仅作历史说明，版本定位以 Git 标签和 GitHub Release 为准。
- 明确遗留：`createWindow` 仍约 593 行；团队主持尚未成为完全统一的唯一入口；正式 8 小时驻留、真实第三方账号矩阵和代码签名仍未完成，不得冒充已验收。

详见 `TAIJI_STAGE_V3.13_PROGRESS.md` 与 `TAIJI_STAGE_V3.13_GAP_MATRIX.md`。

## v3.12.0 已发布基线

- DeepSeek thinking 模式工具续轮已兼容 `reasoning_content`，覆盖流式、非流式、普通聊天、员工、团队与 Coding Runtime。
- Electron 已拆出窗口注册表、窗口 IPC 和 TaskService IPC；聊天窗口新开、复用、广播、锁定和销毁具备专项测试。
- TaskService 已拆出指标/任务树/恢复计划、上下文/就绪步骤/完成门禁、执行证据、审批和生命周期模块。
- `createWindow` 最长函数 593 行；`taskService.cjs` 581 行，最长 `createTaskService` 285 行。新增模块与函数门禁禁止职责回流。
- 编码任务必须保留检查点和通过的验证证据；权限、鉴权和计费错误进入等待用户，批准普通授权后重新排队。
- 当前通过 Vitest `139/139`、语义基准 `400/400`、生产构建、Lint 和完整 v2 核心门禁。
- 内置章北海人格已升级到 v25；README 与仓库整改报告加入真实办公室和项目验收快照。
- 仓库补齐 MIT License、忽略规则、包元数据与强化后的 GitHub Actions 发布门禁；历史安装包清理延期到项目收尾执行。
- Windows 安装包 `release/taiji-office-setup-3.12.0.exe` 为 `195887469` 字节，SHA-256 `40AA6B9F7182C4C9EA004B4EC5E2C1674116ACD1228AEF8DA75E9A083F658275`；Blockmap 与 `latest.yml` 已核验。
- 已覆盖安装到 `%LOCALAPPDATA%\Programs\taiji-office`，产品版本 `3.12.0.0`、包内版本 `3.12.0`，启动 12 秒后正常响应。覆盖前后用户数据均为 320 个文件、`477263942` 字节；备份为 `local-backups/preinstall-3.12.0-20260804-160237`。
- GitHub Release `v3.12.0` 已发布，历史净化后的标签对应提交 `e5a00f3468035209af7dd57c84c05a771d199ce3`；远端安装器、Blockmap、`latest.yml` 的大小与 SHA-256 全部通过核对。
- 仓库 Description、Homepage 和 Topics 已同步。Release 地址：`https://github.com/TTflysky/sirenhuisuo/releases/tag/v3.12.0`。

## v3.11.0 核心职责拆分与结构防回流

- v3.8：原生执行器拆出 `nativeExecutionControl.cjs` 和 `nativeStepExecutor.cjs`，控制面与单步工具执行不再混写。
- v3.9：`hermesClient.ts` 拆出 `agentLoopRuntime.ts`，模型请求协议与 Agent 执行循环分离。
- v3.10：`store.tsx` 拆出办公室命令、任务控制、团队消息和团队讨论运行时，Store 只负责组合和公开状态。
- v3.11：新增 Agent 策略、团队 Worker 租约和团队最终验收模块；指定来源 Skill、检查点恢复、最终完成判断都具备独立所有权与单测。
- 双门禁同时限制文件总行数和 TypeScript AST 识别出的单函数长度。第二梯队 `main.cjs`、`taskService.cjs`、`skills.cjs`、`nativeToolRuntime.cjs` 已冻结增长，后续按窗口生命周期、任务编译/恢复、技能扫描/安装和工具调度继续拆分。
- 内置人格为 v24，新增 v3.11 模块化执行、检查点和真实收尾协议。不得把模型回答、工具返回、检查点写入、界面投影或某一项测试通过互相冒充。
- 当前已通过 `125/125` 标准测试、400 条语义基准、生产构建、模块边界、函数边界、Skill/网页/图片/Coding/诊断/性能专项和完整 v2 核心门禁。
- Windows 安装包 `release/taiji-office-setup-3.11.0.exe` 为 `195887039` 字节，SHA-256 `05C7DFF7A4C2C23708F629B8FEF07863F6A88C34726B3E597538F1C8A51483C2`；包内版本、23 个必需文件和六款字体通过校验。
- 已安装到 `%LOCALAPPDATA%\Programs\taiji-office`，产品版本 `3.11.0.0`，桌面快捷方式已更新。用户数据文件覆盖前后均为 314 个；精简备份位于 `local-backups/preinstall-3.11.0-20260804-113614`。
- 安装版风险看板项目最终任务 `installed-v311-1785816224289` 为 `completed`，计划修订 3 次、模型调用 6 次；故意的窄屏失败只重开构建路线，已完成 `brief` 持续保留。完整证据见 `evidence/v3.11.0/`。


## v3.6.1 真实任务闭环与窄屏验收

- 真实科学计算器项目用于检验太极能否自主写入、运行、验证、纠错和收口，不包含计算器专用代码路径。
- 已修复命令别名导致的错误去重、成功写入内容反复占用上下文、工作区和实时证据未进入自主状态、账本高频全量写入以及前台回复等待落盘等通用问题。
- 第二轮从 18 轮约 `554,097` Token 降至 6 个工具动作约 `154,952` Token，功能交互和任务 `completed` 状态通过。
- 用户补充截图再次证明第二轮窄屏产物的右侧边框、按键和外阴影被窗口裁切，底部还出现横向滚动条；该截图已作为真实失败样本记录。验收现以真实 `clientWidth/visualViewport.width` 为边界，并增加边框、阴影和 8px 安全区检查；第二轮产物已被新门禁正确判为视觉未通过。
- 同一任务继续链使用固定原目标、父任务和工作区；修复后的 HTML 没有立即复验时，内核强制下一动作调用 `verify_web_artifact`。单视口检查不能完成，必须同一轮覆盖桌面和窄屏。
- 最终安装版第三轮使用 11 个工具动作、约 `165,524` Token，任务 `task-1785778780340-8d6f6079` 正确进入 `completed`。桌面与 375px 均无运行错误、横向滚动、元素裁切、边框或外阴影安全区问题，33 个交互控件可用。
- Vitest `112/112`、Lint、TypeScript/Vite 构建、智能体内核和完整 `v2` 核心门禁已通过。本机覆盖验收包 `release/taiji-office-setup-3.6.1.exe` 为 `195877927` 字节，SHA-256 `9F831EA55272E94B4ADBBF6AE5F78812CCCB1FCDDE60F6E510F5F306C1A2E28A`。
- 已覆盖安装并从安装后 `app.asar` 核验版本与收尾代码标记；数据备份位于 `L:\AI办公室\taiji-backups\preinstall-3.6.1-20260804-013718`。同版本复测必须先退出旧 Electron 进程，避免单实例机制把新窗口转交给旧代码。
- 功能提交 `c7b8cef`、标签和 [GitHub Release v3.6.1](https://github.com/TTflysky/sirenhuisuo/releases/tag/v3.6.1) 已发布。GitHub Actions `30842774363` 通过单测、Windows 打包、包内校验和上传；官方安装包为 `195875991` 字节，SHA-256 `5ADFECC43B44392BCB27854D46B547A3BF699EA8CF5DD5D11BFFA56D7DF1425F`，Blockmap 为 `207260` 字节、SHA-256 `56EF9E46B6783ABE94C23949ADCB5F4C507A32AFE81B1979F8405430E0B28B5F`，`latest.yml` 为 `353` 字节、SHA-256 `29FF5DB40778B310E0BC79379910BD379BC670832A21C9771356B50E8ACF476B`。
- 完整记录见 `docs/REAL_PROJECT_ACCEPTANCE_v3.6.1.md`。

## 必读：自主智能体产品方向

从 `v3.6.0` 开始，开发前必须阅读 [`TAIJI_AUTONOMOUS_AGENT_ARCHITECTURE.md`](./TAIJI_AUTONOMOUS_AGENT_ARCHITECTURE.md)。太极不再以“智能体驱动的固定工作流”为目标；固定流程只保留为执行底座，主持权逐步迁移到由 `GoalState`、`SituationModel`、`DecisionEngine`、`AdaptivePlanGraph` 和反思恢复组成的自主控制层。

不得用更长提示词、一次性关键词补丁、固定员工白名单或更复杂的静态 DAG 冒充自主性。现有工作区、账本、工具、权限、证据、审查、恢复和数据迁移能力必须无损保留。

## 强制：每个阶段开工前先做路线回顾

任何新阶段、小版本连续升级或跨电脑接手，在修改代码前必须先完成一次阶段启动校准，并把结论写入当期阶段报告或交接记录。不得仅凭上一轮聊天摘要直接开工。

阶段启动校准至少包含：

1. 重读本文件、`TAIJI_AUTONOMOUS_AGENT_ARCHITECTURE.md`、上一阶段报告、差异矩阵和最近版本 CHANGELOG。
2. 用源码、测试、安装包或真实项目证据核对上一阶段哪些已经完成、哪些只完成了基础设施、哪些仍未验收；不能把文件拆分、提示词更新或单项测试通过等同于产品能力完成。
3. 明确本阶段对应的大版本目标、用户问题、核心代码边界、验收场景、不可破坏能力和明确不做事项。
4. 逐项回答自主架构的防跑偏检查：是否增强目标理解与自主解决、模型是否仍能按新证据换路、确定性代码是否只守事实与安全边界、计划是否可局部修改、用户插话是否进入同一目标、失败是否先归因、完成是否由真实证据决定、状态是否可恢复、所有入口是否共用协议、用户数据是否保留。
5. 发现版本编号、阶段名称或实际交付与路线图不一致时，先在差异矩阵中说明并校正当前边界，再开始实现；不得沿错误计划惯性开发。

本规则是长期交接约束。以后每次开始一个阶段都必须执行，即使用户没有再次提醒。

## v3.6.0 自主控制内核影子模式

- `src/engine/autonomousControl.mjs` 是新增的目标与现场控制合同，包含 `GoalState`、`SituationModel`、公开 `DecisionRecord` 及影子控制快照。类型合同位于同名 `.d.mts`。
- `electron/taskRuntimeStore.cjs` 是统一校准边界。新旧渲染窗口、TaskService、Worker、原生 Adapter 和恢复点的任务变化都在写入账本前调用同一个 `reconcileAutonomousControl()`；旧任务初始化会追加迁移事件，不改写历史证据。
- 账本对缺少新字段的旧窗口快照保留当前自主状态，避免“删除再重建”产生假事件。`goalId/projectId/conversationId`、工作区、成员、步骤与证据已通过重启和旧版快照迁移测试。
- 用户输入仍先由现有语义层判断与当前任务的关系；结构化的纠正、约束、控制和独立新目标结果再进入 `GoalState`。确定性控制层只做去重、事实、权限、重复路线与证据校验，不替模型重做完整语义判断。
- `SituationModel.confirmedFacts` 仅接纳已验证证据；未验证模型陈述进入 `assumptions`。重复失败路线最多两次的规则已投影为 `switch_route` 建议。
- 团队项目面板通过 `autonomousControl.publicSummary` 展示公开判断，不读取或保存隐藏思维链。本版仍为 `mode=shadow`，现有执行器保持实际控制权。
- 专项验证：`npm.cmd run verify:autonomous-control`；发布门禁还必须继续跑全量测试、`verify:v2-core-gate`、模块边界、Lint、构建和包校验。
- `v3.6.0` 安装包为 `release/taiji-office-setup-3.6.0.exe`，大小 `195873370` 字节，SHA-256 `3EDA068868A5F8FE67B1CAAEE327D9F99F8E3CF8F838B704FE8B93F2AF2DFB53`。包内模块和界面标记已验证；已覆盖安装到 `%LOCALAPPDATA%\Programs\taiji-office`，并从安装后的 `app.asar` 读取确认版本 `3.6.0`。覆盖前数据备份位于 `L:\AI办公室\taiji-backups\preinstall-3.6.0-20260803-2316`。

## v3.5.8 真实执行收口与 Windows 渲染恢复

- Windows 默认使用软件渲染，`electron/renderingPolicy.cjs` 统一处理所有窗口的延迟显示、加载失败、渲染进程退出、无响应与启动兜底。仅在诊断时通过 `TAIJI_FORCE_HARDWARE_ACCELERATION=1` 恢复硬件加速。
- 能力图和 Coding DAG 使用同一套专业岗位所有权。协调、架构、UI、前端、后端和 QA 存在对应专家时，迁移遗留的宽泛能力标签不得让相邻岗位冒充负责人。
- 固定 Coding DAG 禁止动态委派复制既有职责；工具注册按步骤收紧，`submit_review` 仅对正式审查可见。真实文件和成功运行证据可以直接结束文件步骤，24 次工具预算边界也不会把已完成交付误判为失败。
- 模型 HTTP、超时、重试和控制中断集中在 `electron/nativeModelGateway.cjs`。长文件生成只有在出现真实写入或运行进展时才获得有限收尾预算；原生 Adapter 继续受 2150 行模块门禁保护。
- 动态复审步骤统一使用 `decision`，正式 `review` 步骤提交结构化结论后立即结束。首次任务账本同步完成前禁止自动恢复，避免旧投影抢跑。
- 新建聊天的项目卡、驳回草案与当前运行按 `conversationId` 隔离；历史无会话字段数据只进入兼容会话，不参与新会话调度。
- 真实项目 `run-1785617297693-za7fs` 已完成产品、架构、UX/UI、前端、后端、验证、首次审查和第一次修订，工作区产生 18 项真实文件。系统自主发现 Chrome 并完成 390px 移动视口、Mock 生图、刷新持久化和横向溢出验证，随后正确退回图生图、设置持久化与浏览器证据缺口。
- 最终复审因模型服务连续返回 `HTTP 502: Upstream service temporarily unavailable` 暂停，Delivery 未执行，不得冒充完整验收。服务恢复后运行 `node scripts/resume-native-run-authoritative.mjs run-1785617297693-za7fs` 继续同一现场。
- 本机已覆盖安装 `v3.5.8`，覆盖前备份位于 `L:\AI办公室\taiji-backups\preinstall-3.5.8-20260802-0632`。API Key、聊天、员工、团队、任务账本和工作区仍只保存在本机，不得提交 GitHub。

## v3.5.7 工作区能力事实校正

- `resolveSupervisorRun()` 从当前子任务沿父链继承项目工作区；`enforceSupervisorWorkspaceTruth()` 在模型输出落地前用任务结构化事实拦截错误的工作区能力否认。
- 主持模型的最后一条系统事实明确区分“尚未产出文件”和“没有工作区/工具”；原生 Adapter 与渲染备用执行器同步注入相同规则。
- 工作区已建立时，真实写入或运行失败必须展示具体工具错误和恢复入口，不得要求用户另开会话、重建项目或重复补充需求。
- Stage F 仍需以至少三个不同类型的真实软件项目完成端到端验收；本版修复的是当前第一个真实项目暴露出的执行事实断层，不把该验收提前标成完成。

## v3.5.6 软件项目可靠恢复与真实交付

- `isTaskContinuationApproval()` 只在同一会话存在 `paused`、`failed` 或 `awaiting_user` 的未完成任务时，将自然语言确认解释为恢复控制；普通聊天和否定表达不受影响。
- `resumeTaskRun()` 从子任务回溯至可恢复的项目根，保留原始目标、工作区、已完成阶段和证据。原生执行器恢复子任务时必须先更新 TaskService 持久状态，再将内存作业入队。
- Coding DAG 的项目根合同为 `mixed` 交付，强制检查真实源文件、磁盘回读、运行或测试证据与最终路径清单。不得再从首个规划步骤继承“无需生成文件”的弱合同。
- 团队主持可读取任务工作区；当工作区存在且实现阶段未完成时，不得声称没有写入或运行入口。专项回归见 `verify:context-router`、`verify:native-execution`、`verify:coding-project-v2` 和 `verify:child-task-dispatch`。

## v3.3.0 团队主持与阶段交接

- `electron/nativeCollaborationProtocol.cjs` 生成原生执行路径的 `TaskStageSummary` 与 `TaskApprovalContract`；`src/engine/teamStageHandoff.ts` 提供渲染备用路径的同构协议。两条路径必须保留相同字段，禁止 UI 解析模型长文本重建阶段事实。
- `src/engine/teamSupervisor.ts` 生成章北海主持上下文，包含当前项目、任务状态、活动阶段、负责人、等待条件和完成证据。未点名员工时由章北海优先响应；明确点名时尊重被点名员工。
- `src/engine/teamControl.ts` 负责授权决定和被拒绝动作保护。批准、拒绝或消费授权后必须按 ID 更新原聊天消息，避免旧按钮继续可点。
- `StageSummaryCard.tsx` 先展示问题、理由、完成项、证据、剩余项、下一负责人、下一动作和耗时；`operations` 只在下方折叠区域展示。`ExecutionApprovalCard.tsx` 展示申请人、目的、动作、读写范围、风险与决定效果。
- 同项目继续任务继承 `projectRootTaskId`、工作区、`sourceAttachments` 和完成证据。澄清阶段允许章北海回答，但不得启动员工执行器；审查失败只重开责任步骤和复审链。
- `src/utils/clipboard.ts` 导出阶段总结、授权决定、附件和执行过程。导出身份统一为“章北海助理 / 常驻主助理”，不得恢复为 `custom` 或临时调度员。
- 内置人格为 v22；总设置和独立助理设置均使用 `PERSONA_MIGRATION_APPENDIX_V22`，旧自定义人格只追加缺失的 v3.3 协议。自评为工程能力 89/100、真实生产可用性 81/100，详见 `SELF_EVALUATION_v3.3.0.md` 与 `TAIJI_STAGE_D_V3.3_GAP_MATRIX.md`。
- Lint、TypeScript、标准测试 `68/68`、400 条语义基准 `400/400`、完整 v2 核心门禁、阶段三治理、生产构建和 Windows 包内验收已经通过。安装包 `taiji-office-setup-3.3.0.exe` 为 `195851435` 字节，SHA-256 `8C963B1051A5151A433DE81BEF41973E89A51B9E8D62CBF82EFB83037A7CB601`；Blockmap 为 `207381` 字节，SHA-256 `B5C0D5A38E1821D05812E81E4A2841B8A6919E2D185E58BD84BA9C6EB0A1FCD5`；`latest.yml` 为 `353` 字节，SHA-256 `A7C0873ED006F6F1BBA8ACD7535733362853742052B1BD59C918873A9DDBCA30`。
- 发布脚本还必须核对 GitHub `main`、标签与三个远端资产哈希。真实多人项目体验不得由自动测试冒充。

## v3.2.1 上下文连续性补丁交接

- `src/engine/conversationReferences.mjs` 只绑定 Skill、文件和网页，并且只在读取、安装、继续资源动作或索要链接时介入；不得重新把普通助理回答注册成资源。
- `src/engine/conversationDispatchContext.mjs` 负责恢复调度连续性。它从最近 24 条对话中区分原始产品目标、用户纠正和助理最近方案，并把能力需求交给能力图，禁止在 UI 中重新用关键词拼名单。
- 助理调度上下文与正式模型上下文已扩展，员工私聊保持最近 40 条对话；任务决策内核保留最近 20 条结构化历史，每条最多 1200 字。
- 被驳回草案通过 `resolveLatestRejectedProject()` 找回；只有用户明确引用修订方案并提供重新匹配成员时，`approveProject()` 才允许从归档状态原子恢复、建群并清除驳回原因。
- `src/utils/clipboard.ts` 是聊天导出的统一附件边界。助理、员工私聊和团队必须传递消息附件；图片引用落盘路径，文本只输出有限预览，禁止写入完整 Base64。
- 回归结果：标准测试 `65/65`、任务语义基准 `400/400`、V2 核心门禁、生产构建和 Lint 通过。当前只生成本地安装包，不上传 GitHub。
- 本地安装包 `release/taiji-office-setup-3.2.1.exe` 为 `195847308` 字节，SHA-256 `2C871138D5D92017D5193683029035890C7A63D40D0A71CE4DEC2C0C6E4CE507`；Blockmap 为 `205534` 字节，SHA-256 `BE173BF0EFB7F654F3CBDCF4610D6E8311350C37CA6CB723ABA7A7635BF01E74`；`latest.yml` 为 `353` 字节，版本 `3.2.1`，SHA-256 `90D033D14B89A310DC42DE388F04A3BD6FAF0FCD47A43F310C490577398901D6`。

## v3.2.0 阶段 C 交接

- `src/engine/projectBoard.mjs` 是项目看板唯一投影边界。它把根任务、子任务、恢复和重试聚合为一个项目，并生成阶段/步骤负责人、耗时、证据、等待条件、下一步和责任返工；UI 不应重新扫描依赖图猜状态。
- `src/data/appStateStorage.ts` 承担员工、团队、项目、聊天和私聊的 localStorage 持久化；旧键名保持不变。`hermesClient.ts` 只负责初始编排并重新导出兼容 API。
- `electron/nativeExecutionProjection.cjs` 负责原生任务的脱敏公开状态；`src/store/nativeEmployeeProjection.ts` 负责从持久 Worker 步骤投影员工工作状态。两者均受 `verify:module-boundaries` 保护。
- `vite.config.ts` 固定专家目录、React 和 Ant Design 分包。`verify:renderer-bundles` 要求主渲染包小于 1.5 MB、专家目录块小于 4.1 MB；当前主包约 0.81 MB，比 v3.1 单包下降 84.1%。
- `scripts/verify-phase-c.mjs` 是阶段 C 短门禁，包含项目看板、人格、模块边界、规模性能、Electron 12 窗口短驻留、构建与分包检查。Electron 测试必须在真实桌面权限运行；受限沙盒曾触发 GPU/DLL 假失败。
- 真实桌面软件渲染短驻留已打开 12 窗口，6 次采样堆增长 0.15 MB。12 窗口总渲染堆约 645 MB，稳定但仍偏重；正式 8 小时命令为 `npm.cmd run verify:phase2-soak:8h`，尚未执行。
- 内置章北海人格为 v21，所有入口必须传 `PERSONA_MIGRATION_APPENDIX_V21`。旧自定义人格只追加缺失章节；不能先用旧基础附录把版本标记为最新。
- `verify:v2-core-gate`、`verify:phase3`、`verify:phase-c`、Lint 和包内验收均通过。Windows 安装包 `release/taiji-office-setup-3.2.0.exe` 为 `195846389` 字节，SHA-256 `32266E279020CB74F6284D7A8F37853C56D3B3CFA95EDB88A06E17F0BE0A4BE0`；Blockmap 为 `206117` 字节，SHA-256 `8129C43B6631521D913917BDDEE2A9A7946048F1E2216A4E363E94D03DEE5E5B`；`latest.yml` 为 `353` 字节，SHA-256 `EF155F850513B6259E10AC6BF0DD482AE8FB1EDB43822E7BC1C83B0ED368F9CF`。
- 当前不上传 Git，也不覆盖本机安装。等后续大版本统一提交和发布。下一阶段 D 做真实旧版升级、迁移、故障注入、回滚、签名与发布资产一致性。

## v3.1.0 阶段 B 交接

- `src/engine/externalCapabilityMatrix.mjs` 是外部能力状态合同，固定九类能力和八种状态。`completeExternalCapabilityProfiles()` 保证未配置类别也可见；`applyExternalCapabilityProbe()` 只接受真实调用证据更新可用性，非真实事件不能覆盖已有失败。
- `src/data/externalCapabilityMatrix.ts` 负责浏览器本地持久化与连接器分类，只保存脱敏身份、有限错误摘要和状态历史，不保存密钥或完整响应。模型库、连接器和 `safeStorage` 仍是配置与凭据唯一事实源。
- `runSystemDiagnostics()` 汇总模型、图片、网页、SkillHub、知识库、邮件、GitHub、HTTP 与 MCP。正常桌面和 780px 窄窗口均已实测；窄窗口会把模型选择和执行按钮分行，矩阵改为单列。
- 模型和图片使用既有兼容性报告回写；连接器最小测试、`read_web_page`、SkillHub 搜索/安装以及真实连接器调用在各自副作用边界回写。邮件发送和 GitHub 写入不会为了诊断自动产生副作用。
- `src/engine/skillEvidence.mjs` 协议为 v3，五段证据为发现、规则读取、调用、产出、验收。`install_skill` 只记录安装；助手、员工私聊和团队任务均使用 `MessageSkillEvidence` 展示真实阶段。
- 内置章北海人格为 v20。两个设置入口使用同一默认人格；旧自定义人格通过 `PERSONA_MIGRATION_APPENDIX_V20` 追加阶段 A/B 缺失章节，不覆盖原文。
- 统一入口为 `npm.cmd run verify:phase-b`。当前标准测试 `57/57`、400 条语义基准 `400/400`，阶段 A、阶段 B、v2 核心、模块边界和阶段三发布治理门禁均通过。
- 阶段 A 安装包 `release/taiji-office-setup-3.0.0.exe` 已通过包内验收，大小 `195838133` 字节，SHA-256 `B3C28F108555438D1F2CD2BA56DEEC4B0D6156294B5A4BF8B2B359E1C6A9DCF4`。当前 `v3.1.0` 尚未打包、覆盖安装或发布。
- 尚未完成并不得冒充：用户真实第三方账号九类矩阵、会产生副作用的邮件/GitHub 写入验收、正式 8 小时驻留、代码签名、真实跨版本故障回滚和 GitHub 远端资产校验。下一步先用用户配置完成阶段 B 实测，再进入阶段 C。

## v3.0.0 阶段 A 交接

- `src/engine/taskDecisionPipeline.mjs` 是四层决策审计边界。它消费任务决策内核结果，记录候选理解、上下文约束、风险/证据和可执行计划的有限输入、接受结果与拒绝原因；禁止在这里保存或展示隐藏思维过程。
- `compileTaskDecision()` 把审计附在 `TaskDecision.decisionAudit` 上。团队任务通过 `createTaskContract()` 将其保存为 `contract.decision.audit`，因此恢复、交接和回放不需要重新猜测当时为什么改写路线。
- `test/fixtures/taskSemanticCases.mjs` 固定为 400 条轨迹，`verify:task-semantics-benchmark` 要求至少 400 条且准确率不低于 98%。当前 `400/400`；增加案例应优先新增反例类别，不得只复制易过句式。
- `src/engine/modelReliability.mjs` 是无副作用的熔断、半开探测、退避、故障分类和指标汇总模块；`src/data/modelReliability.ts` 负责 `taiji_model_reliability_v1` 持久化和请求生命周期包装。模型 key 不包含 API Key，错误摘要会脱敏。
- `src/engine/chatRequestContext.mjs` 负责把当前用户上下文、员工扩展上下文和本轮图片附件整理为模型请求；不要把这段逻辑重新塞回 `hermesClient.ts`。当前核心客户端为 2294 行，仍受 2300 行边界保护。
- `chatCompletion()` 在请求前检查模型准入，在流式首 token、成功和失败时记账。三个连续瞬时故障会打开保护窗口；冷却后只允许一次探测。备用模型只给建议，不自动切换。
- 诊断中心的“AI 模型”项会显示请求数、成功率、平均耗时、首 token、503/429/超时/网络分布和恢复次数。一次兼容性探测通过不能代表流式、工具调用或生图都可用。
- 自动化故障注入已覆盖 503、429、超时和网络中断；统一入口为 `npm.cmd run verify:phase-a`。标准测试 `49/49`，v2 核心门禁和阶段三工程门禁通过；人格版本为 v19。
- 尚未完成并不得冒充：真实供应商长时间故障恢复、正式 8 小时驻留、第三方真实账号矩阵、真实跨版本回滚和 GitHub Release 下载后哈希核对。阶段 B 从真实外部能力矩阵继续。

## v2.9.5 可用性修复与发布交接

- 本版修复了实机发现的模型服务 503 误分类：`turnRuntime.classifyExecutionError()` 将 HTTP 5xx / `Service temporarily unavailable` 归入 `server`，按可恢复故障处理；任务与证据保留，用户无需重新填写模型。
- `SettingsModal` 和运行时模型解析均按能力守卫：诊断优化只接受 `chat`，头像生图只接受 `image`。这既修复 UI 选择错误，也防止旧本地配置继续造成错误调用。
- `modelFailurePresentation.mjs` 负责面向用户的模型故障说明；`hermesClient.ts` 只负责编排，保持在模块边界内。对应回归在 `verify-unified-turn-runtime`。
- 本版自评为工程能力 **87/100**、真实生产可用性 **76/100**。详细证据与限制见 `docs/SELF_EVALUATION_v2.9.5.md`；下一阶段任务见 `docs/TAIJI_OPTIMIZATION_PLAN_V3.0_TO_V3.4.md`。
- 本机已经重新打包并完成包内验收；覆盖安装被系统审批服务限流拦截，不计入已完成。正式 GitHub Release 由 `publish-github-release.ps1` 统一校验提交、标签、安装包、Blockmap、`latest.yml` 和远端 SHA-256 后发布。

## v2.9.4 第三阶段：生态兼容、凭据安全、升级事务与发布治理

- `src/engine/modelCompatibility.mjs` 是无副作用的兼容矩阵合同，`testModelConnection()` 会把真实响应转成聊天/图片能力状态并保存到模型条目。它区分缺配置、鉴权、限流、超时、网络、端点、协议、内容过滤和上游错误；未实际测试的能力显示为 `not_tested`，不能被推断为可用。
- `electron/skillRuntime.cjs` 只编排现有 `skills.cjs` 安装器，不重写原子替换逻辑。运行时清单在用户数据 `skill-runtime/runtime-manifest.json`，记录健康、来源、刷新、规则读取、调用次数和调用证据。主进程 IPC 为 `skills:runtime*`；指定来源安装仍调用原安装器。
- `electron/credentialVault.cjs` 使用 Electron `safeStorage` 保存连接器密钥。`src/data/connectors.ts` 持久化时把 `credentials`/token 送入保险库，普通 localStorage 只留下 `credentialRef`；真实连接测试和连接器工具调用前通过 `hydrateConnectorCredentials()` 临时读取。系统加密不可用时拒绝写入明文。
- `electron/updateTransaction.cjs` 在 `upgrade-backups/transaction.json` 保存升级阶段与证据。`autoUpdate.cjs` 在更新前备份、安装准备和启动后验证时推进事务；验证失败进入 rollback 状态。现有加密备份和旧版回滚下载逻辑仍是实际副作用 owner。
- Windows 安装包已通过 `npm.cmd run dist:win` 与 `npm.cmd run verify:package`：`taiji-office-setup-2.9.4.exe` 195826975 字节，SHA-256 `F1AFA846C979B1D90F4ED97BD9DDC977C1CF425A50BC60159599E81A7C2A41DE`；Blockmap 206051 字节，SHA-256 `9555F64DA5BAAC9CEC5D9F2707EE1D3BAF1D58052E1F4A78EC722DD829F40E8C`；`latest.yml` 353 字节，SHA-256 `FB18975C1FDF973C10F49450B1D7E82C36CAA7D485CDE9A19EE2C5BFA49FEEB5`。远端 GitHub Release 待发布脚本完成后核对。
- 发布治理脚本：`generate-sbom.mjs`、`generate-release-provenance.mjs`、`verify-release-governance.mjs`；统一门禁为 `npm.cmd run verify:phase3`。它会生成 `docs/sbom-v2.9.4.json` 和 `docs/release-provenance-v2.9.4.json`，检查版本、必要文件、依赖清单和高置信度密钥模式。
- 入口验证：`verify:model-compatibility`、`verify:skill-runtime`、`verify:credential-vault`、`verify:update-transaction`、`verify:phase3`、`verify:v2-core-gate` 和 `npm.cmd run build` 已通过；真实 Electron E2E 在当前机器再次出现图形驱动进程崩溃（GPU exit `-1073741515`），不能冒充第三阶段通过，需在稳定图形环境复验。
- 正式八小时驻留、使用真实第三方账号的连接器矩阵、从已发布旧版安装包到 `v2.9.4` 的真实故障注入回滚，以及 GitHub 下载后的远端资产哈希核对，仍是 v3.0 候选验收项。本阶段代码不把这些未执行项目写成已完成。
- 人格版本为 v18；自我评分见 `docs/自我评分.md`。后续优先先做真实打包/安装/回滚验收，再处理剩余 P1 稳定性问题。

## v2.8.4 长任务、Coding Runtime 与真实 Electron

- 第二阶段统一门禁是 `npm.cmd run verify:phase2`，顺序执行 Lint、标准测试、ExecutionController v2、Coding Runtime v2、三个独立 Git 仓库、项目 DAG、真实 Electron E2E、12 窗口驻留冒烟和生产构建。正式八小时长驻必须单独运行 `npm.cmd run verify:phase2-soak:8h`。
- `executionController.mjs` 保存版本化预算、路线历史、结果指纹、失败分类、检查点、证据与未决问题。没有新证据的同一路线不得机械重试；恢复时使用保存的决策和检查点，不从聊天文本重建。
- `chatStream.mjs` 是 OpenAI 兼容 SSE 的唯一增量解析入口。工具参数可能跨多个 chunk，只有完整合并后才能执行。团队 UI 使用 200ms 合并刷新，心跳不得触发全任务与产出物扫描。
- `codingRuntime.cjs` 负责受控工作区中的索引、符号查找、原子补丁、影响分析、测试选择、命令会话、Diff、风险和回滚点。交付面板应消费结构化报告，不解析模型自述。
- `codingProject.mjs` 编译能力/负载匹配与阶段工件合同。执行中补人和替换负责人修改同一项目；审查失败只重开责任步骤、复审和交付，保留无关完成步骤。
- `imageSpecifications.mjs` 定义 GPT Image 2 的画幅、清晰度、质量与像素解析；`ImageGenerationOptions.tsx` 在助手、员工和团队复用。非 GPT Image 2 模型会降级到兼容标准尺寸并明确提示。
- Electron 锁定 `43.2.0`。`build-windows.ps1` 必须核对 `dist/version`，运行时缺失或版本不符时通过 Electron 官方安装器恢复锁定版本；不能只检查 `electron.exe` 是否存在。
- 本机真实 E2E 已通过。12 窗口短驻留结果为 DOM 节点/文档数稳定、渲染堆增长 `0.15 MB`；这不是八小时证据，交接和发布说明不得混写。
- 发布资产：`taiji-office-setup-2.8.4.exe` 为 `195822199` 字节，SHA-256 `5FC2E8E0922FF27E2108D1DD61710FA20959753FE7ED0E6E2EEBC97785B5BE3A`；Blockmap 为 `206372` 字节，SHA-256 `29DCD73E098A468E37660CE65FE0581BBFCBDAD2A0B23CC9856FC8393C9C58A6`；`latest.yml` 为 `353` 字节，SHA-256 `B5757498C34257334C080971BF1FB2DD6042E9BC475B1B4E62A59E2AA30442C8`。
- 人格版本为 v17。第三阶段从 v2.9.0 的模型与图片兼容矩阵开始，随后依次完成 Skill Runtime、连接器/MCP 安全、更新回滚演练和发布治理。

## v2.7.4 工程内核标准化

- 标准测试栈为 Vitest + Testing Library + jsdom + V8 coverage。`test/` 按 unit、components、integration、fixtures 组织；`verify:phase1` 是阶段一入口，覆盖率阈值不得为了发布临时降低。
- `appStateReducer.ts` 与 `appStatePersistence.ts` 分别承载纯状态转换和持久化副作用；新增 action 时必须同时说明状态变化、持久化位置和对应测试，禁止把副作用写回 reducer。
- `theme.css` 是导入清单。新增或移动样式应进入 `styles/core.css`、`collaboration.css`、`appearance.css`、`settings.css` 或 `workspace.css`，并保持稳定导入顺序。
- `resourceContract.mjs` 统一保护 web/file/attachment/skill/connector/employee/task。`explicitResourceContract.mjs` 是旧 API 兼容层，不应再增加只适用于网页的新规则。
- `resourceAcquisition.cjs` 先直接读取，失败后按类别决定是否进入 `browserPageReader.cjs`。不得增加主题搜索作为指定 URL 的正文替代；404 必须终止，获取尝试必须进入证据。
- `verify:known-url-live` 使用独立 Electron 用户目录和软件渲染参数。当前微信实机结果为 direct-http blocked -> browser-session success，正文 1219 字，无无关搜索。
- `taskDecisionKernel` 的模型候选只负责语义判断；规范化层保护目标、对象、任务关系、工具权限和证据边界。200 条轨迹门槛为 95%，失败样例要加入 fixtures 后按类别修复。
- 人格版本为 v16。下一阶段不要重做本阶段模块，直接进入 v2.8.0-v2.8.4：ExecutionController v2、流式预算、Coding Runtime v2、专业团队协作和真实 Electron 长驻。
- v2.7.4 安装包大小为 `175437030` 字节，SHA-256 为 `770A5A95C18B2F6ADD5A6DBBD7604730E006DED138473D946338E8C0FB6BA24F`；Blockmap 为 `181343` 字节，`latest.yml` 与安装包版本一致。包内验收确认 20 个必需文件和 6 个字体均存在。
- 本机覆盖安装后的 ASAR 包版本为 `2.7.4`，可执行文件产品版本为 `2.7.4.0`，启动后进程正常。用户数据文件数只随运行时锁和会话文件在 263-265 间变化，没有执行清空或重建。

## v2.6.2 明确资源合同与更新状态机

- `explicitResourceContract.mjs` 负责从当前目标和已绑定对话引用中提取、规范化并锁定网页 URL。它不替模型写计划，只保护用户明确对象不被搜索结果、相似页面或旧上下文替换。
- 指定网页的总结、分析、翻译和改写必须以原地址的 `read_web_page` 成功记录作为完成证据。助理循环与 `nativeExecutionAdapter` 使用同一调用前门禁和完成验收，不得只改提示词。
- `fetchKnowledgeUrl` 必须拒绝空正文和常见访问验证/拦截页，不能让反爬提示成为成功证据；其 User-Agent 使用 Taiji 身份。
- `taskDecisionKernel` 已将 `read_web_page` 纳入正式路由；模型误选 `web_search` 时，规范化层会恢复精确网页路线。
- `autoUpdate.cjs` 负责检查超时、错误回传和统一状态发送；`App.tsx` 的按钮只负责展示与合法操作。源码版本与 GitHub Release 是两件事，没有对应 Release 安装包时客户端不会发现新版本。
- 人格版本为 v15，旧自定义人格按章节追加明确对象协议。回归入口：`verify:explicit-resource-contract`、`verify:update-control`。
- `v2.6.2` 安装包为 `175439262` 字节，SHA-256 为 `DF421190A3F3A728F0D32724E0EB7BED8DEEDB572A81C236E8018994C8C777C0`；Blockmap 为 `181810` 字节，`latest.yml` 为 `353` 字节。本机覆盖后安装包版本和关键内核文件均已核对，用户数据文件覆盖前后均为 259 个。

## v2.6.1 阶段三：图片编辑、记忆质量、模块与性能门禁

- `generateImage(prompt, model, attachments)` 是图片能力统一入口。本轮有可读图片时，必须经 `imageRequest.mjs` 走 `/images/edits` multipart 请求；无图片时才走 `/images/generations` JSON 请求。`apiFetch` 不得为 FormData 强制设置 `Content-Type`，边界参数由浏览器生成。
- `userMemoryQuality.mjs` 是用户长期记忆质量规则，`userMemory.ts` 是本地持久化边界。过期待复核记忆不得注入模型；用户确认后更新复核时间和可见原因。不得把这套规则重新塞回 `hermesClient.ts`。
- `nativeExecutionPolicy.cjs` 是原生执行的纯策略边界；`nativeExecutionAdapter.cjs` 保留执行时序、队列和副作用。`eventFanout.mjs` 负责本地订阅分发与注销清理。`verify:module-boundaries` 约束当前四个超大文件继续增长。
- 性能基线为 268 名目录专家、320 员工、40 个任务共 12000 条事件、12 个窗口监听者与 5000 次广播。该测试是确定性内核基线，不等同于真实 Electron 长驻压测；后者仍是阶段三后续项。
- v14 人格迁移按 `##` 章节检测缺失协议并增量附加，不覆盖自定义人格。附件存在时不得沿用旧失败结论声称没有图片。
- 本版专项入口：`verify:image-model-routing`、`verify:user-memory-quality`、`verify:native-execution-policy`、`verify:module-boundaries`、`verify:phase3-performance`，均已纳入 `verify:v2-core-gate`。

## v2.6.0 阶段三：执行观测、错误诊断与账本保护

- 正式应用身份为 `taiji-office` / `com.taiji.office`。`electron/appIdentityMigration.cjs` 在主进程初始化最前面将旧 `%APPDATA%/hermes-office-pro` 业务数据复制到 `%APPDATA%/taiji-office`，已有目标文件不覆盖，缓存、进程锁和旧更新器 ID 不复制；迁移通过 `verify:app-identity-migration` 验证。
- `electron/executionObservability.cjs` 将执行器的原始状态投影为用户可读的队列、运行、等待子任务、补偿、暂停与终态，并统计重试、工具结果、失败类型、证据完整度和持续时间。
- `electron/operationDiagnostics.cjs` 是运行时唯一的错误证据源。诊断记录保留任务/团队、模块、操作、错误分类、可恢复性和脱敏上下文；主进程、渲染窗口、任务账本、恢复前置检查、IPC 和原生执行器都写入它。文件保存于客户端用户数据的 `task-runtime/diagnostics.jsonl`。
- 诊断中心可查询摘要和导出 JSON。导出内容已经脱敏，可作为问题复现的附件；不要再依赖截图猜测实际异常。
- `taskRuntimeStore.write()` 将渲染端快照视为建议数据：旧快照中遗漏的活跃任务不会触发 `task_removed`。只有 `removedTaskIds` 明确列出且任务已终态，才允许删除。此规则防止父任务被删除后执行器持续写入并报“找不到任务”。
- 回归入口：`verify:execution-observability`、`verify:operation-diagnostics`、`verify:app-identity-migration`、`verify:task-runtime-store` 与 `verify:native-execution`，前三项已纳入 `verify:v2-core-gate`。阶段三后续仍需完成核心模块拆分、性能/内存压测、真实更新下载校验与回滚演练。
- 本机已完成旧安装身份卸载、新目录安装和真实启动迁移：225 个业务文件复制成功、0 个失败，任务账本、记忆和工作区规模保持一致。安装包为 175428775 字节，SHA-256 为 `49A59EDD0FE78D6DDC296654014FF915F4B11102075E329CE047C0DA5916502D`。

## v2.5.1 阶段二：Coding Runtime 与项目 DAG

- `src/engine/codingProject.mjs` 将软件 `ProjectBrief` 编译为可序列化 DAG：产品、架构、UI/UX、前端、后端、验证、审查、交付。每个节点有负责能力、依赖、重试、验收条件；缺少合适成员时记录职责缺口并阻止错误派工。
- `electron/codingRuntime.cjs` 是主进程独立编码运行时，管理任务工作区或 Git Worktree，建立文件/符号/导入索引，提供代码搜索、依赖反查、Diff/检查点和有超时分类的增量命令会话。
- `TaskService` 增加 `coding` 任务类型并持久化 `codingProject`、工作区索引和审查退回记录。审查拒绝会仅将指定责任步骤重新排队，其他已完成步骤不被重置。
- 团队原生工具提供 `coding_repository_index`、`coding_search`、`coding_dependencies` 和 `coding_checkpoint`；仅允许操作已建立的受控工作树。
- 回归入口：`npm.cmd run verify:coding-runtime`，已加入 `verify:v2-core-gate`。Windows 安装包已通过 `npm.cmd run dist:win` 制作并完成完整性检查；GitHub Release 尚未创建。

## v2.5.0 阶段二：专家人格数据与团队入口

- `expertToEmployee()` 现在把简明角色职责写入 `prompt`，将完整 `instructions` 写入 `soul`。这对应运行时的职责分层：`prompt` 提供身份和回复边界，`soul` 作为深层工作规则被私聊和团队执行共同注入。
- `normalizeCatalogEmployeePersonas()` 在 `fetchInitial()` 中执行。它只迁移带 `catalogId` 的内置专家，识别旧版精确拼接或“专业工作规则”标记；自定义 `prompt` 保留，空 `soul` 补为官方专家规则。该迁移可重复执行。
- `OfficeView`/`Workstation` 增加 `onStationEdit` 和设置图标，调用 Electron 工具窗口中的既有 `EditEmployeeModal`，无 Electron 时回退为主窗口编辑弹窗。
- `SidebarPanel` 不再导入或渲染 `TeamList`；团队生命周期操作只由 `TeamHallPanel` 承担，避免两个列表在状态和操作上漂移。
- 回归入口：`npm.cmd run verify:v250-personas-and-office`。当前版本尚未打包或发布。

## v2.4.0 阶段一：轮次语义与平台级图片模型

- `taskDecisionKernel` 现在输出 `turnRelation`，把新任务、续办、纠错、控制和询问作为不同类型处理。AssistantChat 仅把确认为 `new_task` 的独立目标放入新的执行队列。
- `hermesClient` 提供模型能力推断、聊天场景覆盖和通用 `generateImage`。`gpt-image-2` 请求到 `/images/generations` 时发送 `output_format: "png"`，旧兼容模型才发送 `response_format: "b64_json"`。
- `ModelSelector` 的图片模型选择保存到 `chatModelOverrides`；AssistantChat、DmChatApp、TeamChatApp 均检测图片能力并将生成的附件持久化到消息中。`GeneratedImagePreview` 统一展示和下载这些图片。
- 回归入口：`npm.cmd run verify:image-model-routing` 与 `npm.cmd run verify:task-turn-isolation`。二者都已纳入 `verify:v2-core-gate`。
- 本阶段没有制作 Windows 安装包或 GitHub Release。真实图片生成仍需在设置中配置可用的 OpenAI/API 兼容服务凭据后进行手动验收。

## v2.3.1 软件项目职责编译与导航完整性

完整软件产品需求必须由 `capabilityGraph.mjs` v3 编译为稳定职责基线，模型能力只做并集补充。`teamMembership.ts` 的项目重匹配必须在单人添加/替换逻辑之前处理，并使用当前会话待批项目的 `request` 与 `projectId`；不得从“人员不对”这类纠错句创建新项目。

核心职责推断只能使用员工稳定身份字段和显式能力，长提示词中的相邻领域说明不能改变角色归属。完整回归位于 `scripts/verify-v231-dispatch-and-brand.mjs`，覆盖用户提供的创作者发布平台客户端对话、无关候选排除、模型能力漏项保护、太极导出品牌和办公室导航合同。

办公室导航使用显式左右按钮和滚轮横向转换，激活项必须自动进入可见区域；主题色只使用现有 CSS 变量。真实 Vite 页面已在 `1280×720` 与 `760×720` 检查 272 人目录和 12 个分类，无页面横向溢出。完整系统评分与 Coding Runtime 建议见 `docs/自我评分.md`。

## v2.3.0 员工导航、主题工牌与专用模型

办公室分类由 `src/data/employeeProfiles.ts` 统一推导，`OfficeView` 只过滤当前真实员工并显示实时计数。不要为分类另建持久化员工名单，否则新建、导入或目录补齐员工后会再次不同步。工牌正反面共用现有主题变量；正面是可键盘操作的私聊入口，翻面和背面私聊按钮保持独立。大量员工依靠办公室自身滚动与 `content-visibility`，不能退回一次只显示 12 人的固定布局。

头像生图复用现有模型库的地址和凭据，但必须显式设置 `imageModelId`，不允许静默使用聊天主模型。接口契约位于 `generateEmployeeAvatarImage()` 与 `parseGeneratedAvatarPayload()`，支持 Base64 和 HTTPS URL；图片类型、下载超时和 10MB 上限必须保留。生成结果只有在用户点击“使用这个头像”后才进入员工数据。

诊断优化模型通过 `diagnosticModelId` 单独指定。`diagnosticOptimizer.ts` 的自动动作白名单只能包含 `skill` 与 `permission`：前者只修复来源明确的用户安装 Skill，后者只恢复沙盒和两类低风险委托审核。模型、连接器、密钥、外部软件、路径、代码、系统运行时均不可由模型猜测修改；每次动作后必须重新执行确定性诊断并展示仍需用户处理的项目。

专项门禁：`npm.cmd run verify:v230-experience`。该检查已进入 `verify:v2-core-gate` 与正式 GitHub 发布脚本。Vite 实测覆盖 `1440×960` 和 `1024×720`；Electron 原生 UI 仍需结合下文图形进程故障继续验证。正式发布已由脚本核对发布源码提交 `ac6a3c389d5e6238561c72166a0945eec5ce7d6c`、标签和 [GitHub Release v2.3.0](https://github.com/TTflysky/sirenhuisuo/releases/tag/v2.3.0)。`taiji-office-setup-2.3.0.exe` 为 `175403350` 字节，`.blockmap` 为 `181355` 字节，`latest.yml` 为 `353` 字节，安装包 SHA-256 为 `F929BA87A3B7A64D0CC8CE78376D93EFAD6539B5BA0804C00AF1F83B39CDFD31`。办公室逻辑预留 999 个工位并可继续扩展；界面默认只渲染 24 个可见空位，避免以 999 张空工牌制造性能回归。

## v2.2.2 组队连续性与依赖执行

本版解决两个 P0 根因，不能用提示词替代。第一，项目草案是结构化状态而不是最近几条聊天的推断：草案绑定创建它的聊天会话，保存原始目标、确认成员、名单修订和方向确认状态。换人、加人和删人都必须改同一份名单；“可以”“就这个团队，拉群吧”只能批准当前会话的待批方案，不能重新匹配专家。UI/UX 泛称若无法唯一定位员工，必须追问，绝不能回退到普通设计师或无关专家。

第二，建立团队与开工分开。批准后只创建团队并在群内确认第一版边界、知识来源/部署、必需能力和界面风格；用户确认后才生成依赖计划。执行计划将工作和审查交错，审查未通过阻塞下游；界面只把真实 `running` 标为工作中，`queued` 明确显示为“等待前置步骤/等待执行”。

性能规则：启动和故障恢复可全量读取任务账本；原生执行的高频通知必须按 `taskId` 读取并补丁合并单条任务。工具产出只在真实 `tool_result` 带有 artifact 时同步；IPC 通知只传简短预览，完整证据仍从主进程账本读取。

发布记录：`ea64c9594dae8a790c05e4547d5447443fb9ed42` 已在 `main`，标签与 Release 均为 [v2.2.2](https://github.com/TTflysky/sirenhuisuo/releases/tag/v2.2.2)。Release 已包含 `taiji-office-setup-2.2.2.exe`（`175395904` 字节）、`.blockmap`（`181461` 字节）和 `latest.yml`（`353` 字节）；安装包 SHA-256 为 `6FDC81FB950D744207C3687B2EBF5FCF1A5E4D54A2B2C4AC77A3858464D8F944`。`verify:v2-core-gate` 与 `verify:package` 已通过；本机 Electron 图形 UI 自动化仍待图形环境正常的机器补跑。

下次发布前必跑命令：`npm.cmd run verify:team-membership`、`verify:dispatch-intelligence`、`verify:orchestration-control`、`verify:project-board`、`verify:team-execution-protocol`、`verify:native-execution`、`verify:v2-core-gate`、`npm.cmd run dist:win`、`npm.cmd run verify:package`。

## v2.2.1 专家员工化与交接

`v2.2.1` 已将 `jnMetaCode/agency-agents-zh` 的 268 位 MIT 许可中文专家内置到客户端，并在首次启动时补齐为真实办公室员工。迁移只追加缺失专家，保留用户既有员工、团队、聊天、任务、模型配置和工作区；专家拥有稳定的职责名称、部门、头像框和工位。办公室由最少 24 个工位按实际人员增长，避免旧版固定 999 空工位。

本版同时保留 `ProjectBrief`、项目审批上下文和执行中动态增员的主进程同步。当前已完成的是专家目录、员工物化和名单同步；尚未完成的专业专家分别产出方案、由项目简报编译完整执行 DAG、专家目录独立管理页和中途增员审计 UI，详见 [`V2.2.0_AGENCY_EXPERT_ORCHESTRATION.md`](./V2.2.0_AGENCY_EXPERT_ORCHESTRATION.md)。下一位开发者应先读该文档及根目录 `handoff.md`，再从 `SpecialistOutput` 数据模型和 ProjectBrief 到 TaskPlan DAG 的编译开始，不能将当前规则驱动项目简报误报为完整多专家协作。

发布资产为 `release/taiji-office-setup-2.2.1.exe`、同名 `.blockmap` 与 `release/latest.yml`。只有 GitHub Release `v2.2.1` 的标签、三个资产大小与 SHA-256 均由发布脚本核验一致后，才可声明客户端已同步。

## v2.1 Hermes 真实运行链路

`v2.1.0` 沿用现有太极架构，新增贯穿助手、员工私聊和原生团队 Worker 的持久 Turn Lifecycle。它只保存可审计的公开行动轨迹，不保存隐藏思维链；模型公开决定、工具调用与结果、上下文压缩、用户插话、预算、退出原因和恢复条件均可跨 TaskService 恢复。

生命周期使用严格单调序号，旧窗口和延迟 IPC 不能回退新状态。工具开始与结果按 `callId` 配对，中断后可由同一真实证据闭合；TaskService 在主进程再次脱敏生命周期和恢复胶囊。`waiting_user`、`paused`、`checkpointed`、`stopped`、`failed` 与 `completed` 保持不同语义，进程心跳不会刷新真实进展。

源码级四层映射、未照搬边界和后续保留项见 `docs/HERMES_RUNTIME_ALIGNMENT_V2.1.md`。专项回归为 `npm.cmd run verify:turn-lifecycle`，并已进入 `verify:v2-core-gate` 与正式发布脚本。

`v2.1.0` 安装包为 `release/taiji-office-setup-2.1.0.exe`，大小 `174349843` 字节，最终发布资产 SHA-256 为 `90EF3F096CFFF8F0CDFB3787ABD11ED1088B3F459E4293F0AA3DC15AEC678F44`。`verify:v2-core-gate`、`verify:v1-core-gate` 与 `verify:package` 已通过，GitHub Release 为 `https://github.com/TTflysky/sirenhuisuo/releases/tag/v2.1.0`。本机 Electron 33 的 GPU 子进程仍以系统错误 `-1073741515` 在渲染前退出，因此真实窗口 UI 回归需在图形环境正常的办公室电脑补跑，不能写成已通过。

## v2.0 统一智能体运行时

`v2.0.1` 在统一运行时上补齐可信进度与会话边界：助理、员工私聊和团队都有可恢复的新聊天；原生任务、异步消息和动态子任务携带所属会话；父任务先恢复后代再继续；Worker 心跳与真实动作分开记录。模型或工具超过时间边界仍无结果时，系统会保留现场并暂停，不再无限显示“工作中”。Skill 安装也统一支持 SkillHub、GitHub、ZIP 和 `SKILL.md`，只有完成回读和健康检查后才算安装成功。

真实 Electron 窗口回归使用 `npm.cmd run verify:chat-controls-ui`：脚本会分别点击助理、员工和团队的“新建聊天”，再验证停滞任务的暂停提示与“继续执行”即时反馈。员工私聊工具栏在窄窗口下使用不压缩的图标按钮和自适应换行，避免中文标签被挤成竖排。

`v2.0.0` 在现有产品和持久化基础设施上统一了认知闭环，没有推翻 UI、TaskService、Worker、员工、团队、聊天、人格、记忆、Skill、Connector 或本地数据。核心链路为：模型理解目标并选择精确动作 -> 运行时校验工具、Schema、安全、权限、审批和预算 -> 原样执行参数 -> 真实结果回注模型 -> 模型重新判断 -> 按交付类型验收 -> 统一收尾或恢复交接。

新内核位于 `src/engine/turnRuntime.mjs`、`capabilityGraph.mjs` 和 `moaRuntime.mjs`，并同时接入 `src/data/hermesClient.ts` 与 `electron/nativeExecutionAdapter.cjs`。团队调度不再按整段文本词频凑人；模型生成的交付类型、验收标准和所需能力会完整进入 TaskRun 合同。发布门禁为 `npm.cmd run verify:v2-core-gate`，完整旧版回归仍使用 `npm.cmd run verify:v1-core-gate`。

详细责任边界、轨迹与恢复规则见 `docs/V2_RUNTIME_ARCHITECTURE.md`。

## v1.0 发布基线

`v1.0.2` 统一助理、员工私聊和团队聊天的执行详情：折叠列表保留紧凑摘要，展开内容跟随全局字号，宽版详情支持逐步查看、完整参数/结果、复制、自动换行和原样显示。默认字体仍为幼圆，另外五款用户要求随安装包提供的中文字体已恢复为可选项；`verify-packaged-app.cjs` 会验证六个字体文件真实进入 `app.asar`，不能再以“未使用资源”为由删除。

`v1.0.1` 将团队调度重新接回模型任务决策内核：模型只负责编译目标、路线和所需能力，真实成员选择仍由员工目录、能力覆盖和审批卡确定。UI/UX 类任务必须覆盖 UI/UX 与前端实现，待审批成员可按姓名或职位直接纠正；办公室人数、名单、在线状态和团队数量改为本地控制面直答。助理聊天新增可恢复历史的“新对话”边界。专项回归为 `npm.cmd run verify:dispatch-intelligence`。

`v1.0.0` 将助理、员工私聊和团队任务统一接入持久化 TaskService：任务合同、可执行计划、真实子任务、工具与交付证据、审查、补偿、审批、任务树和恢复计划均以任务账本为唯一事实来源。发布门禁为 `npm.cmd run verify:v1-core-gate`，其中包含 `verify:v1-fault-injection`，覆盖超时重试、权限与授权边界、Worker 重启、子任务中断、补偿审批和 Skill 证据。

所有可见入口和内置人格均使用“章北海助理”；默认人格版本为 v13，已有自定义人格保留原文并追加一次 v1 任务账本与恢复协议。客户端默认字体为幼圆，并随安装包提供另外五款可选中文字体。

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
2. 章北海助理是默认调度者：普通团队工作请求由助理先接收和拆解；用户明确 `@员工` 时，助理不能抢答或代替该员工完成任务。
3. 团队任务按计划顺序执行；模型超时或上一步没有返回结果时，后续步骤必须等待，不能跳过。审查不通过时只退回责任人对应步骤。
4. 员工不能只口头承诺“已完成”。需要文件的任务必须通过工具写入真实工作区；界面需展示可观察的任务状态、工具调用和最终交付物。
5. 助理、员工单聊、团队聊天的附件能力必须保持一致：选择文件、粘贴、拖拽、真实落盘、错误提示和工具可读取性不能只修其中一个入口。
6. 交付物只登记真实文件，并分为最终交付、工作文件、参考资料；绝不能把聊天摘要、工具日志、附件占位或重复记录冒充产物。
7. 每次功能交付必须升级版本、构建 Windows 安装包并计算 SHA-256；补丁版本只做本地安装验收，功能大版本验收通过后才提交、推送 `main` 并创建 GitHub Release。
8. 面向用户的最终回答必须先说清楚成功、失败或进行中；原始工具名、命令、参数、退出码和日志只放在折叠执行过程中，不能在消息正文重复展示。
9. 工具审批和命令沙盒必须同时覆盖助手、员工私聊和团队聊天。审批被拒绝时必须返回“未执行”的真实结果，不能把取消、权限不足或沙盒拦截描述成完成。
10. 所有执行入口必须先通过 `taskDecisionKernel` 还原真实目标、首选路线和完成标准，再进入统一 Turn Runtime。模型负责业务路线和精确工具参数；确定性层只校验工具、Schema、安全、权限、审批、重复和预算。结果返回后由模型重新判断，最终通过任务合同与真实证据验收；不得重新引入主题关键词强制路线或“工具返回内容就算成功”的分支。
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
- 章北海助理、员工私聊和团队执行支持运行中“排队 / 引导”，员工工作状态在所有窗口通过 Store 广播同步。
- 章北海助理伴随窗是主窗口的 owned window，保持同一窗口层级但不跨应用永久置顶。

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
| `src/components/chat/AssistantChat.tsx` | 章北海助理聊天与运行中引导。 |
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

- 渲染进程配置、聊天与兼容缓存：Chromium `localStorage`。现存 `hermes_office_*` 键是历史数据兼容层，不是应用身份；改键必须通过独立版本迁移和回滚验证，不能直接删除。
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
2. 执行“每个阶段开工前先做路线回顾”，形成已完成、未完成、本阶段边界和验收场景四项结论。
3. 阅读本文件的“不可破坏规则”和“附件处理链路”。
4. 从用户当前反馈中选一个可验收的问题，先复现，再沿对应模块修改；不要顺手重构无关部分。
5. 涉及聊天/附件/模型/任务时，必须同时检查助理、单聊、团队三条路径。
6. 完成后按第 7 节的版本、安装包、GitHub Release 流程交付。
