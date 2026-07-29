# v0.63 Direct Chat Migration

`TaskService` is now connected to both executable chat entry points:

- 章北海助理聊天
- 员工单聊

The decision kernel first classifies a message. Only `execute` decisions create durable tasks. Once created, the task records its contract input, bound references, tool attempts, model usage and terminal state. Completion is accepted only after the execution controller reports completion and the TaskService completion gate passes.

Employee retry jobs retain their original job identifier as the TaskService idempotency key. A retry therefore resumes the same durable task instead of producing an unrelated task history.

This change deliberately does not treat a model response as proof that a file exists, a connector worked, or a delegated employee completed work. Those are separate evidence paths and remain requirements for later versions.
