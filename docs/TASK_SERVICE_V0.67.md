# v0.67 Durable Child-Task Dispatch

`delegate_subtask` now resolves the employee before child-task creation, records the resulting `childTaskId` on both the delegation and parent step, and submits the child to the native execution adapter.

The parent task yields while a child is queued or running. When the child reaches a terminal state, its result updates the parent delegation, parent task step, task runner and team execution projection. This establishes a real parent-child execution dependency rather than a chat-only delegation announcement.
