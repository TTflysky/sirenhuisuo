# v0.81 Approved Compensation End-to-End

The native execution regression now validates the complete high-risk compensation lifecycle. It stops an active task, verifies the dangerous compensation tool has not run, finds the durable pending approval, records approval, sends a normal Worker resume command, and verifies that only the compensation step performs a real tool action.

Approval for compensation transitions the task to `paused`, rather than ordinary `queued`, because Worker resume is the authoritative control boundary. The recovery gate can then verify that the approval cleared the blocker before the adapter adds its dedicated compensation queue entry.
