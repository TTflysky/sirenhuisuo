# v0.57.0 Skill Activation Evidence

Skill 生命周期分为：候选检索、来源确认、安装、规则读取、执行和验证。每个阶段都要写入独立证据。

`installed` 只表示文件已经写入技能目录；`read` 才表示规则正文和引用文档已被读取；`called` 表示运行时真正按该 Skill 进入执行；`verified` 表示对应结果通过了验收。任何阶段都不能冒充后续阶段。
