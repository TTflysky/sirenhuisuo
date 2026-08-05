# 太极 v3 -> v4 活路线表

更新时间：2026-08-05
当前版本：`v4.0.0`（源码与发布门禁已完成，尚未创建 GitHub Release）

这张表是每轮开发开始前的事实基线。只有存在代码和测试或发布证据的项目才能标为完成；没有证据只能标为部分完成。

| 阶段 | 目标 | 状态 | 当前证据 | 剩余工作 |
| --- | --- | --- | --- | --- |
| v3.6 | GoalState、SituationModel、DecisionRecord、稳定目标身份、插话与恢复 | 主体完成 | `src/engine/autonomousControl.mjs`、`src/engine/turnRuntime.mjs` | 继续补真实长任务入口回归 |
| v3.7 | AdaptivePlanGraph、局部重规划、失败分类、换路和证据保留 | 主体完成 | `src/engine/adaptivePlanGraph.mjs`、`electron/taskServiceRecoveryCommands.cjs` | 长任务和跨重启实测 |
| v3.8 | 助理/策划者主持团队、依赖执行、阶段交接和有限并行 | 主体完成，仍有尾项 | `src/store/teamDiscussionRuntime.ts`、`electron/nativeExecutionAdapter.cjs`、`src/engine/autonomousExecutionGate.mjs` | 下线未接 UI 的旧 Autopilot 代码；让统一主持层成为所有协作入口的唯一入口 |
| v3.9 | 情景、语义、程序和用户偏好四类记忆 | 主体完成 | `electron/memoryManager.cjs`、`docs/TAIJI_STAGE_V3.13_PROGRESS.md` | 事实版本、冲突证据、路线成功率、时间衰减和统一 UI |
| v3.15 | 长任务驻留、跨重启恢复、上下文一致性、通用产出物语义验收 | 已完成 | `src/engine/taskResidencyCheckpoint.mjs`、`electron/webArtifactVerifier.cjs`、`scripts/verify-v315-soak-kernel.mjs` | 在图形依赖完整机器补正式多窗口/8 小时驻留 |
| v3.16 | 事实版本、冲突证据、路线成功率、记忆时间衰减 | 已完成 | `src/engine/factLedger.mjs`、`src/engine/executionController.mjs`、`electron/memoryManager.cjs`、`scripts/verify-v316-fact-route-decay.mjs` | 已由 v3.17 接入统一主持与 TaskService |
| v3.17 | 统一主持唯一入口、能力矩阵前置检查、事实冲突可执行处理 | 已完成 | `src/engine/unifiedHost.mjs`、`electron/taskService.cjs`、`scripts/verify-v317-unified-host.mjs` | 进入升级事务与发布治理收口 |
| v3.18 | 更新事务完整性、迁移矩阵、安装后健康检查、回滚证据 | 已完成 | `electron/upgradeGovernance.cjs`、`electron/updateTransaction.cjs`、`scripts/verify-v318-upgrade-governance.cjs` | 由 v4 发布清单继续复用 |
| v4.0 | 自主控制层成为唯一主持入口，完成长任务、恢复、审批、真实交付和回滚 | 源码完成，待正式发布 | `src/engine/v4ReleaseReadiness.mjs`、`scripts/verify-v4-release-readiness.mjs`、`docs/sbom-v4.0.0.json` | 发布前配置代码签名并创建 GitHub Release |

## v3.14：统一执行前自主授权

- [x] 回顾 v3 -> v4 路线并绑定代码证据。
- [x] 每个工具动作绑定 `goalId`、计划 `revision`、责任 `stepId`、责任员工和工具名。
- [x] 拒绝过期目标/计划、废弃步骤、未完成依赖、错误责任员工和未主持的直接调用。
- [x] 助理、员工私聊、团队成员、原生后台执行器和团队交接读取共用同一门禁。
- [x] 新增回归测试并通过 Vitest `156/156`、原生执行专项、构建和结构门禁。

## v3.14.1：风格化生产界面

- [x] 原版商务、波普漫画和酸性暗黑迁移到生产客户端，共 25 套配色。
- [x] 主窗口、员工私聊、团队、设置和弹层使用同一视觉状态并跨窗口同步。
- [x] 加入 FC、Mac、街机互动音效、80% 默认音量、关闭和调节控件。
- [x] 加入视觉目录单测、CSS 契约门禁和生产界面快照；不改变 `v3.15 -> v4.0` 主路线。

## v3.15：长任务驻留、跨重启恢复与通用语义验收

- [x] 新增 `src/engine/taskResidencyCheckpoint.mjs`，以任务目标、计划版本、已完成步骤、已验证证据、下一步骤、上下文摘要和 Worker 序号建立可校验检查点。
- [x] 原生 Worker 重启前自动校验目标、计划、证据、上下文和步骤状态；一致时自动排回队列，不一致时安全暂停并用通俗原因等待核对。
- [x] 用户主动继续时允许基于当前真实状态重建恢复基线；旧任务步骤不会因恢复被重复打开。新 TaskService 任务默认建立恢复上下文，兼容旧任务补齐缺失字段。
- [x] 驻留摘要把 Turn Lifecycle 的上下文压缩、摘要、未决问题和用户插话纳入哈希，避免上下文变更被误判为一致。
- [x] `verify_web_artifact` 增加通用 `semanticChecks`：分组、DOM/视觉顺序、相邻关系、网格行列坐标和关键交互断言；语义失败与布局失败一样不能完成任务。
- [x] 真实 Electron 回归证明错误网格被拒绝、修正后五类契约通过；同一契约不包含科学计算器专用规则。
- [x] 内核耐久回归覆盖持续心跳、两次上下文压缩、两次用户插话、跨客户端会话恢复和连续 5 个检查点；多窗口图形耐久脚本同步加入真实任务观察。

验证命令：`npm.cmd run verify:v315`。本机多窗口图形耐久测试另外受 Electron 图形驱动环境影响；若出现渲染进程 `launch-failed / exitCode 49`，使用无界面 `verify:v315-soak` 完成内核门禁，并把图形故障记为环境问题。

## v3.15.1：HTML Demo 视觉一致性补丁

- [x] 以 `design-demos/pop-comic-ui/index.html` 与 `styles.css` 作为唯一验收基准，生产 Pop 根布局、标题栏、办公室、工牌、聊天、团队、设置、诊断和弹层按同一视觉变量实现。
- [x] 固化 62px 标题栏、4px 主分界、3px 次级边框、34px 正方形控件、16px/12px 圆角、网点背景、阴影和按钮层级。
- [x] 视觉门禁覆盖 3 套风格、25 套配色、音效面板和跨窗口同步；酸性暗黑继续隐藏工牌挂带并保持标签高对比。

验证命令：`npm.cmd run verify:visual-system`、`npm.cmd run test:run -- --reporter=dot`、`npm.cmd run build`、`npm.cmd run lint`。

## 当前收口状态

1. `v3.18` 已完成：迁移域矩阵、安装后健康检查、回滚证据和升级提交阻断已接入更新事务。
2. `v4.0` 源码已完成：统一主持、五类入口、迁移/健康/回滚证据和 SBOM/来源证明均通过发布门禁。
3. 待正式发布时补齐代码签名证书并创建 GitHub Release；当前无签名属于已知 Windows SmartScreen 风险，不影响源码门禁结果。

## v3.16：事实版本、冲突证据、路线成功率与时间衰减

- [x] `src/engine/factLedger.mjs` 建立按 `factKey` 分组的事实版本链，保留版本号、来源、观察记录和证据 ID；新事实不会静默覆盖旧事实。
- [x] 同一事实出现不同陈述时写入冲突记录，记录新旧版本、证据、是否需要用户确认；支持保留旧版、接受新版、并存和驳回四种处理结果。
- [x] `SituationModel` 持久化 `factLedger` 与未决冲突；已验证证据冲突时决策层进入 `await_user`，未验证冲突先要求补证据。任务详情显示事实账本和冲突摘要。
- [x] 执行控制器的每条工具路线持久化尝试、成功、失败、成功率、失败率和最近结果时间；公开决策摘要显示路线成功率，供换路判断和回放使用。
- [x] 分层记忆 schema 升级到 v3，新增按记忆类型配置的指数半衰期、动态 `decayScore` 和旧数据迁移审计；上下文排序使用衰减后的相关性与重要性，旧事实不会因历史存在永久占据上下文。
- [x] 新增 `verify:v316`，覆盖事实冲突处理、SituationModel 阻断、路线成功率、Electron 分层记忆迁移与衰减排序。

验证命令：`npm.cmd run verify:v316`、`npm.cmd run build`、`npm.cmd run lint`。

## v3.17：统一主持唯一入口与能力矩阵

- [x] `src/engine/unifiedHost.mjs` 固化 assistant、employee、team、worker、background 五类入口，共用请求 ID、目标 ID、入口身份和动作合同。
- [x] TaskService 新任务记录 `hostEntrypoint`、`requiredCapabilities` 和能力矩阵快照；任务账本每次重算都会持久化 `unifiedHost`，旧任务无矩阵时保持兼容但会明确为未同步状态。
- [x] 已配置并有探测记录的第三方能力才进入强制前置检查；缺配置、鉴权失败、限流、协议错误和无效内容不能被模型动作绕过。
- [x] 原生 Worker 工具调用、助理聊天桥和员工私聊桥都在统一自主门禁后再经过能力矩阵检查，避免不同窗口各自解释同一任务。
- [x] `taskService:resolve-fact-conflict`、preload 和类型声明提供事实冲突的正式处理入口，结果写入任务事件账本并可回放。
- [x] 旧 Autopilot 仍只保留兼容展示，不再拥有独立执行权；实际执行继续由 TaskService、统一主持状态和原生 Worker 负责。

验证命令：`npm.cmd run verify:v317`、`npm.cmd run build`、`npm.cmd run lint`。

## v3.18：升级事务与回滚治理

- [x] 每次更新建立迁移域矩阵：员工、团队、会话、任务、记忆、模型、连接器、工作区逐项记录检查结果和证据。
- [x] 安装后健康检查绑定目标版本、数据保留计数、工作区可写、Worker 可用和统一主持可用；任一关键域失败不得提交升级。
- [x] 回滚记录保留失败阶段、备份摘要、旧安装包校验和恢复结果，避免“安装失败但界面仍显示成功”。
- [x] 发布门禁统一检查版本、lockfile、SBOM、来源证明、迁移矩阵和回滚演练证据。

验证命令：`npm.cmd run verify:v318`、`npm.cmd run build`、`npm.cmd run lint`。

## v4.0：自主智能体发布收口

- [x] `unifiedHost` 成为 assistant、employee、team、worker、background 五类执行入口的唯一主持层；旧 Autopilot 仅保留兼容展示，不拥有执行权。
- [x] TaskService 将入口身份、请求/目标 ID、能力矩阵和事实冲突处理写入任务账本，原生 Worker 与聊天桥共享同一动作校验。
- [x] 长任务驻留、跨重启恢复、上下文一致性、事实版本、路线统计、时间衰减和升级回滚治理形成连续证据链。
- [x] 生成 `docs/sbom-v4.0.0.json` 与 `docs/release-provenance-v4.0.0.json`，发布清单检查源码、lockfile、迁移、健康、回滚和来源证据。
- [x] `npm.cmd run verify:v4-release`、构建和 Lint 已通过；未配置代码签名时只保留 SmartScreen warning，若发布策略要求签名则门禁会阻断。

验证命令：`npm.cmd run verify:v4-release`、`npm.cmd run build`、`npm.cmd run lint`。

### 已登记的 v3.15 验收缺口

- 科学计算器的数字键排列错位暴露了通用验收盲区：现有网页门禁能检查运行错误、横向溢出、裁切、边框安全区和控件数量，但不能判断元素分组、顺序、邻接关系和网格坐标是否符合产品语义。
- 本项必须实现为可由任务合同声明的 `semanticChecks` 或布局契约，至少覆盖元素分组、视觉/键盘顺序、相邻关系、网格坐标、关键交互流程和最终目标一致性。
- 同一机制必须适用于导航顺序、表格列、表单字段、步骤次序和其他结构化界面；禁止增加“科学计算器”关键词、固定按键坐标或仅针对当前成品的特例补丁。
- 真实浏览器验收需要同时保存机器可读结果与截图证据。语义检查未通过时，任务不得标记完成，并应只重开责任实现与审查步骤。

## 每轮固定流程

回顾本表 -> 绑定代码和证据 -> 实现当前阶段 -> 测试与构建 -> 更新本表和 `HANDOFF.md` -> 需要发布时再创建 GitHub Release。
