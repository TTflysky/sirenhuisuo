# v0.72 Unified Manual Delegation

Model tool calls and manual delegation now share the same durable contract. A manual delegation creates a `TaskService` child task, binds its ID to the parent delegation and child-owned parent step, and starts it immediately when the parent native job is available.

If the parent is not active, the child remains queued in the task ledger and is recovered through the normal parent-child resume path. A manual delegation is therefore no longer a display-only announcement.
