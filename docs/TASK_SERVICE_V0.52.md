# v0.52.0 Unified Tool Evidence

本版本把原生执行器的每次工具调用回写到 `TaskService.toolAttempts`，并把工具返回的文件证据回写到 `TaskService.artifacts`。

记录内容包括：工具名、步骤、成功/失败、错误分类、脱敏后的输入摘要、输出摘要、证据引用和耗时。密钥、Authorization、API Key 等不会写入账本。

这不是把所有工具强制变成同一种业务逻辑。Skill、连接器和普通工具仍可拥有各自的执行器，但任务系统只接受统一的结果合同。后续 `v0.53` 会把 Plan 和 Runner 的步骤状态正式绑定到这些结果上。
