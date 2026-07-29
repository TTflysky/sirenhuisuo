# v0.53.0 Task Contract and Plan

TaskService 现在会为每个新任务生成版本化 Contract 和 Plan，并在写入前校验步骤 ID、依赖关系、执行器、重试策略和验收标准。

Runner 只能从 `readySteps()` 返回的步骤中选择工作。前置步骤没有真实 `completed` 状态时，后续步骤不会被放行。步骤失败必须明确是可重试还是阻塞，不能由模型文字自行跳过。
