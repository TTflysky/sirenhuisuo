# 太极 v3 -> v4 活路线表

更新时间：2026-08-04  
当前版本：`v3.14.0`

这张表是每轮开发开始前的事实基线。只有存在代码和测试或发布证据的项目才能标为完成；没有证据只能标为部分完成。

| 阶段 | 目标 | 状态 | 当前证据 | 剩余工作 |
| --- | --- | --- | --- | --- |
| v3.6 | GoalState、SituationModel、DecisionRecord、稳定目标身份、插话与恢复 | 主体完成 | `src/engine/autonomousControl.mjs`、`src/engine/turnRuntime.mjs` | 继续补真实长任务入口回归 |
| v3.7 | AdaptivePlanGraph、局部重规划、失败分类、换路和证据保留 | 主体完成 | `src/engine/adaptivePlanGraph.mjs`、`electron/taskServiceRecoveryCommands.cjs` | 长任务和跨重启实测 |
| v3.8 | 助理/策划者主持团队、依赖执行、阶段交接和有限并行 | 主体完成，仍有尾项 | `src/store/teamDiscussionRuntime.ts`、`electron/nativeExecutionAdapter.cjs`、`src/engine/autonomousExecutionGate.mjs` | 下线未接 UI 的旧 Autopilot 代码；让统一主持层成为所有协作入口的唯一入口 |
| v3.9 | 情景、语义、程序和用户偏好四类记忆 | 主体完成 | `electron/memoryManager.cjs`、`docs/TAIJI_STAGE_V3.13_PROGRESS.md` | 事实版本、冲突证据、路线成功率、时间衰减和统一 UI |
| v4.0 | 自主控制层成为唯一主持入口，完成长任务、恢复、审批、真实交付和回滚 | 未完成 | `docs/TAIJI_AUTONOMOUS_AGENT_ARCHITECTURE.md` | 完成长期稳定性、真实第三方矩阵和发布验收 |

## v3.14：统一执行前自主授权

- [x] 回顾 v3 -> v4 路线并绑定代码证据。
- [x] 每个工具动作绑定 `goalId`、计划 `revision`、责任 `stepId`、责任员工和工具名。
- [x] 拒绝过期目标/计划、废弃步骤、未完成依赖、错误责任员工和未主持的直接调用。
- [x] 助理、员工私聊、团队成员、原生后台执行器和团队交接读取共用同一门禁。
- [x] 新增回归测试并通过 Vitest `156/156`、原生执行专项、构建和结构门禁。

## 后续顺序

1. `v3.15`：8 小时驻留前的长任务、跨重启和上下文恢复验收。
2. `v3.16`：事实版本、冲突证据、路线成功率和时间衰减。
3. `v3.17`：统一主持唯一入口、旧入口下线与真实第三方账号矩阵。
4. `v4.0`：覆盖安装、跨版本回滚、代码签名和正式发布验收。

## 每轮固定流程

回顾本表 -> 绑定代码和证据 -> 实现当前阶段 -> 测试与构建 -> 更新本表和 `HANDOFF.md` -> 发布 GitHub。
