# v0.79 Recovery Resume Gate

The shared `task-worker:command` Electron IPC now evaluates `TaskService.recoveryPlan(taskId)` before it dispatches a `resume` command to TaskWorker. When the tree still has an authorization, configuration, or compensation blocker, the command returns `ok: false` with the generated recovery plan and leaves durable Worker state untouched.

This puts the recovery decision at the common control boundary rather than in a renderer. Assistant chat, employee chat, team tasks, and future recovery UI therefore cannot accidentally bypass it by issuing the same Worker command.
