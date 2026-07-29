# v0.71 Child-Task Failure Reconciliation

When a child task is already `failed` or `stopped`, the parent now synchronizes that terminal state into the delegation record and its child dependency step before failing the parent run.

This preserves the real child error in the parent task ledger and prevents a terminated child from appearing as an indefinite queued or waiting dependency.
