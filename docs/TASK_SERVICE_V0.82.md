# v0.82 Task Tree UI Projection

The existing team task sidebar now consumes `task-service:tree` and `task-service:recovery-plan` when a task card is expanded. It renders the ledger-derived hierarchy, per-node step progress, compensation counts, blockers, and the recovery decision in the task's own detail surface.

The read is on demand and scoped to the selected task. It does not duplicate a mutable front-end task model or try to reconstruct parent-child state from chat messages.
