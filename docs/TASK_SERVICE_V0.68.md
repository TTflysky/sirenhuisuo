# v0.68 Verified Child-Task Handback

`delegate_subtask` now establishes two durable boundaries:

1. The parent waits while the child task owns the delegated step.
2. After the child passes its own completion gate, the parent receives a structured handback instead of a chat-only completion notice.

The handback contains the child task ID, task goal, completed-step summaries, verified artifacts, and completion time. It is recorded on the parent delegation, the delegated parent step, the parent recovery capsule, and `childTaskResults`. Any later parent step receives those verified results as explicit execution context.

The native execution regression verifies that the parent never starts a child-owned step, that child completion updates the parent, and that the result remains available for downstream use.
