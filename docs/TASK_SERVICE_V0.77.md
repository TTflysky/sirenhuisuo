# v0.77 Task Tree Audit Projection

`TaskService.tree(taskId)` constructs an ordered audit projection from the durable task ledger. It starts at the requested root and returns every descendant with its depth, task state, current blocker, next action, child IDs, step totals, verified artifacts, and compensation outcome counts.

The projection exposes aggregate totals for completed, active, failed/stopped, and blocked nodes. It is intentionally derived at read time from ledger state, rather than maintained as an independently mutable UI cache.

The Electron `task-service:tree` endpoint and preload declaration make the same projection available to recovery controls, diagnostics, and the future task-tree interface.
